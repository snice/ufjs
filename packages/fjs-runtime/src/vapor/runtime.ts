// `fjs/vapor` — the VUE BINDING of the host contract (specs/163). The
// framework-neutral core lives in ./host; this module injects @vue/reactivity
// as its HostReactivity and adds the Vue-shaped component layer
// (createComponent / props / slots / defineVaporComponent / createVaporApp).
// Compiled SFCs import this via the CLI's `vue` → `fjs/vapor` rewrite; the
// export surface equals the core's plus the component layer.
import { EffectScope, effect, getCurrentScope, onScopeDispose, shallowRef, stop as stopRunner } from '@vue/reactivity';
import { camelize, hyphenate, isArray, toHandlerKey } from '@vue/shared';
import {
  be,
  blockOf,
  createKeyedFragment,
  currentBranch,
  emptyBlock,
  insertBlock,
  isAnchorHost,
  makeAnchor,
  removeBlock,
  renderEffect,
  setBranchOwnerResolver,
  setHostReactivity,
  setVaporErrorReporter,
  setVaporJobHook,
  listOf,
  switchOf,
  takeInsertionState,
  withScope as hostWithScope,
  type Block,
  type Branch,
  type HostNode,
  type Slots,
  TplNode,
  template,
} from './host';
import { patchHostProps, warnVaporOnce } from './helpers';
import { createListHooks, createTransitionHooks, setShowTransition } from './transition';
import { discardCssVarsBucket, popAndApplyCssVars, pushCssVarsBucket } from './css-vars';
import {
  createVaporInstance,
  currentVaporInstance,
  handleVaporError,
  hasUnmountHooks,
  runBeforeMount,
  runBeforeUnmount,
  runMounted,
  runUnmounted,
  onMounted,
  onUnmounted,
  runKeepAliveHooks,
  detachVaporInstance,
  setCurrentVaporInstance,
  setVaporComponentResolver,
  type VaporAppContext,
  type VaporInstance,
} from './instance';

export type { VaporAppContext, VaporInstance } from './instance';

// ---- instances ↔ scopes (specs/167) ------------------------------------------------------

/** Every scope the runtime creates → the component instance it belongs to.
 * A component created by a LATER effect run (a v-if flipping, a v-for
 * growing) has no vapor setup on the stack; its parent (provides,
 * appContext) is found through the scope that run executes in. */
const scopeOwner = new WeakMap<EffectScope, VaporInstance>();
/** A component's own scope → its instance: what the unmount walk looks for. */
const componentOf = new WeakMap<EffectScope, VaporInstance>();

function ownerOfActiveScope(): VaporInstance | null {
  const active = getCurrentScope();
  return (active && scopeOwner.get(active)) ?? null;
}

// a branch belongs to the component rendering it (specs/174)
setBranchOwnerResolver(() => activeInstance());

// ---- slot authorship (specs/180) ----------------------------------------------------------
//
// Vue scopes slot content by the component that WROTE it, not the one that
// renders it: `<form><input class="field" /></form>` in a page with
// `.field { … }` scoped must give the input's root the PAGE's data-v id. A
// component created while slot content runs takes its scope from here.

let currentSlotAuthor: VaporInstance | null = null;
const slotAuthorOf = new WeakMap<EffectScope, VaporInstance>();
const authoredSlots = new WeakSet<object>();

function slotAuthor(): VaporInstance | null {
  if (currentSlotAuthor) return currentSlotAuthor;
  const active = getCurrentScope();
  return (active && slotAuthorOf.get(active)) ?? null;
}

/** Each slot runs with its author set. A slot already authored (forwarded
 * through another component's <slot>) keeps its original author. */
function authorSlots(slots: Slots, author: VaporInstance | null): Slots {
  if (!author) return slots;
  let out: Slots | null = null;
  for (const key of Object.keys(slots)) {
    const fn = (slots as Record<string, unknown>)[key];
    if (typeof fn !== 'function' || authoredSlots.has(fn)) continue;
    const wrapped = (...args: unknown[]): unknown => {
      // its own scope (a child of whatever renders it, so it stops with
      // that), marked with the author: what a later effect re-run creates
      // inside the slot content — a v-if flipping — is scoped the same way
      const scope = new EffectScope();
      slotAuthorOf.set(scope, author);
      const owner = activeInstance();
      if (owner) scopeOwner.set(scope, owner);
      const prev = currentSlotAuthor;
      currentSlotAuthor = author;
      try {
        // the host's withScope: branches capture ITS current scope
        return hostWithScope(scope, () => (fn as (...a: unknown[]) => unknown)(...args));
      } finally {
        currentSlotAuthor = prev;
      }
    };
    authoredSlots.add(wrapped);
    (out ??= { ...slots } as Slots)[key as never] = wrapped as never;
  }
  return out ?? slots;
}

function activeInstance(): VaporInstance | null {
  return currentVaporInstance() ?? ownerOfActiveScope();
}

/** Pre-order walk over a scope subtree for component instances. Reads
 * EffectScope's `scopes` — not in the 3.5 d.ts, but a plain field since 3.2
 * and reactivity is pinned to 3.5.x (vapor-lifecycle.test.ts locks it in).
 * Tracking our own scope tree instead would charge every v-for item a
 * Map/Set entry for a walk that only runs on removal. Without the field the
 * onScopeDispose fallback still fires both hooks, just after removal. */
function walkInstances(scope: EffectScope, visit: (inst: VaporInstance) => void): void {
  const inst = componentOf.get(scope);
  if (inst) visit(inst);
  const children = (scope as unknown as { scopes?: EffectScope[] }).scopes;
  if (children) for (const child of children.slice()) walkInstances(child, visit);
}

/** Disposals collected while a stopScope is under way: unmounted runs
 * child-first AFTER the whole subtree stopped. EffectScope.stop runs a
 * scope's own cleanups before its children's, so the collection order is
 * parent-first and the flush reverses it. */
