// Vapor component instances (specs/167): lifecycle hooks, provide/inject and
// the app-level context a vapor setup reads — the Vue API surface that
// runtime-core only offers to its own VDOM instances.
//
// Deliberately dependency-light (runtime-core + reactivity, no host, no
// renderer): the Flutter 'vue' shim and the enableVapor web 'vue' pin both
// re-export the DUAL functions below, so a composable in a plain .ts file
// (`import { onMounted, inject } from 'vue'` — pinia, vueuse) reaches the
// vapor instance too, without pulling the vapor runtime into apps that
// never mount a vapor component.
//
// Dual dispatch order: the VAPOR instance first, then runtime-core's. A
// vapor component adopted into a VDOM page runs its setup INSIDE the
// wrapper's VDOM setup — runtime-core has a current instance then too, and
// the hook belongs to the vapor one. The opposite nesting (a VDOM component
// mounted from a vapor template through the interop) clears the vapor
// instance for the duration (runtime.ts withoutVaporInstance).
//
// getCurrentInstance() stays runtime-core's (null in vapor code): a fake
// instance would crash libraries that read instance.proxy / vnode, and the
// ones that check it before registering a hook (vueuse tryOnMounted) take
// their no-instance branch, which is still correct.
import {
  getCurrentInstance as rcInstance,
  hasInjectionContext as rcHasInjectionContext,
  inject as rcInject,
  onActivated as rcOnActivated,
  onBeforeMount as rcOnBeforeMount,
  onBeforeUnmount as rcOnBeforeUnmount,
  onBeforeUpdate as rcOnBeforeUpdate,
  onDeactivated as rcOnDeactivated,
  onErrorCaptured as rcOnErrorCaptured,
  onMounted as rcOnMounted,
  onRenderTracked as rcOnRenderTracked,
  onRenderTriggered as rcOnRenderTriggered,
  onServerPrefetch as rcOnServerPrefetch,
  onUnmounted as rcOnUnmounted,
  onUpdated as rcOnUpdated,
  provide as rcProvide,
  resolveDynamicComponent as rcResolveDynamicComponent,
  useAttrs as rcUseAttrs,
} from '@vue/runtime-core';

type Hook = () => void;
type InjectionKey = string | symbol | object;

/** What a vapor app resolves against: global components (resolveComponent)
 * and app-level provides (app.provide / plugins). Shared by every page of
 * an app; a page gets its own context whose provides inherit the app's. */
export interface VaporAppContext {
  components: Record<string, unknown>;
  provides?: Record<string | symbol, unknown>;
}

export interface VaporInstance {
  parent: VaporInstance | null;
  appContext: VaporAppContext | null;
  provides: Record<string | symbol, unknown>;
  bm: Hook[] | null;
  m: Hook[] | null;
  bum: Hook[] | null;
  um: Hook[] | null;
  isMounted: boolean;
  /** beforeUnmount ran (or was skipped because unmount is under way) */
  isUnmounting: boolean;
  isUnmounted: boolean;
  /** the non-prop attrs the parent passed (specs/170) */
  attrs?: Record<string, unknown>;
  /** the component definition (its `__scopeId` scopes its children's
   * roots — specs/171) */
  type?: unknown;
  /** a render-function component on the render host (specs/171): it HAS
   * re-renders, so onBeforeUpdate / onUpdated apply */
  renderHost?: boolean;
  bu?: Hook[] | null;
  u?: Hook[] | null;
  /** Live child instances — KeepAlive activates a kept subtree (specs/174). */
  children?: Set<VaporInstance>;
  /** onActivated / onDeactivated (specs/174). */
  a?: Hook[] | null;
  da?: Hook[] | null;
}

const EMPTY_PROVIDES: Record<string | symbol, unknown> = Object.freeze(Object.create(null)) as never;

function appProvides(ctx: VaporAppContext | null): Record<string | symbol, unknown> {
  if (!ctx) return EMPTY_PROVIDES;
  if (!ctx.provides) ctx.provides = Object.create(null) as Record<string | symbol, unknown>;
  return ctx.provides;
}

export function createVaporInstance(parent: VaporInstance | null, appContext: VaporAppContext | null): VaporInstance {
  const ctx = appContext ?? parent?.appContext ?? null;
  const inst: VaporInstance = {
    parent,
    appContext: ctx,
    // inherits the parent's (or the app's) provides until the first own
    // provide() — Vue's shape, so inject never sees its own provides
    provides: parent ? parent.provides : appProvides(ctx),
    bm: null,
    m: null,
    bum: null,
    um: null,
    isMounted: false,
    isUnmounting: false,
    isUnmounted: false,
  };
  if (parent) (parent.children ??= new Set()).add(inst);
  return inst;
}

