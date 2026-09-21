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

/* Both engines' Eval requires input[input_len] == '\0'. Callers (Dart FFI,
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

std::string format_exception(FJSVM *vm, fjsengine::Value exc) {
    fjsengine::Context *ctx = vm->ctx;
    std::string out;
    const char *cstr = fjsengine::to_cstring(ctx, exc);
    if (cstr) {
        out = cstr;
        fjsengine::free_cstring(ctx, cstr);
    } else {
        out = "<unprintable exception>";
    }
    if (fjsengine::is_error(ctx, exc)) {
        fjsengine::Value stack = fjsengine::get_property_str(ctx, exc, "stack");
        if (!fjsengine::is_undefined(stack) && !fjsengine::is_exception(stack)) {
            const char *s = fjsengine::to_cstring(ctx, stack);
            if (s && s[0]) {
                out += "\n";
                out += s;
            }
            if (s) fjsengine::free_cstring(ctx, s);
        }
        fjsengine::free_value(ctx, stack);
    }
    return out;
}

bool fail_with_pending_exception(FJSVM *vm, const char *where) {
    fjsengine::Value exc = fjsengine::get_exception(vm->ctx);
    std::string msg = format_exception(vm, exc);
    fjsengine::free_value(vm->ctx, exc);
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

/* spec 088: engine switched from quickjs-ng 0.9.0 to the vendored PrimJS
 * fork (tag 4.1.1, Apache-2.0) for its built-in CDP debugger. spec 091
 * brought quickjs-ng back as a build flavor (FJS_JS_ENGINE=quickjs). Same
 * lockstep rule as before: this id is embedded in every .fjsbundle header
 * and a mismatch is rejected at load (docs/toolchain.md). */
const char *fjs_engine_id(void) {
#if defined(FJS_ENGINE_QUICKJS)
    return "quickjs-ng-0.9.0";
#else
    return "primjs-4.1.1";
#endif
}
int32_t fjs_abi_version(void) { return FJS_ABI_VERSION; }

FJSVM *fjs_vm_create(void) {
    FJSVM *vm = new (std::nothrow) FJSVM();
    if (!vm) return nullptr;
    vm->rt = fjsengine::new_runtime();
    if (!vm->rt) { delete vm; return nullptr; }
    fjsengine::set_runtime_info(vm->rt, "ufjs");
    vm->ctx = fjsengine::new_context(vm->rt);
    if (!vm->ctx) { fjsengine::free_runtime(vm->rt); delete vm; return nullptr; }
    /* PrimJS has no JS_UpdateStackTop equivalent, so the per-entry
     * re-anchoring quickjs-ng needed is replaced by a fixed, generous
     * budget: Dart FFI callbacks (a Flutter-frame callback mounting a
     * whole page) enter JS from much deeper native stacks than app
     * startup, and the default budget tripped there. 32 MiB is well
     * under the main-thread stack on every target platform. */
    fjsengine::set_max_stack_size(vm->ctx, 32u * 1024 * 1024);
    if (!fjs::install_natives(vm)) {
        fjsengine::free_context(vm->ctx);
        fjsengine::free_runtime(vm->rt);
        delete vm;
        return nullptr;
    }
    return vm;
}

