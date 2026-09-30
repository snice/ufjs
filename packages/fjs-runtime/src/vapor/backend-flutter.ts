// The Flutter Vapor backend (specs/161): the node primitives over the fjs
// renderer's nodeOps / patchProp — writes cross to Dart in op frames, and a
// template instance is native-cloned by libfjs-style when it can be
// (specs/152), falling back to node-by-node createElement otherwise.
import { effect, stop as stopRunner, type ReactiveEffectRunner } from '@vue/reactivity';
import type { HostNode } from '../vue/renderer';
import {
  childElementIds,
  cloneReady,
  cloneTemplate,
  elementById,
  nodeOps,
  patchProp,
  prepareClone,
  registerAdoptHook,
  render,
  type CloneNode,
  type ClonePlan,
} from '../vue/renderer';
import { h } from '../vue/vue-shim';
import {
  blockOf,
  type Block,
  type TemplateDef,
  type VaporBackend,
  setVaporBackend,
} from './runtime';

/** The clone plan is a pure function of the parse — compute it once per
 * template, not once per instance. `defToPlan` maps def node indices onto
 * plan indices (folded text nodes are not in the plan at all). */
interface PlanEntry {
  plan: ClonePlan | null;
  defToPlan: Map<number, number>;
}

const plans = new WeakMap<TemplateDef, PlanEntry>();

function planOf(def: TemplateDef): PlanEntry {
  let entry = plans.get(def);
  if (entry === undefined) {
    const nodes: CloneNode[] = [];
    const defToPlan = new Map<number, number>();
    for (let k = 1; k < def.nodes.length; k++) {
      const n = def.nodes[k];
      if (n.kind === 'folded') continue;
      defToPlan.set(k, nodes.length);
      if (n.kind === 'element') {
        nodes.push({ kind: 'element', parent: 0, tag: n.tag, classes: n.classes, scope: n.scope, text: n.inline && n.raw.trim() !== '' ? n.raw : '', inline: n.inline ? n.raw : null });
      } else if (n.kind === 'text') {
        nodes.push({ kind: 'text', parent: 0, tag: 'text', classes: null, scope: null, text: n.raw, inline: null });
      } else {
        nodes.push({ kind: 'anchor', parent: 0, tag: 'view', classes: null, scope: null, text: n.raw, inline: null });
      }
    }
    for (let k = 1; k < def.nodes.length; k++) {
      const n = def.nodes[k];
      const at = defToPlan.get(k);
      if (at === undefined) continue;
      // def parent 0 is the virtual root = the plan's own root (-1); every
      // real parent maps onto its plan index
      const parentPlan = defToPlan.get(n.parent);
      nodes[at].parent = parentPlan === undefined ? -1 : parentPlan;
    }
    const plan = prepareClone(nodes);
    entry = { plan, defToPlan };
    plans.set(def, entry);
  }
  return entry;
}

/** Node-by-node instantiation when the native clone is unavailable (TS style
 * engine, a rejected frame, a tag the plan cannot carry). Same end state as
 * cloneTemplate: hosts in template order, template root unattached. */
function instantiateFallback(def: TemplateDef, hosts: unknown[]): void {
  const { nodes } = def;
  for (let k = 1; k < nodes.length; k++) {
    const n = nodes[k];
    if (n.kind === 'folded') {
      hosts[k] = undefined;
      continue;
    }
    let host: unknown;
    if (n.kind === 'element') {
      host = nodeOps.createElement(n.tag);
      if (n.classes !== null) patchProp(host as never, 'class', null, n.classes);
      if (n.scope !== null) nodeOps.setScopeId?.(host as never, n.scope);
      if (n.inline && n.raw.trim() !== '') nodeOps.setElementText(host as never, n.raw);
    } else if (n.kind === 'text') {
      host = nodeOps.createText(n.raw);
    } else {
      host = nodeOps.createComment(n.raw);
    }
    hosts[k] = host;
    if (n.parent > 0) nodeOps.insert(host as never, hosts[n.parent] as never, null as never);
  }
}

setVaporBackend({
  instantiate(def, hosts, _html) {
    const g = globalThis as { __inst?: number };
    g.__inst = (g.__inst ?? 0) + 1;
    const { plan, defToPlan } = planOf(def);
    if (plan !== null && cloneReady()) {
      // libfjs-style expands the clone and returns the hosts in PLAN order,
      // root unattached (specs/152) — remap onto def index space for the
      // walkers
      const out = cloneTemplate(plan);
      hosts[0] = undefined;
      for (const [defIdx, planIdx] of defToPlan) hosts[defIdx] = out[planIdx];
      return;
    }
    instantiateFallback(def, hosts);
  },

  instantiateBareText(text) {
    return nodeOps.createText(text);
  },


  createAnchor(label) {
    void label;
    return nodeOps.createComment('');
  },

  attach(host, parent, anchor) {
    nodeOps.insert(host as never, parent as never, anchor as never);
  },

  childAt(parent, index) {
    const id = childElementIds((parent as { id: number }).id)[index];
    return id == null ? null : elementById(id) ?? null;
  },

  remove(host) {
    nodeOps.remove(host as never);
  },

  setElementText(host, text) {
    nodeOps.setElementText(host as never, text);
  },

  setText(host, text) {
    nodeOps.setText(host as never, text);
  },

  setClasses(host, value) {
    patchProp(host as never, 'class', null, value);
  },

  patchStyle(host, prev, next) {
    patchProp(host as never, 'style', prev, next);
  },

  setAttr(host, key, value) {
    if (value === '' && key.startsWith('data-v-')) {
      nodeOps.setScopeId?.(host as never, key);
      return;
    }
    patchProp(host as never, key, null, value);
  },

  on(host, key, handler) {
    patchProp(host as never, key, null, handler);
  },

  off(host, key) {
    patchProp(host as never, key, null, null);
  },


  mountVdomComponent(comp, props, slots, parent, anchor) {
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
  },
});

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
