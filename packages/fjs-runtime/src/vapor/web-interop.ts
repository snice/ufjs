// The web VDOM interop (specs/166 split): a VDOM component mounted inside a
// Vapor tree (vant et al) and the compile-time wrapper's adopt path. Pulled
// out of web.ts so the pure-vapor surface (web-pure.ts, the enableVapor
// alias) carries neither this code nor the runtime-core renderer engine it
// is built on — a pure-vapor app cannot mount VDOM components, which is the
// documented trade for a bundle without any vdom machinery.
import { EffectScope, effect, shallowReactive, stop as stopRunner } from '@vue/reactivity';
import { getCurrentInstance, h, render } from 'vue';
import { blockOf, disposeBlock, mountVaporComponentForAdopt, nodesChanged, type Block, type VaporAppContext, type VaporBackend, type VaporComponent } from './runtime';
import { markVdomOwner, runVdomKeepAliveHooks, vdomAppContext, vdomPublicInstance, type VdomMountContext } from './vdom-context';
import { domBackend } from './web-dom';

// the VDOM interop effect re-runs outside any vapor component scope — it is
// disposed through its block's cleanup, not a vapor scope
interface VdomJob {
  run: () => void;
  alive: () => boolean;
}
const vdomQueue: VdomJob[] = [];
let vdomQueued = false;
function flushVdom(): void {
  vdomQueued = false;
  for (const { run, alive } of vdomQueue.splice(0)) {
    if (alive()) run();
  }
}

// ---- slot bridging (a Vapor slot into a VDOM component) -----------------------

/** A Vapor slot as a VDOM slot: the slot function returns one placeholder
 * element (`display: contents`, so the content joins the parent's flex line)
 * whose vnode hooks fill it with the slot block's hosts once it is in the
 * DOM and dispose the block when the VDOM drops it. Slot props (a scoped
 * slot) ride on the vnode; an update writes them into the block's reactive
 * copy instead of rebuilding the content. */
function bridgeSlot(renderSlot: (...args: unknown[]) => unknown): (props?: Record<string, unknown>) => unknown {
  type HookVNode = { el: Element | null };
  const live = new WeakMap<object, { scope: EffectScope; state: Record<string, unknown>; block: Block }>();
  // per placeholder vnode: its slot props and the VDOM component calling
  // the slot — kept off the vnode's props, which runtime-dom would write
  // onto the element as attributes
  const data = new WeakMap<object, { props: Record<string, unknown>; owner: unknown }>();
  return (props?: Record<string, unknown>) => {
    const vnode = h('fjs-vapor-slot', {
      style: 'display: contents',
      onVnodeMounted(raw: unknown) {
        const el = (raw as HookVNode).el;
        if (!el) return;
        const d = data.get(raw as object);
        const state = shallowReactive({ ...(d?.props ?? {}) });
        const scope = new EffectScope(true);
        markVdomOwner(scope, d?.owner);
        const block = scope.run(() => blockOf(renderSlot(state)))!;
        for (const node of block.nodes) el.appendChild(node as Node);
        live.set(el, { scope, state, block });
      },
      onVnodeUpdated(raw: unknown) {
        const el = (raw as HookVNode).el;
        const rec = el && live.get(el);
        const d = data.get(raw as object);
        if (rec && d) Object.assign(rec.state, d.props);
      },
      onVnodeBeforeUnmount(raw: unknown) {
        const el = (raw as HookVNode).el;
        const rec = el && live.get(el);
        if (!rec) return;
        live.delete(el!);
        disposeBlock(rec.block);
        rec.scope.stop();
      },
    });
    // the slot is called from the VDOM component's render
    data.set(vnode, { props: props ?? {}, owner: getCurrentInstance() });
    return vnode;
  };
}

/** The component's top-level hosts: down through components whose root is
 * another component (vant's ActionSheet renders a Popup), then the root
 * element, or a fragment's / teleport's span from its start to its end
 * anchor. A root-level mount (no insertion point) is placed by the vapor
 * side from exactly this list — a node missing here stays in the detached
 * container. */
function rootsOf(vnode: unknown): Node[] {
  type V = { component?: { subTree?: V } | null; el?: Node | null; anchor?: Node | null };
  let v = vnode as V | undefined;
  while (v?.component?.subTree) v = v.component.subTree;
  const el = v?.el ?? null;
  if (!el) return [];
  const end = v?.anchor ?? null;
  if (!end || end === el) return [el];
  const out: Node[] = [];
  for (let n: Node | null = el; n; n = n.nextSibling) {
    out.push(n);
    if (n === end) break;
  }
  return out;
}

