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
 *   __fjs.styleAttach/Detach/Result/Stats — libfjs-style binding (specs/150)
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
    if (vm->style.style) {
        /* specs/150: the frame goes through libfjs-style, which strips the
         * style input ops and appends the styles its flush wrote. Callbacks
         * into JS happen in here; the frame bytes stay valid because argv
         * holds the buffer. */
        if (vm->style.busy) return fjs_fail(vm, "uiOps: called from inside a style callback");
        vm->style.busy = true;
        vm->style.threw = false;
        const uint8_t *out = nullptr;
        size_t out_len = 0;
        int rc = fjs_style_process(vm->style.style, bytes, size, &out, &out_len);
        vm->style.busy = false;
        bool threw = vm->style.threw;
        if (rc != 0) {
            /* the frame's structure still goes to Dart (libfjs-style hands
             * back the frame minus its style ops); the tree it kept is out
             * of step now: detach, so the runtime notices (styleResult stops
             * answering) and restyles with its own engine */
            if (out) vm->on_ui_ops(out, (int32_t)out_len);
            fjs::style_detach(vm);
            vm->style.stripping = true;
            if (threw) return fjsengine::exception();
            return fjs_fail(vm, "uiOps: the native style engine rejected the frame");
        }
        vm->on_ui_ops(out, (int32_t)out_len);
        return threw ? fjsengine::exception() : fjsengine::undefined();
    }
    if (vm->style.stripping) {
        vm->style.stripped.resize(size);
        size_t n = fjs_style_strip(bytes, size, vm->style.stripped.data());
        vm->on_ui_ops(vm->style.stripped.data(), (int32_t)n);
        return fjsengine::undefined();
    }
    /* The host copies synchronously inside the callback. */
    vm->on_ui_ops(bytes, (int32_t)size);
    return fjsengine::undefined();
}

/* ---- libfjs-style binding (specs/150) -------------------------------------
 *
 * The engine-specific half of the native style engine: libfjs-style itself
 * knows no JS engine and calls back through plain C function pointers; these
 * turn each callback into a call of the JS function styleAttach was given.
 * Another engine needs only this block rewritten. */

static uint32_t style_define_match(void *user, const fjs_style_hit *hits, uint32_t count) {
    FJSVM *vm = (FJSVM *)user;
    fjsengine::Context *ctx = vm->ctx;
    /* the hit structs as they lie in memory: four int32 each, read with an
     * Int32Array (host byte order on both ends) */
    fjsengine::Value buf =
        fjsengine::new_array_buffer_copy(ctx, (const uint8_t *)hits, count * sizeof(fjs_style_hit));
    fjsengine::Value r = fjsengine::call(ctx, vm->style.define_match, fjsengine::undefined(), 1, &buf);
    fjsengine::free_value(ctx, buf);
    if (fjsengine::is_exception(r)) {
        vm->style.threw = true;
        return 0;
    }
    uint32_t id = 0;
    fjsengine::to_uint32(ctx, &id, r);
    fjsengine::free_value(ctx, r);
    return id;
}

/* Copies an optional string property into `slot`; false when present but
 * not convertible. */
static bool style_read_json(fjsengine::Context *ctx, fjsengine::ValueConst obj, const char *prop,
                            std::string &slot, const char **ptr, size_t *len) {
    *ptr = nullptr;
    *len = 0;
    fjsengine::Value v = fjsengine::get_property_str(ctx, obj, prop);
    if (fjsengine::is_exception(v)) return false;
    if (fjsengine::is_undefined(v) || fjsengine::is_null(v)) return true;
    size_t n = 0;
    const char *s = fjsengine::to_cstring_len(ctx, &n, v);
    fjsengine::free_value(ctx, v);
    if (!s) return false;
    slot.assign(s, n);
    fjsengine::free_cstring(ctx, s);
    *ptr = slot.data();
    *len = slot.size();
    return true;
}

