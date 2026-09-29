/*
 * Object ABI (spec 159): Dart objects as first-class JS values.
 *
 * JS side of the contract:
 *   - a Dart object handle arrives as a "DartObject" proxy; property reads
 *     build (and cache) bound member functions, property writes funnel to
 *     fjs.object.set, calling a bound member funnels to fjs.object.invoke.
 *   - a JS function argument becomes a positive FJS_T_CALLBACK id; the
 *     engine keeps a strong reference under a hidden root and the host
 *     calls it back through fjs_vm_call_callback.
 *   - a host closure arrives as a "DartCallback" wrapper whose call
 *     funnels to fjs.object.callback with the closure's id.
 *   - a pending async reply arrives as a native Promise; the host settles
 *     it later through fjs_vm_settle_promise.
 *
 * Every op crosses the boundary through the SAME fjs_invoke_host callback
 * the scalar host modules use, under the reserved "fjs.object.*" names —
 * the Dart side keeps a single trampoline funnel (HostBridge).
 *
 * Ownership: the tables here hold NO JSValues. Callbacks, promise resolving
 * functions and the bound-method cache all live as properties of the hidden
 * "\x02fjsObj" global, so the GC reaches them through the ordinary object
 * graph and no class needs a gc_mark. GC finalizers of proxies and closure
 * wrappers only ENQUEUE release ids; the flush that crosses into the host
 * runs at pump boundaries and at dispatch entry, never mid-collection.
 */
