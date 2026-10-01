// Custom-renderer implementation of Vue's useCssVars() — the runtime half
// of <style> v-bind() support. compileScript injects
// `useCssVars(_ctx => ({ "<scopeId>-<expr>": (expr), ... }))` into
// script-setup components whose CSS uses v-bind(); this module applies the
// resulting custom properties as inline styles on the component's root
// element(s). The style engine inherits them down the tree, so every
// element of the component subtree picks them up.
//
// Replaces the runtime-dom version, which is DOM-only (document,
// MutationObserver, CSSStyleDeclaration).
import {
  Fragment,
  getCurrentInstance,
  onBeforeUpdate,
  onMounted,
  onUnmounted,
  queuePostFlushCb,
  watchPostEffect,
} from '@vue/runtime-core';
import { styleEngine } from './host-ops';

export function useCssVars(getter: (ctx: any) => Record<string, unknown>): void {
  const instance = getCurrentInstance() as any;
  if (!instance) return;

  const apply = (vnode: any, vars: Record<string, unknown>): void => {
    if (!vnode) return;
    while (vnode.component) vnode = vnode.component.subTree;
    if (vnode.type === Fragment) {
      for (const child of vnode.children ?? []) apply(child, vars);
      return;
    }
    const el = vnode.el;
    if (el && typeof el.id === 'number') {
      styleEngine.setInlineCustomProps(el.id, vars);
    }
  };
  const setVars = (): void => {
    if (!instance.subTree) return;
    apply(instance.subTree, getter(instance.proxy) ?? {});
  };

  onMounted(() => {
    watchPostEffect(setVars);
  });
  onBeforeUpdate(() => {
    // re-apply after every re-render, as Vue does (the getter may return
    // values not driven by tracked reactivity, e.g. plain props mutation)
    queuePostFlushCb(setVars);
  });
  onUnmounted(() => {
    if (instance.subTree?.el) {
      styleEngine.setInlineCustomProps(instance.subTree.el.id, {});
    }
  });
}
