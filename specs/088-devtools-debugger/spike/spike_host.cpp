// fjs spec 088 spike — minimal PrimJS debugger host.
//
// Validates the host-side contract for the vendored-PrimJS migration:
//   - RegisterQJSDebuggerCallbacks takes a void** array in the ORDER OF THE
//     MACRO LIST in quickjs.cc (QJSCallBackName), which is NOT the struct
//     field order in quickjs-inner.h (inspector_check / debugger_exception
//     are swapped). We therefore build the array explicitly, never cast a
//     struct.
//   - While running, the HOST feeds CDP messages via
//     PushAndProcessProtocolMessages (from its own event loop).
//   - While paused, the engine calls run_message_loop_on_pause on the JS
//     thread; the host blocks there serving ProcessPausedMessages until
//     quit_message_loop_on_pause fires.
//   - scriptParsed / consoleAPICalled: watch what the engine sends by
//     itself; host-side synthesis only if it does not.
//
// Two-phase script mirrors the real app: phase 1 defines functions
// (scriptParsed fires), DevTools attaches + sets a breakpoint, host then
// evals "main()" (phase 2) which hits the breakpoint.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cctype>
#include <cstdio>
#include <cstring>
#include <string>

#include "quickjs.h"
#include "debugger_struct.h"  // LEPUSScriptSource

// ---- engine debugger interface (inspector/interface.h), declared here so
// the host does not have to pull the whole internal header tree in.
extern "C" {
void QJSDebuggerInitialize(LEPUSContext *ctx);
void QJSDebuggerFree(LEPUSContext *ctx);
void ProcessPausedMessages(LEPUSContext *ctx, const char *message);
void PushAndProcessProtocolMessages(LEPUSDebuggerInfo *info, const char *msg);
struct LEPUSDebuggerInfo *GetDebuggerInfo(LEPUSContext *ctx);
}

static const int kPort = 39800;

static int g_client = -1;
static volatile bool g_in_pause = false;
static volatile bool g_bp_armed = false;  // breakpoint resolved w/ locations
static LEPUSContext *g_ctx = nullptr;

static void send_line(const char *msg) {
  if (g_client < 0 || !msg) return;
  std::string line = msg;
  line += "\n";
  ssize_t n = ::send(g_client, line.data(), line.size(), 0);
  (void)n;
  printf("[out] %.200s\n", msg);
  fflush(stdout);
}

// ---- engine -> host callbacks (macros order!) ----------------------------

static void cb_run_message_loop_on_pause(LEPUSContext *ctx) {
  printf("[host] === PAUSED (message loop on pause) ===\n");
  fflush(stdout);
  g_in_pause = true;
  std::string buf;
  while (g_in_pause) {
    struct pollfd pfd = {g_client, POLLIN, 0};
    if (::poll(&pfd, 1, 500) <= 0) continue;
    char tmp[65536];
    ssize_t n = ::recv(g_client, tmp, sizeof(tmp), 0);
    if (n <= 0) { g_in_pause = false; break; }
    buf.append(tmp, static_cast<size_t>(n));
    size_t pos;
    while ((pos = buf.find('\n')) != std::string::npos) {
      std::string line = buf.substr(0, pos);
      buf.erase(0, pos + 1);
      if (!line.empty()) {
        printf("[in-paused] %.200s\n", line.c_str());
        ProcessPausedMessages(ctx, line.c_str());
      }
    }
  }
  printf("[host] === RESUMED ===\n");
  fflush(stdout);
}

