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

LEPUSValue fjs_fail(FJSVM *vm, const char *msg) {
    return LEPUS_ThrowTypeError(vm->ctx, "%s", msg);
}

/* ---- console --------------------------------------------------------- */

LEPUSValue console_print(FJSVM *vm, int32_t level, int argc, LEPUSValueConst *argv) {
    std::string line;
    for (int i = 0; i < argc; i++) {
        size_t len = 0;
        const char *s = LEPUS_ToCStringLen(vm->ctx, &len, argv[i]);
        if (!s) return LEPUS_EXCEPTION;
        if (i > 0) line += ' ';
        line.append(s, len);
        LEPUS_FreeCString(vm->ctx, s);
    }
    fjs::log_line(vm, level, line.c_str(), (int32_t)line.size());
    return LEPUS_UNDEFINED;
}

#define CONSOLE_FN(name, LEVEL)                                                \
    static LEPUSValue js_console_##name(LEPUSContext *ctx, LEPUSValueConst this_val,    \
                                     int argc, LEPUSValueConst *argv) {           \
        (void)this_val;                                                        \
        FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);                         \
        return console_print(vm, LEVEL, argc, argv);                           \
    }

CONSOLE_FN(log, FJS_LOG_INFO)
CONSOLE_FN(debug, FJS_LOG_DEBUG)
CONSOLE_FN(info, FJS_LOG_INFO)
CONSOLE_FN(warn, FJS_LOG_WARN)
CONSOLE_FN(error, FJS_LOG_ERROR)

/* ---- timers ----------------------------------------------------------- */

static LEPUSValue js_set_timeout(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                              LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    if (argc < 1 || !LEPUS_IsFunction(ctx, argv[0]))
        return fjs_fail(vm, "setTimeout(callback, ms): callback required");
    double ms = 0;
    if (argc >= 2) LEPUS_ToFloat64(ctx, &ms, argv[1]);
    if (ms < 0) ms = 0;

    FjsTimer t{};
    t.id = vm->next_timer_id++;
    t.interval = false;
    t.next_ms = fjs::now_ms(vm) + ms;
    t.interval_ms = 0;
    t.callback = LEPUS_DupValue(ctx, argv[0]);
    vm->timers.push_back(t);
    return LEPUS_NewInt32(ctx, t.id);
}

static LEPUSValue js_set_interval(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                               LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    if (argc < 1 || !LEPUS_IsFunction(ctx, argv[0]))
        return fjs_fail(vm, "setInterval(callback, ms): callback required");
    double ms = 0;
    if (argc >= 2) LEPUS_ToFloat64(ctx, &ms, argv[1]);
    if (ms < 1) ms = 1; /* no busy loops */

    FjsTimer t{};
    t.id = vm->next_timer_id++;
    t.interval = true;
    t.next_ms = fjs::now_ms(vm) + ms;
    t.interval_ms = ms;
    t.callback = LEPUS_DupValue(ctx, argv[0]);
    vm->timers.push_back(t);
    return LEPUS_NewInt32(ctx, t.id);
}

static bool clear_timer(FJSVM *vm, int argc, LEPUSValueConst *argv) {
    if (argc < 1) return false;
    int32_t id = 0;
    if (LEPUS_ToInt32(vm->ctx, &id, argv[0]) != 0) return false;
    for (auto it = vm->timers.begin(); it != vm->timers.end(); ++it) {
        if (it->id == id) {
            LEPUS_FreeValue(vm->ctx, it->callback);
            vm->timers.erase(it);
            return true;
        }
    }
    return false;
}

static LEPUSValue js_clear_timer(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                              LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    clear_timer(vm, argc, argv);
    return LEPUS_UNDEFINED;
}

/* ---- UI op buffer ------------------------------------------------------ */

