/* Internal shared declarations for the fjs C++ core (not part of fjs.h ABI). */
#ifndef FJS_INTERNAL_H
#define FJS_INTERNAL_H

#include "fjs.h"

#include <string>
#include <unordered_map>
#include <vector>

/* Engine boundary (spec 091): core code only ever sees fjsengine::*, never
 * a concrete engine's C API. */
#include "engine.h"
#include "fjs_style.h"

struct FjsTimer {
    int32_t id;
    bool interval;
    double next_ms;    /* absolute deadline on the host clock */
    double interval_ms;
    fjsengine::Value callback;  /* owns a reference */
};

struct FJSVM;

/* libfjs-style binding (specs/150): the instance plus the three JS callbacks
 * it reaches back through, each holding a reference. `json` keeps a compute
 * callback's strings alive until libfjs-style has copied them; `busy` refuses
 * a uiOps call made from inside a callback (the output frame is not
 * re-entrant); `threw` carries a callback's JS exception out of the frame. */
struct FjsStyleBinding {
    fjs_style *style = nullptr;
    fjsengine::Value define_match = fjsengine::undefined();
    fjsengine::Value compute = fjsengine::undefined();
    fjsengine::Value styled = fjsengine::undefined();
    std::string json[3];
    bool busy = false;
    bool threw = false;
    /* an instance failed: frames keep arriving with style ops in them, and
     * are stripped until the runtime attaches again */
    bool stripping = false;
    std::vector<uint8_t> stripped;
};

/* Devtools transport slot (spec 090): the pluggable module
 * (libfjs_debugger.so) installs one via fjs_debugger_set_transport(); the
 * engine-side glue then routes frontend I/O through it. Null = no debugger
 * module attached — the engine is fully inert on this path. */
struct FjsDebuggerTransport;

/* Object ABI state (spec 159). The tables here hold NO JSValues of their
 * own: every registered JS callback, every promise's resolving functions
 * and every cached bound method lives as a property of one hidden root
 * object hanging off the globalThis, so the GC sees all of them through the
 * normal object graph and no class needs a gc_mark. "Releasing" overwrites
 * the property with null — dead slots accumulate until the VM dies, which
 * keeps the roots O(total callbacks ever made) instead of O(live), and
 * avoids a delete-property facade across both engines. */
struct FjsObjectAbi {
    fjsengine::ClassID proxy_class = 0;   /* "DartObject" — handle carrier */
    fjsengine::ClassID method_class = 0;  /* bound member function */
    fjsengine::ClassID dartfn_class = 0;  /* host-closure wrapper function */
    int64_t next_callback_id = 1; /* engine-held JS functions (positive) */
    int64_t next_call_id = 1;     /* pending promise settle ids */
    /* hidden global: "\x02fjsObj" -> { c: callback id -> fn,
     * p: settle id -> {r: resolve, j: reject},
     * m: "handle\x1fmember" -> bound fn }. Owned reference, freed at
     * teardown before the context goes. */
    fjsengine::Value roots = fjsengine::undefined();
    /* GC finalizers only enqueue here; the flush (which crosses into the
     * host) runs at pump boundaries and objectCall entry — never during a
     * collection pass. Object handles are > 0; host-closure releases are
     * reported negative (the FJS_T_CALLBACK sign convention). */
    std::vector<int64_t> pending_releases;
    bool flushing = false;
    /* JS -> Dart -> JS alternation guard, shared by objectCall and
     * fjs_vm_call_callback (the style binding's `busy` precedent). */
    int reentry_depth = 0;
};

struct FJSVM {
    fjsengine::Runtime *rt = nullptr;
    fjsengine::Context *ctx = nullptr;
    fjs_on_log_fn on_log = nullptr;
    fjs_on_ui_ops_fn on_ui_ops = nullptr;
    fjs_invoke_host_fn on_invoke_host = nullptr;
    fjs_on_toast_fn on_toast = nullptr;
    std::vector<FjsTimer> timers;
    int32_t next_timer_id = 1;
    /* Binary handles (spec 038): Dart writes a body once, JS consumes it
     * through the fns natives. Not a JS-opaque map — the host modules run
     * in Dart and can never hold a C++ pointer, so the table is the point:
     * data crosses Dart->C++ once, then only int ids travel. next_handle_id
     * is monotonic across the VM's whole life (no reset), which is what
     * makes a stale id miss instead of alias. */
    std::unordered_map<int64_t, std::vector<uint8_t>> handle_bytes;
    int64_t next_handle_id = 1;
    char last_error[1024] = {0};
    const FjsDebuggerTransport *dbg_transport = nullptr;
    /* spec 111: rejections still unhandled, reported after each job drain */
    fjsengine::RejectionState rejections;
    FjsStyleBinding style;
    FjsObjectAbi object_abi;
};

