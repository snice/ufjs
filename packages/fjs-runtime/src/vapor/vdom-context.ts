// The app context a VDOM subtree mounted inside a vapor tree runs under
// (specs/182). runtime-core gives a root vnode's component `vnode.appContext`
// and seeds its provides from `appContext.provides` — so handing it the vapor
// parent's provides is what lets vant's (or any VDOM component's) inject()
// see what a vapor ancestor or the app provided (pinia, the router), and
// `components` / `directives` are the app's registrations (a library that
// resolves its own children by name). Built by hand: the Flutter 'vue' has
// no createApp, and a real app here would be a second app to install into.
import { getCurrentScope, proxyRefs, type EffectScope } from '@vue/reactivity';
import type { VaporAppContext } from './instance';

/** What a VDOM component instance offers its descendants: its provides and
 * its app context. Structural — the two backends' renderers share it. */
interface VdomOwner {
  provides: Record<string | symbol, unknown>;
  appContext?: { components?: Record<string, unknown>; directives?: Record<string, unknown> } | null;
}

// ---- VDOM owner of bridged slot content ----------------------------------------------
//
// `<van-grid><van-grid-item/></van-grid>` in a vapor template: the grid
// mounts through the interop, its default slot is vapor content, and the
// item inside mounts through the interop AGAIN — a separate VDOM root with no
// parent, so vant's useParent (inject of the grid's link) found nothing:
// "<GridItem> must be a child component of <Grid>". The slot bridge marks the
// scope it renders the vapor content in with the VDOM component rendering
// that slot; a VDOM component mounted anywhere under it — now, or later by a
// v-if / v-for inside — takes that owner's provides.

const vdomOwners = new WeakMap<object, VdomOwner>();

export function markVdomOwner(scope: EffectScope, owner: unknown): void {
  if (owner && typeof owner === 'object' && (owner as VdomOwner).provides) vdomOwners.set(scope, owner as VdomOwner);
}

/** The nearest bridged-slot owner above the running code's scope. */
function vdomOwner(): VdomOwner | null {
  for (let s = getCurrentScope() as (EffectScope & { parent?: EffectScope }) | undefined; s; s = s.parent) {
    const o = vdomOwners.get(s);
    if (o) return o;
  }
  return null;
}

export interface VdomMountContext {
  provides?: Record<string | symbol, unknown> | null;
  appContext?: VaporAppContext | null;
  onKeepAlive?: (run: (kind: 'a' | 'da') => void) => void;
}

/** Runs the activated ('a') / deactivated ('da') hooks of every component
 * instance in a mounted VDOM subtree — what runtime-core's KeepAlive does
 * for its own children, for a subtree whose keeper is on the vapor side. */
export function runVdomKeepAliveHooks(vnode: unknown, kind: 'a' | 'da'): void {
  type I = { a?: (() => void)[] | null; da?: (() => void)[] | null; subTree?: V };
  type V = { component?: I | null; children?: unknown; dynamicChildren?: unknown } | null | undefined;
  const walk = (v: V): void => {
    if (!v || typeof v !== 'object') return;
    const inst = v.component;
    if (inst) {
      walk(inst.subTree);
      for (const hook of inst[kind] ?? []) hook();
      return;
    }
    if (Array.isArray(v.children)) for (const c of v.children) walk(c as V);
  };
  walk(vnode as V);
}

const config = {
  isNativeTag: () => false,
  performance: false,
  globalProperties: {} as Record<string, unknown>,
  optionMergeStrategies: {} as Record<string, unknown>,
  errorHandler: undefined,
  warnHandler: undefined,
  compilerOptions: {},
};
const app = { version: '3-vapor-interop', config };

const cache = new WeakMap<object, unknown>();

export function vdomAppContext(ctx: VdomMountContext | undefined): unknown {
  // inside a VDOM component's slot: that component is the parent to inject
  // from (its provides chain on to the vapor side it was mounted from)
  const owner = vdomOwner();
  if (owner) {
    ctx = {
      provides: owner.provides,
      appContext: { components: owner.appContext?.components ?? ctx?.appContext?.components ?? {}, directives: owner.appContext?.directives ?? ctx?.appContext?.directives },
    };
  }
  if (!ctx || (!ctx.provides && !ctx.appContext)) return null;
  const key = (ctx.provides ?? ctx.appContext) as object;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = {
    app,
    config,
    mixins: [],
    components: ctx.appContext?.components ?? {},
    directives: ctx.appContext?.directives ?? {},
    provides: ctx.provides ?? ctx.appContext?.provides ?? Object.create(null),
    optionsCache: new WeakMap(),
    propsCache: new WeakMap(),
    emitsCache: new WeakMap(),
  };
  cache.set(key, made);
  return made;
}

/** What a template ref to a VDOM component holds — runtime-core's
 * getComponentPublicInstance: its expose()d object (with `$el` & co. still
 * reachable), else its public proxy. A vapor page doing
 * `page.value.$el.getBoundingClientRect()` on a `<scroll-view ref="page">`
 * got the interop's block instead (specs/181 follow-up: vant Sticky offsets). */
export function vdomPublicInstance(vnode: unknown): unknown {
  type I = { exposed?: Record<string, unknown> | null; exposeProxy?: unknown; proxy?: Record<string | symbol, unknown> | null };
  const inst = (vnode as { component?: I | null } | null)?.component;
  if (!inst) return null;
  if (!inst.exposed) return inst.proxy ?? null;
  if (!inst.exposeProxy) {
    const exposed = proxyRefs(inst.exposed) as Record<string | symbol, unknown>;
    inst.exposeProxy = new Proxy(exposed, {
      get: (target, key) => (key in target ? target[key] : typeof key === 'string' && key.startsWith('$') ? inst.proxy?.[key] : undefined),
      has: (target, key) => key in target || (typeof key === 'string' && key.startsWith('$') && !!inst.proxy && key in inst.proxy),
    });
  }
  return inst.exposeProxy;
}