let stopDepth = 0;
let disposed: VaporInstance[] = [];

function onInstanceDisposed(inst: VaporInstance): void {
  detachVaporInstance(inst);
  if (stopDepth > 0) disposed.push(inst);
  else runUnmounted(inst);
}

function stopScopeWithHooks(scope: EffectScope): void {
  if (!hasUnmountHooks()) {
    scope.stop();
    return;
  }
  // beforeUnmount normally ran in beforeStopScope (hosts still attached); a
  // path that stops without it gets it here, parent-first all the same
  walkInstances(scope, runBeforeUnmount);
  stopDepth++;
  try {
    scope.stop();
  } finally {
    stopDepth--;
  }
  if (stopDepth === 0 && disposed.length) {
    const batch = disposed;
    disposed = [];
    for (let i = batch.length - 1; i >= 0; i--) runUnmounted(batch[i]);
  }
}

// the reactivity seam, bound before any helper can run (module init)
setHostReactivity({
  createScope: () => {
    const scope = new EffectScope();
    const owner = activeInstance();
    if (owner) scopeOwner.set(scope, owner);
    // a branch / item scope made while slot content renders remembers who
    // wrote that content, so what a later re-run creates in it is scoped
    // the same way (specs/180)
    const author = slotAuthor();
    if (author) slotAuthorOf.set(scope, author);
    return scope;
  },
  runInScope: <T,>(scope: EffectScope, fn: () => T) => scope.run(fn) as T,
  stopScope: (scope: EffectScope) => stopScopeWithHooks(scope),
  beforeStopScope: (scope: EffectScope) => {
    if (hasUnmountHooks()) walkInstances(scope, runBeforeUnmount);
  },
  effect: (fn, opts) => effect(fn, opts),
  stopEffect: (runner) => stopRunner(runner as Parameters<typeof stopRunner>[0]),
  box: <T,>(value: T) => shallowRef(value),
});

// ---- mounted hooks (specs/167 Q1: synchronous, once the hosts are in) -------------------

/** Instances whose setup finished but whose block is not in the host tree
 * yet. Children finish setup inside their parent's, so the list is
 * child-first already. createVaporApp / the adopt path take the list over
 * for their own construction and flush it when they insert; what a
 * scheduled effect run creates is flushed when the job returns. */
let pendingMounted: VaporInstance[] = [];

function flushMounted(list: VaporInstance[]): void {
  for (const inst of list) runMounted(inst);
}

setVaporJobHook(() => {
  if (pendingMounted.length === 0) return;
  const list = pendingMounted;
  pendingMounted = [];
  flushMounted(list);
});

setVaporErrorReporter((err, info) => handleVaporError(err, info));

function withPendingCapture<T>(fn: () => T): { value: T; mounted: VaporInstance[] } {
  const saved = pendingMounted;
  pendingMounted = [];
  try {
    const value = fn();
    return { value, mounted: pendingMounted };
  } finally {
    pendingMounted = saved;
  }
}

// ---- component context -------------------------------------------------------------------

let currentSlots: Slots | null = null;
/** Runs fn with [scope] as the enclosing one — the binding's slots-aware
 * wrapper over the core's withScope. Slot content renders while a child
 * mounts but belongs to the slot functions the parent passed. */
function withScope<T>(scope: EffectScope | null, fn: () => T, slots: Slots | null = null): T {
  const savedSlots = currentSlots;
  currentSlots = slots ?? savedSlots;
  try {
    return hostWithScope(scope, fn);
  } finally {
    currentSlots = savedSlots;
  }
}

export interface VaporComponent {
  name?: string;
  props?: Record<string, { default?: unknown } | unknown> | string[];
  emits?: Record<string, unknown> | string[];
  inheritAttrs?: boolean;
  setup?: (props: Record<string, unknown>, ctx: {
    emit: (name: string, ...args: unknown[]) => void;
    slots: Slots;
    attrs: Record<string, unknown>;
    expose: () => void;
  }) => unknown;
  /** compiler-vapor stamps this on every compiled SFC component */
  __vapor?: true;
  __fjsVapor?: true;
}

/** Stamps the marker createComponent dispatches on. In-place: the compiled
 * module holds one object and identity is load-bearing. */
export function defineVaporComponent<T extends VaporComponent>(options: T): T {
  options.__fjsVapor = true;
  return options;
}

/** The 3.6 SFC compiler stamps `__vapor: true` on the component object
 * itself; `__fjsVapor` covers hand-written defineVaporComponent options. */
function isVaporComponent(comp: unknown): comp is VaporComponent {
  return !!comp && typeof comp === 'object'
    && ((comp as VaporComponent).__vapor === true || (comp as VaporComponent).__fjsVapor === true);
}

export { isVaporComponent };

/** fjs's component-backed tags (specs/171): `<input>` on web, `<list-view>`
 * on both ends… The compiler injects `import "fjs/tag/<tag>"` into a module
 * that uses one, and that module registers the implementation here — so a
 * bundle carries exactly the tags its pages use, with no app-level table
 * (an enableVapor app has none). App components still win. */
const tagComponents = new Map<string, unknown>();
export function registerTagComponent(tag: string, comp: unknown): void {
  tagComponents.set(tag, comp);
}
setVaporComponentResolver((name) => activeInstance()?.appContext?.components[name] ?? tagComponents.get(name) ?? null);

export function resolveComponent(name: string): unknown {
  const resolved = activeInstance()?.appContext?.components[name] ?? tagComponents.get(name);
  if (resolved) return resolved;
  throw new Error(`[fjs vapor] component <${name}> is not registered on the app — import it and use the imported name instead`);
}

/** The dynamic-component entry (`<van-switch>` in a Vapor template compiles
 * to this): same contract as createComponent — resolves the name on the app
 * context and mounts, consuming the insertion state. Extra positional args
 * the compiler appends (single-root / once flags, appContext…) are ignored:
 * the general path below is correct for them. */
