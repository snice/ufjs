/*
 * FJSValue (C ABI tagged value) <-> QuickJS fjsengine::Value conversion.
 *
 * JS -> host direction: strings are converted to utf8 via fjsengine::to_cstring_len
 * and stay owned by a per-call stack; the host must consume them before
 * returning (the JSI contract: no copies, no cross-call ownership).
 *
 * Host -> JS direction: strings arriving in FJSValue are malloc'ed by the
 * host; we copy into a JS string and free() the buffer here.
 */
#include "fjs_internal.h"

#include <cstdlib>

namespace fjs {

bool to_fjs_value(FJSVM *vm, fjsengine::ValueConst v, FJSValue *out) {
    fjsengine::Context *ctx = vm->ctx;
    if (out == nullptr) return false;
    out->tag = FJS_T_NULL;
    out->len = 0;
    out->d = 0;

    if (fjsengine::is_null(v) || fjsengine::is_undefined(v)) {
        return true;
    }
    if (fjsengine::is_bool(v)) {
        out->tag = FJS_T_BOOL;
        out->i = fjsengine::to_bool(ctx, v) ? 1 : 0;
        return true;
    }
    if (fjsengine::is_number(v)) {
        double d;
        if (fjsengine::to_float64(ctx, &d, v) != 0) return false;
        out->tag = FJS_T_FLOAT64;
        out->d = d;
        return true;
    }
    if (fjsengine::is_string(v)) {
        size_t len = 0;
        const char *s = fjsengine::to_cstring_len(ctx, &len, v);
        if (!s) return false;
        out->tag = FJS_T_STRING;
        out->s = s; /* freed by fjs_free_abi_value */
        out->len = (int32_t)len;
        return true;
    }
    /* objects/functions/etc. cross as their string form for v1 —
     * structured object handles are on the roadmap (docs/roadmap.md). */
    size_t len = 0;
    const char *s = fjsengine::to_cstring_len(ctx, &len, v);
    if (!s) return false;
    out->tag = FJS_T_STRING;
    out->s = s;
    out->len = (int32_t)len;
    return true;
}

void fjs_free_abi_value(FJSVM *vm, FJSValue *v) {
    if (v && v->tag == FJS_T_STRING && v->s) {
        fjsengine::free_cstring(vm->ctx, v->s);
        v->s = nullptr;
    }
    v->tag = FJS_T_NULL;
}

fjsengine::Value from_fjs_value(FJSVM *vm, const FJSValue *v) {
    fjsengine::Context *ctx = vm->ctx;
    if (!v) return fjsengine::undefined();
    switch (v->tag) {
        case FJS_T_BOOL:  return fjsengine::new_bool(ctx, v->i != 0);
        case FJS_T_INT32: return fjsengine::new_int32(ctx, v->i);
        case FJS_T_FLOAT64: return fjsengine::new_float64(ctx, v->d);
        case FJS_T_STRING: {
            fjsengine::Value s = v->s
                            ? fjsengine::new_string_len(ctx, v->s, (size_t)v->len)
                            : fjsengine::new_string(ctx, "");
            free((void *)v->s); /* host malloc'ed — contract in fjs.h */
            return s;
        }
        default: return fjsengine::undefined();
    }
}

} // namespace fjs
