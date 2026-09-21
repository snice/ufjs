/*
 * Native (host) functions installed on the JS global object:
 *
 *   console.log/info/warn/error/debug(...)
 *   __fjs.setTimeout(cb, ms) / clearTimeout(id)
 *   __fjs.setInterval(cb, ms) / clearInterval(id)
 *   __fjs.uiOps(u8ArrayOrArrayBuffer)   — batched UI op buffer -> host
 *   __fjs.invokeHost(name, ...args)     — synchronous host-module call (JSI)
 *   __fjs.nowMs()
 *   __fjs.gc()                          — collect now; returns heap before/after
 *   __fjs.engine                        — { engineId, abiVersion }
 *   __fjs.natives.fibonacci(n)          — demo C++ JSI module
 *
 * Everything here receives raw JSValues from QuickJS — this is the
 * direct JS<->C++ channel, equivalent in spirit to RN's JSI HostFunctions.
 */
#include "fjs_internal.h"

#include <cmath>
#include <cstring>
#include <string>

namespace {

fjsengine::Value fjs_fail(FJSVM *vm, const char *msg) {
    return fjsengine::throw_type_error(vm->ctx, "%s", msg);
}

/* ---- console --------------------------------------------------------- */

fjsengine::Value console_print(FJSVM *vm, int32_t level, int argc, fjsengine::ValueConst *argv) {
    std::string line;
    for (int i = 0; i < argc; i++) {
        size_t len = 0;
        const char *s = fjsengine::to_cstring_len(vm->ctx, &len, argv[i]);
        if (!s) return fjsengine::exception();
        if (i > 0) line += ' ';
        line.append(s, len);
        fjsengine::free_cstring(vm->ctx, s);
    }
    fjs::log_line(vm, level, line.c_str(), (int32_t)line.size());
    return fjsengine::undefined();
}

#define CONSOLE_FN(name, LEVEL)                                                \
    static fjsengine::Value js_console_##name(fjsengine::Context *ctx, fjsengine::ValueConst this_val,    \
                                     int argc, fjsengine::ValueConst *argv) {           \
        (void)this_val;                                                        \
        FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);                         \
        return console_print(vm, LEVEL, argc, argv);                           \
    }

CONSOLE_FN(log, FJS_LOG_INFO)
CONSOLE_FN(debug, FJS_LOG_DEBUG)
CONSOLE_FN(info, FJS_LOG_INFO)
CONSOLE_FN(warn, FJS_LOG_WARN)
CONSOLE_FN(error, FJS_LOG_ERROR)

/* ---- timers ----------------------------------------------------------- */

static fjsengine::Value js_set_timeout(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                              fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (argc < 1 || !fjsengine::is_function(ctx, argv[0]))
        return fjs_fail(vm, "setTimeout(callback, ms): callback required");
    double ms = 0;
    if (argc >= 2) fjsengine::to_float64(ctx, &ms, argv[1]);
    if (ms < 0) ms = 0;

    FjsTimer t{};
    t.id = vm->next_timer_id++;
    t.interval = false;
    t.next_ms = fjs::now_ms(vm) + ms;
    t.interval_ms = 0;
    t.callback = fjsengine::dup_value(ctx, argv[0]);
    vm->timers.push_back(t);
    return fjsengine::new_int32(ctx, t.id);
}

static fjsengine::Value js_set_interval(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                               fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (argc < 1 || !fjsengine::is_function(ctx, argv[0]))
        return fjs_fail(vm, "setInterval(callback, ms): callback required");
    double ms = 0;
    if (argc >= 2) fjsengine::to_float64(ctx, &ms, argv[1]);
    if (ms < 1) ms = 1; /* no busy loops */

    FjsTimer t{};
    t.id = vm->next_timer_id++;
    t.interval = true;
    t.next_ms = fjs::now_ms(vm) + ms;
    t.interval_ms = ms;
    t.callback = fjsengine::dup_value(ctx, argv[0]);
    vm->timers.push_back(t);
    return fjsengine::new_int32(ctx, t.id);
}

static bool clear_timer(FJSVM *vm, int argc, fjsengine::ValueConst *argv) {
    if (argc < 1) return false;
    int32_t id = 0;
    if (fjsengine::to_int32(vm->ctx, &id, argv[0]) != 0) return false;
    for (auto it = vm->timers.begin(); it != vm->timers.end(); ++it) {
        if (it->id == id) {
            fjsengine::free_value(vm->ctx, it->callback);
            vm->timers.erase(it);
            return true;
        }
    }
    return false;
}

static fjsengine::Value js_clear_timer(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                              fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    clear_timer(vm, argc, argv);
    return fjsengine::undefined();
}