#include "fjs_internal.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace fjs {
namespace obj {

namespace {

/* Keys in the hidden roots object. "\x02"-prefixed names are invisible to
 * JS enumeration (the same trick QuickJS uses for its own internals). */
constexpr const char *kRootsProp = "\x02fjsObj";
constexpr const char *kCallbacks = "c";
constexpr const char *kPendings = "p";
constexpr const char *kMethods = "m";

/* Proxy: carries the Dart object handle. Lives exactly as long as the JS
 * object; its finalizer queues the release for the next flush. */
struct ProxyData {
    FJSVM *vm;
    int64_t handle;
};

/* Bound member: a (handle, member) pair captured at proxy-get time. May
 * outlive its proxy (JS can stash it anywhere); calling it after the Dart
 * object was released is a loud stale-handle error on the Dart side. */
struct MethodData {
    FJSVM *vm;
    int64_t handle;
    std::string member;
};

/* Host-closure wrapper: identifies a Dart Function the ObjectBridge
 * registered; calling it funnels back through fjs.object.callback. */
struct DartFnData {
    FJSVM *vm;
    int64_t dart_id;
};

/* Property reads that must NOT resolve to a bound member: the thenable
 * check (`await proxy` must not fire a Dart call), the ones console and
 * tooling probe for (kept native so logging stays side-effect free), and
 * the module-system probes. Everything else goes to Dart, which decides
 * field vs method via fjs.object.get. */
bool reserved_member(const char *name) {
    static const char *kReserved[] = {
        "then", "toJSON", "constructor", "toString", "valueOf",
        "inspect", "$$typeof",
    };
    for (const char *r : kReserved) {
        if (std::strcmp(name, r) == 0) return true;
    }
    return false;
}

fjsengine::Value roots_child(FJSVM *vm, const char *name) {
    if (fjsengine::is_undefined(vm->object_abi.roots)) {
        return fjsengine::undefined();
    }
    return fjsengine::get_property_str(vm->ctx, vm->object_abi.roots, name);
}

void root_set(FJSVM *vm, const char *child, const char *key,
              fjsengine::Value val /* consumed */) {
    fjsengine::Value c = roots_child(vm, child);
    fjsengine::set_property_str(vm->ctx, c, key, val);
    fjsengine::free_value(vm->ctx, c);
}

/* Reads roots[child][key]; an overwritten-with-null slot reads as
 * undefined, which is how "released" looks everywhere below. */
fjsengine::Value root_get(FJSVM *vm, const char *child, const char *key) {
    fjsengine::Value c = roots_child(vm, child);
    fjsengine::Value v = fjsengine::get_property_str(vm->ctx, c, key);
    fjsengine::free_value(vm->ctx, c);
    if (fjsengine::is_null(v)) {
        fjsengine::free_value(vm->ctx, v);
        return fjsengine::undefined();
    }
    return v;
}

void key_for(char *buf, size_t cap, int64_t id) {
    std::snprintf(buf, cap, "%lld", (long long)id);
}

void key_for_member(char *buf, size_t cap, int64_t handle, const char *member) {
    std::snprintf(buf, cap, "%lld\x1f%s", (long long)handle, member);
}

/* ---- the three classes ------------------------------------------------ */

void proxy_finalizer(fjsengine::Runtime *rt, fjsengine::ValueConst val) {
    (void)rt;
    auto *pd = (ProxyData *)fjsengine::get_opaque(
        val, fjsengine::value_class_id(val));
    if (!pd) return; /* not ours — cannot happen for this class */
    /* GC may be mid-sweep: NO crossing into the host here. The handle is
     * flushed at the next pump boundary / object-call entry. */
    pd->vm->object_abi.pending_releases.push_back(pd->handle);
    delete pd;
}

void method_finalizer(fjsengine::Runtime *rt, fjsengine::ValueConst val) {
    (void)rt;
    auto *md = (MethodData *)fjsengine::get_opaque(
        val, fjsengine::value_class_id(val));
    delete md; /* POD identity only — nothing to release across the heap */
}

void dartfn_finalizer(fjsengine::Runtime *rt, fjsengine::ValueConst val) {
    (void)rt;
    auto *dd = (DartFnData *)fjsengine::get_opaque(
        val, fjsengine::value_class_id(val));
    if (!dd) return;
    /* negative = host closure, per the FJS_T_CALLBACK sign convention */
    dd->vm->object_abi.pending_releases.push_back(-dd->dart_id);
    delete dd;
}

/* Members on a DartObject resolve to cached bound functions; the cache
 * lives under the hidden roots (keyed "handle\x1fmember") so the GC sees
 * it and a re-read returns the same function object. */
fjsengine::Value make_bound_method(FJSVM *vm, int64_t handle,
                                   const char *member) {
    auto *md = new MethodData{vm, handle, member};
    fjsengine::Value fn =
        fjsengine::new_object_class(vm->ctx, vm->object_abi.method_class);
    fjsengine::set_opaque(fn, md);
    return fn;
}

fjsengine::Value proxy_get(fjsengine::Context *ctx, fjsengine::ValueConst obj,
                           int atom, fjsengine::ValueConst receiver) {
    (void)receiver;
    auto *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    auto *pd = (ProxyData *)fjsengine::get_opaque(
        obj, vm->object_abi.proxy_class);
    if (!pd) return fjsengine::undefined();
    char *name = const_cast<char *>(fjsengine::atom_to_cstring(ctx, atom));
    if (!name) return fjsengine::undefined(); /* symbol-ish atoms: absent */
    fjsengine::Value result = fjsengine::undefined();
    if (!reserved_member(name)) {
        char key[256];
        key_for_member(key, sizeof(key), pd->handle, name);
        fjsengine::Value cached = root_get(vm, kMethods, key);
        if (!fjsengine::is_undefined(cached)) {
            fjsengine::free_cstring(ctx, name);
            return cached; /* ownership transfers to the caller */
        }
        fjsengine::free_value(ctx, cached);
        /* Dart decides field vs method (FjsMethod marker -> FJS_T_METHOD):
         * a field answer converts and returns as-is, a method answer builds
         * the bound function this reply describes. Only methods are cached
         * — field reads must stay live. */
        FJSValue pre[2];
        pre[0].tag = FJS_T_HANDLE;
        pre[0].j = pd->handle;
        pre[1].tag = FJS_T_STRING;
        pre[1].s = name; /* outlives the funnel call */
        pre[1].len = (int32_t)std::strlen(name);
        result = dispatch_op(vm, "get", 2, pre, 0, nullptr);
        if (!fjsengine::is_exception(result) && fjsengine::is_object(result) &&
            fjsengine::get_opaque(result, vm->object_abi.method_class)) {
            root_set(vm, kMethods, key, fjsengine::dup_value(ctx, result));
        }
    }
    fjsengine::free_cstring(ctx, name);
    return result;
}

/* Property writes have no silent local fallback: they go to Dart or they
 * throw (constitution V — a quietly-dropped `c.step = 2` would be a bug
 * nobody sees). */
int proxy_set(fjsengine::Context *ctx, fjsengine::ValueConst obj, int atom,
              fjsengine::ValueConst value, fjsengine::ValueConst receiver,
              int flags) {
    (void)receiver;
    (void)flags;
    auto *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    auto *pd = (ProxyData *)fjsengine::get_opaque(
        obj, vm->object_abi.proxy_class);
    if (!pd) return -1;
    char *name = const_cast<char *>(fjsengine::atom_to_cstring(ctx, atom));
    if (!name) return -1;
    FJSValue pre[2];
    pre[0].tag = FJS_T_HANDLE;
    pre[0].j = pd->handle;
    pre[1].tag = FJS_T_STRING;
    pre[1].s = name;
    pre[1].len = (int32_t)std::strlen(name);
    fjsengine::ValueConst argv[1] = {value};
    fjsengine::Value ret =
        dispatch_op(vm, "set", 2, pre, 1, const_cast<fjsengine::ValueConst *>(argv));
    fjsengine::free_cstring(ctx, name);
    if (fjsengine::is_exception(ret)) return -1;
    fjsengine::free_value(ctx, ret);
    return 1;
}

fjsengine::Value proxy_exotic_get(fjsengine::Context *ctx,
                                  fjsengine::ValueConst obj, JSAtom atom,
                                  fjsengine::ValueConst receiver) {
    return proxy_get(ctx, obj, (int)atom, receiver);
}

int proxy_exotic_set(fjsengine::Context *ctx, fjsengine::ValueConst obj,
                     JSAtom atom, fjsengine::ValueConst value,
                     fjsengine::ValueConst receiver, int flags) {
    return proxy_set(ctx, obj, (int)atom, value, receiver, flags);
}

fjsengine::ExoticMethods make_proxy_exotic() {
    fjsengine::ExoticMethods e{};
    e.get_property = proxy_exotic_get;
    e.set_property = proxy_exotic_set;
    return e;
}
const fjsengine::ExoticMethods kProxyExotic = make_proxy_exotic();

/* A bound member's call: fjs.object.invoke(handle, member, ...args). */
fjsengine::Value bound_call(fjsengine::Context *ctx,
                            fjsengine::ValueConst func_obj,
                            fjsengine::ValueConst this_val, int argc,
                            fjsengine::ValueConst *argv, int flags) {
    (void)this_val;
    (void)flags;
    auto *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    auto *md = (MethodData *)fjsengine::get_opaque(
        func_obj, vm->object_abi.method_class);
    if (!md) return fjsengine::throw_type_error(ctx, "%s",
                                                "bound method lost its target");
    FJSValue pre[2];
    pre[0].tag = FJS_T_HANDLE;
    pre[0].j = md->handle;
    pre[1].tag = FJS_T_STRING;
    pre[1].s = md->member.c_str(); /* outlives the funnel call */
    pre[1].len = (int32_t)md->member.size();
    return dispatch_op(vm, "invoke", 2, pre, argc,
                       const_cast<fjsengine::ValueConst *>(argv));
}

/* A host-closure wrapper's call: fjs.object.callback(dartId, ...args). */
fjsengine::Value dartfn_call(fjsengine::Context *ctx,
                             fjsengine::ValueConst func_obj,
                             fjsengine::ValueConst this_val, int argc,
                             fjsengine::ValueConst *argv, int flags) {
    (void)this_val;
    (void)flags;
    auto *vm = (FJSVM *)fjsengine::get_context_opaque(ctx);
    auto *dd = (DartFnData *)fjsengine::get_opaque(
        func_obj, vm->object_abi.dartfn_class);
    if (!dd) {
        return fjsengine::throw_type_error(ctx, "%s",
                                           "callback lost its target");
    }
    FJSValue pre[1];
    pre[0].tag = FJS_T_INT32;
    pre[0].i = (int32_t)dd->dart_id;
    return dispatch_op(vm, "callback", 1, pre, argc,
                       const_cast<fjsengine::ValueConst *>(argv));
}

/* Engine-side value -> out FJSValue for fjs_vm_call_callback's result: the
 * mirror of HostBridge._writeOut. Strings are malloc'ed here and the host
 * free()s them (fjs.h's contract, flipped). */
int32_t write_out_value(FJSVM *vm, fjsengine::ValueConst v, FJSValue *out) {
    fjsengine::Context *ctx = vm->ctx;
    std::memset(out, 0, sizeof(*out));
    if (fjsengine::is_null(v) || fjsengine::is_undefined(v)) return 0;
    if (fjsengine::is_bool(v)) {
        out->tag = FJS_T_BOOL;
        out->i = fjsengine::to_bool(ctx, v) ? 1 : 0;
        return 0;
    }
    if (fjsengine::is_number(v)) {
        double d = 0;
        if (fjsengine::to_float64(ctx, &d, v) != 0) return -1;
        if (std::trunc(d) == d && std::fabs(d) <= 2147483647.0) {
            out->tag = FJS_T_INT32;
            out->i = (int32_t)d;
        } else {
            out->tag = FJS_T_FLOAT64;
            out->d = d;
        }
        return 0;
    }
    /* rich values (proxies, functions) keep their identity across the
     * boundary instead of degrading to strings */
    if (to_rich(vm, v, out)) return 0;
    size_t len = 0;
    const char *s = fjsengine::to_cstring_len(ctx, &len, v);
    if (!s) return -1;
    char *copy = (char *)std::malloc(len + 1);
    if (!copy) {
        fjsengine::free_cstring(ctx, s);
        return -1;
    }
    std::memcpy(copy, s, len + 1);
    fjsengine::free_cstring(ctx, s);
    out->tag = FJS_T_STRING;
    out->s = copy;
    out->len = (int32_t)len;
    return 0;
}

} // namespace

/* ---- lifecycle --------------------------------------------------------- */

bool install(FJSVM *vm) {
    FjsObjectAbi &abi = vm->object_abi;
    fjsengine::Runtime *rt = vm->rt;
    fjsengine::Context *ctx = vm->ctx;

    fjsengine::ClassDef def{};
    def.class_name = "DartObject";
    def.finalizer = proxy_finalizer;
    def.exotic = const_cast<fjsengine::ExoticMethods *>(&kProxyExotic);
    abi.proxy_class = fjsengine::new_class_id(rt);
    if (fjsengine::new_class(rt, abi.proxy_class, &def) != 0) return false;

    def = {};
    def.class_name = "DartMethod";
    def.finalizer = method_finalizer;
    def.call = bound_call;
    abi.method_class = fjsengine::new_class_id(rt);
    if (fjsengine::new_class(rt, abi.method_class, &def) != 0) return false;

    def = {};
    def.class_name = "DartCallback";
    def.finalizer = dartfn_finalizer;
    def.call = dartfn_call;
    abi.dartfn_class = fjsengine::new_class_id(rt);
    if (fjsengine::new_class(rt, abi.dartfn_class, &def) != 0) return false;

    fjsengine::Value global = fjsengine::get_global_object(ctx);
    fjsengine::Value roots = fjsengine::new_object(ctx);
    fjsengine::set_property_str(ctx, roots, kCallbacks, fjsengine::new_object(ctx));
    fjsengine::set_property_str(ctx, roots, kPendings, fjsengine::new_object(ctx));
    fjsengine::set_property_str(ctx, roots, kMethods, fjsengine::new_object(ctx));
    /* one reference on the global (keeps everything GC-reachable), one
     * owned here (freed at teardown) */
    fjsengine::set_property_str(ctx, global, kRootsProp,
                                fjsengine::dup_value(ctx, roots));
    fjsengine::free_value(ctx, global);
    abi.roots = roots;
    return true;
}

void teardown(FJSVM *vm) {
    if (!fjsengine::is_undefined(vm->object_abi.roots)) {
        fjsengine::free_value(vm->ctx, vm->object_abi.roots);
        vm->object_abi.roots = fjsengine::undefined();
    }
    vm->object_abi.pending_releases.clear();
}

void flush_pending_releases(FJSVM *vm) {
    FjsObjectAbi &abi = vm->object_abi;
    if (abi.pending_releases.empty() || abi.flushing) return;
    if (!vm->on_invoke_host) {
        abi.pending_releases.clear(); /* no host: nothing to release into */
        return;
    }
    abi.flushing = true;
    /* swap first: finalizers fired by calls below enqueue into the live
     * vector and are picked up by the next flush */
    std::vector<int64_t> batch;
    batch.swap(abi.pending_releases);
    for (int64_t id : batch) {
        bool is_closure = id < 0;
        FJSValue arg{};
        if (is_closure) {
            /* Dart closure counters are far below 2^31 within one VM */
            arg.tag = FJS_T_INT32;
            arg.i = (int32_t)(-id);
        } else {
            arg.tag = FJS_T_HANDLE;
            arg.j = id;
        }
        FJSValue out{};
        int32_t rc = vm->on_invoke_host(
            is_closure ? "fjs.object.releaseCallback" : "fjs.object.release",
            1, &arg, &out);
        if (out.tag == FJS_T_STRING && out.s) std::free((void *)out.s);
        if (rc != 0) {
            /* the VM may be tearing down, or the object was explicitly
             * released already — report and keep going */
            std::string msg = "[fjs/object] release failed: ";
            msg += vm->last_error;
            log_line(vm, FJS_LOG_WARN, msg.c_str(), (int32_t)msg.size());
        }
    }
    abi.flushing = false;
}

/* ---- conversions -------------------------------------------------------- */

bool proxy_handle(FJSVM *vm, fjsengine::ValueConst v, int64_t *handle) {
    if (!fjsengine::is_object(v)) return false;
    auto *pd = (ProxyData *)fjsengine::get_opaque(
        v, vm->object_abi.proxy_class);
    if (!pd) return false;
    *handle = pd->handle;
    return true;
}

bool to_rich(FJSVM *vm, fjsengine::ValueConst v, FJSValue *out) {
    int64_t handle = 0;
    if (proxy_handle(vm, v, &handle)) {
        out->tag = FJS_T_HANDLE;
        out->j = handle;
        return true;
    }
    if (fjsengine::is_function(vm->ctx, v)) {
        int64_t id = vm->object_abi.next_callback_id++;
        char key[32];
        key_for(key, sizeof(key), id);
        root_set(vm, kCallbacks, key, fjsengine::dup_value(vm->ctx, v));
        out->tag = FJS_T_CALLBACK;
        out->j = id;
        return true;
    }
    return false;
}

fjsengine::Value from_rich(FJSVM *vm, const FJSValue *v, int64_t method_handle,
                           const char *method_member) {
    fjsengine::Context *ctx = vm->ctx;
    FjsObjectAbi &abi = vm->object_abi;
    switch (v->tag) {
        /* v3 semantics: a Dart null answer IS JS null on the rich path —
         * the generated d.ts declares `T | null`, and mapping it to
         * undefined (the frozen invokeHost behavior) would make every
         * nullable answer a type lie */
        case FJS_T_NULL:
            return fjsengine::null();
        case FJS_T_HANDLE: {
            auto *pd = new ProxyData{vm, v->j};
            fjsengine::Value obj =
                fjsengine::new_object_class(ctx, abi.proxy_class);
            fjsengine::set_opaque(obj, pd);
            return obj;
        }
        case FJS_T_CALLBACK: {
            if (v->j > 0) {
                /* identity: hand back the very function that was passed in */
                char key[32];
                key_for(key, sizeof(key), v->j);
                fjsengine::Value fn = root_get(vm, kCallbacks, key);
                if (fjsengine::is_function(ctx, fn)) return fn;
                fjsengine::free_value(ctx, fn);
                return fjsengine::throw_type_error(
                    ctx, "%s", "unknown callback id (already released?)");
            }
            auto *dd = new DartFnData{vm, -v->j};
            fjsengine::Value fn =
                fjsengine::new_object_class(ctx, abi.dartfn_class);
            fjsengine::set_opaque(fn, dd);
            return fn;
        }
        case FJS_T_PENDING: {
            /* a native promise the host settles later via
             * fjs_vm_settle_promise; the resolving functions stay
             * GC-reachable under the hidden roots until then */
            fjsengine::Value resolving[2];
            fjsengine::Value promise =
                fjsengine::new_promise_capability(ctx, resolving);
            fjsengine::Value holder = fjsengine::new_object(ctx);
            fjsengine::set_property_str(ctx, holder, "r", resolving[0]);
            fjsengine::set_property_str(ctx, holder, "j", resolving[1]);
            char key[32];
            key_for(key, sizeof(key), v->j);
            root_set(vm, kPendings, key, holder);
            return promise;
        }
        case FJS_T_METHOD:
            if (method_member) {
                return make_bound_method(vm, method_handle, method_member);
            }
            return fjsengine::throw_type_error(
                ctx, "%s", "FJS_T_METHOD outside fjs.object.get");
        case FJS_T_JSON: {
            /* the host's List/Map answer as JSON text — materialized into a
             * real JS value through the global JSON.parse, so the generated
             * d.ts type is the runtime type */
            fjsengine::Value global = fjsengine::get_global_object(ctx);
            fjsengine::Value json = fjsengine::get_property_str(ctx, global, "JSON");
            fjsengine::Value parse = fjsengine::get_property_str(ctx, json, "parse");
            fjsengine::Value text = v->s
                                        ? fjsengine::new_string_len(ctx, v->s, (size_t)v->len)
                                        : fjsengine::null();
            fjsengine::ValueConst argv[1] = {text};
            fjsengine::Value parsed =
                fjsengine::call(ctx, parse, fjsengine::undefined(), 1, argv);
            fjsengine::free_value(ctx, text);
            fjsengine::free_value(ctx, parse);
            fjsengine::free_value(ctx, json);
            fjsengine::free_value(ctx, global);
            /* a malformed answer throws JSON.parse's SyntaxError into JS —
             * loud, per constitution V */
            return parsed;
        }
        default:
            return from_fjs_value(vm, v);
    }
}

/* ---- the funnel ---------------------------------------------------------- */

fjsengine::Value dispatch_op(FJSVM *vm, const char *op, int pre_argc,
                             const FJSValue *pre_args, int argc,
                             fjsengine::ValueConst *argv) {
    fjsengine::Context *ctx = vm->ctx;
    flush_pending_releases(vm);
    if (!vm->on_invoke_host) {
        return fjsengine::throw_type_error(ctx, "%s",
                                           "no host module handler installed");
    }
    if (vm->object_abi.reentry_depth >= 64) {
        /* JS -> Dart -> JS ping-pong deeper than this is an adapter bug,
         * and the native stack dies before the JS stack limit would */
        return fjsengine::throw_range_error(
            ctx, "%s", "object call nesting too deep (adapter loop?)");
    }

    int nargs = pre_argc + argc;
    FJSValue *cargs = (FJSValue *)std::calloc((size_t)nargs, sizeof(FJSValue));
    if (!cargs) return fjsengine::exception();
    for (int i = 0; i < pre_argc; i++) cargs[i] = pre_args[i];
    for (int i = 0; i < argc; i++) {
        FJSValue &slot = cargs[pre_argc + i];
        if (!to_rich(vm, argv[i], &slot) && !to_fjs_value(vm, argv[i], &slot)) {
            for (int k = 0; k < i; k++) fjs_free_abi_value(vm, &cargs[pre_argc + k]);
            std::free(cargs);
            return fjsengine::exception();
        }
    }

    char name[48];
    std::snprintf(name, sizeof(name), "fjs.object.%s", op);

    vm->object_abi.reentry_depth++;
    FJSValue out{};
    int32_t rc = vm->on_invoke_host(name, nargs, cargs, &out);
    vm->object_abi.reentry_depth--;

    /* free the JS-converted args; pre_args belong to the caller (their
     * strings outlive this call on purpose) */
    for (int i = 0; i < argc; i++) fjs_free_abi_value(vm, &cargs[pre_argc + i]);
    std::free(cargs);

    if (rc != 0) {
        /* v3: the host may put the failure message into out — surface it
         * as the exception text instead of a generic line (constitution V) */
        std::string msg = "object call failed: ";
        msg += op;
        if (out.tag == FJS_T_STRING && out.s) {
            msg += ": ";
            msg += out.s;
            std::free((void *)out.s);
        }
        return fjsengine::throw_type_error(ctx, "%s", msg.c_str());
    }

    /* fjs.object.get may answer FJS_T_METHOD: build the bound function for
     * the member this very call asked about */
    int64_t mh = 0;
    const char *mm = nullptr;
    if (std::strcmp(op, "get") == 0 && pre_argc == 2 && pre_args[1].s) {
        mh = pre_args[0].j;
        mm = pre_args[1].s;
    }
    return from_rich(vm, &out, mh, mm);
}

/* ---- the exported C entry points ------------------------------------------ */

int32_t call_callback(FJSVM *vm, int64_t cb_id, int32_t argc,
                      const FJSValue *args, FJSValue *out) {
    if (!vm || !out) return -1;
    if (cb_id <= 0) {
        /* negative ids are host closures — the host invokes those directly,
         * it owns them */
        set_error(vm, "fjs_vm_call_callback: cb_id must be a positive "
                      "engine-held callback id");
        return -1;
    }
    if (vm->object_abi.reentry_depth >= 64) {
        set_error(vm, "fjs_vm_call_callback: nesting too deep (adapter loop?)");
        return -1;
    }
    char key[32];
    key_for(key, sizeof(key), cb_id);
    fjsengine::Value fn = root_get(vm, kCallbacks, key);
    if (!fjsengine::is_function(vm->ctx, fn)) {
        fjsengine::free_value(vm->ctx, fn);
        set_error(vm, "fjs_vm_call_callback: callback %lld is not registered "
                      "(released or never passed from JS)",
                  (long long)cb_id);
        return -1;
    }

    std::vector<fjsengine::Value> argv((size_t)(argc > 0 ? argc : 0));
    for (int32_t i = 0; i < argc; i++) {
        argv[(size_t)i] = from_rich(vm, &args[i], 0, nullptr);
    }
    vm->object_abi.reentry_depth++;
    fjsengine::Value ret = fjsengine::call(
        vm->ctx, fn, fjsengine::undefined(), argc,
        argc > 0 ? argv.data() : nullptr);
    vm->object_abi.reentry_depth--;
    fjsengine::free_value(vm->ctx, fn);
    for (auto &a : argv) fjsengine::free_value(vm->ctx, a);

    if (fjsengine::is_exception(ret)) {
        fjs::fail_with_pending_exception(vm, "object-callback");
        return -1;
    }
    int32_t rc = write_out_value(vm, ret, out);
    fjsengine::free_value(vm->ctx, ret);
    if (rc != 0) {
        set_error(vm, "fjs_vm_call_callback: result conversion failed");
        return -1;
    }
    return 0;
}

int32_t settle_promise(FJSVM *vm, int64_t call_id, int32_t ok,
                       const FJSValue *value) {
    if (!vm) return -1;
    char key[32];
    key_for(key, sizeof(key), call_id);
    fjsengine::Value holder = root_get(vm, kPendings, key);
    if (!fjsengine::is_object(holder)) {
        fjsengine::free_value(vm->ctx, holder);
        set_error(vm, "fjs_vm_settle_promise: call %lld has no pending "
                      "promise (already settled, or the VM was rebuilt)",
                  (long long)call_id);
        return -1;
    }
    fjsengine::Value fn = fjsengine::get_property_str(
        vm->ctx, holder, ok ? "r" : "j");
    /* release the slot before calling: re-entrant settles of the same id
     * must fail loudly instead of resolving twice */
    root_set(vm, kPendings, key, fjsengine::null());
    fjsengine::Value arg = value ? from_rich(vm, value, 0, nullptr)
                                 : fjsengine::undefined();
    fjsengine::Value ret =
        fjsengine::call(vm->ctx, fn, fjsengine::undefined(), 1, &arg);
    fjsengine::free_value(vm->ctx, fn);
    fjsengine::free_value(vm->ctx, arg);
    fjsengine::free_value(vm->ctx, holder);
    if (fjsengine::is_exception(ret)) {
        fjsengine::free_value(vm->ctx, ret);
        fjs::fail_with_pending_exception(vm, "settle-promise");
        return -1;
    }
    fjsengine::free_value(vm->ctx, ret);
    /* the settling callbacks queue microtasks (.then chains) — drain them
     * now, the same entry path every dispatchEvent takes */
    fjs_vm_pump(vm, (int64_t)fjs::now_ms(vm));
    return 0;
}

int32_t release_callback(FJSVM *vm, int64_t cb_id) {
    if (!vm) return -1;
    if (cb_id <= 0) {
        set_error(vm, "fjs_vm_release_callback: cb_id must be positive");
        return -1;
    }
    char key[32];
    key_for(key, sizeof(key), cb_id);
    fjsengine::Value fn = root_get(vm, kCallbacks, key);
    if (!fjsengine::is_function(vm->ctx, fn)) {
        fjsengine::free_value(vm->ctx, fn);
        set_error(vm, "fjs_vm_release_callback: callback %lld is not "
                      "registered", (long long)cb_id);
        return -1;
    }
    fjsengine::free_value(vm->ctx, fn);
    root_set(vm, kCallbacks, key, fjsengine::null());
    return 0;
}

} // namespace obj
} // namespace fjs