export function createAssetComponent(
  name: string,
  rawProps?: Record<string, unknown>,
  rawSlots?: Slots | (() => unknown),
): Block {
  return createComponent(resolveComponent(name), rawProps, rawSlots);
}

interface PropOptions {
  type?: unknown;
  default?: unknown;
}

const typeList = (opt: PropOptions): unknown[] => (isArray(opt.type) ? opt.type : opt.type != null ? [opt.type] : []);
const isBooleanProp = (opt: PropOptions): boolean => typeList(opt).includes(Boolean);
/** `[String, Boolean]` keeps "" a string; `[Boolean, String]` casts it. */
const stringBeforeBoolean = (opt: PropOptions): boolean => {
  const list = typeList(opt);
  const s = list.indexOf(String);
  return s >= 0 && s < list.indexOf(Boolean);
};

/** A declared default: a factory is called (once per instance — [cache]
 * is the instance's) unless the prop's type is Function; a Boolean prop
 * without one is false. */
function defaultOf(opt: PropOptions | undefined, key: string, cache: Map<string, unknown>): unknown {
  if (!opt || typeof opt !== 'object') return undefined;
  if (!('default' in opt)) return isBooleanProp(opt) ? false : undefined;
  const d = opt.default;
  if (typeof d !== 'function' || typeList(opt).includes(Function)) return d;
  if (!cache.has(key)) cache.set(key, (d as () => unknown)());
  return cache.get(key);
}

/** Vue's resolvePropValue for one read. */
function resolvePropValue(opt: PropOptions | undefined, key: string, v: unknown, cache: Map<string, unknown>): unknown {
  if (v === undefined) return defaultOf(opt, key, cache);
  if (opt && isBooleanProp(opt) && (v === '' || v === hyphenate(key)) && !stringBeforeBoolean(opt)) return true;
  return v;
}

/** Props and attrs for a mounted component (specs/170: Vue's split). Raw
 * values are getters evaluated on read, so a reader tracks what the
 * closure read; declared props get their defaults; everything NOT declared
 * as a prop or emit lands in attrs (class, style, undeclared listeners),
 * which fall through onto a single-root component's root element. A
 * function PROP (an event handler) cannot be told apart from a getter —
 * both arrive as functions — and a getter returning the handler reads the
 * same. */
function splitProps(
  getters: Record<string, unknown> | undefined,
  comp: VaporComponent,
): { props: Record<string, unknown>; attrs: Record<string, unknown> } {
  const props: Record<string, unknown> = {};
  const attrs: Record<string, unknown> = {};
  const declared = Array.isArray(comp.props) ? null : (comp.props as Record<string, { default?: unknown }> | undefined) ?? null;
  const keys = Array.isArray(comp.props) ? comp.props : declared ? Object.keys(declared) : [];
  const propKeys = new Set(keys.map((k) => camelize(k)));
  const emitKeys = new Set<string>(
    (Array.isArray(comp.emits) ? comp.emits : comp.emits ? Object.keys(comp.emits) : []).map((e) => toHandlerKey(camelize(e))),
  );
  const defaults = new Map<string, unknown>();
  const define = (target: Record<string, unknown>, key: string, value: unknown): void => {
    if (typeof value === 'function') Object.defineProperty(target, key, { get: value as () => unknown, enumerable: true });
    else target[key] = value;
  };
  for (const raw of getters ? Object.keys(getters) : []) {
    const value = getters![raw];
    const key = propKeys.has(camelize(raw)) ? camelize(raw) : raw;
    if (propKeys.has(key)) {
      const opt = declared?.[key] as PropOptions | undefined;
      if (opt && typeof opt === 'object' && ('default' in opt || isBooleanProp(opt))) {
        // Vue's casting / defaults (specs/171): `<switch checked>` passes ""
        // and reads true; an absent Boolean reads false
        Object.defineProperty(props, key, {
          get: () => resolvePropValue(opt, key, typeof value === 'function' ? (value as () => unknown)() : value, defaults),
          enumerable: true,
        });
      } else define(props, key, value);
    } else if (!emitKeys.has(raw)) define(attrs, raw, value);
  }
  for (const key of propKeys) {
    if (key in props) continue;
    props[key] = defaultOf(declared?.[key] as PropOptions | undefined, key, defaults);
  }
  return { props, attrs };
}

/** Attrs onto the component's root (specs/170) — only a single element
 * root, never an anchor, and not with `inheritAttrs: false`. class merges
 * with the root's own, style merges (the parent's keys win), listeners
 * stack, the rest become props / attributes. */
function applyFallthrough(block: Block, attrs: Record<string, unknown>, comp: VaporComponent, record: object): void {
  if (comp.inheritAttrs === false || block.nodes.length !== 1) return;
  const root = block.nodes[0];
  if (!root || typeof root !== 'object' || isAnchorHost(root) || isBlockOfComponent(root)) return;
  if (Object.keys(attrs).length === 0) return;
  renderEffect(() => {
    const next: Record<string, unknown> = {};
    for (const key of Object.keys(attrs)) next[key] = attrs[key];
    patchHostProps(root, next, record, true);
  });
}

/** The parent's scoped styles reach this component's root (Vue's rule,
 * specs/171): `<list-view class="list">` styled by the page's scoped
 * `.list { height: … }` needs the page's `data-v-…` on the list's root —
 * without it the rule never matches (on Flutter an unbounded list-view
 * then throws). A single element root only; fragments get none. */
function applyParentScope(block: Block, parent: VaporInstance | null): void {
  const scopeId = (parent?.type as { __scopeId?: unknown } | undefined)?.__scopeId;
  if (typeof scopeId !== 'string' || !scopeId) return;
  let root: unknown = null;
  for (const n of block.nodes) {
    if (!n || typeof n !== 'object' || isAnchorHost(n) || isBlockOfComponent(n)) continue;
    if (root) return;
    root = n;
  }
  if (root) be().setAttr(root as HostNode, scopeId, '');
}

