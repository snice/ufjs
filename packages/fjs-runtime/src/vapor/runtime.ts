// `fjs/vapor` — the VUE BINDING of the host contract (specs/163). The
// framework-neutral core lives in ./host; this module injects @vue/reactivity
// as its HostReactivity and adds the Vue-shaped component layer
// (createComponent / props / slots / defineVaporComponent / createVaporApp).
// Compiled SFCs import this via the CLI's `vue` → `fjs/vapor` rewrite; the
// export surface equals the core's plus the component layer.
import { EffectScope, effect, getCurrentScope, onScopeDispose, shallowRef, stop as stopRunner } from '@vue/reactivity';
import { camelize, toHandlerKey } from '@vue/shared';
import {
  be,
  blockOf,
  emptyBlock,
  insertBlock,
  removeBlock,
  renderEffect,
  setHostReactivity,
  setVaporErrorReporter,
  setVaporJobHook,
  takeInsertionState,
  withScope as hostWithScope,
  type Block,
  type HostNode,
  type Slots,
} from './host';
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
  setCurrentVaporInstance,
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
  props?: Record<string, { default?: unknown }> | string[];
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

export function resolveComponent(name: string): unknown {
  const resolved = activeInstance()?.appContext?.components[name];
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

/** Props for a mounted component: getters evaluated on read, so an effect
 * reading `props.x` tracks whatever the getter read. Event handlers arrive
 * as plain functions and read as themselves; declared defaults fill in when
 * no getter exists. */
function makeProps(getters: Record<string, unknown> | undefined, comp: VaporComponent): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const declared = Array.isArray(comp.props) ? null : comp.props ?? null;
  const keys = Array.isArray(comp.props) ? comp.props : declared ? Object.keys(declared) : [];
  const names = new Set([...(getters ? Object.keys(getters) : []), ...keys]);
  for (const key of names) {
    const value = getters?.[key];
    if (typeof value === 'function') {
      // reactive binding: evaluated on read, so the reader tracks what the
      // closure read. A function PROP (an event handler, `onClick`) cannot
      // be told apart from a getter here — both arrive as functions — and
      // a getter returning the handler works the same for readers.
      Object.defineProperty(props, key, { get: value as () => unknown, enumerable: true });
      continue;
    }
    // a static value the compiler folded (class="page" on a component tag);
    // a declared default fills in when the parent passed nothing
    if (value !== undefined) {
      props[key] = value;
      continue;
    }
    const fallback = declared?.[key]?.default;
    props[key] = typeof fallback === 'function' ? (fallback as () => unknown)() : fallback;
  }
  return props;
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
  const inst = createVaporInstance(parent, appContext ?? parent?.appContext ?? null);
  const scope = new EffectScope(root);
  scopeOwner.set(scope, inst);
  componentOf.set(scope, inst);
  // the fallback unmount path (and the child-first collection of the main
  // one): fires whoever stops this scope
  scope.run(() => onScopeDispose(() => onInstanceDisposed(inst)));
  const props = makeProps(rawProps, comp);
  const slots = rawSlots ?? {};
  const ctx = {
    emit: (name: string, ...args: unknown[]) => {
      const handler = props[toHandlerKey(camelize(name))];
      if (typeof handler === 'function') (handler as (...a: unknown[]) => void)(...args);
    },
    slots,
    // the vite path's compiled setup destructures these (plugin-vue always
    // emits `{ expose: __expose }` for vapor); expose is a no-op — the own
    // runtime has no devtools instance to expose onto
    attrs: {},
    expose: () => {},
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
    scope.stop();
    throw e;
  }
  setCurrentVaporInstance(prevInst);
  withScope(scope, () => popAndApplyCssVars(block, (fn) => renderEffect(fn)));
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
  return typeof rawSlots === 'function' ? { default: rawSlots as () => unknown } : rawSlots;
}

export function createComponent(
  comp: unknown,
  rawProps?: Record<string, unknown>,
  rawSlots?: Slots | (() => unknown),
): Block {
  const slots = normalizeSlots(rawSlots);
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
  if (!interop) {
    throw new Error(
      '[fjs vapor] a VDOM component reached a pure-vapor app — the enableVapor web build ships no vdom machinery (specs/166). ' +
        'Import it in a vapor page of a non-enableVapor app, or drop enableVapor.',
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
  return createComponent(typeof comp === 'string' ? resolveComponent(comp) : comp, rawProps, rawSlots);
}

export function createDynamicComponent(
  getComp: () => unknown,
  rawProps?: Record<string, unknown>,
  rawSlots?: Slots,
): Block {
  // evaluated once: a true dynamic swap needs keyed-fragment plumbing that
  // no page in this repo uses yet
  return createComponentWithFallback(getComp(), rawProps, rawSlots);
}


// ---- slots ------------------------------------------------------------------------------

/** A slot position: renders the slot the parent passed, or the fallback
 * block. Slot content belongs to the CHILD's scope (it dies with the child)
 * but reads the parent's reactive state through the slot closure. */
export function createSlot(name = 'default', _rawProps?: unknown, fallback?: () => unknown): Block {
  const { parent, anchor } = takeInsertionState();
  const render = currentSlots?.[name] ?? fallback;
  if (!render) {
    if (!parent) return emptyBlock();
    const anchorHost = be().createAnchor('slot');
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

// the core's surface IS the compiled face — component layer adds the rest
export * from './host';
export type { Slots };
