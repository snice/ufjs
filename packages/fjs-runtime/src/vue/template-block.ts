// Native template clones on the VDOM path (specs/153).
//
// The Flutter build's template compiler (@ufjs/cli template/clone-blocks)
// finds the largest subtrees whose structure and classes are static and whose
// only dynamic parts are text — flat-4050's `view.cell > text.tiny{{ i }}` —
// and turns each into ONE vnode of the type made here, carrying its dynamic
// texts (`t`). runtime-core hands a vnode whose type says `__isTeleport` to
// the type's own process / move / remove instead of mountElement, so the
// subtree costs one vnode, and — when libfjs-style is attached — one CLONE
// word plus the text writes (specs/152's prepareClone / cloneTemplate).
// Otherwise it is built node by node through the same host calls, in the
// order mountElement makes them, so the result is the same either way.
//
// The Teleport protocol is runtime-core's (the `shapeFlag & 64` branches);
// test/template-block.test.ts pins what this module relies on.
import type { VNode } from '@vue/runtime-core';
import {
  cloneReady,
  cloneTemplate,
  nodeOps,
  patchProp,
  prepareClone,
  type ClonePlan,
  type CloneNode,
} from './renderer';
import type { Element as HostNode } from '../ui/element';

/** One node as the compiler writes it, in pre-order:
 * [parent index (-1 for the root), tag, class or null, static text or null
 * when the text is dynamic]. An element without text has ''. */
export type TemplateNode = [number, string, string | null, string | null];

export interface TemplateBlockType {
  __isTeleport: true;
  name: string;
  nodes: TemplateNode[];
  /** Dynamic text slots: node indexes, in the order of `t`. */
  slots: number[];
  /** Prepared clone per scope id (a template belongs to one SFC, so in
   * practice one entry); null = cannot be cloned, build node by node. */
  plans: Map<string | null, ClonePlan | null>;
  process: (...a: any[]) => void;
  move: (...a: any[]) => void;
  remove: (...a: any[]) => void;
}

interface Props {
  t?: string | string[];
}

const textAt = (t: Props['t'], k: number): string =>
  typeof t === 'string' ? t : t![k];

function planFor(type: TemplateBlockType, scope: string | null): ClonePlan | null {
  let plan = type.plans.get(scope);
  if (plan === undefined) {
    const nodes: CloneNode[] = type.nodes.map(([parent, tag, classes, text]) => ({
      kind: 'element',
      parent,
      tag,
      classes,
      scope,
      text: text ?? '',
      inline: null,
    }));
    plan = prepareClone(nodes);
    type.plans.set(scope, plan);
  }
  return plan;
}

/** The hosts of the dynamic slots, kept on the vnode (`target`, a Teleport
 * field cloneVNode carries over) so an update writes only those. */
function mount(type: TemplateBlockType, vnode: VNode, container: HostNode, anchor: HostNode | null, slotScopeIds: string[] | null): void {
  const t = (vnode.props as Props | null)?.t;
  const scope = vnode.scopeId;
  const slots = type.slots;
  const dyn: HostNode[] = new Array(slots.length);
  let root: HostNode;
  const plan = !slotScopeIds?.length && cloneReady() ? planFor(type, scope) : null;
  if (plan !== null) {
    const hosts = cloneTemplate(plan);
    root = hosts[0];
    for (let k = 0; k < slots.length; k++) {
      const el = hosts[slots[k]];
      dyn[k] = el;
      nodeOps.setElementText(el, textAt(t, k));
    }
  } else {
    root = build(type, 0, scope, slotScopeIds, t, dyn);
  }
  vnode.el = root;
  (vnode as unknown as { target: unknown }).target = dyn;
  nodeOps.insert(root, container, anchor);
}

/** Node `i` and its subtree as mountElement makes them: create, text or
 * children (each inserted), scope ids, class; the caller inserts it. */
function build(
  type: TemplateBlockType,
  i: number,
  scope: string | null,
  slotScopeIds: string[] | null,
  t: Props['t'],
  dyn: HostNode[],
): HostNode {
  const [, tag, classes, text] = type.nodes[i];
  const el = nodeOps.createElement(tag, undefined, undefined, null);
  if (text === null) {
    const k = type.slots.indexOf(i);
    dyn[k] = el;
    nodeOps.setElementText(el, textAt(t, k));
  } else if (text !== '') {
    nodeOps.setElementText(el, text);
  } else {
    const nodes = type.nodes;
    for (let c = i + 1; c < nodes.length; c++) {
      if (nodes[c][0] === i) nodeOps.insert(build(type, c, scope, slotScopeIds, t, dyn), el, null);
    }
  }
  if (scope) nodeOps.setScopeId!(el, scope);
  if (slotScopeIds) for (const s of slotScopeIds) nodeOps.setScopeId!(el, s);
  if (classes !== null) patchProp(el, 'class', null, classes);
  return el;
}

function process(
  this: void,
  n1: VNode | null,
  n2: VNode,
  container: HostNode,
  anchor: HostNode | null,
  _parentComponent: unknown,
  _parentSuspense: unknown,
  _namespace: unknown,
  slotScopeIds: string[] | null,
): void {
  const type = n2.type as unknown as TemplateBlockType;
  if (n1 === null) {
    mount(type, n2, container, anchor, slotScopeIds);
    return;
  }
  n2.el = n1.el;
  const dyn = (n1 as unknown as { target: HostNode[] }).target;
  (n2 as unknown as { target: unknown }).target = dyn;
  const a = (n1.props as Props | null)?.t;
  const b = (n2.props as Props | null)?.t;
  if (a === b) return;
  for (let k = 0; k < dyn.length; k++) {
    const next = textAt(b, k);
    if (textAt(a, k) !== next) nodeOps.setElementText(dyn[k], next);
  }
}

function move(vnode: VNode, container: HostNode, anchor: HostNode | null): void {
  nodeOps.insert(vnode.el as HostNode, container, anchor);
}

/** The renderer's remove takes the whole subtree's bookkeeping with the
 * root; under a removed ancestor (doRemove false) there is nothing to do. */
function remove(vnode: VNode, _parentComponent: unknown, _parentSuspense: unknown, _internals: unknown, doRemove: boolean): void {
  if (doRemove) nodeOps.remove(vnode.el as HostNode);
}

/** Called once per template, from the hoisted module scope of a compiled
 * render function. */
export function fjsTemplate(nodes: TemplateNode[]): TemplateBlockType {
  const slots: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (nodes[i][3] === null) slots.push(i);
  return {
    __isTeleport: true,
    name: 'FjsTemplate',
    nodes,
    slots,
    plans: new Map(),
    process,
    move,
    remove,
  };
}