function isBlockOfComponent(node: unknown): boolean {
  return !!(node && typeof node === 'object' && Array.isArray((node as Block).nodes));
}

/** What a template ref to a component resolves to (`expose()`d object, or
 * {} — `<script setup>` components are closed by default). */
const exposedOf = new WeakMap<object, Record<string, unknown>>();

/** A component block's ref value (its exposed object), the block itself
 * when it is not a component's. */
export function exposedRefOf(block: unknown): unknown {
  return block && typeof block === 'object' && exposedOf.has(block) ? exposedOf.get(block) : block;
}

type RenderHost = (
  comp: unknown,
  rawProps: Record<string, unknown> | undefined,
  slots: Slots,
  parent: HostNode | null,
  anchor: HostNode | null,
) => Block;
let renderHost: RenderHost | null = null;
/** The pure-vapor entries load vapor/render-host.ts, which registers here
 * (specs/171): a module the full entries (with the real VDOM interop) and
 * apps without render-function components never pull in. */
export function setRenderHost(fn: RenderHost): void {
  renderHost = fn;
}

function mountVaporComponent(
  comp: VaporComponent,
  rawProps: Record<string, unknown> | undefined,
  rawSlots: Slots | undefined,
  appContext: VaporAppContext | null,
  root = false,
): Block {
  // a root (an app, an adopted component) starts a fresh tree: a detached
  // scope, so a page mounted from inside another page's effect does not
  // die with it, and no parent to inherit provides from
  const parent = root ? null : activeInstance();
  // whose scoped styles reach this component's root: the parent's — or, for
  // a component written inside slot content, the template author's (Vue's
  // slotScopeIds). The parent stays the slot-rendering component (provide /
  // inject, lifecycle) (specs/180)
  const scopeFrom = root ? null : slotAuthor() ?? parent;
  // the component's own template is its own: no slot author inside it
  const prevAuthor = currentSlotAuthor;
  currentSlotAuthor = null;
  const inst = createVaporInstance(parent, appContext ?? parent?.appContext ?? null);
  // a component mounted straight into a v-if / dynamic-component branch:
  // KeepAlive keys, matches and activates by it (specs/174)
  const branch = currentBranch();
  if (branch && branch.owner === parent) (branch.insts ??= []).push(inst);
  inst.type = comp;
  const scope = new EffectScope(root);
  scopeOwner.set(scope, inst);
  componentOf.set(scope, inst);
  // the fallback unmount path (and the child-first collection of the main
  // one): fires whoever stops this scope
  scope.run(() => onScopeDispose(() => onInstanceDisposed(inst)));
  const { props, attrs } = splitProps(rawProps, comp);
  inst.attrs = attrs;
  const slots = rawSlots ?? {};
  let exposed: Record<string, unknown> = {};
  const ctx = {
    // the listener the parent passed (rawProps hold getters returning it):
    // `emit('scroll')` → `onScroll`, also its kebab / exact spellings
    emit: (name: string, ...args: unknown[]) => {
      for (const key of new Set([toHandlerKey(camelize(name)), toHandlerKey(name)])) {
        const raw = rawProps?.[key];
        const handler = typeof raw === 'function' ? (raw as () => unknown)() : raw;
        const list = isArray(handler) ? handler : [handler];
        for (const fn of list) if (typeof fn === 'function') (fn as (...a: unknown[]) => void)(...args);
      }
    },
    slots,
    attrs,
    // what a parent's template ref to this component receives (specs/170)
    expose: (value?: Record<string, unknown>) => {
      exposed = value ?? {};
    },
  };
  let block: Block;
  // useVaporCssVars registrations made during setup land in this bucket and
  // are applied (inside the scope, so they die with the component) once the
  // block exists — specs/166. A throwing setup discards its bucket: a leak
  // would attach this component's vars to the NEXT mounted one.
  pushCssVarsBucket();
  const prevInst = setCurrentVaporInstance(inst);
  try {
    block = withScope(scope, () => blockOf(comp.setup?.(props, ctx) ?? emptyBlock()), slots);
  } catch (e) {
    discardCssVarsBucket();
    setCurrentVaporInstance(prevInst);
    currentSlotAuthor = prevAuthor;
    scope.stop();
    throw e;
  }
  setCurrentVaporInstance(prevInst);
  withScope(scope, () => popAndApplyCssVars(block, (fn) => renderEffect(fn)));
  withScope(scope, () => applyFallthrough(block, attrs, comp, inst));
  currentSlotAuthor = prevAuthor;
  applyParentScope(block, scopeFrom);
  // the block object identifies the component for template refs: a fresh
  // object, so a child that returned its own child's block keeps its own
  block = { nodes: block.nodes, scopes: block.scopes, cleanups: block.cleanups };
  exposedOf.set(block, exposed);
  if (!block.scopes) block.scopes = [];
  block.scopes.push(scope);
  runBeforeMount(inst);
  pendingMounted.push(inst);
  return block;
}

/** The compiler's single-slot optimization passes the default slot as a
 * BARE FUNCTION; the general form is `{ name: fn }`. Normalize here so every
 * consumer sees the object. */
export function normalizeSlots(rawSlots?: Slots | (() => unknown)): Slots {
  if (rawSlots == null) return {};
  if (typeof rawSlots === 'function') return { default: rawSlots as () => unknown };
  const dynamic = (rawSlots as { $?: unknown }).$;
  if (!isArray(dynamic)) return rawSlots;
  // `$`: dynamic slot sources (createForSlots / v-if'd slots), each a getter
  // returning a descriptor `{ name, fn }` or a list of them (specs/170)
  const out: Slots = {};
  for (const key of Object.keys(rawSlots)) if (key !== '$') out[key] = (rawSlots as Slots)[key];
  const addAll = (d: unknown): void => {
    if (isArray(d)) d.forEach(addAll);
    else if (d && typeof d === 'object' && typeof (d as { fn?: unknown }).fn === 'function') {
      out[String((d as { name: unknown }).name)] = (d as { fn: (...a: unknown[]) => unknown }).fn;
    }
  };
  for (const src of dynamic) addAll(typeof src === 'function' ? (src as () => unknown)() : src);
  return out;
}