static int style_compute(void *user, const fjs_style_subject *sub, fjs_style_result *out) {
    FJSVM *vm = (FJSVM *)user;
    fjsengine::Context *ctx = vm->ctx;
    fjsengine::Value args[8] = {
        fjsengine::new_int64(ctx, sub->element),   fjsengine::new_int64(ctx, sub->match),
        fjsengine::new_int64(ctx, sub->parent_result), fjsengine::new_int64(ctx, sub->tag),
        fjsengine::new_int64(ctx, sub->defaults),  fjsengine::new_int64(ctx, sub->inline_key),
        fjsengine::new_int64(ctx, sub->flags),     fjsengine::new_int64(ctx, sub->seeded)};
    fjsengine::Value r = fjsengine::call(ctx, vm->style.compute, fjsengine::undefined(), 8, args);
    if (fjsengine::is_exception(r)) {
        vm->style.threw = true;
        return -1;
    }
    bool ok = fjsengine::is_object(r);
    if (ok) {
        fjsengine::Value id = fjsengine::get_property_str(ctx, r, "result");
        fjsengine::Value flags = fjsengine::get_property_str(ctx, r, "flags");
        ok = fjsengine::to_uint32(ctx, &out->result, id) == 0;
        if (ok && !fjsengine::is_undefined(flags)) ok = fjsengine::to_uint32(ctx, &out->flags, flags) == 0;
        fjsengine::free_value(ctx, id);
        fjsengine::free_value(ctx, flags);
    }
    ok = ok && style_read_json(ctx, r, "style", vm->style.json[0], &out->style, &out->style_len) &&
         style_read_json(ctx, r, "active", vm->style.json[1], &out->active, &out->active_len) &&
         style_read_json(ctx, r, "hover", vm->style.json[2], &out->hover, &out->hover_len);
    fjsengine::free_value(ctx, r);
    return ok ? 0 : -1;
}

static void style_styled(void *user, uint32_t element, uint32_t result) {
    FJSVM *vm = (FJSVM *)user;
    fjsengine::Context *ctx = vm->ctx;
    fjsengine::Value args[2] = {fjsengine::new_int64(ctx, element), fjsengine::new_int64(ctx, result)};
    fjsengine::Value r = fjsengine::call(ctx, vm->style.styled, fjsengine::undefined(), 2, args);
    if (fjsengine::is_exception(r)) vm->style.threw = true;
    else fjsengine::free_value(ctx, r);
}

/* styleAttach(defineMatch, compute, styled): routes every later frame
 * through a fresh libfjs-style instance. */
static fjsengine::Value js_style_attach(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                                        fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (argc < 3 || !fjsengine::is_function(ctx, argv[0]) || !fjsengine::is_function(ctx, argv[1]) ||
        !fjsengine::is_function(ctx, argv[2]))
        return fjs_fail(vm, "styleAttach(defineMatch, compute, styled): three functions required");
    if (vm->style.busy) return fjs_fail(vm, "styleAttach: called from inside a style callback");
    fjs::style_detach(vm);
    vm->style.stripping = false;
    vm->style.define_match = fjsengine::dup_value(ctx, argv[0]);
    vm->style.compute = fjsengine::dup_value(ctx, argv[1]);
    vm->style.styled = fjsengine::dup_value(ctx, argv[2]);
    fjs_style_callbacks cb{vm, style_define_match, style_compute, style_styled};
    vm->style.style = fjs_style_create(&cb);
    return fjsengine::new_bool(ctx, true);
}

static fjsengine::Value js_style_detach(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                                        fjsengine::ValueConst *argv) {
    (void)this_val; (void)argc; (void)argv;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (vm->style.busy) return fjs_fail(vm, "styleDetach: called from inside a style callback");
    fjs::style_detach(vm);
    return fjsengine::undefined();
}

/* styleResult(element): the host result id the element's style came from,
 * or -1 when no instance is attached (a failed frame detaches it). */
static fjsengine::Value js_style_result(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                                        fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (!vm->style.style) return fjsengine::new_int32(ctx, -1);
    uint32_t id = 0;
    if (argc < 1 || fjsengine::to_uint32(ctx, &id, argv[0]) != 0) return fjs_fail(vm, "styleResult(id): id required");
    return fjsengine::new_int64(ctx, fjs_style_result_of(vm->style.style, id));
}

/* styleClasses(element): the element's class atoms as an ArrayBuffer of
 * uint32 (host byte order), or null when no instance is attached. */
