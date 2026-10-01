// The Flutter Vapor backend (specs/161): the node primitives over the fjs
// renderer's nodeOps / patchProp — writes cross to Dart in op frames, and a
// template instance is native-cloned by libfjs-style when it can be
// (specs/152), falling back to node-by-node createElement otherwise.
import { effect, stop as stopRunner, type ReactiveEffectRunner } from '@vue/reactivity';
import type { HostNode } from '../vue/host-ops';
import {
  childElementIds,
  cloneListMany,
  cloneReady,
  cloneTemplate,
  cloneTemplateMany,
  elementById,
  nodeOps,
  patchProp,
  prepareClone,
  styleEngine,
  type CloneNode,
  type ClonePlan,
} from '../vue/host-ops';
import {
  blockOf,
  __zoneEnter,
  __zoneExit,
  insertZoneName,
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

/** The backend object (specs/169): `backend-flutter-interop.ts` assigns
 * `mountVdomComponent` onto it — the pure-vapor surface never loads that
 * module, so the VDOM renderer stays out of its bundle. */
export const flutterBackend: VaporBackend = {
  instantiate(def, hosts, _html) {
    const profiling = (globalThis as { __fjsVaporProfOn?: boolean }).__fjsVaporProfOn === true;
    if (profiling) __zoneEnter('plan');
    const { plan, defToPlan } = planOf(def);
    if (profiling) __zoneExit('plan');
    if (plan !== null && cloneReady()) {
      // libfjs-style expands the clone and returns the hosts in PLAN order,
      // root unattached (specs/152) — remap onto def index space for the
      // walkers
      const out = cloneTemplate(plan);
      hosts[0] = undefined;
      if (profiling) __zoneEnter('remap');
      for (const [defIdx, planIdx] of defToPlan) hosts[defIdx] = out[planIdx];
      if (profiling) __zoneExit('remap');
      return;
    }
    if (profiling) __zoneEnter('fallback');
    instantiateFallback(def, hosts);
    if (profiling) __zoneExit('fallback');
  },

  instantiateMany(def, count, html) {
    if (count === 0) return [];
    const { plan, defToPlan } = planOf(def);
    if (plan !== null && cloneReady()) {
      const copies = cloneTemplateMany(plan, count);
      const all: unknown[][] = new Array(count);
      for (let i = 0; i < count; i++) {
        const hosts: unknown[] = [];
        hosts[0] = undefined;
        for (const [defIdx, planIdx] of defToPlan) hosts[defIdx] = copies[i][planIdx];
        all[i] = hosts;
      }
      return all;
    }
    const all: unknown[][] = new Array(count);
    for (let i = 0; i < count; i++) {
      const hosts: unknown[] = [];
      instantiateFallback(def, hosts);
      all[i] = hosts;
    }
    void html;
    return all;
  },

  // specs/162: the whole list in one CLONE_MANY op. textIdx is a def index;
  // the op speaks plan indices, so a folded text node (not in the plan)
  // means this def cannot batch — null sends the caller down the per-cell
  // path. The parent/anchor are passed through as is: the engine resolves
  // the anchor's index at the end of the frame, so they may be created by
  // later ops of the same mount.
  cloneList(def, count, parent, anchor, textIdx, texts, html) {
    void html;
    if (count === 0) return [];
    const { plan, defToPlan } = planOf(def);
    if (plan === null || !cloneReady()) return null;
    let textPlanIdx: number | null = null;
    if (textIdx !== null) {
      const mapped = defToPlan.get(textIdx);
      if (mapped === undefined) return null;
      textPlanIdx = mapped;
    }
    const copies = cloneListMany(plan, count, parent as HostNode, (anchor ?? null) as HostNode | null, textPlanIdx, texts);
    const all: unknown[][] = new Array(count);
    for (let i = 0; i < count; i++) {
      const hosts: unknown[] = [];
      hosts[0] = undefined;
      for (const [defIdx, planIdx] of defToPlan) hosts[defIdx] = copies[i][planIdx];
      all[i] = hosts;
    }
    return all;
  },

  instantiateBareText(text) {
    return nodeOps.createText(text);
  },


  createAnchor(label) {
    void label;
    return nodeOps.createComment('');
  },

  attach(host, parent, anchor) {
    if ((globalThis as { __fjsVaporProfOn?: boolean }).__fjsVaporProfOn === true) {
      const z = insertZoneName();
      __zoneEnter(z);
      nodeOps.insert(host as never, parent as never, anchor as never);
      __zoneExit(z);
      return;
    }
    nodeOps.insert(host as never, parent as never, anchor as never);
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


  // <style> v-bind() on a Vapor component (specs/166): the vars ride the
  // style engine's inline-custom-props channel — the same one the VDOM
  // useCssVars feeds — so inheritance down the subtree is the engine's job
  setCssVars(host, vars) {
    const id = (host as { id?: number }).id;
    if (typeof id === 'number') styleEngine.setInlineCustomProps(id, vars);
  },
};

setVaporBackend(flutterBackend);


