// The enableVapor web 'vue' (specs/167): runtime-core — the standalone
// package the vapor runtime shares its reactivity with (specs/166 keeps
// runtime-dom out) — plus the vapor-aware lifecycle and provide/inject, so
// a composable or library importing them from 'vue' (pinia, vueuse) works
// in a vapor setup the same way it does on Flutter, where the vue shim
// re-exports the same functions.
export * from '@vue/runtime-core';
export {
  onBeforeMount, onMounted, onBeforeUnmount, onUnmounted, onBeforeUpdate, onUpdated, onActivated, onDeactivated, onErrorCaptured, onRenderTracked, onRenderTriggered, onServerPrefetch, provide, inject, hasInjectionContext, useAttrs,
} from './instance';
