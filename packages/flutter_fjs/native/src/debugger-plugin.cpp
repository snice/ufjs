/*
 * fjs debugger — the PLUGGABLE MODULE (libfjs_debugger, spec 088/090).
 * Ships next to libfjs; release builds drop it, which is what removes the
 * debugger: the engine holds only an empty six-entry hook table
 * (primjs/.../inspector_hooks.h) and the CDP code that would fill it is not
 * in the process at all.
 *
 * What this module contains: the PrimJS inspector objects (linked in whole,
 * see CMakeLists) plus, in this file, the TCP client socket (the app dials
 * the `fjs debug` relay — the same direction as the dev WebSocket, because
 * phones are unreachable from the dev machine), the newline framing, and
 * the attach/detach orchestration that installs the hooks and the transport.
 *
 * Threading: everything runs on the JS thread. While running,
 * fjs_vm_pump() → transport.feed() drains the socket. While paused, the
 * engine calls run_message_loop_on_pause() and this module blocks there,
 * serving the socket until the frontend resumes. The Dart event loop is
 * blocked inside JS the whole time — which is exactly why the transport is
 * a separate module instead of a Dart-held WebSocket.
 *
 * Engine-callback notes (from the spike, specs/088.../spike/README.md):
 *  - RegisterQJSDebuggerCallbacks consumes a void** array in the ORDER OF
 *    THE MACRO LIST in quickjs.cc, which is NOT the field order of
 *    QJSDebuggerCallbacks2 in quickjs-inner.h (inspector_check /
 *    debugger_exception are swapped). Build the array explicitly, never
 *    cast a struct.
 *  - The engine emits Debugger.scriptParsed itself; nothing to synthesize.
 *  - Frontend messages enter via PushAndProcessProtocolMessages() while
 *    running and ProcessPausedMessages() while paused; the engine pulls
 *    neither — the host feeds both.
 */
#include "fjs_internal.h"

#ifndef _WIN32

#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>

#ifdef __ANDROID__
#include <android/log.h>
#define DBG_LOG(...) __android_log_print(ANDROID_LOG_INFO, "fjs-debug", __VA_ARGS__)
#else
#define DBG_LOG(...) fprintf(stderr, __VA_ARGS__)
#endif

#include "quickjs.h"
#include "quickjs/include/inspector_hooks.h" // the engine-side seam
#include "quickjs/include/quickjs-inner.h"   // DebuggerPause
#include "inspector/debugger_inner.h"        // AdjustBreakpoints & friends
#include "inspector/debugger_struct.h"       // LEPUSScriptSource
#include "inspector/interface.h"             // DoInspectorCheck & friends