static LEPUSValue js_ui_ops(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                         LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    if (argc < 1) return fjs_fail(vm, "uiOps(buffer) requires an argument");
    if (!vm->on_ui_ops) return LEPUS_UNDEFINED; /* no host attached yet */

    LEPUSValueConst buf = argv[0];
    size_t size = 0;
    uint8_t *bytes = nullptr;
    if (LEPUS_IsObject(buf)) {
        /* ArrayBuffer directly */
        size_t asize = 0;
        uint8_t *abuf = LEPUS_GetArrayBuffer(ctx, &asize, buf);
        if (abuf) {
            bytes = abuf;
            size = asize;
        } else {
            /* typed array (e.g. Uint8Array): read view over its buffer */
            LEPUSValue bo2 = LEPUS_GetPropertyStr(ctx, buf, "byteOffset");
            LEPUSValue bl = LEPUS_GetPropertyStr(ctx, buf, "byteLength");
            LEPUSValue ab = LEPUS_GetPropertyStr(ctx, buf, "buffer");
            uint32_t byteOffset = 0;
            int64_t byteLength = 0;
            if (!LEPUS_IsException(bo2) && !LEPUS_IsException(bl) &&
                LEPUS_ToUint32(ctx, &byteOffset, bo2) == 0 &&
                LEPUS_ToInt64(ctx, &byteLength, bl) == 0) {
                size_t basize = 0;
                uint8_t *base = LEPUS_GetArrayBuffer(ctx, &basize, ab);
                if (base && byteOffset + byteLength <= (int64_t)basize) {
                    bytes = base + byteOffset;
                    size = (size_t)byteLength;
                }
            }
            LEPUS_FreeValue(ctx, bo2);
            LEPUS_FreeValue(ctx, bl);
            LEPUS_FreeValue(ctx, ab);
        }
    }
    if (!bytes) return fjs_fail(vm, "uiOps expects a Uint8Array/ArrayBuffer");
    /* The host copies synchronously inside the callback. */
    vm->on_ui_ops(bytes, (int32_t)size);
    return LEPUS_UNDEFINED;
}

/* ---- synchronous host-module invocation (JSI) --------------------------- */