/* ---- UI op buffer ------------------------------------------------------ */

static fjsengine::Value js_ui_ops(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                         fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (argc < 1) return fjs_fail(vm, "uiOps(buffer) requires an argument");
    if (!vm->on_ui_ops) return fjsengine::undefined(); /* no host attached yet */

    fjsengine::ValueConst buf = argv[0];
    size_t size = 0;
    uint8_t *bytes = nullptr;
    if (fjsengine::is_object(buf)) {
        /* ArrayBuffer directly */
        size_t asize = 0;
        uint8_t *abuf = fjsengine::get_array_buffer(ctx, &asize, buf);
        if (abuf) {
            bytes = abuf;
            size = asize;
        } else {
            /* typed array (e.g. Uint8Array): read view over its buffer */
            fjsengine::Value bo2 = fjsengine::get_property_str(ctx, buf, "byteOffset");
            fjsengine::Value bl = fjsengine::get_property_str(ctx, buf, "byteLength");
            fjsengine::Value ab = fjsengine::get_property_str(ctx, buf, "buffer");
            uint32_t byteOffset = 0;
            int64_t byteLength = 0;
            if (!fjsengine::is_exception(bo2) && !fjsengine::is_exception(bl) &&
                fjsengine::to_uint32(ctx, &byteOffset, bo2) == 0 &&
                fjsengine::to_int64(ctx, &byteLength, bl) == 0) {
                size_t basize = 0;
                uint8_t *base = fjsengine::get_array_buffer(ctx, &basize, ab);
                if (base && byteOffset + byteLength <= (int64_t)basize) {
                    bytes = base + byteOffset;
                    size = (size_t)byteLength;
                }
            }
            fjsengine::free_value(ctx, bo2);
            fjsengine::free_value(ctx, bl);
            fjsengine::free_value(ctx, ab);
        }
    }
    if (!bytes) return fjs_fail(vm, "uiOps expects a Uint8Array/ArrayBuffer");
    /* The host copies synchronously inside the callback. */
    vm->on_ui_ops(bytes, (int32_t)size);
    return fjsengine::undefined();
}

/* ---- synchronous host-module invocation (JSI) --------------------------- */

static fjsengine::Value js_invoke_host(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                              fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (argc < 1 || !fjsengine::is_string(argv[0]))
        return fjs_fail(vm, "invokeHost(name, ...args): name required");
    if (!vm->on_invoke_host)
        return fjs_fail(vm, "no host module handler installed");

    size_t name_len = 0;
    const char *name = fjsengine::to_cstring_len(ctx, &name_len, argv[0]);
    if (!name) return fjsengine::exception();

    int32_t nargs = argc - 1;
    FJSValue *cargs = nullptr;
    if (nargs > 0) {
        cargs = (FJSValue *)calloc((size_t)nargs, sizeof(FJSValue));
        if (!cargs) {
            fjsengine::free_cstring(ctx, name);
            return fjsengine::exception();
        }
        for (int32_t i = 0; i < nargs; i++) {
            if (!fjs::to_fjs_value(vm, argv[1 + i], &cargs[i])) {
                for (int32_t k = 0; k < i; k++) fjs::fjs_free_abi_value(vm, &cargs[k]);
                free(cargs);
                fjsengine::free_cstring(ctx, name);
                return fjsengine::exception();
            }
        }
    }

    FJSValue out{};
    int32_t rc = vm->on_invoke_host(name, nargs, cargs, &out);

    /* free converted args (string ptrs owned by QuickJS) */
    for (int32_t i = 0; i < nargs; i++) fjs::fjs_free_abi_value(vm, &cargs[i]);
    free(cargs);
    fjsengine::free_cstring(ctx, name);

    if (rc != 0) {
        fjs::fjs_free_abi_value(vm, &out);
        return fjs_fail(vm, "host module call failed"); /* host sets details */
    }
    return fjs::from_fjs_value(vm, &out); /* consumes malloc'ed strings */
}

/* ---- binary handles (spec 038) -------------------------------------------
 *
 * JS creates a handle from an ArrayBuffer/TypedArray, hands the int to any
 * host module (plain scalar on the wire), and later materializes it back.
 * The bytes never serialize: they copy JS->C++ once and C++->JS once, where
 * the v1 path paid base64 inside JSON both ways. */

/* Shared shape with js_ui_ops: ArrayBuffer directly, or a typed-array view
 * over its buffer. Returns null (with size 0) for anything else. */
