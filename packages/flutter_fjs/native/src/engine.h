/* Engine boundary (spec 091): the only place that names a specific JS engine.
 *
 * vm/natives/value are written against this facade so the whole core compiles
 * against either vendored engine:
 *
 *   FJS_ENGINE_PRIMJS  (default)  vendored PrimJS 4.1.1, LEPUS_* API; the
 *                                 only backend with a CDP inspector, hence
 *                                 the only one fjs debug works on.
 *   FJS_ENGINE_QUICKJS             vendored quickjs-ng 0.9.0, JS_* API; the
 *                                 pre-088 engine, kept for comparison and
 *                                 as a fallback.
 *
 * The include dirs pick which "quickjs.h" lands here (both engines ship a
 * header of that name), so the include line is identical on both sides.
 *
 * Everything is a 1:1 rename except where noted: EvalFunction arity
 * (quickjs-ng takes no this_obj) and the buffer free (lepus_free vs js_free).
 */
#ifndef FJS_ENGINE_H
#define FJS_ENGINE_H

#include <cstdarg>
#include <cstdio>
#include <cstddef>
#include <vector>

#if defined(FJS_ENGINE_QUICKJS)
#include "quickjs.h" /* quickjs-ng */

namespace fjsengine {

using Runtime = JSRuntime;
using Context = JSContext;
using Value = JSValue;
using ValueConst = JSValueConst;
using MemoryUsage = JSMemoryUsage;
using CFunction = JSCFunction;

inline Value undefined() { return JS_UNDEFINED; }
inline Value null() { return JS_NULL; }
inline Value exception() { return JS_EXCEPTION; }

/* Flag bits are NOT stable across engines (PrimJS's COMPILE_ONLY is 1<<5,
 * quickjs-ng's is 1<<8) — core code never hardcodes them. */
constexpr int eval_type_global = JS_EVAL_TYPE_GLOBAL;
constexpr int eval_flag_compile_only = JS_EVAL_FLAG_COMPILE_ONLY;
constexpr int read_obj_bytecode = JS_READ_OBJ_BYTECODE;
constexpr int write_obj_bytecode = JS_WRITE_OBJ_BYTECODE;

inline Runtime *new_runtime() { return JS_NewRuntime(); }
inline void free_runtime(Runtime *rt) { JS_FreeRuntime(rt); }
inline Context *new_context(Runtime *rt) { return JS_NewContext(rt); }
inline void free_context(Context *ctx) { JS_FreeContext(ctx); }
inline void set_runtime_info(Runtime *rt, const char *info) { JS_SetRuntimeInfo(rt, info); }
/* quickjs-ng re-anchors its stack limit on every JS entry; the budget set
 * here is a ceiling, not the whole story (see vm.cpp's comment on 32 MiB).
 * ng's setter takes the runtime, PrimJS's the context. */
inline void set_max_stack_size(Context *ctx, size_t bytes) {
    JS_SetMaxStackSize(JS_GetRuntime(ctx), bytes);
}
inline Runtime *get_runtime(Context *ctx) { return JS_GetRuntime(ctx); }
inline void set_context_opaque(Context *ctx, void *opaque) { JS_SetContextOpaque(ctx, opaque); }
inline void *get_context_opaque(Context *ctx) { return JS_GetContextOpaque(ctx); }

inline Value eval(Context *ctx, const char *input, size_t len, const char *filename,
                  int flags) {
    return JS_Eval(ctx, input, len, filename, flags);
}
/* quickjs-ng's EvalFunction takes no this_obj (PrimJS's does). */
inline Value eval_function(Context *ctx, Value fun) { return JS_EvalFunction(ctx, fun); }
inline Value read_object(Context *ctx, const uint8_t *buf, size_t len, int flags) {
    return JS_ReadObject(ctx, buf, len, flags);
}
/* Returns a malloc'ed buffer; release with free_buffer(). */
inline uint8_t *write_object(Context *ctx, size_t *psize, ValueConst obj, int flags) {
    return JS_WriteObject(ctx, psize, obj, flags);
}
inline void free_buffer(Context *ctx, void *ptr) { js_free(ctx, ptr); }
inline Value call(Context *ctx, ValueConst func, ValueConst this_obj, int argc,
                  ValueConst *argv) {
    return JS_Call(ctx, func, this_obj, argc, argv);
}
inline int execute_pending_job(Runtime *rt, Context **pctx) {
    return JS_ExecutePendingJob(rt, pctx);
}

/* Unhandled promise rejections (spec 111). quickjs-ng reports them through
 * a host tracker: is_handled=false when a promise is rejected with no
 * handler, true when one is attached afterwards. Entries wait here for the
 * pump's end-of-drain check, so a handler attached later in the same drain
 * cancels the report. Both values are held (dup'd) until taken or cleared. */
struct RejectionState {
    struct Entry {
        Value promise;
        Value reason;
    };
    std::vector<Entry> pending;
};
inline void rejection_tracker_(JSContext *ctx, JSValueConst promise, JSValueConst reason,
                               bool is_handled, void *opaque) {
    auto *st = static_cast<RejectionState *>(opaque);
    if (!is_handled) {
        st->pending.push_back({JS_DupValue(ctx, promise), JS_DupValue(ctx, reason)});
        return;
    }
    for (size_t i = 0; i < st->pending.size(); i++) {
        if (JS_VALUE_GET_PTR(st->pending[i].promise) == JS_VALUE_GET_PTR(promise)) {
            JS_FreeValue(ctx, st->pending[i].promise);
            JS_FreeValue(ctx, st->pending[i].reason);
            st->pending.erase(st->pending.begin() + (long)i);
            return;
        }
    }
}
inline void track_rejections(Runtime *rt, RejectionState *st) {
    JS_SetHostPromiseRejectionTracker(rt, rejection_tracker_, st);
}
/* Hands over the reason of the oldest rejection still unhandled (the caller
 * frees it); false when there is none. */
inline bool take_unhandled_rejection(Context *ctx, RejectionState *st, Value *reason) {
    if (st->pending.empty()) return false;
    RejectionState::Entry e = st->pending.front();
    st->pending.erase(st->pending.begin());
    JS_FreeValue(ctx, e.promise);
    *reason = e.reason;
    return true;
}
/* Before the context goes: JS_FreeRuntime asserts nothing is still held. */
inline void clear_rejections(Context *ctx, RejectionState *st) {
    for (auto &e : st->pending) {
        JS_FreeValue(ctx, e.promise);
        JS_FreeValue(ctx, e.reason);
    }
    st->pending.clear();
}
inline void run_gc(Runtime *rt) { JS_RunGC(rt); }
inline void compute_memory_usage(Runtime *rt, MemoryUsage *s) { JS_ComputeMemoryUsage(rt, s); }

inline Value get_global_object(Context *ctx) { return JS_GetGlobalObject(ctx); }
inline Value get_property_str(Context *ctx, ValueConst obj, const char *prop) {
    return JS_GetPropertyStr(ctx, obj, prop);
}
inline int set_property_str(Context *ctx, ValueConst obj, const char *prop, Value val) {
    /* consumes val on both engines */
    return JS_SetPropertyStr(ctx, obj, prop, val);
}
inline Value dup_value(Context *ctx, ValueConst v) { return JS_DupValue(ctx, v); }
inline void free_value(Context *ctx, Value v) { JS_FreeValue(ctx, v); }
inline Value get_exception(Context *ctx) { return JS_GetException(ctx); }
inline const char *to_cstring(Context *ctx, ValueConst v) { return JS_ToCString(ctx, v); }
inline const char *to_cstring_len(Context *ctx, size_t *plen, ValueConst v) {
    return JS_ToCStringLen(ctx, plen, v);
}
inline void free_cstring(Context *ctx, const char *ptr) { JS_FreeCString(ctx, ptr); }
inline Value new_c_function(Context *ctx, CFunction *fn, const char *name, int length) {
    return JS_NewCFunction(ctx, fn, name, length);
}
inline Value new_string(Context *ctx, const char *str) { return JS_NewString(ctx, str); }
inline Value new_string_len(Context *ctx, const char *buf, size_t len) {
    return JS_NewStringLen(ctx, buf, len);
}
inline Value new_int32(Context *ctx, int32_t v) { return JS_NewInt32(ctx, v); }
inline Value new_int64(Context *ctx, int64_t v) { return JS_NewInt64(ctx, v); }
inline Value new_float64(Context *ctx, double d) { return JS_NewFloat64(ctx, d); }
inline Value new_bool(Context *ctx, bool v) { return JS_NewBool(ctx, v); }
inline Value new_object(Context *ctx) { return JS_NewObject(ctx); }
inline Value new_array_buffer_copy(Context *ctx, const uint8_t *buf, size_t len) {
    return JS_NewArrayBufferCopy(ctx, buf, len);
}
inline uint8_t *get_array_buffer(Context *ctx, size_t *psize, ValueConst obj) {
    return JS_GetArrayBuffer(ctx, psize, obj);
}
inline int to_int32(Context *ctx, int32_t *pres, ValueConst v) { return JS_ToInt32(ctx, pres, v); }
inline int to_int64(Context *ctx, int64_t *pres, ValueConst v) { return JS_ToInt64(ctx, pres, v); }
inline int to_uint32(Context *ctx, uint32_t *pres, ValueConst v) {
    return JS_ToUint32(ctx, pres, v);
}
inline int to_float64(Context *ctx, double *pres, ValueConst v) {
    return JS_ToFloat64(ctx, pres, v);
}
inline int to_bool(Context *ctx, ValueConst v) { return JS_ToBool(ctx, v); }

inline bool is_exception(Value v) { return JS_IsException(v); }
inline bool is_error(Context *ctx, ValueConst v) { return JS_IsError(ctx, v); }
inline bool is_undefined(ValueConst v) { return JS_IsUndefined(v); }
inline bool is_null(ValueConst v) { return JS_IsNull(v); }
inline bool is_bool(ValueConst v) { return JS_IsBool(v); }
inline bool is_number(ValueConst v) { return JS_IsNumber(v); }
inline bool is_string(ValueConst v) { return JS_IsString(v); }
inline bool is_object(ValueConst v) { return JS_IsObject(v); }
inline bool is_function(Context *ctx, ValueConst v) { return JS_IsFunction(ctx, v); }

/* Neither engine exposes a va_list variant of the throwing helpers, and C
 * varargs cannot be forwarded — format here, throw "%s". Call sites only
 * ever pass a single pre-built string. */
inline Value throw_type_error(Context *ctx, const char *fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    return JS_ThrowTypeError(ctx, "%s", buf);
}
inline Value throw_range_error(Context *ctx, const char *fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    return JS_ThrowRangeError(ctx, "%s", buf);
}

} // namespace fjsengine
#else
#include "quickjs.h" /* vendored PrimJS */