namespace {

/* The engine's seam (inspector_hooks.h). Installed at attach, cleared when
 * the session ends — the engine cannot reach any of this before or after.
 * Process-wide, like g_transport below: one debug session per process. */
const QJSInspectorHooks kInspectorHooks = {
    DoInspectorCheck,
    DebuggerPause,
    HandleDebuggerException,
    AdjustBreakpoints,
    DebuggerParseScript,
    DebuggerSetFunctionBytecodeScript,
};

constexpr int32_t kCallbackCount = 23;

struct Transport {
    int fd = -1;
    bool in_pause = false;
    /* Partial CDP line carried across recv boundaries: TCP does not
     * preserve the relay's '\n' framing, and a >64KB scriptParsed
     * split over two recvs used to lose its tail (the buffer was a
     * local). Both feed paths drain through this one buffer. */
    std::string line_buf;
    void *callback_funcs[kCallbackCount];
};

Transport g_transport; // one debug session per process

FJSVM *vm_of(LEPUSContext *ctx) {
    return static_cast<FJSVM *>(LEPUS_GetContextOpaque(ctx));
}

bool write_line(const char *msg) {
    if (g_transport.fd < 0 || !msg) return false;
    std::string buf = msg;
    buf.push_back('\n');
    size_t off = 0;
    while (off < buf.size()) {
        ssize_t n = ::send(g_transport.fd, buf.data() + off, buf.size() - off,
                           MSG_NOSIGNAL);
        if (n <= 0) {
            close(g_transport.fd);
            g_transport.fd = -1;
            return false;
        }
        off += (size_t)n;
    }
    return true;
}

void drop_socket() {
    if (g_transport.fd >= 0) close(g_transport.fd);
    g_transport.fd = -1;
}

/* ---- engine -> host callbacks (MACRO order, see file comment) ---------- */

void cb_run_message_loop_on_pause(LEPUSContext *ctx) {
    g_transport.in_pause = true;
    char tmp[65536];
    while (g_transport.in_pause && g_transport.fd >= 0) {
        pollfd p = {g_transport.fd, POLLIN, 0};
        if (::poll(&p, 1, 500) <= 0) continue;
        ssize_t n = ::recv(g_transport.fd, tmp, sizeof(tmp), 0);
        if (n <= 0) {
            DBG_LOG("debug channel closed while paused (recv %zd)", n);
            drop_socket();
            break;
        }
        g_transport.line_buf.append(tmp, (size_t)n);
        size_t pos;
        while ((pos = g_transport.line_buf.find('\n')) != std::string::npos) {
            std::string line = g_transport.line_buf.substr(0, pos);
            g_transport.line_buf.erase(0, pos + 1);
            if (!line.empty()) ProcessPausedMessages(ctx, line.c_str());
        }
    }
    g_transport.line_buf.clear();
}

void cb_quit_message_loop_on_pause(LEPUSContext *) {
    /* The engine processed Debugger.resume: tell the pause loop to exit. */
    g_transport.in_pause = false;
}

void cb_noop_ctx(LEPUSContext *) {}
void cb_noop_script(LEPUSContext *, LEPUSScriptSource *) {}
void cb_noop_msg(LEPUSContext *, LEPUSValue *) {}
void cb_noop_pc(LEPUSContext *, const uint8_t *) {}
void cb_noop_console(LEPUSContext *, int, LEPUSValueConst *, int) {}
void cb_noop_str(LEPUSContext *, LEPUSValue, const char *) {}
void cb_noop_free(LEPUSContext *, char **, int32_t) {}

void cb_send_response(LEPUSContext *, int32_t, const char *message) {
    if (message) write_line(message);
}
void cb_send_notification(LEPUSContext *, const char *message) {
    if (message) write_line(message);
}

uint8_t cb_is_devtool_on(LEPUSRuntime *) { return g_transport.fd >= 0 ? 1 : 0; }

void cb_send_response_view(LEPUSContext *, int32_t id, const char *m, int32_t) {
    cb_send_response(nullptr, id, m);
}
void cb_send_ntfy_view(LEPUSContext *, const char *m, int32_t) {
    cb_send_notification(nullptr, m);
}
void cb_script_parsed_view(LEPUSContext *, LEPUSScriptSource *, int32_t) {}
void cb_script_fail_view(LEPUSContext *, LEPUSScriptSource *, int32_t) {}
void cb_set_session(LEPUSContext *, int32_t, int32_t) {}
void cb_get_session(LEPUSContext *, int32_t, bool *enabled, bool *paused) {
    if (enabled) *enabled = true;
    if (paused) *paused = false;
}
void cb_get_session_enable(LEPUSContext *, int32_t, int32_t, bool *ret) {
    if (ret) *ret = true;
}
void cb_console_stack(LEPUSContext *, LEPUSValue *ret) {
    if (ret) *ret = LEPUS_UNDEFINED;
}
void cb_on_console_message(LEPUSContext *, LEPUSValue, const char *) {}

/* Registration order = the QJSCallBackName macro list in quickjs.cc. */
void *const kCallbacks[] = {
    (void *)cb_run_message_loop_on_pause,   /* 1 run_message_loop_on_pause */
    (void *)cb_quit_message_loop_on_pause,  /* 2 quit_message_loop_on_pause */
    (void *)cb_noop_ctx,                    /* 3 get_messages */
    (void *)cb_send_response,               /* 4 send_response */
    (void *)cb_send_notification,           /* 5 send_notification */
    (void *)cb_noop_free,                   /* 6 free_messages */
    (void *)cb_noop_ctx,                    /* 7 debugger_exception */
    (void *)cb_noop_ctx,                    /* 8 inspector_check */
    (void *)cb_noop_console,             /* 9 console_message */
    (void *)cb_noop_script,                 /* 10 script_parsed_ntfy */
    (void *)cb_noop_msg,                    /* 11 console_api_called_ntfy */
    (void *)cb_noop_script,                 /* 12 script_fail_parse_ntfy */
    (void *)cb_noop_pc,                     /* 13 debugger_paused */
    (void *)cb_is_devtool_on,               /* 14 is_devtool_on */
    (void *)cb_send_response_view,          /* 15 send_response_with_view_id */
    (void *)cb_send_ntfy_view,              /* 16 send_ntfy_with_view_id */
    (void *)cb_script_parsed_view,          /* 17 script_parsed_ntfy_with_view_id */
    (void *)cb_script_fail_view,            /* 18 script_fail_parse_ntfy_with_view_id */
    (void *)cb_set_session,                 /* 19 set_session_enable_state */
    (void *)cb_get_session,                 /* 20 get_session_state */
    (void *)cb_get_session_enable,          /* 21 get_session_enable_state */
    (void *)cb_console_stack,               /* 22 get_console_stack_trace */
    (void *)cb_on_console_message,          /* 23 on_console_message */
};

/* ---- the transport seam the engine's pump gate uses -------------------- */

void transport_feed(void *opaque, FJSVM *vm) {
    if (g_transport.fd < 0 || g_transport.in_pause) return;
    LEPUSDebuggerInfo *info = GetDebuggerInfo(vm->ctx);
    if (!info) return;
    pollfd p = {g_transport.fd, POLLIN, 0};
    if (::poll(&p, 1, 0) <= 0) return;
    char tmp[65536];
    ssize_t n = ::recv(g_transport.fd, tmp, sizeof(tmp), 0);
    if (n <= 0) {
        DBG_LOG("debug channel closed by relay (recv %zd)", n);
        drop_socket();
        return;
    }
    g_transport.line_buf.append(tmp, (size_t)n);
    size_t pos;
    while ((pos = g_transport.line_buf.find('\n')) != std::string::npos) {
        std::string line = g_transport.line_buf.substr(0, pos);
        g_transport.line_buf.erase(0, pos + 1);
        if (!line.empty()) PushAndProcessProtocolMessages(info, line.c_str());
    }
}

void transport_close(void *opaque) {
    (void)opaque;
    g_transport.in_pause = false;
    g_transport.line_buf.clear();
    /* VM teardown only: pull the hooks with the dying VM's inspector state.
     * The TCP session deliberately SURVIVES the reload (that is the whole
     * point — see fjs_vm_debugger_attach); the next VM's attach reuses it
     * without a dial, so a reload can never lose the channel to the dial
     * race or to a second app that grabbed the slot in between. */
    QJSSetInspectorHooks(nullptr);
}

} // namespace

