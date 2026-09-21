/* DevTools transport glue (spec 090): the engine-side half of the pluggable
 * debugger. Lives in libfjs and is tiny by design — a slot for the transport
 * plus the two gates (pump feed, teardown close) the engine drives. All
 * debugger semantics (CDP, breakpoints, pause loop feeding) live in the
 * pluggable module; with no transport installed this file is inert. */
#include "fjs_internal.h"

namespace fjs {
namespace dbg {

/* Called from fjs_vm_pump: hand the frontend's queued CDP lines to the
 * transport so the engine processes them between frames. */
void transport_feed(FJSVM *vm) {
    const FjsDebuggerTransport *t = vm->dbg_transport;
    if (t && t->feed) t->feed(t->opaque, vm);
}

/* Called from fjs_vm_destroy: lets the transport release its resources
 * before the VM (and the inspector state hanging off it) goes away. */
void transport_closed(FJSVM *vm) {
    const FjsDebuggerTransport *t = vm->dbg_transport;
    if (t && t->close) t->close(t->opaque);
    vm->dbg_transport = nullptr;
}

} // namespace dbg
} // namespace fjs

void fjs_debugger_set_transport(FJSVM *vm, const FjsDebuggerTransport *t) {
    if (vm) vm->dbg_transport = t;
}