export function createComponent(
  comp: unknown,
  rawProps?: Record<string, unknown>,
  rawSlots?: Slots | (() => unknown),
): Block {
  // the slots are this template's: whoever wrote it authors their content
  const slots = authorSlots(normalizeSlots(rawSlots), slotAuthor() ?? activeInstance());
  const { parent, anchor } = takeInsertionState();
  if (isVaporComponent(comp)) {
    const block = mountVaporComponent(comp, rawProps, slots, null);
    if (parent) insertBlock(block, parent, anchor);
    return block;
  }
  // a VDOM component (vant, or any render-function component) mounts through
  // the backend's own renderer and lands here as a block — specs/161 §3.2
  const props: Record<string, unknown> = {};
  for (const k in rawProps ?? {}) {
    const v = (rawProps as Record<string, unknown>)[k];
    if (typeof v === 'function') Object.defineProperty(props, k, { get: v as () => unknown, enumerable: true });
    else props[k] = v;
  }
  const interop = be().mountVdomComponent;
  if (!interop && renderHost) {
    // specs/171: no VDOM renderer in this build — a render-function
    // component (fjs's own controls) runs on the render host instead
    return renderHost(comp, rawProps, slots, parent, anchor);
  }
  if (!interop) {
    throw new Error(
      '[fjs vapor] a render-function (VDOM) component reached a pure-vapor app and no render host is loaded (specs/171). ' +
        "fjs's own tags load it with them; for a component of your own, write it as a vapor component " +
        '(`<script setup vapor>`) or drop enableVapor.',
    );
  }
  // the VDOM component's own setup must register its hooks on ITS
  // runtime-core instance, not on the vapor component mounting it
  const prevInst = setCurrentVaporInstance(null);
  try {
    return interop(comp as Record<string, unknown>, props, slots, parent, anchor);
  } finally {
    setCurrentVaporInstance(prevInst);
  }
}

export function createComponentWithFallback(
  comp: unknown,
  rawProps?: Record<string, unknown>,
  rawSlots?: Slots | (() => unknown),
): Block {
  if (typeof comp === 'string') {
    // `<component :is="'view'">`: a registered component by that name, else
    // a plain element of that tag (specs/170 — it used to throw)
    const resolved = activeInstance()?.appContext?.components[comp] ?? tagComponents.get(comp);
    return resolved ? createComponent(resolved, rawProps, rawSlots) : createPlainElement(comp, rawProps, rawSlots);
  }
  return createComponent(comp, rawProps, rawSlots);
}

/** A bare element of [tag] with props applied and the default slot inside
 * (dynamic `<component :is="tag">`). */
export function createPlainElement(
  tag: string,
  rawProps?: Record<string, unknown> | null,
  rawSlots?: Slots | (() => unknown) | null,
): Block {
  const { parent, anchor } = takeInsertionState();
  const host = be().createElement ? be().createElement!(tag) : template(`<${tag}></${tag}>`)().host;
  const getters = rawProps ?? {};
  if (Object.keys(getters).length) {
    renderEffect(() => {
      const next: Record<string, unknown> = {};
      for (const key of Object.keys(getters)) {
        const v = getters[key];
        next[key] = typeof v === 'function' && !/^on[A-Z]/.test(key) ? (v as () => unknown)() : typeof v === 'function' ? (v as () => unknown)() : v;
      }
      patchHostProps(host, next, host as object);
    });
  }
  const slots = normalizeSlots(rawSlots ?? undefined);
  if (slots.default) insertBlock(blockOf(slots.default()), host, null);
  const block: Block = { nodes: [host] };
  if (parent) insertBlock(block, parent, anchor);
  return block;
}

export function createDynamicComponent(
  getComp: () => unknown,
  rawProps?: Record<string, unknown>,
  rawSlots?: Slots,
): Block {
  // specs/174: keyed on the resolved component — `is` changing to another
  // component rebuilds, re-renders of the same one do not (it used to be
  // evaluated once, so `<component :is>` never switched)
  return createKeyedFragment(getComp, (comp) => createComponentWithFallback(comp, rawProps, rawSlots));
}


// ---- slots ------------------------------------------------------------------------------

/** A slot position: renders the slot the parent passed, or the fallback
 * block. Slot content belongs to the CHILD's scope (it dies with the child)
 * but reads the parent's reactive state through the slot closure. */
/** Slot props for a scoped slot (specs/170): the compiler passes getters
 * (`{ item: () => x }`, plus `$: [() => obj]` for `v-bind="obj"`), the slot
 * function reads `slotProps.item` — a getter here, so its effects track
 * the source. */
function makeSlotProps(rawProps: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!rawProps || typeof rawProps !== 'object') return out;
  for (const key of Object.keys(rawProps)) {
    const v = (rawProps as Record<string, unknown>)[key];
    if (key === '$' && isArray(v)) {
      for (const src of v) {
        const obj = typeof src === 'function' ? (src as () => unknown)() : src;
        for (const k of Object.keys((obj as Record<string, unknown>) ?? {})) {
          Object.defineProperty(out, k, {
            get: () => {
              const o = typeof src === 'function' ? (src as () => Record<string, unknown>)() : (src as Record<string, unknown>);
              return o?.[k];
            },
            enumerable: true,
            configurable: true,
          });
        }
      }
      continue;
    }
    if (typeof v === 'function') Object.defineProperty(out, key, { get: v as () => unknown, enumerable: true, configurable: true });
    else out[key] = v;
  }
  return out;
}