namespace fjs {

/* Monotonic clock in ms (used for nowMs() and internal pumps). */
double now_ms(FJSVM *vm);

/* Helpers shared across translation units. */
void set_error(FJSVM *vm, const char *fmt, ...);
void log_line(FJSVM *vm, int32_t level, const char *msg, int32_t len);
std::string format_exception(FJSVM *vm, fjsengine::Value exc);
/* Clears the pending exception, records + logs it. Returns false. */
bool fail_with_pending_exception(FJSVM *vm, const char *where);

/* natives.cpp: installs `console` and `__fjs` on the global object. */
bool install_natives(FJSVM *vm);
/* natives.cpp: drops the libfjs-style instance and its JS callbacks. */
void style_detach(FJSVM *vm);

/* debugger-glue.cpp: the engine-side half of the pluggable debugger
 * (spec 090) — transport slot + the pump/teardown gates. */
namespace dbg {
void transport_feed(FJSVM *vm);
void transport_closed(FJSVM *vm);
} // namespace dbg

/* value.cpp: FJSValue (C ABI tagged value) <-> fjsengine::Value conversion.
 * to_fjs_value: string pointers are QuickJS-owned, valid until the
 *   matching fjs_free_abi_value() (ref-holding for strings).
 * from_fjs_value: consumes malloc'ed strings (free()d here). */
bool to_fjs_value(FJSVM *vm, fjsengine::ValueConst v, FJSValue *out);
void fjs_free_abi_value(FJSVM *vm, FJSValue *v);
fjsengine::Value from_fjs_value(FJSVM *vm, const FJSValue *v);

/* object_abi.cpp: the structured object ABI (spec 159). The rich conversions
 * extend the scalar ones — proxies to FJS_T_HANDLE, functions to
 * FJS_T_CALLBACK (sign convention in fjs.h), plus the PENDING / METHOD
 * replies — and every op funnels through the same fjs_invoke_host callback
 * under the reserved "fjs.object.*" module names. */
namespace obj {

/* Registers the three classes and the hidden roots object. */
bool install(FJSVM *vm);
/* Drops the roots reference; called once at fjs_vm_destroy. */
void teardown(FJSVM *vm);
/* Drains the GC-queued releases into the host. Called at pump boundaries
 * and at object-call entry — never from a finalizer, never reentrant. */
void flush_pending_releases(FJSVM *vm);

/* True when v is a DartObject proxy; *handle receives its id. */
bool proxy_handle(FJSVM *vm, fjsengine::ValueConst v, int64_t *handle);
/* Rich JS -> FJSValue. Returns false when v is scalar-shaped and the plain
 * to_fjs_value should run. */
bool to_rich(FJSVM *vm, fjsengine::ValueConst v, FJSValue *out);
/* Rich FJSValue -> JS; plain-scalar tags delegate to from_fjs_value.
 * (method_handle, method_member) give an FJS_T_METHOD reply the receiver it
 * needs to build a bound function — only the fjs.object.get op passes them. */
fjsengine::Value from_rich(FJSVM *vm, const FJSValue *v,
                           int64_t method_handle, const char *method_member);

/* The funnel every object op takes: flush GC-queued releases, guard
 * reentry, convert argv richly, call the host's fjs_invoke_host under
 * "fjs.object.<op>", convert the result back. pre_args are already-encoded
 * FJSValues (their strings are NOT freed here — they outlive the call). */
fjsengine::Value dispatch_op(FJSVM *vm, const char *op, int pre_argc,
                             const FJSValue *pre_args, int argc,
                             fjsengine::ValueConst *argv);

/* The exported C entry points (fjs.h) minus the FJSVM-less signature. */
int32_t call_callback(FJSVM *vm, int64_t cb_id, int32_t argc,
                      const FJSValue *args, FJSValue *out);
int32_t settle_promise(FJSVM *vm, int64_t call_id, int32_t ok,
                       const FJSValue *value);
int32_t release_callback(FJSVM *vm, int64_t cb_id);

} // namespace obj

} // namespace fjs

#endif /* FJS_INTERNAL_H */
