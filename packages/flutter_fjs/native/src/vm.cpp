/*
 * fjs VM core: lifecycle, script/bytecode evaluation, event-loop pump.
 * JS↔C++ calls go through QuickJS's C API with raw JSValues — no JSON,
 * no bridge serialization (the "JSI" boundary of this project).
 */
#include "fjs_internal.h"

#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>

namespace {

constexpr char kBundleMagic[4] = {'F', 'J', 'S', 'B'};
constexpr uint16_t kBundleFormat = 1;

thread_local char t_error_buf[1024] = {0};

/* quickjs-ng's JS_Eval requires input[input_len] == '\0'. Callers (Dart FFI,
 * file readers) hand us raw non-terminated bytes, so copy into a
 * NUL-terminated buffer first. */
static std::vector<char> nul_terminated(const uint8_t *src, int32_t len) {
    std::vector<char> buf;
    buf.reserve((size_t)len + 1);
    buf.insert(buf.end(), src, src + len);
    buf.push_back('\0');
    return buf;
}

} // namespace

/* fjs_compile_bundle below needs these too */
using namespace fjs;

namespace fjs {

void set_error(FJSVM *vm, const char *fmt, ...) {
    char *buf = vm ? vm->last_error : t_error_buf;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, 1024, fmt, ap);
    va_end(ap);
}

// Length is passed, not derived: console output may contain NUL — an `fjs
// eval` answer is prefixed with \u0000 so `fjs log` can tell it from app
// output — and strlen would cut the message to nothing there.
void log_line(FJSVM *vm, int32_t level, const char *msg, int32_t len) {
    if (vm && vm->on_log) vm->on_log(level, msg, len);
}

std::string format_exception(FJSVM *vm, JSValue exc) {
    JSContext *ctx = vm->ctx;
    std::string out;
    const char *cstr = JS_ToCString(ctx, exc);
    if (cstr) {
        out = cstr;
        JS_FreeCString(ctx, cstr);
    } else {
        out = "<unprintable exception>";
    }
    if (JS_IsError(ctx, exc)) {
        JSValue stack = JS_GetPropertyStr(ctx, exc, "stack");
        if (!JS_IsUndefined(stack) && !JS_IsException(stack)) {
            const char *s = JS_ToCString(ctx, stack);
            if (s && s[0]) {
                out += "\n";
                out += s;
            }
            if (s) JS_FreeCString(ctx, s);
        }
        JS_FreeValue(ctx, stack);
    }
    return out;
}

bool fail_with_pending_exception(FJSVM *vm, const char *where) {
    JSValue exc = JS_GetException(vm->ctx);
    std::string msg = format_exception(vm, exc);
    JS_FreeValue(vm->ctx, exc);
    std::string full = std::string("[fjs/") + where + "] " + msg;
    set_error(vm, "%s", full.c_str());
    log_line(vm, FJS_LOG_ERROR, full.c_str(), (int32_t)full.size());
    return false;
}

double now_ms(FJSVM *vm) {
    (void)vm;
    auto now = std::chrono::steady_clock::now().time_since_epoch();
    using std::chrono::duration_cast;
    return (double)duration_cast<std::chrono::microseconds>(now).count() / 1000.0;
}

} // namespace fjs