export function createSlot(name: string | (() => string) = 'default', rawProps?: unknown, fallback?: () => unknown): Block {
  const { parent, anchor } = takeInsertionState();
  const slotName = typeof name === 'function' ? name() : name;
  const slotFn = currentSlots?.[slotName];
  const render = slotFn ? () => slotFn(makeSlotProps(rawProps)) : fallback;
  if (!render) {
    if (!parent) return emptyBlock();
    const anchorHost = makeAnchor('slot');
    if (parent) be().attach(anchorHost, parent, anchor);
    return { nodes: [anchorHost] };
  }
  const block = blockOf(render());
  if (parent) insertBlock(block, parent, anchor);
  return block;
}

export function useSlots(): Slots {
  return currentSlots ?? {};
}

// ---- app mount ---------------------------------------------------------------------------

/** Mounts a Vapor component as the root of a Vapor app (the enableVapor
 * page mount, bench, tests): the block lands in [container]; its mounted
 * hooks run once it is there; unmount tears everything down, beforeUnmount
 * while the hosts are still attached. */
export function createVaporApp(comp: VaporComponent, appContext: VaporAppContext | null = null): {
  mount: (container: HostNode) => void;
  unmount: () => void;
} {
  const { value: built, mounted } = withPendingCapture(() => mountVaporComponent(comp, undefined, undefined, appContext, true));
  let block: Block | null = built;
  return {
    mount: (container: HostNode) => {
      insertBlock(block as Block, container, null);
      flushMounted(mounted);
    },
    unmount: () => {
      if (block) removeBlock(block);
      block = null;
    },
  };
}

let warnedVdomShell = false;

/** A vapor page wrapped in the app's shell (enableVapor, specs/167 §8): the
 * shell gets `route` (the page's own) and renders the page in its default
 * slot — the VDOM path's `h(shell, { route }, { default })` shape. The shell
 * is where the nav bar and its back button live, so dropping it silently
 * (what the Flutter mount used to do) took the way back with it. A VDOM
 * shell cannot render in a pure-vapor mount: warn once, mount bare. */
export function withVaporShell(page: VaporComponent, shell: unknown, route: () => unknown): VaporComponent {
  if (!shell) return page;
  if (!isVaporComponent(shell)) {
    if (!warnedVdomShell) {
      warnedVdomShell = true;
      console.warn(
        '[fjs] enableVapor: `shell` is not a vapor component — pages mount without it (no nav bar / back button). ' +
          'Give the shell `<script setup vapor>`.',
      );
    }
    return page;
  }
  return defineVaporComponent({
    setup() {
      return createComponent(shell, { route }, { default: () => createComponent(page) });
    },
  });
}

/** The compile-time wrapper's entry (VDOM page embedding a Vapor component,
 * specs/161 §3.2): the block is built but NOT inserted — the wrapper's
 * placeholder host adopts it, calls mounted() once the hosts are in the VDOM
 * tree, and unmount() tears it down. */
export function mountVaporComponentForAdopt(
  comp: VaporComponent,
  rawProps: Record<string, unknown> | undefined,
  appContext: VaporAppContext | null,
): { block: Block; mounted: () => void; unmount: () => void } {
  const { value: block, mounted } = withPendingCapture(() => mountVaporComponent(comp, rawProps, undefined, appContext, true));
  return {
    block,
    mounted: () => flushMounted(mounted),
    unmount: () => removeBlock(block),
  };
}

// ---- template refs (specs/170) ---------------------------------------------------------

interface RefLike {
  value: unknown;
  __v_isRef?: true;
}
const isRefLike = (r: unknown): r is RefLike => !!r && typeof r === 'object' && (r as RefLike).__v_isRef === true;

/** What a ref points at: a template node's host, a component's exposed
 * object, a fragment's first host. */
function refValueOf(el: unknown): unknown {
  if (el instanceof TplNode) return el.host;
  if (el && typeof el === 'object' && exposedOf.has(el)) return exposedOf.get(el);
  if (el && typeof el === 'object' && Array.isArray((el as Block).nodes)) return (el as Block).nodes[0] ?? null;
  return el ?? null;
}

function setRef(el: unknown, ref: unknown, refFor: boolean | null | undefined, refKey: string | null | undefined): () => void {
  const value = refValueOf(el);
  const inst = activeInstance() as (ReturnType<typeof activeInstance> & { refs?: Record<string, unknown> }) | null;
  if (isRefLike(ref)) {
    if (refFor) {
      const list = isArray(ref.value) ? (ref.value as unknown[]) : (ref.value = []) as unknown[];
      list.push(value);
      return () => {
        const at = list.indexOf(value);
        if (at >= 0) list.splice(at, 1);
      };
    }
    ref.value = value;
    if (refKey && inst) (inst.refs ??= {})[refKey] = value;
    return () => {
      if (ref.value === value) ref.value = null;
      if (refKey && inst?.refs) inst.refs[refKey] = null;
    };
  }
  if (typeof ref === 'function') {
    (ref as (v: unknown, refs: unknown) => void)(value, inst?.refs ?? {});
    return () => (ref as (v: unknown, refs: unknown) => void)(null, inst?.refs ?? {});
  }
  if (typeof ref === 'string' && inst) {
    const refs = (inst.refs ??= {});
    if (refFor) {
      const list = (isArray(refs[ref]) ? refs[ref] : (refs[ref] = [])) as unknown[];
      list.push(value);
      return () => {
        const at = list.indexOf(value);
        if (at >= 0) list.splice(at, 1);
      };
    }
    refs[ref] = value;
    return () => {
      if (refs[ref] === value) refs[ref] = null;
    };
  }
  return () => {};
}

export function setStaticTemplateRef(el: unknown, ref: unknown, refFor?: boolean | null, refKey?: string | null): void {
  const unset = setRef(el, ref, refFor, refKey);
  onScopeDispose(unset, true);
}

