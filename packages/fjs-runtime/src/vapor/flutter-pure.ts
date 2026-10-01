// `fjs/vapor` for Flutter in enableVapor mode (specs/169) — the twin of
// web-pure.ts: the own runtime over the Flutter backend with the VDOM
// interop left out. No `render` / `h` from the Vue renderer anywhere in its
// graph, so runtime-core's rendering engine never enters the bundle. A page
// that reaches a VDOM component gets the runtime's plain error (the backend
// has no `mountVdomComponent`), the same one web gives — both ends draw the
// enableVapor boundary in the same place. The CLI's flutterAliases point
// `fjs/vapor` here when the app entry declares enableVapor.
export * from '../vue/vue-shim';
export * from './runtime';

// the runtime's slot/resolve helpers win over runtime-core's same-named
// exports (those need a VDOM currentInstance, which Vapor code never has)
export { resolveComponent, useSlots, type Slots } from './runtime';
export {
  onBeforeMount, onMounted, onBeforeUnmount, onUnmounted, onBeforeUpdate, onUpdated, onActivated, onDeactivated, onErrorCaptured, onRenderTracked, onRenderTriggered, onServerPrefetch, provide, inject, hasInjectionContext,
} from './instance';
export { useVaporCssVars } from './css-vars';

// the backend must be registered before any helper runs: compiled SFCs call
// template() at module level, and this entry is their import
import './backend-flutter';

/** Kept for the CLI injection's call shape (see vapor/index.ts). */
export function enableVapor(): void {}