static fjsengine::Value js_style_classes(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                                         fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (!vm->style.style) return fjsengine::null();
    uint32_t id = 0;
    if (argc < 1 || fjsengine::to_uint32(ctx, &id, argv[0]) != 0) return fjs_fail(vm, "styleClasses(id): id required");
    const uint32_t *atoms = nullptr;
    size_t n = fjs_style_classes_of(vm->style.style, id, &atoms);
    return fjsengine::new_array_buffer_copy(ctx, (const uint8_t *)atoms, n * sizeof(uint32_t));
}

/* styleMatchedRules(element): the hits of the element's current match as an
 * ArrayBuffer of int32 quadruples (DevTools), null when not attached. */
static fjsengine::Value js_style_matched_rules(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                                               fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (!vm->style.style) return fjsengine::null();
    uint32_t id = 0;
    if (argc < 1 || fjsengine::to_uint32(ctx, &id, argv[0]) != 0)
        return fjs_fail(vm, "styleMatchedRules(id): id required");
    const fjs_style_hit *hits = nullptr;
    size_t n = fjs_style_hits_of(vm->style.style, id, &hits);
    return fjsengine::new_array_buffer_copy(ctx, (const uint8_t *)hits, n * sizeof(fjs_style_hit));
}

static fjsengine::Value js_style_stats(fjsengine::Context *ctx, fjsengine::ValueConst this_val, int argc,
                                       fjsengine::ValueConst *argv) {
    (void)this_val;
    FJSVM *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    if (!vm->style.style) return fjsengine::null();
    fjs_style_stats s{};
    fjs_style_get_stats(vm->style.style, &s);
    if (argc > 0 && fjsengine::to_bool(ctx, argv[0])) fjs_style_reset_stats(vm->style.style);
    fjsengine::Value o = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, o, "elements", fjsengine::new_int64(ctx, s.elements));
    fjsengine::set_property_str(ctx, o, "rules", fjsengine::new_int64(ctx, s.rules));
    fjsengine::set_property_str(ctx, o, "recompute", fjsengine::new_int64(ctx, s.recompute));
    fjsengine::set_property_str(ctx, o, "matchHit", fjsengine::new_int64(ctx, s.match_hit));
    fjsengine::set_property_str(ctx, o, "matchMiss", fjsengine::new_int64(ctx, s.match_miss));
    fjsengine::set_property_str(ctx, o, "computeHit", fjsengine::new_int64(ctx, s.compute_hit));
    fjsengine::set_property_str(ctx, o, "computeMiss", fjsengine::new_int64(ctx, s.compute_miss));
    fjsengine::set_property_str(ctx, o, "applied", fjsengine::new_int64(ctx, s.applied));
    fjsengine::set_property_str(ctx, o, "flushMs", fjsengine::new_float64(ctx, s.flush_ms));
    return o;
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

void style_detach(FJSVM *vm) {
    FjsStyleBinding &b = vm->style;
    if (b.style) fjs_style_destroy(b.style);
    b.style = nullptr;
    fjsengine::free_value(vm->ctx, b.define_match);
    fjsengine::free_value(vm->ctx, b.compute);
    fjsengine::free_value(vm->ctx, b.styled);
    b.define_match = b.compute = b.styled = fjsengine::undefined();
}

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
    fjsengine::set_property_str(ctx, fns, "styleAttach", fjsengine::new_c_function(ctx, js_style_attach, "styleAttach", 3));
    fjsengine::set_property_str(ctx, fns, "styleDetach", fjsengine::new_c_function(ctx, js_style_detach, "styleDetach", 0));
    fjsengine::set_property_str(ctx, fns, "styleResult", fjsengine::new_c_function(ctx, js_style_result, "styleResult", 1));
    fjsengine::set_property_str(ctx, fns, "styleStats", fjsengine::new_c_function(ctx, js_style_stats, "styleStats", 1));
    fjsengine::set_property_str(ctx, fns, "styleClasses", fjsengine::new_c_function(ctx, js_style_classes, "styleClasses", 1));
    fjsengine::set_property_str(ctx, fns, "styleMatchedRules", fjsengine::new_c_function(ctx, js_style_matched_rules, "styleMatchedRules", 1));

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