static uint8_t *read_buffer_arg(fjsengine::Context *ctx, fjsengine::ValueConst buf,
                                size_t *size) {
    *size = 0;
    size_t asize = 0;
    uint8_t *abuf = fjsengine::get_array_buffer(ctx, &asize, buf);
    if (abuf) {
        *size = asize;
        return abuf;
    }
    if (!fjsengine::is_object(buf)) return nullptr;
    fjsengine::Value bo2 = fjsengine::get_property_str(ctx, buf, "byteOffset");
    fjsengine::Value bl = fjsengine::get_property_str(ctx, buf, "byteLength");
    fjsengine::Value ab = fjsengine::get_property_str(ctx, buf, "buffer");
    uint32_t byteOffset = 0;
    int64_t byteLength = 0;
    uint8_t *bytes = nullptr;
    if (!fjsengine::is_exception(bo2) && !fjsengine::is_exception(bl) &&
        fjsengine::to_uint32(ctx, &byteOffset, bo2) == 0 &&
        fjsengine::to_int64(ctx, &byteLength, bl) == 0) {
        size_t basize = 0;
        uint8_t *base = fjsengine::get_array_buffer(ctx, &basize, ab);
        if (base && byteOffset + byteLength <= (int64_t)basize) {
            bytes = base + byteOffset;
            *size = (size_t)byteLength;
        }
    }
    fjsengine::free_value(ctx, bo2);
    fjsengine::free_value(ctx, bl);
    fjsengine::free_value(ctx, ab);
    return bytes;
}

static fjsengine::Value js_handle_bytes(fjsengine::Context *ctx, fjsengine::ValueConst this_val,
                               int argc, fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (argc < 1) return fjs_fail(vm, "handleBytes(data): data required");
    size_t size = 0;
    uint8_t *bytes = read_buffer_arg(ctx, argv[0], &size);
    if (!bytes) return fjs_fail(vm, "handleBytes expects a Uint8Array/ArrayBuffer");
    int64_t id = fjs_handle_put_bytes(vm, 0, bytes, (int32_t)size);
    if (!id) return fjsengine::exception();
    return fjsengine::new_int64(ctx, id);
}

static fjsengine::Value js_read_handle_bytes(fjsengine::Context *ctx, fjsengine::ValueConst this_val,
                                    int argc, fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    int64_t id = 0;
    if (argc < 1 || fjsengine::to_int64(ctx, &id, argv[0]) != 0)
        return fjs_fail(vm, "readHandleBytes(id): id required");
    const uint8_t *data = nullptr;
    int32_t len = 0;
    fjs_handle_bytes(vm, id, &data, &len);
    if (!data) return fjs_fail(vm, "readHandleBytes: unknown or released handle");
    return fjsengine::new_array_buffer_copy(ctx, data, (size_t)len);
}

static fjsengine::Value js_release_handle(fjsengine::Context *ctx, fjsengine::ValueConst this_val,
                                 int argc, fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    int64_t id = 0;
    if (argc < 1 || fjsengine::to_int64(ctx, &id, argv[0]) != 0)
        return fjs_fail(vm, "releaseHandle(id): id required");
    fjs_handle_release(vm, id);
    return fjsengine::undefined();
}

/* ---- misc --------------------------------------------------------------- */

static fjsengine::Value js_now_ms(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                         fjsengine::ValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    return fjsengine::new_float64(ctx, fjs::now_ms(vm));
}

/* Collects now, and reports what the heap looked like on either side.
 *
 * QuickJS collects when an object allocation crosses a threshold, and the
 * threshold is recomputed as live*1.5 after every collection — so a
 * collection lands wherever the allocation happens to cross it, which on a
 * busy frame is in the middle of the work the user is watching. Handing the
 * decision to the host is the first step to moving it somewhere idle. */
static fjsengine::Value js_gc(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                     fjsengine::ValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    fjsengine::Runtime *rt = fjsengine::get_runtime(ctx);
    fjsengine::MemoryUsage before, after;
    fjsengine::compute_memory_usage(rt, &before);
    fjsengine::run_gc(rt);
    fjsengine::compute_memory_usage(rt, &after);
    fjsengine::Value out = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, out, "before", fjsengine::new_int64(ctx, before.malloc_size));
    fjsengine::set_property_str(ctx, out, "after", fjsengine::new_int64(ctx, after.malloc_size));
    fjsengine::set_property_str(ctx, out, "objects", fjsengine::new_int64(ctx, after.obj_count));
    return out;
}

static fjsengine::Value js_toast(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                        fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (argc < 1 || !vm->on_toast) return fjsengine::undefined();
    size_t len = 0;
    const char *msg = fjsengine::to_cstring_len(ctx, &len, argv[0]);
    if (!msg) return fjsengine::exception();
    vm->on_toast(msg, (int32_t)len);
    fjsengine::free_cstring(ctx, msg);
    return fjsengine::undefined();
}