/** The compiler's setter for refs whose element varies (v-for items). */
export function createTemplateRefSetter(): (el: unknown, ref: unknown, refFor?: boolean | null, refKey?: string | null) => void {
  return (el, ref, refFor, refKey) => setStaticTemplateRef(el, ref, refFor, refKey);
}

/** `:ref="expr"` — the target can change. */
export function setTemplateRefBinding(el: unknown, getter: () => unknown, refFor?: boolean | null, refKey?: string | null): void {
  let unset: (() => void) | null = null;
  renderEffect(() => {
    unset?.();
    unset = setRef(el, getter(), refFor, refKey);
  });
  onScopeDispose(() => unset?.(), true);
}

// ---- custom directives (specs/170) -----------------------------------------------------

type VaporDirective = (el: unknown, source?: () => unknown, arg?: string, modifiers?: Record<string, boolean>) => void | (() => void);

/** `v-foo` on an element: a vapor directive is a function called once with
 * the host and a value getter; a returned function is its cleanup. The
 * VDOM object-hook form has no lifecycle to hang off here — warned. */
export function withVaporDirectives(node: unknown, dirs: unknown[][]): void {
  const host = refValueOf(node);
  for (const [dir, source, arg, modifiers] of dirs) {
    if (typeof dir === 'function') {
      const cleanup = (dir as VaporDirective)(host, source as (() => unknown) | undefined, arg as string | undefined, modifiers as Record<string, boolean> | undefined);
      if (typeof cleanup === 'function') onScopeDispose(cleanup, true);
    } else {
      warnVaporOnce('vdom-directive', 'an object-hook (VDOM) directive reached a vapor template — write it as a vapor directive function (el, source, arg, modifiers) => cleanup');
    }
  }
}

// ---- built-in components (specs/170, 174–176) -------------------------------------------


/** Vapor <Transition> (specs/174): renders its slot, then hangs the class
 * timeline on what came back — the v-if / `:key` / `<component :is>`
 * fragment's switches, or the v-show element's toggles. */
export const VaporTransition = /* @__PURE__ */ defineVaporComponent({
  name: 'Transition',
  props: [
    'name', 'appear', 'mode', 'css', 'type', 'duration', 'persisted',
    'enterFromClass', 'enterActiveClass', 'enterToClass', 'appearFromClass', 'appearActiveClass', 'appearToClass',
    'leaveFromClass', 'leaveActiveClass', 'leaveToClass',
    'onBeforeEnter', 'onEnter', 'onAfterEnter', 'onEnterCancelled',
    'onBeforeLeave', 'onLeave', 'onAfterLeave', 'onLeaveCancelled',
    'onBeforeAppear', 'onAppear', 'onAfterAppear', 'onAppearCancelled',
  ],
  setup(props: Record<string, unknown>) {
    const block = createSlot('default');
    const hooks = createTransitionHooks(props);
    const sw = switchOf(block);
    if (sw) {
      sw.transition = hooks;
    } else {
      // v-show on a plain element: applyVShow asks at each toggle
      for (const host of block.nodes) setShowTransition(host, hooks);
    }
    const appear = props.appear;
    if (appear !== undefined && appear !== false && appear !== 'false') {
      onMounted(() => hooks.appear(sw ? sw.current?.nodes ?? [] : block.nodes));
    }
    return block;
  },
});
/** Vapor <TransitionGroup> (specs/176): the v-for list it wraps gets the
 * item enter / leave and the move pass (vapor/transition.ts
 * createListHooks); `tag` renders a container element around the items. */
export const VaporTransitionGroup = /* @__PURE__ */ defineVaporComponent({
  name: 'TransitionGroup',
  props: [
    'tag', 'name', 'appear', 'css', 'type', 'duration', 'moveClass',
    'enterFromClass', 'enterActiveClass', 'enterToClass', 'appearFromClass', 'appearActiveClass', 'appearToClass',
    'leaveFromClass', 'leaveActiveClass', 'leaveToClass',
    'onBeforeEnter', 'onEnter', 'onAfterEnter', 'onEnterCancelled',
    'onBeforeLeave', 'onLeave', 'onAfterLeave', 'onLeaveCancelled',
    'onBeforeAppear', 'onAppear', 'onAfterAppear', 'onAppearCancelled',
  ],
  setup(props: Record<string, unknown>) {
    const content = createSlot('default');
    const list = listOf(content);
    const hooks = createListHooks(props);
    if (list) {
      list.transition = hooks;
    } else {
      warnVaporOnce('transition-group-child', '<TransitionGroup> animates the items of a v-for — its content is not one, so it renders without animation');
    }
    const appear = props.appear;
    if (list && appear !== undefined && appear !== false && appear !== 'false') {
      onMounted(() => hooks.appear(content.nodes));
    }
    const tag = props.tag;
    if (typeof tag !== 'string' || tag === '') return content;
    // a container element: the items (and the list's anchor) live in it, so
    // the list finds its parent there; attrs fall through onto it
    const b = be();
    const host = b.createElement ? b.createElement(tag) : template(`<${tag}></${tag}>`)().host;
    insertBlock(content, host, null);
    // the content's cleanups (leaving items) belong to this component
    onScopeDispose(() => {
      for (const cleanup of content.cleanups ?? []) cleanup();
    });
    return { nodes: [host] } as Block;
  },
});
type NameMatcher = string | RegExp | (string | RegExp)[] | null | undefined;

function nameMatches(pattern: NameMatcher, name: string): boolean {
  if (Array.isArray(pattern)) return pattern.some((p) => nameMatches(p, name));
  if (typeof pattern === 'string') return pattern.split(',').map((p) => p.trim()).includes(name);
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(name);
  }
  return false;
}