void fjs_vm_destroy(FJSVM *vm) {
    if (!vm) return;
    fjs::dbg::transport_closed(vm); /* lets the transport release before the ctx */
    for (auto &t : vm->timers) fjsengine::free_value(vm->ctx, t.callback);
    vm->timers.clear();
    fjsengine::free_context(vm->ctx);
    fjsengine::free_runtime(vm->rt);
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

int32_t fjs_vm_eval_source(FJSVM *vm, const uint8_t *src, int32_t len,
                           const char *filename) {
    if (!vm || !src || len < 0 || !filename) {
        fjs::set_error(vm, "invalid arguments to fjs_vm_eval_source");
        return -1;
    }
    vm->last_error[0] = '\0';
    std::vector<char> code = nul_terminated(src, len);
    fjsengine::Value result = fjsengine::eval(vm->ctx, code.data(), (size_t)len, filename,
                             fjsengine::eval_type_global);
    if (fjsengine::is_exception(result)) {
        fjs::fail_with_pending_exception(vm, "eval");
        return -1;
    }
    fjsengine::free_value(vm->ctx, result);
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
    fjsengine::Value fun = fjsengine::read_object(vm->ctx, bundle + off, (size_t)plen,
                                fjsengine::read_obj_bytecode);
    if (fjsengine::is_exception(fun)) {
        fjs::fail_with_pending_exception(vm, "bytecode-load");
        return -1;
    }
    fjsengine::Value result = fjsengine::eval_function(vm->ctx, fun);
    if (fjsengine::is_exception(result)) {
        fjs::fail_with_pending_exception(vm, "eval");
        return -1;
    }
    fjsengine::free_value(vm->ctx, result);
    fjs_vm_pump(vm, (int64_t)fjs::now_ms(vm));
    return 0;
}

int64_t fjs_vm_now(FJSVM *vm) { return (int64_t)fjs::now_ms(vm); }

void fjs_vm_heap(FJSVM *vm, int64_t *bytes, int64_t *objects) {
    if (bytes) *bytes = 0;
    if (objects) *objects = 0;
    if (!vm || !vm->ctx) return;
    fjsengine::MemoryUsage usage;
    fjsengine::compute_memory_usage(fjsengine::get_runtime(vm->ctx), &usage);
    if (bytes) *bytes = (int64_t)usage.malloc_size;
    if (objects) *objects = (int64_t)usage.obj_count;
}

int32_t fjs_vm_pump(FJSVM *vm, int64_t now_ms_) {    if (!vm) return -1;
    int32_t executed = 0;

    /* 0) debugger channel (spec 088/090): serve queued CDP messages before
     * the timers/jobs run, so a fresh Debugger.setBreakpointByUrl is armed
     * in the same pump that follows it. A no-op unless attached. */
    fjs::dbg::transport_feed(vm);

    /* 1) due timers (index loop: callbacks may add/remove timers) */
    bool ran_timer = true;
    while (ran_timer) {
        ran_timer = false;
        for (size_t i = 0; i < vm->timers.size(); i++) {
            FjsTimer &t = vm->timers[i];
            if (t.next_ms > (double)now_ms_) continue;
            fjsengine::Value cb = t.callback;
            fjsengine::dup_value(vm->ctx, cb); /* keep alive across possible removal */
            if (t.interval) {
                t.next_ms += t.interval_ms;
                if (t.next_ms <= (double)now_ms_) /* catch-up after jank */
                    t.next_ms = (double)now_ms_ + t.interval_ms;
            } else {
                fjsengine::free_value(vm->ctx, t.callback);
                vm->timers.erase(vm->timers.begin() + (long)i);
            }
            fjsengine::Value ret = fjsengine::call(vm->ctx, cb, fjsengine::undefined(), 0, nullptr);
            fjsengine::free_value(vm->ctx, cb);
            executed++;
            ran_timer = true;
            if (fjsengine::is_exception(ret)) {
                fjsengine::free_value(vm->ctx, ret);
                /* A throwing timer must not skip the rest of the pump: the
                 * early return also abandoned the pending-job drain, i.e.
                 * every microtask queued behind it — Vue's scheduler flush
                 * among them. One vant `useRect` throw per tick used to
                 * freeze whole pages mid-mount (specs/070 D1). Report like
                 * a browser would and move on. */
                fjsengine::Value exc = fjsengine::get_exception(vm->ctx);
                std::string msg = format_exception(vm, exc);
                fjsengine::free_value(vm->ctx, exc);
                std::string out = "[fjs/timer] " + msg;
                log_line(vm, FJS_LOG_ERROR, out.c_str(), (int32_t)out.size());
            } else {
                fjsengine::free_value(vm->ctx, ret);
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
        fjsengine::Context *ctx1 = nullptr;
        int r = fjsengine::execute_pending_job(vm->rt, &ctx1);
        if (r < 0) {
            fjsengine::Value exc = fjsengine::get_exception(ctx1);
            std::string msg = format_exception(vm, exc);
            fjsengine::free_value(ctx1, exc);
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
    fjsengine::Value global = fjsengine::get_global_object(vm->ctx);
    fjsengine::Value fn = fjsengine::get_property_str(vm->ctx, global, "__fjsDispatchEvent");
    fjsengine::free_value(vm->ctx, global);
    if (fjsengine::is_undefined(fn)) {
        fjsengine::free_value(vm->ctx, fn);
        return 0; /* runtime not installed yet — fine */
    }
    fjsengine::ValueConst argv[3];
    argv[0] = fjsengine::new_int32(vm->ctx, node_id);
    argv[1] = fjsengine::new_int32(vm->ctx, event_type);
    argv[2] = (params && len > 0)
                  ? fjsengine::new_string_len(vm->ctx, (const char *)params, (size_t)len)
                  : fjsengine::null();
    fjsengine::Value ret = fjsengine::call(vm->ctx, fn, fjsengine::undefined(), 3, argv);
    fjsengine::free_value(vm->ctx, argv[0]);
    fjsengine::free_value(vm->ctx, argv[1]);
    fjsengine::free_value(vm->ctx, argv[2]);
    fjsengine::free_value(vm->ctx, fn);
    if (fjsengine::is_exception(ret)) {
        fjsengine::free_value(vm->ctx, ret);
        fjs::fail_with_pending_exception(vm, "dispatch-event");
        return -1;
    }
    fjsengine::free_value(vm->ctx, ret);
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
    fjsengine::Value fun = fjsengine::eval(vm->ctx, code.data(), (size_t)len, "<bundle>",
                          fjsengine::eval_type_global | fjsengine::eval_flag_compile_only);
    if (fjsengine::is_exception(fun)) {
        fjs::fail_with_pending_exception(vm, "compile");
        return -1;
    }
    size_t bc_len = 0;
    uint8_t *bc = fjsengine::write_object(vm->ctx, &bc_len, fun, fjsengine::write_obj_bytecode);
    fjsengine::free_value(vm->ctx, fun);
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
    fjsengine::free_buffer(vm->ctx, bc);
    if (out && cap >= 0 && total == 0) return -1;
    return (int32_t)total;
}

} /* extern "C" */
