// `fjs/vapor` — the VUE BINDING of the host contract (specs/163). The
// framework-neutral core lives in ./host; this module injects @vue/reactivity
// as its HostReactivity and adds the Vue-shaped component layer
// (createComponent / props / slots / defineVaporComponent / createVaporApp).
// Compiled SFCs import this via the CLI's `vue` → `fjs/vapor` rewrite; the
// export surface equals the core's plus the component layer.
import { EffectScope, effect, shallowRef, stop as stopRunner } from '@vue/reactivity';
import { camelize, toHandlerKey } from '@vue/shared';
import {
  be,
  blockOf,
  emptyBlock,
  insertBlock,
  removeBlock,
  setHostReactivity,
  takeInsertionState,
  withScope as hostWithScope,
  type Block,
  type HostNode,
  type Slots,
} from './host';

// the reactivity seam, bound before any helper can run (module init)
setHostReactivity({
  createScope: () => new EffectScope(),
  runInScope: <T,>(scope: EffectScope, fn: () => T) => scope.run(fn) as T,
  stopScope: (scope: EffectScope) => scope.stop(),
  effect: (fn, opts) => effect(fn, opts),
  stopEffect: (runner) => stopRunner(runner as Parameters<typeof stopRunner>[0]),
  box: <T,>(value: T) => shallowRef(value),
});

// ---- component context -------------------------------------------------------------------

/** Where a component resolves its global components (`<van-switch>` compiles
 * to resolveComponent): the mounting VDOM app's context, handed down by the
 * compile-time wrapper. A pure Vapor app has none — it imports everything. */
export interface VaporAppContext {
  components: Record<string, unknown>;
}
let currentAppContext: VaporAppContext | null = null;
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
  setup?: (props: Record<string, unknown>, ctx: { emit: (name: string, ...args: unknown[]) => void; slots: Slots }) => unknown;
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

export function resolveComponent(name: string): unknown {
  const resolved = currentAppContext?.components[name];
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
): Block {
  const scope = new EffectScope();
  const props = makeProps(rawProps, comp);
  const slots = rawSlots ?? {};
  const ctx = {
    emit: (name: string, ...args: unknown[]) => {
      const handler = props[toHandlerKey(camelize(name))];
      if (typeof handler === 'function') (handler as (...a: unknown[]) => void)(...args);
    },
    slots,
  };
  const savedContext = currentAppContext;
  currentAppContext = appContext;
  let block: Block;
  try {
    block = withScope(scope, () => blockOf(comp.setup?.(props, ctx) ?? emptyBlock()), slots);
  } finally {
    currentAppContext = savedContext;
  }
  if (!block.scopes) block.scopes = [];
  block.scopes.push(scope);
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
    const block = mountVaporComponent(comp, rawProps, slots, currentAppContext);
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
  return be().mountVdomComponent(comp as Record<string, unknown>, props, slots, parent, anchor);
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

/** Mounts a Vapor component as the root of a Vapor app (bench, tests): the
 * block lands in [container]; unmount tears everything down. */
export function createVaporApp(comp: VaporComponent, appContext: VaporAppContext | null = null): {
  mount: (container: HostNode) => void;
  unmount: () => void;
} {
  const scope = new EffectScope();
  const savedContext = currentAppContext;
  currentAppContext = appContext;
  let block: Block | null = null;
  try {
    block = withScope(scope, () => blockOf(comp.setup?.({}, { emit: () => {}, slots: {} })));
  } finally {
    currentAppContext = savedContext;
  }
  return {
    mount: (container: HostNode) => insertBlock(block as Block, container, null),
    unmount: () => {
      if (block) removeBlock(block);
      scope.stop();
      block = null;
    },
  };
}

/** The compile-time wrapper's entry (VDOM page embedding a Vapor component,
 * specs/161 §3.2): the block is built but NOT inserted — the wrapper's
 * placeholder host adopts it, and unmount() tears it down. */
export function mountVaporComponentForAdopt(
  comp: VaporComponent,
  rawProps: Record<string, unknown> | undefined,
  appContext: VaporAppContext | null,
): { block: Block; unmount: () => void } {
  const block = mountVaporComponent(comp, rawProps, undefined, appContext);
  return {
    block,
    unmount: () => removeBlock(block),
  };
}

// the core's surface IS the compiled face — component layer adds the rest
export * from './host';
export type { Slots };
