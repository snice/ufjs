// The enableVapor web 'vue' WITH a VDOM component library (specs/182):
// runtime-dom — the renderer vant / nutui are compiled against (createApp
// for their imperative overlays, vShow / vModelText, the VDOM Transition) —
// plus the vapor-aware lifecycle and provide/inject of vue-pure.ts, so a
// composable called from a vapor setup still reaches the vapor instance.
// runtime-dom sits on the same runtime-core / reactivity copy the vapor
// runtime links (both resolve from fjs-runtime), so there is one reactive
// system. The vapor <Transition> / <TransitionGroup> are not re-exported:
// a vapor template reaches them through fjs/vapor, and here the names belong
// to the VDOM components that render them.
// the vue package's own runtime build (runtime-dom over runtime-core) —
// not the bare 'vue', which the app's alias points back at this module
export * from 'vue/dist/vue.runtime.esm-bundler.js';
export {
  onBeforeMount, onMounted, onBeforeUnmount, onUnmounted, onBeforeUpdate, onUpdated, onActivated, onDeactivated, onErrorCaptured, onRenderTracked, onRenderTriggered, onServerPrefetch, provide, inject, hasInjectionContext, useAttrs, resolveDynamicComponent,
} from './instance';
