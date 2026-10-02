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
export { resolveComponent, resolveDirective, useSlots, type Slots } from './runtime';
// specs/167: vapor-aware lifecycle + provide/inject (the shim above already
// re-exports the same bindings; spelled out so the surface is explicit)
export {
  onBeforeMount, onMounted, onBeforeUnmount, onUnmounted, onBeforeUpdate, onUpdated, onActivated, onDeactivated, onErrorCaptured, onRenderTracked, onRenderTriggered, onServerPrefetch, provide, inject, hasInjectionContext, useAttrs, resolveDynamicComponent,
} from './instance';

// <style> v-bind() on a Vapor page (specs/166): the compiler names this
// helper in the useCssVars call it injects for vapor SFCs
export { useVaporCssVars } from './css-vars';

// the flutter backend must be registered before any helper runs: compiled
// SFCs call template() at module level, and this entry is their import. The
// adopt hook (VDOM pages embedding Vapor components) comes with it.
import './backend-flutter';
// VDOM components inside vapor templates, and vapor components adopted by
// VDOM pages — both need the Vue renderer; the enableVapor surface
// (flutter-pure.ts) leaves them out (specs/169)
import './backend-flutter-interop';
import './interop';

/** specs/148's enableVapor installed runtime-vapor's interop plugin on every
 * app. The own runtime needs no app-level wiring — helpers register on nodes
 * directly, and VDOM⇄Vapor crossings are compile-time. Kept exported (the
 * CLI injection and older builds call it) as a no-op. */
export function enableVapor(): void {}

// specs/170: event modifiers on the Flutter end — vue-shim's withModifiers /
// withKeys. A tap reaches the handler as renderer.ts's event object, whose
// stopPropagation / preventDefault are real (the tap bubbles), so `.stop`
// holds; key filters pass through (fjs events carry no key codes).
import { withKeys as fjsWithKeys, withModifiers as fjsWithModifiers } from '../vue/modifiers';
import { createInvoker } from './helpers';
export const withVaporModifiers = <T extends (...args: unknown[]) => unknown>(fn: T, modifiers: string[]): T =>
  createInvoker(typeof fn === 'function' ? (fjsWithModifiers(fn as never, modifiers) as unknown as T) : fn);
export const withVaporKeys = <T extends (...args: unknown[]) => unknown>(fn: T, _modifiers: string[]): T =>
  createInvoker(typeof fn === 'function' ? (fjsWithKeys(fn as never) as unknown as T) : fn);