extern "C" {

const char *fjs_engine_id(void) { return "quickjs-ng-0.9.0"; }
int32_t fjs_abi_version(void) { return FJS_ABI_VERSION; }

FJSVM *fjs_vm_create(void) {
    FJSVM *vm = new (std::nothrow) FJSVM();
    if (!vm) return nullptr;
    vm->rt = JS_NewRuntime();
    if (!vm->rt) { delete vm; return nullptr; }
    JS_SetRuntimeInfo(vm->rt, "ufjs");
    vm->ctx = JS_NewContext(vm->rt);
    if (!vm->ctx) { JS_FreeRuntime(vm->rt); delete vm; return nullptr; }
    if (!fjs::install_natives(vm)) {
        JS_FreeContext(vm->ctx);
        JS_FreeRuntime(vm->rt);
        delete vm;
        return nullptr;
    }
    return vm;
}

void fjs_vm_destroy(FJSVM *vm) {
    if (!vm) return;
    for (auto &t : vm->timers) JS_FreeValue(vm->ctx, t.callback);
    vm->timers.clear();
    JS_FreeContext(vm->ctx);
    JS_FreeRuntime(vm->rt);
    delete vm; /* the handle table dies here too — every outstanding
                  binary handle becomes permanently stale */
}

int64_t fjs_handle_put_bytes(FJSVM *vm, int64_t id,
                             const uint8_t *data, int32_t len) {
    if (!vm || len < 0 || (!data && len > 0)) return 0;
    if (id <= 0) id = vm->next_handle_id++;
    else if (id >= vm->next_handle_id) vm->next_handle_id = id + 1;
    vm->handle_bytes[id] = std::vector<uint8_t>(data, data + len);
    return id;
}

void fjs_handle_bytes(FJSVM *vm, int64_t id,
                      const uint8_t **data, int32_t *len) {
    auto it = vm ? vm->handle_bytes.find(id) : vm->handle_bytes.end();
    if (it == vm->handle_bytes.end()) {
        *data = nullptr;
        *len = 0;
        return;
    }
    *data = it->second.data();
    *len = (int32_t)it->second.size();
}

void fjs_handle_release(FJSVM *vm, int64_t id) {
    if (vm) vm->handle_bytes.erase(id);
}

void fjs_set_callbacks(FJSVM *vm, fjs_on_log_fn on_log,
                       fjs_on_ui_ops_fn on_ui_ops,
                       fjs_invoke_host_fn on_invoke_host) {
    if (!vm) return;
    vm->on_log = on_log;
    vm->on_ui_ops = on_ui_ops;
    vm->on_invoke_host = on_invoke_host;
}

void fjs_set_toast_callback(FJSVM *vm, fjs_on_toast_fn on_toast) {
    if (vm) vm->on_toast = on_toast;
}

/* Every entry point below can be reached from a different native stack
 * depth than the one JS_NewRuntime() recorded — a Dart FFI callback fired
 * from inside a Flutter frame sits far deeper than app startup. QuickJS
 * measures its stack budget from that recorded top, so without re-anchoring
 * it a deep-enough call (mounting a whole page from a navigator callback)
 * trips "Maximum call stack size exceeded" with plenty of stack left. */
static inline void fjs_reanchor_stack(FJSVM *vm) {
    if (vm && vm->rt) JS_UpdateStackTop(vm->rt);
}

int32_t fjs_vm_eval_source(FJSVM *vm, const uint8_t *src, int32_t len,
                           const char *filename) {
    if (!vm || !src || len < 0 || !filename) {
        fjs::set_error(vm, "invalid arguments to fjs_vm_eval_source");
        return -1;
    }
    fjs_reanchor_stack(vm);
    vm->last_error[0] = '\0';
    std::vector<char> code = nul_terminated(src, len);
    JSValue result = JS_Eval(vm->ctx, code.data(), (size_t)len, filename,
                             JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(result)) {
        fjs::fail_with_pending_exception(vm, "eval");
        return -1;
    }
    JS_FreeValue(vm->ctx, result);
    /* run jobs enqueued during evaluation */
    fjs_vm_pump(vm, (int64_t)fjs::now_ms(vm));
    return 0;
}

int32_t fjs_bundle_check(const uint8_t *bundle, int32_t len,
                         const char **engine_id_out,
                         int32_t *payload_off, int32_t *payload_len,
                         const char **err_out) {
    static thread_local char err[256];
    auto fail = [&](const char *msg) -> int32_t {
        snprintf(err, sizeof(err), "%s", msg);
        if (err_out) *err_out = err;
        return -1;
    };
    if (len < 8) return fail("bundle too short");
    if (memcmp(bundle, kBundleMagic, 4) != 0)
        return fail("bad magic (not a .fjsbundle)");
    uint16_t fmt = bundle[4] | (bundle[5] << 8);
    if (fmt != kBundleFormat) return fail("unsupported bundle format version");
    uint16_t idlen = bundle[6] | (bundle[7] << 8);
    if (8 + (int32_t)idlen > len) return fail("truncated engine id");
    if (engine_id_out) {
        static thread_local char idbuf[64];
        int32_t n = idlen < 63 ? idlen : 63;
        memcpy(idbuf, bundle + 8, (size_t)n);
        idbuf[n] = '\0';
        *engine_id_out = idbuf;
    }
    if (payload_off) *payload_off = 8 + (int32_t)idlen;
    if (payload_len) *payload_len = len - 8 - (int32_t)idlen;
    if (err_out) *err_out = nullptr;
    return 0;
}

int32_t fjs_vm_eval_bundle(FJSVM *vm, const uint8_t *bundle, int32_t len) {
    fjs_reanchor_stack(vm);
    if (!vm || !bundle || len <= 0) {
        fjs::set_error(vm, "invalid arguments to fjs_vm_eval_bundle");
        return -1;
    }
    vm->last_error[0] = '\0';
    const char *id = nullptr;
    int32_t off = 0, plen = 0;
    const char *err = nullptr;
    if (fjs_bundle_check(bundle, len, &id, &off, &plen, &err) != 0) {
        fjs::set_error(vm, "bundle check failed: %s", err ? err : "unknown");
        return -1;
    }
    if (strcmp(id, fjs_engine_id()) != 0) {
        fjs::set_error(vm,
                       "bundle engine mismatch: bundle was built for '%s' but "
                       "this app embeds '%s'. Rebuild the bundle with the "
                       "matching fjs CLI (see docs/toolchain.md).",
                       id, fjs_engine_id());
        return -1;
    }
    JSValue fun = JS_ReadObject(vm->ctx, bundle + off, (size_t)plen,
                                JS_READ_OBJ_BYTECODE);
    if (JS_IsException(fun)) {
        fjs::fail_with_pending_exception(vm, "bytecode-load");
        return -1;
    }
    JSValue result = JS_EvalFunction(vm->ctx, fun);
    if (JS_IsException(result)) {
        fjs::fail_with_pending_exception(vm, "eval");
        return -1;
    }
    JS_FreeValue(vm->ctx, result);
    fjs_vm_pump(vm, (int64_t)fjs::now_ms(vm));
    return 0;
}

int64_t fjs_vm_now(FJSVM *vm) { return (int64_t)fjs::now_ms(vm); }

void fjs_vm_heap(FJSVM *vm, int64_t *bytes, int64_t *objects) {
    if (bytes) *bytes = 0;
    if (objects) *objects = 0;
    if (!vm || !vm->ctx) return;
    JSMemoryUsage usage;
    JS_ComputeMemoryUsage(JS_GetRuntime(vm->ctx), &usage);
    if (bytes) *bytes = (int64_t)usage.malloc_size;
    if (objects) *objects = (int64_t)usage.obj_count;
}

int32_t fjs_vm_pump(FJSVM *vm, int64_t now_ms_) {    if (!vm) return -1;
    fjs_reanchor_stack(vm);
    int32_t executed = 0;

    /* 1) due timers (index loop: callbacks may add/remove timers) */
    bool ran_timer = true;
    while (ran_timer) {
        ran_timer = false;
        for (size_t i = 0; i < vm->timers.size(); i++) {
            Timer &t = vm->timers[i];
            if (t.next_ms > (double)now_ms_) continue;
            JSValue cb = t.callback;
            JS_DupValue(vm->ctx, cb); /* keep alive across possible removal */
            if (t.interval) {
                t.next_ms += t.interval_ms;
                if (t.next_ms <= (double)now_ms_) /* catch-up after jank */
                    t.next_ms = (double)now_ms_ + t.interval_ms;
            } else {
                JS_FreeValue(vm->ctx, t.callback);
                vm->timers.erase(vm->timers.begin() + (long)i);
            }
            JSValue ret = JS_Call(vm->ctx, cb, JS_UNDEFINED, 0, nullptr);
            JS_FreeValue(vm->ctx, cb);
            executed++;
            ran_timer = true;
            if (JS_IsException(ret)) {
                JS_FreeValue(vm->ctx, ret);
                /* A throwing timer must not skip the rest of the pump: the
                 * early return also abandoned the pending-job drain, i.e.
                 * every microtask queued behind it — Vue's scheduler flush
                 * among them. One vant `useRect` throw per tick used to
                 * freeze whole pages mid-mount (specs/070 D1). Report like
                 * a browser would and move on. */
                JSValue exc = JS_GetException(vm->ctx);
                std::string msg = format_exception(vm, exc);
                JS_FreeValue(vm->ctx, exc);
                std::string out = "[fjs/timer] " + msg;
                log_line(vm, FJS_LOG_ERROR, out.c_str(), (int32_t)out.size());
            } else {
                JS_FreeValue(vm->ctx, ret);
            }
            break; /* restart scan: vector was mutated */
        }
    }

    /* 2) promise jobs, bounded so a job storm can't wedge the frame.
     * A throwing job must not starve the jobs queued behind it — browsers
     * report the rejection and keep draining. One dropped Vue-scheduler
     * flush used to blank the whole page with no error surfaced anywhere
     * (vant Tabs throws `window is not defined` from a nextTick chain). */
    for (int i = 0; i < 10000; i++) {
        JSContext *ctx1 = nullptr;
        int r = JS_ExecutePendingJob(vm->rt, &ctx1);
        if (r < 0) {
            JSValue exc = JS_GetException(ctx1);
            std::string msg = format_exception(vm, exc);
            JS_FreeValue(ctx1, exc);
            std::string out = "[fjs] unhandled rejection in a microtask job: " + msg;
            log_line(vm, FJS_LOG_ERROR, out.c_str(), (int32_t)out.size());
            executed++;
            continue;
        }
        if (r == 0) break;
        executed++;
    }
    return executed;
}

int32_t fjs_vm_dispatch_event(FJSVM *vm, int32_t node_id, int32_t event_type,
                              const uint8_t *params, int32_t len) {
    if (!vm) return -1;
    fjs_reanchor_stack(vm);
    JSValue global = JS_GetGlobalObject(vm->ctx);
    JSValue fn = JS_GetPropertyStr(vm->ctx, global, "__fjsDispatchEvent");
    JS_FreeValue(vm->ctx, global);
    if (JS_IsUndefined(fn)) {
        JS_FreeValue(vm->ctx, fn);
        return 0; /* runtime not installed yet — fine */
    }
    JSValueConst argv[3];
    argv[0] = JS_NewInt32(vm->ctx, node_id);
    argv[1] = JS_NewInt32(vm->ctx, event_type);
    argv[2] = (params && len > 0)
                  ? JS_NewStringLen(vm->ctx, (const char *)params, (size_t)len)
                  : JS_NULL;
    JSValue ret = JS_Call(vm->ctx, fn, JS_UNDEFINED, 3, argv);
    JS_FreeValue(vm->ctx, argv[0]);
    JS_FreeValue(vm->ctx, argv[1]);
    JS_FreeValue(vm->ctx, argv[2]);
    JS_FreeValue(vm->ctx, fn);
    if (JS_IsException(ret)) {
        JS_FreeValue(vm->ctx, ret);
        fjs::fail_with_pending_exception(vm, "dispatch-event");
        return -1;
    }
    JS_FreeValue(vm->ctx, ret);
    /* handlers typically queue UI frames via microtasks — drain them now so
     * a gesture produces its frame synchronously */
    fjs_vm_pump(vm, (int64_t)fjs::now_ms(vm));
    return 0;
}

const char *fjs_last_error(FJSVM *vm) {
    if (vm) return vm->last_error;
    return t_error_buf;
}

int32_t fjs_compile_bundle(FJSVM *vm, const uint8_t *src, int32_t len,
                           uint8_t *out, int32_t cap) {
    if (!vm || !src || len < 0) {
        fjs::set_error(vm, "invalid arguments to fjs_compile_bundle");
        return -1;
    }
    /* global compile only — no execution (compile-only eval) */
    std::vector<char> code = nul_terminated(src, len);
    JSValue fun = JS_Eval(vm->ctx, code.data(), (size_t)len, "<bundle>",
                          JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(fun)) {
        fjs::fail_with_pending_exception(vm, "compile");
        return -1;
    }
    size_t bc_len = 0;
    uint8_t *bc = JS_WriteObject(vm->ctx, &bc_len, fun, JS_WRITE_OBJ_BYTECODE);
    JS_FreeValue(vm->ctx, fun);
    if (!bc) {
        fjs::fail_with_pending_exception(vm, "write-object");
        return -1;
    }

    const char *eid = fjs_engine_id();
    size_t idlen = strlen(eid);
    size_t header = 8 + idlen;
    size_t total = header + bc_len;
    if (out && cap >= 0 && (size_t)cap >= total) {
        memcpy(out, kBundleMagic, 4);
        out[4] = (uint8_t)(kBundleFormat & 0xff);
        out[5] = (uint8_t)(kBundleFormat >> 8);
        out[6] = (uint8_t)(idlen & 0xff);
        out[7] = (uint8_t)(idlen >> 8);
        memcpy(out + 8, eid, idlen);
        memcpy(out + header, bc, bc_len);
    } else if (out) {
        total = 0; /* caller misjudged size: signal nothing written */
        fjs::set_error(vm, "fjs_compile_bundle: output buffer too small");
    }
    js_free(vm->ctx, bc);
    if (out && cap >= 0 && total == 0) return -1;
    return (int32_t)total;
}

} /* extern "C" */