// ---- exported by THIS module (libfjs_debugger.so) --------------------------

namespace {

/* Copies a failure reason into the engine's last-error slot so the Dart side
 * can log WHY an attach failed — an empty "re-attach failed:" once cost an
 * afternoon of guessing between a busy relay and a dead network. */
void attach_fail(FJSVM *vm, const char *fmt, ...) {
    if (!vm) return;
    char msg[256];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);
    snprintf(vm->last_error, sizeof(vm->last_error), "%s", msg);
    DBG_LOG("attach failed: %s", msg);
}

/* Installs this VM's slice of the debug session: the process-wide hooks plus
 * the per-context inspector state. Runs on first attach AND after every
 * reload (a fresh VM means a fresh runtime/context to wire up). */
void install_vm_state(FJSVM *vm) {
    QJSSetInspectorHooks(&kInspectorHooks);
    RegisterQJSDebuggerCallbacks(vm->rt, const_cast<void **>(kCallbacks),
                                 kCallbackCount);
    QJSDebuggerInitialize(vm->ctx);
    /* devtool_connect=true flips ctx->debugger_mode: scripts evaluated from
     * now on enter the debugger's script table (the Dart side reloads right
     * after attach), and breakpoints can bind. */
    PrepareQJSDebuggerForSharedContext(vm->ctx,
                                       const_cast<void **>(kCallbacks),
                                       kCallbackCount, true);
    static const FjsDebuggerTransport kTransport = {
        nullptr,
        [](void *op, FJSVM *lvm) { transport_feed(op, lvm); },
        [](void *op) { /* quit: engine calls cb_quit_message_loop_on_pause */ },
        [](void *op) { transport_close(op); },
    };
    fjs_debugger_set_transport(vm, &kTransport);
}

} // namespace

