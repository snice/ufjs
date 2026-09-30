// `fjs/vapor` — Flutter entry (specs/161): what a compiled Vapor SFC imports
// instead of 'vue'. The 'vue' shim re-exports runtime-core (the page's own
// `ref` / `reactive` / `nextTick`), `./runtime` is the shared Vapor runtime
// over a node backend, and `./backend-flutter` points that runtime at the fjs
// renderer's nodeOps — writes cross to Dart in op frames, templates clone
// natively in libfjs-style when they can. The web twin is src/vapor/web.ts:
// same exports, DOM backend — the compiled page code is identical.
export * from '../vue/vue-shim';
export * from './runtime';
export { adoptVaporComponent, mountAdoptNodes, releaseAdopt } from './interop';

// the runtime's slot/resolve helpers win over runtime-core's same-named
// exports (those need a VDOM currentInstance, which Vapor code never has)
export { resolveComponent, useSlots, type Slots } from './runtime';

// <style> v-bind() on a Vapor page (specs/166): the compiler names this
// helper in the useCssVars call it injects for vapor SFCs
export { useVaporCssVars } from './css-vars';

// the flutter backend must be registered before any helper runs: compiled
// SFCs call template() at module level, and this entry is their import. The
// adopt hook (VDOM pages embedding Vapor components) comes with it.
import './backend-flutter';
import './interop';

/** specs/148's enableVapor installed runtime-vapor's interop plugin on every
 * app. The own runtime needs no app-level wiring — helpers register on nodes
 * directly, and VDOM⇄Vapor crossings are compile-time. Kept exported (the
 * CLI injection and older builds call it) as a no-op. */
export function enableVapor(): void {}