/** the backend's mountVdomComponent — assigned onto [domBackend] below */
const mountVdomComponent: VaporBackend['mountVdomComponent'] = (comp, props, slots, parent, anchor, ctx) => {
    // vant et al on web: runtime-dom's own renderer (specs/182 — it used to
    // be a reduced createRenderer whose patchProp stringified style objects
    // and knew no DOM props), into a detached container whose children are
    // then kept at this spot of the vapor tree. runtime-core copies props
    // into its own container at mount, so this effect tracks every getter
    // and re-renders with a plain snapshot — the child's props diff runs as
    // under a VDOM parent.
    const container = document.createElement('div');
    const reposition = (): void => {
      if (!parent) return;
      let cursor: Node | null = (anchor ?? null) as Node | null;
      const kids = [...container.childNodes];
      for (let i = kids.length - 1; i >= 0; i--) {
        (parent as Node).insertBefore(kids[i], cursor);
        cursor = kids[i];
      }
    };
    const vdomSlots: Record<string, unknown> = {};
    for (const name in slots) vdomSlots[name] = bridgeSlot(slots[name]);
    const appContext = vdomAppContext(ctx as VdomMountContext | undefined);
    let lastVnode: unknown = null;
    (ctx as VdomMountContext | undefined)?.onKeepAlive?.((kind) => runVdomKeepAliveHooks(lastVnode, kind));
    let alive = true;
    const roots: unknown[] = [];
    const runner = effect(
      () => {
        const snapshot: Record<string, unknown> = {};
        for (const k in props) snapshot[k] = (props as Record<string, unknown>)[k];
        const vnode = h(comp as never, snapshot as never, vdomSlots as never);
        // inject() / global components reach the vapor side (specs/182)
        (vnode as unknown as { appContext: unknown }).appContext = appContext;
        // runtime-core puts a component vnode's scopeId on its root element
        if (ctx?.scopeId) (vnode as unknown as { scopeId: string }).scopeId = ctx.scopeId;
        render(vnode, container);
        lastVnode = vnode;
        // the first render lands in the container; later patches happen in
        // place, wherever the roots are
        reposition();
        const now = rootsOf(vnode);
        if (now.length !== roots.length || now.some((n, i) => n !== roots[i])) {
          roots.splice(0, roots.length, ...now);
          nodesChanged(roots);
        }
      },
      {
        scheduler: () => {
          vdomQueue.push({ run: () => runner(), alive: () => alive });
          if (!vdomQueued) {
            vdomQueued = true;
            void Promise.resolve().then(flushVdom);
          }
        },
      },
    );
    const block: Block = {
      nodes: roots,
      scopes: [],
      cleanups: [
        () => {
          alive = false;
          stopRunner(runner);
          // unmount through the renderer either way: the component's
          // unmount hooks run, and its hosts leave their parent, wherever
          // the vapor tree put them
          render(null, container);
        },
      ],
    };
    // a template ref to this component holds its public instance
    (block as Block & { vdomRef?: () => unknown }).vdomRef = () => vdomPublicInstance(lastVnode);
    return block;
};

domBackend.mountVdomComponent = mountVdomComponent as NonNullable<VaporBackend['mountVdomComponent']>;

// ---- adoption (a VDOM page embedding a Vapor component on web) ----------------
/** Same contract as the Flutter interop: the generated wrapper mounts the
 * block here, renders an `fjs-vapor-root` placeholder (an unknown element
 * carrying `display: contents`, so the vapor children join the parent's
 * flex line directly), and on mount the block's nodes are appended under
 * it. Host removal is the VDOM's — it owns the placeholder. */
interface WebAdopt {
  block: Block;
  el: HTMLElement | null;
  /** the adopted tree's mounted hooks (specs/167), run once it is in */
  mounted: () => void;
}

const adopts = new Map<number, WebAdopt>();
let adoptSeq = 0;

export function adoptVaporComponent(
  comp: VaporComponent,
  props: Record<string, unknown> | undefined,
  appContext: VaporAppContext | null,
): { id: number } {
  const { block, mounted } = mountVaporComponentForAdopt(comp, props, appContext);
  const id = ++adoptSeq;
  adopts.set(id, { block, el: null, mounted });
  return { id };
}

/** The wrapper's commit-time ref: [target] is the placeholder element (web);
 * an instance object also works (older call shape). Re-fires are no-ops —
 * the nodes are already under the placeholder. */
export function mountAdoptNodes(id: number, target: unknown): void {
  const adopt = adopts.get(id);
  if (!adopt) return;
  const el = target instanceof Element
    ? (target as HTMLElement)
    : (((target as { proxy?: { $el?: HTMLElement } } | undefined)?.proxy?.$el ?? null) as HTMLElement | null);
  if (!el) throw new Error('[fjs vapor] vapor-root placeholder did not mount');
  const first = adopt.block.nodes[0] as Node | undefined;
  if (first && first.parentNode === el) return;
  adopt.el = el;
  for (const node of adopt.block.nodes) el.appendChild(node as Node);
  adopt.mounted();
}

export function releaseAdopt(id: number): void {
  const adopt = adopts.get(id);
  if (!adopt) return;
  adopts.delete(id);
  disposeBlock(adopt.block);
}
