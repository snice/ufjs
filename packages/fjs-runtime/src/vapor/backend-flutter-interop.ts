// VDOM components inside a Vapor tree on Flutter (specs/161 §3.2), split out
// of backend-flutter.ts by specs/169: this is the half of the backend that
// needs the Vue renderer (`render` / `h`), and the renderer module pins
// runtime-core's whole rendering engine. `fjs/vapor` (vapor/index.ts) loads
// it; the enableVapor surface (vapor/flutter-pure.ts) does not, so a pure
// vapor app ships without the engine — exactly like web's web-interop.ts.
import { EffectScope, effect, stop as stopRunner } from '@vue/reactivity';
import { childElementIds, elementById, nodeOps, patchProp, registerAdoptHook, type HostNode } from '../vue/host-ops';
import { queuePostFlushCb } from '@vue/runtime-core';
import { render } from '../vue/renderer';
import { KeepAlive, defineComponent, getCurrentInstance, h } from '../vue/vue-shim';
import { flutterBackend } from './backend-flutter';
import { blockOf, type Block, type Slots, type VaporBackend } from './runtime';
import { createMountHold, markVdomOwner, probePatch, runVdomKeepAliveHooks, vdomAppContext, vdomPublicInstance, type VdomMountContext } from './vdom-context';

let patchFn: ((...args: unknown[]) => void) | null = null;
const patchOf = (): ((...args: unknown[]) => void) =>
  (patchFn ??= probePatch(render as never, nodeOps.createElement('view'), { h, KeepAlive, defineComponent, getCurrentInstance } as never));

const mountVdomComponent: NonNullable<VaporBackend['mountVdomComponent']> = (comp, props, slots: Slots, parent, anchor, ctx) => {
    // vant et al: render through our own renderer into a detached container,
    // then keep the component's roots positioned at this spot of the vapor
    // tree. runtime-core COPIES a component's props into its own reactive
    // container at mount, so handing it the getter object directly would
    // snapshot the getters' current values and never see a change. Instead
    // THIS effect tracks every getter and re-renders with a plain snapshot —
    // the child's props diff then runs as it would under a VDOM parent.
    const container = nodeOps.createElement('view');
    // Vapor slots → the VDOM slot contract: each slot renders an
    // `fjs-vapor-slot` placeholder whose createElement fills the Vapor slot
    // block's hosts into a wrapper view (the adopt mechanism, generalized)
    const vdomSlots: Record<string, () => unknown> = {};
    for (const name in slots) {
      const renderSlot = slots[name];
      const id = ++slotSeq;
      slotRenders.set(id, renderSlot);
      vdomSlots[name] = () => {
        slotPending = id;
        // the VDOM component calling the slot (its render is running): the
        // parent a VDOM component inside the content injects from (specs/182)
        slotOwners.set(id, getCurrentInstance());
        return h('fjs-vapor-slot', { 'data-fjs-slot': String(id) });
      };
    }
    const reposition = (): void => {
      if (!parent) return;
      const ids = childElementIds(container.id);
      let cursor: unknown = anchor;
      for (let k = ids.length - 1; k >= 0; k--) {
        const child = elementById(ids[k]);
        if (child) {
          nodeOps.insert(child as never, parent as never, cursor as never);
          cursor = child;
        }
      }
    };
    let alive = true;
    const appContext = vdomAppContext(ctx as VdomMountContext | undefined);
    let lastVnode: unknown = null;
    (ctx as VdomMountContext | undefined)?.onKeepAlive?.((kind) => runVdomKeepAliveHooks(lastVnode, kind));
    // mounted hooks wait for the vapor tree to reach the page (specs/199)
    let hold = ctx?.afterMount ? createMountHold(queuePostFlushCb as never) : null;
    const held = hold;
    if (held) {
      const release = (): void => {
        if (!alive) return held.discard();
        held.release(() => render(lastVnode as never, container as never));
      };
      ctx!.afterMount!(release);
      // no vapor flush ever coming (a mount path that never calls it) must
      // not leave the hooks held for good
      void Promise.resolve().then(release);
    }
    const runner = effect(
      () => {
        const snapshot: Record<string, unknown> = {};
        for (const k in props) snapshot[k] = (props as Record<string, unknown>)[k];
        const vnode = h(comp as never, snapshot as never, vdomSlots as never);
        // inject() / global components reach the vapor side (specs/182)
        (vnode as { appContext: unknown }).appContext = appContext;
        // runtime-core puts a component vnode's scopeId on its root element
        if (ctx?.scopeId) (vnode as unknown as { scopeId: string }).scopeId = ctx.scopeId;
        if (hold) {
          // render() without its trailing flush: the post callbacks of the
          // first patch land in the hold, not the global queue
          patchOf()(null, vnode, container, null, null, hold.suspense);
          (container as unknown as { _vnode: unknown })._vnode = vnode;
          hold = null;
        } else {
          render(vnode, container as never);
        }
        lastVnode = vnode;
        reposition();
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
    const roots = childElementIds(container.id)
      .map((id) => elementById(id))
      .filter(Boolean) as unknown[];
    const block: Block = {
      nodes: roots,
      scopes: [],
      cleanups: [
        () => {
          alive = false;
          stopRunner(runner);
          // skipped when the vapor tree already dropped the subtree (an
          // enclosing block removal took it) — render(null) would then
          // remove ids the host has forgotten
          if (roots.every((r) => elementById((r as { id: number }).id) === undefined)) {
            nodeOps.remove(container);
          } else {
            render(null, container as never);
            nodeOps.remove(container);
          }
        },
      ],
    };
    // a template ref to this component holds its public instance
    (block as Block & { vdomRef?: () => unknown }).vdomRef = () => vdomPublicInstance(lastVnode);
    return block;
  };

// The VDOM interop effect re-runs outside any vapor component scope — it is
// disposed through its block's cleanup, not a vapor scope.
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

const slotRenders = new Map<number, () => unknown>();
const slotOwners = new Map<number, unknown>();
let slotSeq = 0;
/** set by the createElement call, consumed immediately after */
let slotPending: number | null = null;

registerAdoptHook({
  createElement(tag: string): HostNode | null {
    if (tag !== 'fjs-vapor-slot') return null;
    const id = slotPending;
    if (id === null) return null;
    slotPending = null;
    const renderSlot = slotRenders.get(id);
    const wrapper = nodeOps.createElement('view');
    // no box of its own: the slot content joins the VDOM parent's flex line
    // (vant's tabbar items stacked into a column inside it) — the web
    // bridge's `display: contents`, which the Flutter renderer now honours
    patchProp(wrapper as never, 'style', null, { display: 'contents' });
    if (renderSlot) {
      // the slot block belongs to the child's tree; dropping the wrapper
      // takes it with it (backend remove is a subtree walk)
      let block: Block;
      const scope = new EffectScope(true);
      markVdomOwner(scope, slotOwners.get(id));
      try {
        block = scope.run(() => blockOf(renderSlot()))!;
      } catch (e) {
        console.log(`[fjs vapor] slot render THREW: ${String(e)}`);
        block = { nodes: [] };
      }
      for (const node of block.nodes) nodeOps.insert(node as never, wrapper as never, null);
    }
    return wrapper;
  },
  isAdopted(_el: unknown): boolean {
    return false;
  },
});

flutterBackend.mountVdomComponent = mountVdomComponent;