static void cb_quit_message_loop_on_pause(LEPUSContext *) { g_in_pause = false; }
static void cb_get_messages(LEPUSContext *) {}
static void cb_send_response(LEPUSContext *, int32_t, const char *message) {
  if (message) {
    send_line(message);
    if (strstr(message, "\"breakpointId\"") && strstr(message, "\"locations\"")) {
      // resolved to a real location (not "locations":[]).
      const char *loc = strstr(message, "\"locations\"");
      if (loc && !strstr(loc, "[]")) {
        g_bp_armed = true;
      }
    }
  }
}
static void cb_send_notification(LEPUSContext *, const char *message) {
  send_line(message);
}
static void cb_free_messages(LEPUSContext *, char **, int32_t) {}
static void cb_debugger_exception(LEPUSContext *) {}
static void cb_inspector_check(LEPUSContext *) {}
static void cb_console_message(LEPUSContext *, int, LEPUSValueConst *, int) {}
static void cb_script_parsed_ntfy(LEPUSContext *, LEPUSScriptSource *src) {
  // The engine sends Debugger.scriptParsed by itself (verified in this
  // spike); the host callback only needs bookkeeping, no synthesis.
  if (src && src->url) {
    printf("[host] script parsed: id=%d url=%s\n", src->id, src->url);
  }
}
static void cb_console_api_called_ntfy(LEPUSContext *, LEPUSValue *) {}
static void cb_script_fail_parse_ntfy(LEPUSContext *, LEPUSScriptSource *) {}
static void cb_debugger_paused(LEPUSContext *, const uint8_t *) {}
static uint8_t cb_is_devtool_on(LEPUSRuntime *) { return 1; }
static void cb_send_response_with_view_id(LEPUSContext *, int32_t, const char *m, int32_t) { send_line(m); }
static void cb_send_ntfy_with_view_id(LEPUSContext *, const char *m, int32_t) { send_line(m); }
static void cb_script_parsed_ntfy_with_view_id(LEPUSContext *c, LEPUSScriptSource *s, int32_t) {
  cb_script_parsed_ntfy(c, s);
}
static void cb_script_fail_parse_ntfy_with_view_id(LEPUSContext *, LEPUSScriptSource *, int32_t) {}
static void cb_set_session_enable_state(LEPUSContext *, int32_t, int32_t) {}
static void cb_get_session_state(LEPUSContext *, int32_t, bool *enabled, bool *paused) {
  if (enabled) *enabled = true;
  if (paused) *paused = false;
}
static void cb_get_session_enable_state(LEPUSContext *, int32_t, int32_t, bool *ret) {
  if (ret) *ret = true;
}
static void cb_get_console_stack_trace(LEPUSContext *, LEPUSValue *ret) {
  if (ret) *ret = LEPUS_UNDEFINED;
}
static void cb_on_console_message(LEPUSContext *, LEPUSValue, const char *) {}

// ---- console.log (host-injected, like Lynx does) --------------------------

static LEPUSValue js_console_log(LEPUSContext *ctx, LEPUSValueConst, int argc,
                                 LEPUSValueConst *argv) {
  std::string line = "[console] ";
  for (int i = 0; i < argc; i++) {
    const char *s = LEPUS_ToCString(ctx, argv[i]);
    if (i) line += " ";
    line += s ? s : "(null)";
    if (s) LEPUS_FreeCString(ctx, s);
  }
  printf("%s\n", line.c_str());
  fflush(stdout);
  // hand-built Runtime.consoleAPICalled so the CDP client sees it
  std::string msg = "{\"method\":\"Runtime.consoleAPICalled\",\"params\":{";
  msg += "\"type\":\"log\",\"executionContextId\":1,";
  msg += "\"args\":[";
  for (int i = 0; i < argc; i++) {
    const char *s = LEPUS_ToCString(ctx, argv[i]);
    if (i) msg += ",";
    msg += "{\"type\":\"string\",\"value\":\"";
    msg += s ? s : "";
    msg += "\"}";
    if (s) LEPUS_FreeCString(ctx, s);
  }
  msg += "]}}";
  send_line(msg.c_str());
  return LEPUS_UNDEFINED;
}

static void install_console(LEPUSContext *ctx) {
  LEPUSValue global = LEPUS_GetGlobalObject(ctx);
  LEPUSValue console = LEPUS_NewObject(ctx);
  LEPUSValue log = LEPUS_NewCFunction2(ctx, js_console_log, "log", 1,
                                       LEPUS_CFUNC_generic, 0);
  LEPUS_SetPropertyStr(ctx, console, "log", log);
  LEPUS_SetPropertyStr(ctx, global, "console", console);
  LEPUS_FreeValue(ctx, global);
}

// ---- main -----------------------------------------------------------------

static const char *kPhase1 =
    "function work(n) {\n"       // line 1 (CDP line 0)
    "  let s = 0;\n"             // line 2 (1)
    "  for (let i = 0; i < n; i++) {\n"  // line 3 (2)
    "    s += i * 2;\n"          // line 4 (3)  <-- breakpoint here
    "  }\n"
    "  return s;\n"
    "}\n"
    "function main() {\n"
    "  const a = work(200000000);\n"
    "  const b = work(200000000);\n"
    "  return a + b;\n"
    "}\n"
    "console.log('phase1 loaded');\n";

static const char *kPhase2 = "const r = main(); console.log('main done', r);\n";

