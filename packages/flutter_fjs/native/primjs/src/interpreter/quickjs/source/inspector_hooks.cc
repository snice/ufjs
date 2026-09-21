// fjs local patch (specs/090-devtools-split) — not upstream PrimJS.
// See quickjs/include/inspector_hooks.h for why the seam exists.

#include "quickjs/include/inspector_hooks.h"

#include "gc/trace-gc.h"

extern "C" {

const QJSInspectorHooks *qjs_inspector_hooks = nullptr;

void QJSSetInspectorHooks(const QJSInspectorHooks *h) {
  qjs_inspector_hooks = h;
}

}  // extern "C"

// The inspector calls these GC write-barrier shims; the interpreter never
// does. With the inspector linked into the engine (upstream) that was enough
// to pull gc/collector.cc in. As a separate module it is not: the engine
// would drop the object file and the module would find nothing to bind to.
// Anchoring the addresses here keeps exactly one copy of the barriers, in
// the engine, where the GC state they guard already lives.
extern "C" QJS_EXPORT_FOR_DEVTOOL void *const qjs_inspector_gc_anchor[] = {
    reinterpret_cast<void *>(
        static_cast<void (*)(LEPUSContext *, void *, LEPUSValue)>(
            LEPUS_HeapObjStore)),
    reinterpret_cast<void *>(
        static_cast<void (*)(LEPUSContext *, void *, void *)>(
            LEPUS_HeapObjStore)),
    reinterpret_cast<void *>(
        static_cast<void (*)(void *, LEPUSValue)>(LEPUS_HeapObjStoreNoCtx)),
    reinterpret_cast<void *>(
        static_cast<void (*)(void *, void *)>(LEPUS_HeapObjStoreNoCtx)),
    reinterpret_cast<void *>(
        static_cast<void (*)(LEPUSRuntime *, void *)>(
            LEPUS_WriteBarrierNoStore)),
    reinterpret_cast<void *>(
        static_cast<void (*)(LEPUSContext *, LEPUSValue)>(
            LEPUS_WriteBarrierNoStore)),
    reinterpret_cast<void *>(
        static_cast<void (*)(LEPUSContext *, void *)>(
            LEPUS_WriteBarrierNoStore)),
};