function branchName(branch: Branch): string {
  const type = (branch.insts?.[0] as VaporInstance | undefined)?.type as { name?: string; __name?: string } | undefined;
  return type?.name ?? type?.__name ?? '';
}

/** Vapor <KeepAlive> (specs/174): the v-if / `<component :is>` fragment it
 * wraps keeps a left component instead of destroying it — its hosts move
 * into a storage element that is never attached (Flutter's remove destroys
 * elements, so storage is an insert, as runtime-core's KeepAlive does), its
 * effects and state stay. Back in the tree: onActivated; out: onDeactivated. */
export const VaporKeepAlive = /* @__PURE__ */ defineVaporComponent({
  name: 'KeepAlive',
  props: ['include', 'exclude', 'max'],
  setup(props: Record<string, unknown>) {
    const block = createSlot('default');
    const sw = switchOf(block);
    if (!sw) {
      warnVaporOnce('keepalive-child', '<KeepAlive> keeps a v-if branch or a <component :is> — its content is neither, so nothing is cached');
      return block;
    }
    const b = be();
    const storage = b.createElement ? b.createElement('view') : template('<view></view>')().host;
    /** Kept branches by key, least recently used first. */
    const cache = new Map<unknown, Branch>();
    const destroy = (branch: Branch): void => {
      removeBlock({ nodes: branch.nodes, scopes: [branch.scope], cleanups: branch.cleanups });
    };
    const insts = (branch: Branch): VaporInstance[] => (branch.insts ?? []) as VaporInstance[];
    sw.keepAlive = {
      wants(branch) {
        if (!branch.insts?.length) return false; // only components are kept
        const name = branchName(branch);
        if (props.include != null && props.include !== '' && !nameMatches(props.include as NameMatcher, name)) return false;
        if (props.exclude != null && props.exclude !== '' && nameMatches(props.exclude as NameMatcher, name)) return false;
        return true;
      },
      deactivate(branch) {
        cache.delete(branch.key);
        cache.set(branch.key, branch);
        runKeepAliveHooks(insts(branch), 'da');
      },
      store(branch) {
        // still cached (not evicted meanwhile): park the hosts
        if (cache.get(branch.key) === branch) for (const node of branch.nodes) b.attach(node, storage, null);
      },
      take(key) {
        const branch = cache.get(key);
        if (branch) cache.delete(key);
        return branch;
      },
      activate(branch) {
        runKeepAliveHooks(insts(branch), 'a');
        // `max` counts the live component too (Vue's rule): the least
        // recently used kept one goes once there is no room
        const max = Number(props.max);
        if (max > 0) {
          while (cache.size + 1 > max) {
            const [oldestKey, oldest] = cache.entries().next().value as [unknown, Branch];
            cache.delete(oldestKey);
            destroy(oldest);
          }
        }
      },
    };
    onMounted(() => {
      const cur = sw.current;
      if (cur && sw.keepAlive!.wants(cur)) runKeepAliveHooks(insts(cur), 'a');
    });
    onUnmounted(() => {
      for (const branch of cache.values()) destroy(branch);
      cache.clear();
    });
    return block;
  },
});
/** Vapor <Teleport> (specs/175): the slot renders as usual, then its hosts
 * move to the target — `to` a selector (the backend resolves it) or a host —
 * and back in front of the placeholder while `disabled`. The block's `nodes`
 * array is live (a v-if at the slot root swaps branches into it), and a
 * switching fragment finds its parent through its anchor, so later branches
 * land in the target on their own. */
export const VaporTeleport = /* @__PURE__ */ defineVaporComponent({
  name: 'Teleport',
  props: ['to', 'disabled', 'defer'],
  setup(props: Record<string, unknown>) {
    const placeholder = makeAnchor('teleport');
    const content = createSlot('default');
    const b = be();
    const resolve = (): HostNode | null => {
      const to = props.to;
      if (typeof to === 'string') return b.querySelector?.(to) ?? null;
      return to && typeof to === 'object' ? (to as HostNode) : null;
    };
    /** Where the content is: a target host, in place, or nowhere yet. */
    let where: HostNode | 'inline' | null = null;
    const place = (): void => {
      const disabled = props.disabled !== undefined && props.disabled !== false && props.disabled !== 'false';
      const target = disabled ? null : resolve();
      if (!disabled && !target) {
        warnVaporOnce(`teleport:${String(props.to)}`, `<Teleport to="${String(props.to)}"> has no target here — rendered in place`);
      }
      if (target) {
        if (where === target) return;
        where = target;
        for (const node of content.nodes) b.attach(node, target, null);
        return;
      }
      if (where === 'inline') return;
      const parent = b.parentNode?.(placeholder) ?? null;
      if (!parent) return; // not in the tree yet: mount places it
      where = 'inline';
      for (const node of content.nodes) b.attach(node, parent, placeholder);
    };
    // the placement effect belongs to this component: it stops with it
    const scope = getCurrentScope();
    const deferred = props.defer !== undefined && props.defer !== false && props.defer !== 'false';
    let started = false;
    const start = (): void => {
      if (started) return;
      started = true;
      const run = () =>
        renderEffect(() => {
          void props.to;
          void props.disabled;
          place();
        });
      if (scope) scope.run(run);
      else run();
    };
    // in-place content needs the placeholder's parent, a deferred target
    // the rest of the page — both are there at mount; a target that exists
    // already takes the content before the first paint
    onMounted(start);
    if (!deferred && !props.disabled && resolve()) start();
    // teleported hosts are not in any ancestor's subtree, so an ancestor's
    // removal would not take them: they go when this component's scope stops
    onScopeDispose(() => {
      for (let i = content.nodes.length - 1; i >= 0; i--) b.remove(content.nodes[i]);
      for (const cleanup of content.cleanups ?? []) cleanup();
    });
    return { nodes: [placeholder] } as Block;
  },
});

// the core's surface IS the compiled face — component layer adds the rest
export * from './host';
export * from './helpers';
export type { Slots };