static LEPUSValue js_invoke_host(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                              LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    if (argc < 1 || !LEPUS_IsString(argv[0]))
        return fjs_fail(vm, "invokeHost(name, ...args): name required");
    if (!vm->on_invoke_host)
        return fjs_fail(vm, "no host module handler installed");

    size_t name_len = 0;
    const char *name = LEPUS_ToCStringLen(ctx, &name_len, argv[0]);
    if (!name) return LEPUS_EXCEPTION;

    int32_t nargs = argc - 1;
    FJSValue *cargs = nullptr;
    if (nargs > 0) {
        cargs = (FJSValue *)calloc((size_t)nargs, sizeof(FJSValue));
        if (!cargs) {
            LEPUS_FreeCString(ctx, name);
            return LEPUS_EXCEPTION;
        }
        for (int32_t i = 0; i < nargs; i++) {
            if (!fjs::to_fjs_value(vm, argv[1 + i], &cargs[i])) {
                for (int32_t k = 0; k < i; k++) fjs::fjs_free_abi_value(vm, &cargs[k]);
                free(cargs);
                LEPUS_FreeCString(ctx, name);
                return LEPUS_EXCEPTION;
            }
        }
    }

    FJSValue out{};
    int32_t rc = vm->on_invoke_host(name, nargs, cargs, &out);

    /* free converted args (string ptrs owned by QuickJS) */
    for (int32_t i = 0; i < nargs; i++) fjs::fjs_free_abi_value(vm, &cargs[i]);
    free(cargs);
    LEPUS_FreeCString(ctx, name);

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
static uint8_t *read_buffer_arg(LEPUSContext *ctx, LEPUSValueConst buf,
                                size_t *size) {
    *size = 0;
    size_t asize = 0;
    uint8_t *abuf = LEPUS_GetArrayBuffer(ctx, &asize, buf);
    if (abuf) {
        *size = asize;
        return abuf;
    }
    if (!LEPUS_IsObject(buf)) return nullptr;
    LEPUSValue bo2 = LEPUS_GetPropertyStr(ctx, buf, "byteOffset");
    LEPUSValue bl = LEPUS_GetPropertyStr(ctx, buf, "byteLength");
    LEPUSValue ab = LEPUS_GetPropertyStr(ctx, buf, "buffer");
    uint32_t byteOffset = 0;
    int64_t byteLength = 0;
    uint8_t *bytes = nullptr;
    if (!LEPUS_IsException(bo2) && !LEPUS_IsException(bl) &&
        LEPUS_ToUint32(ctx, &byteOffset, bo2) == 0 &&
        LEPUS_ToInt64(ctx, &byteLength, bl) == 0) {
        size_t basize = 0;
        uint8_t *base = LEPUS_GetArrayBuffer(ctx, &basize, ab);
        if (base && byteOffset + byteLength <= (int64_t)basize) {
            bytes = base + byteOffset;
            *size = (size_t)byteLength;
        }
    }
    LEPUS_FreeValue(ctx, bo2);
    LEPUS_FreeValue(ctx, bl);
    LEPUS_FreeValue(ctx, ab);
    return bytes;
}

static LEPUSValue js_handle_bytes(LEPUSContext *ctx, LEPUSValueConst this_val,
                               int argc, LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    if (argc < 1) return fjs_fail(vm, "handleBytes(data): data required");
    size_t size = 0;
    uint8_t *bytes = read_buffer_arg(ctx, argv[0], &size);
    if (!bytes) return fjs_fail(vm, "handleBytes expects a Uint8Array/ArrayBuffer");
    int64_t id = fjs_handle_put_bytes(vm, 0, bytes, (int32_t)size);
    if (!id) return LEPUS_EXCEPTION;
    return LEPUS_NewInt64(ctx, id);
}

static LEPUSValue js_read_handle_bytes(LEPUSContext *ctx, LEPUSValueConst this_val,
                                    int argc, LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    int64_t id = 0;
    if (argc < 1 || LEPUS_ToInt64(ctx, &id, argv[0]) != 0)
        return fjs_fail(vm, "readHandleBytes(id): id required");
    const uint8_t *data = nullptr;
    int32_t len = 0;
    fjs_handle_bytes(vm, id, &data, &len);
    if (!data) return fjs_fail(vm, "readHandleBytes: unknown or released handle");
    return LEPUS_NewArrayBufferCopy(ctx, data, (size_t)len);
}

static LEPUSValue js_release_handle(LEPUSContext *ctx, LEPUSValueConst this_val,
                                 int argc, LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    int64_t id = 0;
    if (argc < 1 || LEPUS_ToInt64(ctx, &id, argv[0]) != 0)
        return fjs_fail(vm, "releaseHandle(id): id required");
    fjs_handle_release(vm, id);
    return LEPUS_UNDEFINED;
}

/* ---- misc --------------------------------------------------------------- */

static LEPUSValue js_now_ms(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                         LEPUSValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    return LEPUS_NewFloat64(ctx, fjs::now_ms(vm));
}

/* Collects now, and reports what the heap looked like on either side.
 *
 * QuickJS collects when an object allocation crosses a threshold, and the
 * threshold is recomputed as live*1.5 after every collection — so a
 * collection lands wherever the allocation happens to cross it, which on a
 * busy frame is in the middle of the work the user is watching. Handing the
 * decision to the host is the first step to moving it somewhere idle. */
static LEPUSValue js_gc(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                     LEPUSValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    LEPUSRuntime *rt = LEPUS_GetRuntime(ctx);
    LEPUSMemoryUsage before, after;
    LEPUS_ComputeMemoryUsage(rt, &before);
    LEPUS_RunGC(rt);
    LEPUS_ComputeMemoryUsage(rt, &after);
    LEPUSValue out = LEPUS_NewObject(ctx);
    LEPUS_SetPropertyStr(ctx, out, "before", LEPUS_NewInt64(ctx, before.malloc_size));
    LEPUS_SetPropertyStr(ctx, out, "after", LEPUS_NewInt64(ctx, after.malloc_size));
    LEPUS_SetPropertyStr(ctx, out, "objects", LEPUS_NewInt64(ctx, after.obj_count));
    return out;
}

static LEPUSValue js_toast(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                        LEPUSValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    if (argc < 1 || !vm->on_toast) return LEPUS_UNDEFINED;
    size_t len = 0;
    const char *msg = LEPUS_ToCStringLen(ctx, &len, argv[0]);
    if (!msg) return LEPUS_EXCEPTION;
    vm->on_toast(msg, (int32_t)len);
    LEPUS_FreeCString(ctx, msg);
    return LEPUS_UNDEFINED;
}

/* ---- demo native module: fibonacci (pure C++, called straight from JS) -- */

static int64_t fib(int64_t n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

static LEPUSValue js_fibonacci(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                            LEPUSValueConst *argv) {
    (void)this_val;
    if (argc < 1) return LEPUS_ThrowTypeError(ctx, "fibonacci(n) requires n");
    int64_t n = 0;
    if (LEPUS_ToInt64(ctx, &n, argv[0]) != 0)
        return LEPUS_ThrowTypeError(ctx, "fibonacci(n): n must be an integer");
    if (n < 0 || n > 45)
        return LEPUS_ThrowRangeError(ctx, "fibonacci(n): n out of range [0, 45]");
    return LEPUS_NewInt64(ctx, fib(n));
}

static LEPUSValue js_engine_info(LEPUSContext *ctx, LEPUSValueConst this_val, int argc,
                              LEPUSValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    FJSVM *vm = (FJSVM *)LEPUS_GetContextOpaque(ctx);
    LEPUSValue obj = LEPUS_NewObject(ctx);
    LEPUS_SetPropertyStr(ctx, obj, "engineId", LEPUS_NewString(ctx, fjs_engine_id()));
    LEPUS_SetPropertyStr(ctx, obj, "abiVersion", LEPUS_NewInt32(ctx, fjs_abi_version()));
    (void)vm;
    return obj;
}

} // namespace

namespace fjs {

bool install_natives(FJSVM *vm) {
    LEPUSContext *ctx = vm->ctx;
    LEPUS_SetContextOpaque(ctx, vm);

    LEPUSValue global = LEPUS_GetGlobalObject(ctx);

    /* console */
    LEPUSValue console = LEPUS_NewObject(ctx);
    LEPUS_SetPropertyStr(ctx, console, "log", LEPUS_NewCFunction(ctx, js_console_log, "log", 1));
    LEPUS_SetPropertyStr(ctx, console, "debug", LEPUS_NewCFunction(ctx, js_console_debug, "debug", 1));
    LEPUS_SetPropertyStr(ctx, console, "info", LEPUS_NewCFunction(ctx, js_console_info, "info", 1));
    LEPUS_SetPropertyStr(ctx, console, "warn", LEPUS_NewCFunction(ctx, js_console_warn, "warn", 1));
    LEPUS_SetPropertyStr(ctx, console, "error", LEPUS_NewCFunction(ctx, js_console_error, "error", 1));
    LEPUS_SetPropertyStr(ctx, global, "console", console);

    /* __fjs */
    LEPUSValue fns = LEPUS_NewObject(ctx);
    LEPUS_SetPropertyStr(ctx, fns, "setTimeout", LEPUS_NewCFunction(ctx, js_set_timeout, "setTimeout", 2));
    LEPUS_SetPropertyStr(ctx, fns, "clearTimeout", LEPUS_NewCFunction(ctx, js_clear_timer, "clearTimeout", 1));
    LEPUS_SetPropertyStr(ctx, fns, "setInterval", LEPUS_NewCFunction(ctx, js_set_interval, "setInterval", 2));
    LEPUS_SetPropertyStr(ctx, fns, "clearInterval", LEPUS_NewCFunction(ctx, js_clear_timer, "clearInterval", 1));
    LEPUS_SetPropertyStr(ctx, fns, "uiOps", LEPUS_NewCFunction(ctx, js_ui_ops, "uiOps", 1));
    LEPUS_SetPropertyStr(ctx, fns, "invokeHost", LEPUS_NewCFunction(ctx, js_invoke_host, "invokeHost", 1));
    LEPUS_SetPropertyStr(ctx, fns, "handleBytes", LEPUS_NewCFunction(ctx, js_handle_bytes, "handleBytes", 1));
    LEPUS_SetPropertyStr(ctx, fns, "readHandleBytes", LEPUS_NewCFunction(ctx, js_read_handle_bytes, "readHandleBytes", 1));
    LEPUS_SetPropertyStr(ctx, fns, "releaseHandle", LEPUS_NewCFunction(ctx, js_release_handle, "releaseHandle", 1));
    LEPUS_SetPropertyStr(ctx, fns, "nowMs", LEPUS_NewCFunction(ctx, js_now_ms, "nowMs", 0));
    LEPUS_SetPropertyStr(ctx, fns, "toast", LEPUS_NewCFunction(ctx, js_toast, "toast", 1));
    LEPUS_SetPropertyStr(ctx, fns, "gc", LEPUS_NewCFunction(ctx, js_gc, "gc", 0));
    LEPUS_SetPropertyStr(ctx, fns, "engine", js_engine_info(ctx, LEPUS_UNDEFINED, 0, nullptr));

    LEPUSValue root = LEPUS_NewObject(ctx);
    LEPUS_SetPropertyStr(ctx, root, "fns", fns);
    /* expose demo natives directly for discoverability */
    LEPUSValue natives = LEPUS_NewObject(ctx);
    LEPUS_SetPropertyStr(ctx, natives, "fibonacci",
                      LEPUS_NewCFunction(ctx, js_fibonacci, "fibonacci", 1));
    LEPUS_SetPropertyStr(ctx, root, "natives", natives);
    LEPUS_SetPropertyStr(ctx, root, "engine", js_engine_info(ctx, LEPUS_UNDEFINED, 0, nullptr));
    LEPUS_SetPropertyStr(ctx, global, "__fjs", root);

    LEPUS_FreeValue(ctx, global);
    return true;
}

} // namespace fjs