/** An instance went away: its parent stops listing it. */
export function detachVaporInstance(inst: VaporInstance): void {
  inst.parent?.children?.delete(inst);
}

let current: VaporInstance | null = null;
/** app.runWithContext(fn): inject reads the app's provides while fn runs
 * (pinia's store setup goes through it) */
let runContext: VaporAppContext | null = null;

export function currentVaporInstance(): VaporInstance | null {
  return current;
}

export function setCurrentVaporInstance(inst: VaporInstance | null): VaporInstance | null {
  const prev = current;
  current = inst;
  return prev;
}

export function runWithVaporContext<T>(ctx: VaporAppContext, fn: () => T): T {
  const prev = runContext;
  runContext = ctx;
  try {
    return fn();
  } finally {
    runContext = prev;
  }
}

// ---- error routing ---------------------------------------------------------------------

let errorHandlerSource: (() => ((err: unknown, instance: null, info: string) => void) | undefined) | null = null;

/** The app shell registers where `app.config.errorHandler` lives; read at
 * error time, so assigning the handler after createFjsApp still counts. */
export function setVaporErrorHandlerSource(src: typeof errorHandlerSource): void {
  errorHandlerSource = src;
}

export function handleVaporError(err: unknown, info: string): void {
  const handler = errorHandlerSource?.();
  if (handler) {
    handler(err, null, info);
    return;
  }
  console.error(`[fjs vapor] error in ${info}:`, err);
}

function callHooks(hooks: Hook[] | null, info: string): void {
  if (!hooks) return;
  for (const hook of hooks) {
    try {
      hook();
    } catch (e) {
      handleVaporError(e, info);
    }
  }
}

// ---- lifecycle -------------------------------------------------------------------------

/** Live instances that registered an unmount hook — the runtime skips the
 * scope-tree walk entirely while this is 0 (no hooks, no cost: the bench
 * grids never register one). */
let unmountHookCount = 0;
export function hasUnmountHooks(): boolean {
  return unmountHookCount > 0;
}

function register(key: 'bm' | 'm' | 'bum' | 'um', fn: Hook): void {
  const inst = current as VaporInstance;
  if ((key === 'bum' || key === 'um') && !inst.bum && !inst.um) unmountHookCount++;
  (inst[key] ??= []).push(fn);
}

export function runBeforeMount(inst: VaporInstance): void {
  callHooks(inst.bm, 'beforeMount hook');
}

export function runMounted(inst: VaporInstance): void {
  if (inst.isMounted || inst.isUnmounting || inst.isUnmounted) return;
  inst.isMounted = true;
  callHooks(inst.m, 'mounted hook');
}

export function runBeforeUnmount(inst: VaporInstance): void {
  if (inst.isUnmounting || inst.isUnmounted) return;
  inst.isUnmounting = true;
  callHooks(inst.bum, 'beforeUnmount hook');
}

export function runUnmounted(inst: VaporInstance): void {
  if (inst.isUnmounted) return;
  runBeforeUnmount(inst);
  inst.isUnmounted = true;
  if (inst.bum || inst.um) unmountHookCount--;
  callHooks(inst.um, 'unmounted hook');
}

type HookFn = (fn: Hook, target?: unknown) => void;

function dual(key: 'bm' | 'm' | 'bum' | 'um', rc: HookFn): HookFn {
  return (fn, target) => {
    if (current && target === undefined) register(key, fn);
    else rc(fn, target as never);
  };
}

export const onBeforeMount = dual('bm', rcOnBeforeMount as HookFn);
export const onMounted = dual('m', rcOnMounted as HookFn);
export const onBeforeUnmount = dual('bum', rcOnBeforeUnmount as HookFn);
export const onUnmounted = dual('um', rcOnUnmounted as HookFn);