namespace fjsengine {

using Runtime = LEPUSRuntime;
using Context = LEPUSContext;
using Value = LEPUSValue;
using ValueConst = LEPUSValueConst;
using MemoryUsage = LEPUSMemoryUsage;
using CFunction = LEPUSCFunction;

inline Value undefined() { return LEPUS_UNDEFINED; }
inline Value null() { return LEPUS_NULL; }
inline Value exception() { return LEPUS_EXCEPTION; }

/* Flag bits are NOT stable across engines — see the quickjs-ng branch. */
constexpr int eval_type_global = LEPUS_EVAL_TYPE_GLOBAL;
constexpr int eval_flag_compile_only = LEPUS_EVAL_FLAG_COMPILE_ONLY;
constexpr int read_obj_bytecode = LEPUS_READ_OBJ_BYTECODE;
constexpr int write_obj_bytecode = LEPUS_WRITE_OBJ_BYTECODE;

inline Runtime *new_runtime() { return LEPUS_NewRuntime(); }
inline void free_runtime(Runtime *rt) { LEPUS_FreeRuntime(rt); }
inline Context *new_context(Runtime *rt) { return LEPUS_NewContext(rt); }
inline void free_context(Context *ctx) { LEPUS_FreeContext(ctx); }
inline void set_runtime_info(Runtime *rt, const char *info) { LEPUS_SetRuntimeInfo(rt, info); }
inline void set_max_stack_size(Context *ctx, size_t bytes) { LEPUS_SetMaxStackSize(ctx, bytes); }
inline Runtime *get_runtime(Context *ctx) { return LEPUS_GetRuntime(ctx); }
inline void set_context_opaque(Context *ctx, void *opaque) { LEPUS_SetContextOpaque(ctx, opaque); }
inline void *get_context_opaque(Context *ctx) { return LEPUS_GetContextOpaque(ctx); }

inline Value eval(Context *ctx, const char *input, size_t len, const char *filename,
                  int flags) {
    return LEPUS_Eval(ctx, input, len, filename, flags);
}
inline Value eval_function(Context *ctx, Value fun) {
    return LEPUS_EvalFunction(ctx, fun, LEPUS_UNDEFINED);
}
inline Value read_object(Context *ctx, const uint8_t *buf, size_t len, int flags) {
    return LEPUS_ReadObject(ctx, buf, len, flags);
}
inline uint8_t *write_object(Context *ctx, size_t *psize, ValueConst obj, int flags) {
    return LEPUS_WriteObject(ctx, psize, obj, flags);
}
inline void free_buffer(Context *ctx, void *ptr) { lepus_free(ctx, ptr); }
inline Value call(Context *ctx, ValueConst func, ValueConst this_obj, int argc,
                  ValueConst *argv) {
    return LEPUS_Call(ctx, func, this_obj, argc, argv);
}
inline int execute_pending_job(Runtime *rt, Context **pctx) {
    return LEPUS_ExecutePendingJob(rt, pctx);
}

/* Unhandled promise rejections (spec 111). PrimJS tracks them itself: a
 * promise rejected with no handler goes on rt->unhandled_rejections (as an
 * Error — a non-Error reason is wrapped), and attaching a handler later
 * takes it off again. LEPUS_MoveUnhandledRejectionToException pops the
 * oldest into the pending exception. Nothing drained that list before
 * spec 111, so it only ever grew: every unhandled rejection's Error stayed
 * alive for the whole VM. No per-VM state; the runtime frees what is left. */
struct RejectionState {};
inline void track_rejections(Runtime *, RejectionState *) {}
inline bool take_unhandled_rejection(Context *ctx, RejectionState *, Value *reason) {
    if (!LEPUS_MoveUnhandledRejectionToException(ctx)) return false;
    *reason = LEPUS_GetException(ctx);
    return true;
}
inline void clear_rejections(Context *, RejectionState *) {}
inline void run_gc(Runtime *rt) { LEPUS_RunGC(rt); }
inline void compute_memory_usage(Runtime *rt, MemoryUsage *s) { LEPUS_ComputeMemoryUsage(rt, s); }

inline Value get_global_object(Context *ctx) { return LEPUS_GetGlobalObject(ctx); }
inline Value get_property_str(Context *ctx, ValueConst obj, const char *prop) {
    return LEPUS_GetPropertyStr(ctx, obj, prop);
}
inline int set_property_str(Context *ctx, ValueConst obj, const char *prop, Value val) {
    return LEPUS_SetPropertyStr(ctx, obj, prop, val);
}
inline Value dup_value(Context *ctx, ValueConst v) { return LEPUS_DupValue(ctx, v); }
inline void free_value(Context *ctx, Value v) { LEPUS_FreeValue(ctx, v); }
inline Value get_exception(Context *ctx) { return LEPUS_GetException(ctx); }
inline const char *to_cstring(Context *ctx, ValueConst v) { return LEPUS_ToCString(ctx, v); }
inline const char *to_cstring_len(Context *ctx, size_t *plen, ValueConst v) {
    return LEPUS_ToCStringLen(ctx, plen, v);
}
inline void free_cstring(Context *ctx, const char *ptr) { LEPUS_FreeCString(ctx, ptr); }
inline Value new_c_function(Context *ctx, CFunction *fn, const char *name, int length) {
    return LEPUS_NewCFunction(ctx, fn, name, length);
}
inline Value new_string(Context *ctx, const char *str) { return LEPUS_NewString(ctx, str); }
inline Value new_string_len(Context *ctx, const char *buf, size_t len) {
    return LEPUS_NewStringLen(ctx, buf, len);
}
inline Value new_int32(Context *ctx, int32_t v) { return LEPUS_NewInt32(ctx, v); }
inline Value new_int64(Context *ctx, int64_t v) { return LEPUS_NewInt64(ctx, v); }
inline Value new_float64(Context *ctx, double d) { return LEPUS_NewFloat64(ctx, d); }
inline Value new_bool(Context *ctx, bool v) { return LEPUS_NewBool(ctx, v); }
inline Value new_object(Context *ctx) { return LEPUS_NewObject(ctx); }
inline Value new_array_buffer_copy(Context *ctx, const uint8_t *buf, size_t len) {
    return LEPUS_NewArrayBufferCopy(ctx, buf, len);
}
inline uint8_t *get_array_buffer(Context *ctx, size_t *psize, ValueConst obj) {
    return LEPUS_GetArrayBuffer(ctx, psize, obj);
}
inline int to_int32(Context *ctx, int32_t *pres, ValueConst v) {
    return LEPUS_ToInt32(ctx, pres, v);
}
inline int to_int64(Context *ctx, int64_t *pres, ValueConst v) {
    return LEPUS_ToInt64(ctx, pres, v);
}
inline int to_uint32(Context *ctx, uint32_t *pres, ValueConst v) {
    return LEPUS_ToUint32(ctx, pres, v);
}
inline int to_float64(Context *ctx, double *pres, ValueConst v) {
    return LEPUS_ToFloat64(ctx, pres, v);
}
inline int to_bool(Context *ctx, ValueConst v) { return LEPUS_ToBool(ctx, v); }

inline bool is_exception(Value v) { return LEPUS_IsException(v); }
inline bool is_error(Context *ctx, ValueConst v) { return LEPUS_IsError(ctx, v); }
inline bool is_undefined(ValueConst v) { return LEPUS_IsUndefined(v); }
inline bool is_null(ValueConst v) { return LEPUS_IsNull(v); }
inline bool is_bool(ValueConst v) { return LEPUS_IsBool(v); }
inline bool is_number(ValueConst v) { return LEPUS_IsNumber(v); }
inline bool is_string(ValueConst v) { return LEPUS_IsString(v); }
inline bool is_object(ValueConst v) { return LEPUS_IsObject(v); }
inline bool is_function(Context *ctx, ValueConst v) { return LEPUS_IsFunction(ctx, v); }
inline Value throw_type_error(Context *ctx, const char *fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    return LEPUS_ThrowTypeError(ctx, "%s", buf);
}
inline Value throw_range_error(Context *ctx, const char *fmt, ...) {
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    return LEPUS_ThrowRangeError(ctx, "%s", buf);
}

} // namespace fjsengine
#endif

#endif /* FJS_ENGINE_H */