/* ---- demo native module: fibonacci (pure C++, called straight from JS) -- */

static int64_t fib(int64_t n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

static fjsengine::Value js_fibonacci(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                            fjsengine::ValueConst *argv) {
    (void)this_val;
    if (argc < 1) return fjsengine::throw_type_error(ctx, "fibonacci(n) requires n");
    int64_t n = 0;
    if (fjsengine::to_int64(ctx, &n, argv[0]) != 0)
        return fjsengine::throw_type_error(ctx, "fibonacci(n): n must be an integer");
    if (n < 0 || n > 45)
        return fjsengine::throw_range_error(ctx, "fibonacci(n): n out of range [0, 45]");
    return fjsengine::new_int64(ctx, fib(n));
}

static fjsengine::Value js_engine_info(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                              fjsengine::ValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    fjsengine::Value obj = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, obj, "engineId", fjsengine::new_string(ctx, fjs_engine_id()));
    fjsengine::set_property_str(ctx, obj, "abiVersion", fjsengine::new_int32(ctx, fjs_abi_version()));
    (void)vm;
    return obj;
}

} // namespace

namespace fjs {

bool install_natives(FJSVM *vm) {
    fjsengine::Context *ctx = vm->ctx;
    fjsengine::set_context_opaque(ctx, vm);

    fjsengine::Value global = fjsengine::get_global_object(ctx);

    /* console */
    fjsengine::Value console = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, console, "log", fjsengine::new_c_function(ctx, js_console_log, "log", 1));
    fjsengine::set_property_str(ctx, console, "debug", fjsengine::new_c_function(ctx, js_console_debug, "debug", 1));
    fjsengine::set_property_str(ctx, console, "info", fjsengine::new_c_function(ctx, js_console_info, "info", 1));
    fjsengine::set_property_str(ctx, console, "warn", fjsengine::new_c_function(ctx, js_console_warn, "warn", 1));
    fjsengine::set_property_str(ctx, console, "error", fjsengine::new_c_function(ctx, js_console_error, "error", 1));
    fjsengine::set_property_str(ctx, global, "console", console);

    /* __fjs */
    fjsengine::Value fns = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, fns, "setTimeout", fjsengine::new_c_function(ctx, js_set_timeout, "setTimeout", 2));
    fjsengine::set_property_str(ctx, fns, "clearTimeout", fjsengine::new_c_function(ctx, js_clear_timer, "clearTimeout", 1));
    fjsengine::set_property_str(ctx, fns, "setInterval", fjsengine::new_c_function(ctx, js_set_interval, "setInterval", 2));
    fjsengine::set_property_str(ctx, fns, "clearInterval", fjsengine::new_c_function(ctx, js_clear_timer, "clearInterval", 1));
    fjsengine::set_property_str(ctx, fns, "uiOps", fjsengine::new_c_function(ctx, js_ui_ops, "uiOps", 1));
    fjsengine::set_property_str(ctx, fns, "invokeHost", fjsengine::new_c_function(ctx, js_invoke_host, "invokeHost", 1));
    fjsengine::set_property_str(ctx, fns, "handleBytes", fjsengine::new_c_function(ctx, js_handle_bytes, "handleBytes", 1));
    fjsengine::set_property_str(ctx, fns, "readHandleBytes", fjsengine::new_c_function(ctx, js_read_handle_bytes, "readHandleBytes", 1));
    fjsengine::set_property_str(ctx, fns, "releaseHandle", fjsengine::new_c_function(ctx, js_release_handle, "releaseHandle", 1));
    fjsengine::set_property_str(ctx, fns, "nowMs", fjsengine::new_c_function(ctx, js_now_ms, "nowMs", 0));
    fjsengine::set_property_str(ctx, fns, "toast", fjsengine::new_c_function(ctx, js_toast, "toast", 1));
    fjsengine::set_property_str(ctx, fns, "gc", fjsengine::new_c_function(ctx, js_gc, "gc", 0));
    fjsengine::set_property_str(ctx, fns, "engine", js_engine_info(ctx, fjsengine::undefined(), 0, nullptr));

    fjsengine::Value root = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, root, "fns", fns);
    /* expose demo natives directly for discoverability */
    fjsengine::Value natives = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, natives, "fibonacci",
                      fjsengine::new_c_function(ctx, js_fibonacci, "fibonacci", 1));
    fjsengine::set_property_str(ctx, root, "natives", natives);
    fjsengine::set_property_str(ctx, root, "engine", js_engine_info(ctx, fjsengine::undefined(), 0, nullptr));
    fjsengine::set_property_str(ctx, global, "__fjs", root);

    fjsengine::free_value(ctx, global);
    return true;
}

} // namespace fjs