const warned = new Set<string>();
function unsupported<F extends (...args: never[]) => unknown>(name: string, rc: F): F {
  return ((...args: never[]) => {
    if (!current) return rc(...args);
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[fjs vapor] ${name} is not supported in vapor components (specs/167) — the hook never runs`);
    }
  }) as F;
}

const unsupportedBeforeUpdate = unsupported('onBeforeUpdate', rcOnBeforeUpdate);
const unsupportedUpdated = unsupported('onUpdated', rcOnUpdated);
export const onBeforeUpdate = (fn: Hook, target?: unknown): void => {
  if (current?.renderHost && target === undefined) (current.bu ??= []).push(fn);
  else unsupportedBeforeUpdate(fn, target as never);
};
export const onUpdated = (fn: Hook, target?: unknown): void => {
  if (current?.renderHost && target === undefined) (current.u ??= []).push(fn);
  else unsupportedUpdated(fn, target as never);
};
export function runBeforeUpdate(inst: VaporInstance): void {
  callHooks(inst.bu ?? null, 'beforeUpdate hook');
}
export function runUpdated(inst: VaporInstance): void {
  callHooks(inst.u ?? null, 'updated hook');
}
// specs/174: fired by <KeepAlive> for the kept subtree; outside a KeepAlive
// they never run, as in Vue
export const onActivated = (fn: Hook, target?: unknown): void => {
  if (current && target === undefined) (current.a ??= []).push(fn);
  else rcOnActivated(fn, target as never);
};
export const onDeactivated = (fn: Hook, target?: unknown): void => {
  if (current && target === undefined) (current.da ??= []).push(fn);
  else rcOnDeactivated(fn, target as never);
};

/** Runs the activated / deactivated hooks of `roots` and everything under
 * them, children first (Vue's order). */
export function runKeepAliveHooks(roots: readonly VaporInstance[], kind: 'a' | 'da'): void {
  const walk = (inst: VaporInstance): void => {
    for (const child of inst.children ?? []) walk(child);
    callHooks(inst[kind] ?? null, kind === 'a' ? 'activated hook' : 'deactivated hook');
  };
  for (const root of roots) walk(root);
}
export const onErrorCaptured = unsupported('onErrorCaptured', rcOnErrorCaptured);
export const onRenderTracked = unsupported('onRenderTracked', rcOnRenderTracked);
export const onRenderTriggered = unsupported('onRenderTriggered', rcOnRenderTriggered);
export const onServerPrefetch = unsupported('onServerPrefetch', rcOnServerPrefetch);

// ---- provide / inject ------------------------------------------------------------------

/** Whether a vapor provide/inject context is active: a vapor setup running,
 * or an app's runWithContext. */
export function hasVaporInjectionContext(): boolean {
  return current !== null || runContext !== null;
}

export function provide(key: InjectionKey, value: unknown): void {
  const inst = current;
  if (!inst) {
    rcProvide(key as never, value as never);
    return;
  }
  const parentProvides = inst.parent ? inst.parent.provides : appProvides(inst.appContext);
  // first own provide: fork the chain so siblings never see it
  if (inst.provides === parentProvides) inst.provides = Object.create(parentProvides) as Record<string | symbol, unknown>;
  inst.provides[key as string | symbol] = value;
}

export function inject(key: InjectionKey, defaultValue?: unknown, treatDefaultAsFactory = false): unknown {
  const inst = current;
  // forwarded with the caller's arity: runtime-core tells "no default"
  // (warn when missing) from "default undefined" by arguments.length
  // eslint-disable-next-line prefer-rest-params
  if (!inst && !runContext) return (rcInject as (...a: unknown[]) => unknown)(...Array.from(arguments));
  const source = inst
    ? inst.parent
      ? inst.parent.provides
      : appProvides(inst.appContext)
    : appProvides(runContext);
  if ((key as string | symbol) in source) return source[key as string | symbol];
  if (arguments.length > 1) {
    return treatDefaultAsFactory && typeof defaultValue === 'function' ? (defaultValue as () => unknown)() : defaultValue;
  }
  if (!warned.has('inject:' + String(key))) {
    warned.add('inject:' + String(key));
    console.warn(`[fjs vapor] injection "${String(key)}" not found`);
  }
  return undefined;
}

export function hasInjectionContext(): boolean {
  return hasVaporInjectionContext() || rcHasInjectionContext();
}

/** resolveDynamicComponent() (specs/171): inside a vapor setup — a
 * render-function component on the render host — names resolve through the
 * vapor runtime (app components, then the fjs tag table), which registers
 * the lookup here so this module stays free of it; elsewhere runtime-core's
 * (the VDOM app's component table). An unknown name stays a tag string. */
let vaporResolver: ((name: string) => unknown) | null = null;
export function setVaporComponentResolver(fn: (name: string) => unknown): void {
  vaporResolver = fn;
}
export function resolveDynamicComponent(comp: unknown): unknown {
  if (current && vaporResolver && typeof comp === 'string') return vaporResolver(comp) ?? comp;
  return rcResolveDynamicComponent(comp);
}

/** useAttrs() (specs/170): a vapor setup's attrs; runtime-core's otherwise. */
export function useAttrs(): Record<string, unknown> {
  if (current) return current.attrs ?? {};
  return rcUseAttrs() as Record<string, unknown>;
}

/** true when runtime-core has its own current instance and no vapor one —
 * the router's inject paths keep using runtime-core there */
export function inVdomInstance(): boolean {
  return current === null && rcInstance() !== null;
}