int main() {
  setvbuf(stdout, nullptr, _IONBF, 0);
  LEPUSRuntime *rt = LEPUS_NewRuntime();

  // macro order — see file comment
  void *funcs[] = {
      (void *)cb_run_message_loop_on_pause,
      (void *)cb_quit_message_loop_on_pause,
      (void *)cb_get_messages,
      (void *)cb_send_response,
      (void *)cb_send_notification,
      (void *)cb_free_messages,
      (void *)cb_debugger_exception,
      (void *)cb_inspector_check,
      (void *)cb_console_message,
      (void *)cb_script_parsed_ntfy,
      (void *)cb_console_api_called_ntfy,
      (void *)cb_script_fail_parse_ntfy,
      (void *)cb_debugger_paused,
      (void *)cb_is_devtool_on,
      (void *)cb_send_response_with_view_id,
      (void *)cb_send_ntfy_with_view_id,
      (void *)cb_script_parsed_ntfy_with_view_id,
      (void *)cb_script_fail_parse_ntfy_with_view_id,
      (void *)cb_set_session_enable_state,
      (void *)cb_get_session_state,
      (void *)cb_get_session_enable_state,
      (void *)cb_get_console_stack_trace,
      (void *)cb_on_console_message,
  };
  RegisterQJSDebuggerCallbacks(rt, funcs,
                               static_cast<int32_t>(sizeof(funcs) / sizeof(void *)));

  LEPUSContext *ctx = LEPUS_NewContext(rt);
  g_ctx = ctx;
  QJSDebuggerInitialize(ctx);
  PrepareQJSDebuggerDefer(ctx, funcs,
                          static_cast<int32_t>(sizeof(funcs) / sizeof(void *)));
  // debugger_mode = 1: parse scripts into the debugger's script list
  PrepareQJSDebuggerForSharedContext(ctx, funcs,
                                     static_cast<int32_t>(sizeof(funcs) / sizeof(void *)),
                                     true);
  install_console(ctx);

  int srv = ::socket(AF_INET, SOCK_STREAM, 0);
  int one = 1;
  setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = htons(kPort);
  if (::bind(srv, (sockaddr *)&addr, sizeof(addr)) != 0) {
    perror("bind");
    return 1;
  }
  ::listen(srv, 1);
  printf("[host] listening on 127.0.0.1:%d\n", kPort);

  // phase 1: definitions; scriptParsed should fire here
  LEPUSValue r1 = LEPUS_Eval(ctx, kPhase1, strlen(kPhase1), "test.js",
                             LEPUS_EVAL_TYPE_GLOBAL);
  if (LEPUS_IsException(r1)) {
    LEPUSValue ex = LEPUS_GetException(ctx);
    const char *m = LEPUS_ToCString(ctx, ex);
    printf("[host] phase1 eval FAILED: %s\n", m ? m : "?");
    return 1;
  }
  printf("[host] phase1 evaluated OK\n");

  // serve until the client resolves a breakpoint, then run main()
  std::string buf;
  while (!g_bp_armed) {
    struct pollfd pfds[2] = {{srv, POLLIN, 0}, {g_client, POLLIN, 0}};
    if (g_client < 0) {
      if (::poll(&pfds[0], 1, 500) <= 0) continue;
      g_client = ::accept(srv, nullptr, nullptr);
      printf("[host] CDP client connected\n");
      continue;
    }
    if (::poll(pfds, 2, 500) <= 0) continue;
    if (pfds[0].revents & POLLIN) {
      g_client = ::accept(srv, nullptr, nullptr);
      printf("[host] CDP client reconnected\n");
    }
    if (pfds[1].revents & POLLIN) {
      char tmp[65536];
      ssize_t n = ::recv(g_client, tmp, sizeof(tmp), 0);
      if (n <= 0) { g_client = -1; continue; }
      buf.append(tmp, static_cast<size_t>(n));
      size_t pos;
      while ((pos = buf.find('\n')) != std::string::npos) {
        std::string line = buf.substr(0, pos);
        buf.erase(0, pos + 1);
        if (line.empty()) continue;
        printf("[in] %.200s\n", line.c_str());
        PushAndProcessProtocolMessages(GetDebuggerInfo(ctx), line.c_str());
      }
    }
  }
  printf("[host] breakpoint armed — running main()\n");

  LEPUSValue r2 = LEPUS_Eval(ctx, kPhase2, strlen(kPhase2), "test.js",
                             LEPUS_EVAL_TYPE_GLOBAL);
  if (LEPUS_IsException(r2)) {
    LEPUSValue ex = LEPUS_GetException(ctx);
    const char *m = LEPUS_ToCString(ctx, ex);
    printf("[host] phase2 eval FAILED: %s\n", m ? m : "?");
  } else {
    printf("[host] phase2 evaluated OK (bp hit + resume worked)\n");
  }

  sleep(1);  // flush trailing notifications
  QJSDebuggerFree(ctx);
  LEPUS_FreeContext(ctx);
  LEPUS_FreeRuntime(rt);
  printf("[host] done\n");
  return 0;
}
