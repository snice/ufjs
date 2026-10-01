// VDOM components inside a Vapor tree on Flutter (specs/161 §3.2), split out
// of backend-flutter.ts by specs/169: this is the half of the backend that
// needs the Vue renderer (`render` / `h`), and the renderer module pins
// runtime-core's whole rendering engine. `fjs/vapor` (vapor/index.ts) loads
// it; the enableVapor surface (vapor/flutter-pure.ts) does not, so a pure
// vapor app ships without the engine — exactly like web's web-interop.ts.
import { effect, stop as stopRunner } from '@vue/reactivity';
import { childElementIds, elementById, nodeOps, registerAdoptHook, type HostNode } from '../vue/host-ops';
import { render } from '../vue/renderer';
import { h } from '../vue/vue-shim';
import { flutterBackend } from './backend-flutter';
import { blockOf, type Block, type Slots, type VaporBackend } from './runtime';

const mountVdomComponent: NonNullable<VaporBackend['mountVdomComponent']> = (comp, props, slots: Slots, parent, anchor) => {
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
    const runner = effect(
      () => {
        const snapshot: Record<string, unknown> = {};
        for (const k in props) snapshot[k] = (props as Record<string, unknown>)[k];
        render(h(comp as never, snapshot as never, vdomSlots as never), container as never);
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
    if (renderSlot) {
      // the slot block belongs to the child's tree; dropping the wrapper
      // takes it with it (backend remove is a subtree walk)
      let block: Block;
      try {
        block = blockOf(renderSlot());
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