extern "C" {

int32_t fjs_vm_debugger_attach(FJSVM *vm, const char *host, int32_t port) {
    if (!vm || !vm->ctx || !host || port <= 0) {
        attach_fail(vm, "invalid attach arguments (vm/host/port)");
        return -1;
    }

    if (g_transport.fd < 0) {
        /* No live session: dial the relay. Once the socket is up it stays
         * open across reloads (transport_close keeps it), so this path runs
         * once per `debug on` — not once per reload — and a reload can never
         * lose the channel to the close-then-redial race or to another app
         * that grabbed the slot in between. */
        int fd = ::socket(AF_INET, SOCK_STREAM, 0);
        if (fd < 0) {
            attach_fail(vm, "socket() failed: errno %d", errno);
            return -1;
        }
        /* Non-blocking connect, bounded to 2s: Dart calls this on the UI
         * isolate, so an unreachable relay must fail fast, not freeze a frame. */
        int fl = fcntl(fd, F_GETFL, 0);
        fcntl(fd, F_SETFL, fl | O_NONBLOCK);
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<uint16_t>(port));
        if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
            close(fd);
            attach_fail(vm, "invalid relay host '%s' (not an IPv4 address)", host);
            return -1;
        }
        if (connect(fd, (sockaddr *)&addr, sizeof(addr)) != 0) {
            if (errno != EINPROGRESS) {
                int e = errno;
                close(fd);
                attach_fail(vm, "relay %s:%d refused: errno %d (%s)", host, port,
                            e, strerror(e));
                return -1;
            }
            int pr;
            pollfd p = {fd, POLLOUT, 0};
            do { pr = poll(&p, 1, 2000); } while (pr < 0 && errno == EINTR);
            if (pr <= 0) {
                close(fd);
                attach_fail(vm, "relay %s:%d unreachable (connect %s)", host,
                            port, pr < 0 ? "interrupted" : "timed out");
                return -1;
            }
            int soerr = 0;
            socklen_t slen = sizeof(soerr);
            getsockopt(fd, SOL_SOCKET, SO_ERROR, &soerr, &slen);
            if (soerr != 0) {
                close(fd);
                attach_fail(vm, "relay %s:%d refused: errno %d (%s) — another "
                                "app may hold the debug channel, or fjs debug "
                                "exited", host, port, soerr, strerror(soerr));
                return -1;
            }
        }
        fcntl(fd, F_SETFL, fl & ~O_NONBLOCK);
        int one = 1;
        setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));

        g_transport.fd = fd;
        DBG_LOG("debug channel open to %s:%d", host, port);
    } else {
        /* Session already live: this is a reload. Tell the relay so it can
         * drop per-VM bookkeeping (the fetch-id space restarts from 1). */
        write_line("{\"fjs\":\"debug-reload\"}");
    }

    install_vm_state(vm);
    return 0;
}

int32_t fjs_vm_debugger_detach(FJSVM *vm) {
    if (!vm) return 0;
    drop_socket();
    g_transport.in_pause = false;
    g_transport.line_buf.clear();
    fjs_debugger_set_transport(vm, nullptr);
    QJSDebuggerFree(vm->ctx);
    /* Last, so the teardown above can still call back in. */
    QJSSetInspectorHooks(nullptr);
    DBG_LOG("debug channel detached");
    return 0;
}

} /* extern "C" */

#else /* _WIN32 */

/* Windows support is a roadmap item for the whole native core; the plugin
 * reports it loudly instead of silently doing nothing (constitution V). */
extern "C" int32_t fjs_vm_debugger_attach(FJSVM *, const char *, int32_t) {
    return -1;
}
extern "C" int32_t fjs_vm_debugger_detach(FJSVM *) { return 0; }

#endif /* _WIN32 */
