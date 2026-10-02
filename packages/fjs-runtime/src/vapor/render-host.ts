// render-host (specs/171): runs RENDER-FUNCTION components — `setup()`
// returning `() => h(tag, props, children)` — inside a pure-vapor app, where
// runtime-core's renderer does not exist (specs/166/169 keep it out).
//
// Why this exists: fjs's own controls are written that way, once, and serve
// both ends: the web adapter's tags (input / image / scroll-view / swiper /
// switch / picker-view / form …) and the built-in components (list-view /
// form / picker / textarea / canvas / rich-text / defer). A vapor rewrite of
// each would be ~37 second implementations to keep in step; this host runs
// the one implementation instead (the user picked this route, specs/171).
//
// What it is NOT: a general Vue renderer. It serves the subset those
// components use — elements, text, comments, fragments, nested components
// (vapor ones go through the vapor runtime, render-function ones recurse),
// Teleport, keyed / positional children, refs, slots, attrs fallthrough,
// onBeforeUpdate / onUpdated. Anything else (Suspense, KeepAlive, VDOM
// directives) is reported, not guessed. A third-party VDOM library (vant)
// still needs the real renderer: a non-enableVapor app keeps the interop.
//
// The update model is the VDOM one — the render function re-runs in a
// renderEffect and the new tree is compared with the last — because that is
// how these components are written. They are leaf controls with a handful
// of nodes each; the vapor fine-grained path stays for page templates.
import { EffectScope, getCurrentScope, isRef, shallowReactive, shallowRef, type Ref } from '@vue/reactivity';
import { cloneVNode, Comment, createVNode, Fragment, isVNode, Teleport, Text, type VNode } from '@vue/runtime-core';
import { isArray } from '@vue/shared';
import { patchHostProps, setElementText, warnVaporOnce } from './helpers';
import { currentVaporInstance, runBeforeUpdate, runUpdated } from './instance';
import {
  be,
  blockOf,
  createComponent,
  defineVaporComponent,
  disposeBlock,
  exposedRefOf,
  insertBlock,
  isVaporComponent,
  makeAnchor,
  nodesChanged,
  removeBlock,
  renderEffect,
  setInsertionState,
  setRenderHost,
  type Block,
  type HostNode,
  type Slots,
  type VaporComponent,
} from './runtime';

// ---- mounted records ------------------------------------------------------------------

interface Rec {
  vnode: VNode;
  /** the hosts this record contributes to its parent, in order */
  hosts: () => HostNode[];
  /** element / text / comment host */
  host?: HostNode;
  children?: Rec[];
  /** a component (vapor or render-host) mounted through createComponent */
  block?: Block;
  /** props / children boxes a mounted component reads */
  propsBox?: Ref<Record<string, unknown> | null>;
  childrenBox?: Ref<unknown>;
  /** a vapor slot's host node shown through a marker vnode: not ours */
  borrowed?: boolean;
  /** Teleport: where the children went */
  teleportTarget?: HostNode;
  unsetRef?: () => void;
}

/** A host node a vapor slot produced, carried through a vnode so render
 * functions can treat it like any child — `cloneVNode(page, { class })`
 * (swiper's track cells) included. */
const HostRef = { name: 'FjsHostRef', __fjsHostRef: true };

function isBlock(x: unknown): x is Block {
  return !!x && typeof x === 'object' && !isVNode(x) && Array.isArray((x as Block).nodes);
}

/** Children as the renderer would normalize them: strings become Text,
 * nested arrays Fragments, null / booleans nothing, Blocks marker vnodes. */
function normalizeChild(c: unknown): VNode | null {
  if (c == null || typeof c === 'boolean') return null;
  if (isVNode(c)) return c;
  if (isArray(c)) return createVNode(Fragment, null, c);
  if (isBlock(c)) return createVNode(Fragment, null, hostMarkers(c));
  return createVNode(Text, null, String(c));
}

/** One marker vnode per top-level host of a vapor Block. `__fjsTag` is the
 * host's tag, so a render function that sorts its children by kind
 * (swiper keeps its <swiper-item> pages) can still tell them apart. */
function hostMarkers(block: Block): VNode[] {
  return block.nodes.map((n) => {
    const tag = (n as { tagName?: string }).tagName?.toLowerCase() ?? (n as { tag?: string }).tag;
    return createVNode(HostRef as never, { __host: n, __fjsTag: tag });
  });
}

function childList(children: unknown): VNode[] {
  if (children == null) return [];
  if (isArray(children)) return children.map(normalizeChild).filter((v): v is VNode => v !== null);
  if (isBlock(children)) return [normalizeChild(children) as VNode];
  if (typeof children === 'object' && !isVNode(children)) {
    // an element given slot-shaped children (`h('view', null, { default })`)
    const d = (children as { default?: () => unknown }).default;
    return typeof d === 'function' ? childList(d()) : [];
  }
  const one = normalizeChild(children);
  return one ? [one] : [];
}

const isSameType = (a: VNode, b: VNode): boolean => a.type === b.type && a.key === b.key;

/** The element props to write: everything but the vnode-only keys. */
function hostPropsOf(vnode: VNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const p = vnode.props as Record<string, unknown> | null;
  for (const k in p ?? {}) {
    if (k === 'key' || k === 'ref' || k === 'ref_for' || k === 'ref_key' || k === '__host' || k === '__fjsTag') continue;
    out[k] = p![k];
  }
  return out;
}

// ---- refs --------------------------------------------------------------------------------

function applyRef(vnode: VNode, value: unknown): (() => void) | undefined {
  const raw = (vnode.ref as { r?: unknown } | null)?.r ?? vnode.ref;
  if (raw == null) return undefined;
  if (isRef(raw)) {
    (raw as Ref<unknown>).value = value;
    return () => {
      if ((raw as Ref<unknown>).value === value) (raw as Ref<unknown>).value = null;
    };
  }
  if (typeof raw === 'function') {
    (raw as (v: unknown) => void)(value);
    return () => (raw as (v: unknown) => void)(null);
  }
  warnVaporOnce('rh-string-ref', 'a string ref in a render function has no instance refs to land in under vapor — use a ref() object');
  return undefined;
}

// ---- mount / patch / unmount ---------------------------------------------------------------

function insertHosts(hosts: HostNode[], parent: HostNode | null, anchor: HostNode | null): void {
  if (!parent) return;
  for (const h of hosts) be().attach(h, parent, anchor);
}

function mount(vnode: VNode, parent: HostNode | null, anchor: HostNode | null): Rec {
  const type = vnode.type as unknown;
  if (type === Text) {
    const host = be().instantiateBareText(String(vnode.children ?? ''));
    insertHosts([host], parent, anchor);
    return { vnode, host, hosts: () => [host] };
  }
  if (type === Comment) {
    const host = makeAnchor('c');
    insertHosts([host], parent, anchor);
    return { vnode, host, hosts: () => [host] };
  }
  if (type === Fragment) {
    const children = childList(vnode.children).map((c) => mount(c, parent, anchor));
    return { vnode, children, hosts: () => children.flatMap((c) => c.hosts()) };
  }
  if (type === HostRef) {
    const host = (vnode.props as { __host: HostNode }).__host;
    const rec: Rec = { vnode, host, borrowed: true, hosts: () => [host] };
    const extra = hostPropsOf(vnode);
    if (Object.keys(extra).length) patchHostProps(host, extra, rec, true);
    insertHosts([host], parent, anchor);
    return rec;
  }
  if (type === Teleport) return mountTeleport(vnode, parent, anchor);
  if (typeof type === 'string') {
    const host = be().createElement ? be().createElement!(type) : (null as never);
    const rec: Rec = { vnode, host, hosts: () => [host] };
    patchHostProps(host, hostPropsOf(vnode), rec);
    if (typeof vnode.children === 'string' || typeof vnode.children === 'number') {
      setElementText(host, vnode.children);
      rec.children = [];
    } else {
      rec.children = childList(vnode.children).map((c) => mount(c, host, null));
    }
    insertHosts([host], parent, anchor);
    rec.unsetRef = applyRef(vnode, host);
    return rec;
  }
  if (type && (typeof type === 'object' || typeof type === 'function')) return mountComponent(vnode, parent, anchor);
  warnVaporOnce(`rh-type:${String(type)}`, `render-host: unsupported vnode type ${String(type)} — rendered as nothing`);
  const host = makeAnchor('unsupported');
  insertHosts([host], parent, anchor);
  return { vnode, host, hosts: () => [host] };
}

function mountTeleport(vnode: VNode, parent: HostNode | null, anchor: HostNode | null): Rec {
  const placeholder = makeAnchor('teleport');
  insertHosts([placeholder], parent, anchor);
  const to = (vnode.props as { to?: unknown; disabled?: unknown } | null)?.to;
  const disabled = !!(vnode.props as { disabled?: unknown } | null)?.disabled;
  let target: HostNode | null = null;
  if (!disabled) {
    if (typeof to === 'string' && typeof document !== 'undefined') target = document.querySelector(to);
    else if (to && typeof to === 'object') target = to as HostNode;
    if (!target) {
      warnVaporOnce('rh-teleport', `render-host: <Teleport to="${String(to)}"> has no target here — rendered in place`);
    }
  }
  const children = childList(vnode.children).map((c) => mount(c, target ?? parent, target ? null : placeholder));
  return { vnode, host: placeholder, children, teleportTarget: target ?? undefined, hosts: () => [placeholder] };
}

/** Components inside a render tree go through the vapor runtime's own
 * createComponent: a vapor component mounts natively, a render-function
 * one comes back here (setRenderHost). Props reach it as getters over a
 * box the parent's re-render refreshes, so the child's effects re-run on
 * exactly what changed. */
function mountComponent(vnode: VNode, parent: HostNode | null, anchor: HostNode | null): Rec {
  const type = vnode.type as unknown;
  if (typeof type === 'function' && !(type as { setup?: unknown }).setup && !isVaporComponent(type)) {
    // a functional component: call it as a render function of its own
    const fn = type as (props: unknown, ctx: unknown) => unknown;
    const inner = normalizeChild(fn(vnode.props ?? {}, { slots: vnode.children ?? {}, attrs: vnode.props ?? {}, emit: () => {} })) ?? createVNode(Comment);
    const child = mount(inner, parent, anchor);
    return { vnode, children: [child], hosts: () => child.hosts() };
  }
  const propsBox = shallowRef<Record<string, unknown> | null>((vnode.props as Record<string, unknown>) ?? null);
  const childrenBox = shallowRef<unknown>(vnode.children);
  const rawProps: Record<string, unknown> = {};
  for (const key of Object.keys(vnode.props ?? {})) {
    if (key === 'key' || key === 'ref' || key === 'ref_for' || key === 'ref_key') continue;
    rawProps[key] = () => propsBox.value?.[key];
  }
  const slots = slotsForChild(type as VaporComponent, childrenBox);
  if (parent) setInsertionState(parent, anchor ?? undefined);
  const block = createComponent(type, rawProps, slots);
  const rec: Rec = { vnode, block, propsBox, childrenBox, hosts: () => [...block.nodes] };
  // a ref to a component gets its exposed object
  rec.unsetRef = applyRef(vnode, exposedRefOf(block));
  return rec;
}

/** The slots a mounted child receives. A render-function child calls them
 * expecting vnodes; a vapor child expects Blocks — those are rendered
 * through a render block of their own, re-run when the parent re-renders
 * (the box holds the parent's latest slot closures). */
function slotsForChild(type: VaporComponent, childrenBox: Ref<unknown>): Slots | undefined {
  const raw = childrenBox.value;
  if (raw == null) return undefined;
  const names = typeof raw === 'object' && !isArray(raw) && !isVNode(raw) && !isBlock(raw)
    ? Object.keys(raw).filter((k) => k !== '_' && k !== '_ctx')
    : ['default'];
  const read = (name: string, args: unknown[]): unknown => {
    const now = childrenBox.value;
    if (now == null) return null;
    if (typeof now === 'object' && !isArray(now) && !isVNode(now) && !isBlock(now)) {
      const fn = (now as Record<string, unknown>)[name];
      return typeof fn === 'function' ? (fn as (...a: unknown[]) => unknown)(...args) : null;
    }
    return name === 'default' ? now : null;
  };
  const out: Slots = {};
  const vaporChild = isVaporComponent(type);
  for (const name of names) {
    out[name] = vaporChild
      ? (...args: unknown[]) => renderBlock(() => read(name, args))
      : (...args: unknown[]) => read(name, args);
  }
  return out;
}

function unmount(rec: Rec, removeHosts: boolean): void {
  rec.unsetRef?.();
  if (rec.block) {
    removeBlock(rec.block);
    return;
  }
  if (rec.teleportTarget) {
    for (const c of rec.children ?? []) unmount(c, true);
    if (removeHosts && rec.host) be().remove(rec.host);
    return;
  }
  // an element's subtree leaves with it (the backends remove subtrees)
  if (rec.host && !rec.borrowed) {
    for (const c of rec.children ?? []) unmountQuiet(c);
    if (removeHosts) be().remove(rec.host);
    return;
  }
  if (rec.borrowed) return;
  for (const c of rec.children ?? []) unmount(c, removeHosts);
}

/** Children of an element being removed: their hosts go with the parent,
 * but components still need their scopes stopped and refs cleared. */
function unmountQuiet(rec: Rec): void {
  rec.unsetRef?.();
  if (rec.block) {
    disposeBlock(rec.block);
    return;
  }
  for (const c of rec.children ?? []) unmountQuiet(c);
}

/** Patches [old] into [vnode]'s shape; returns the record now standing for
 * it (a type change mounts a new one in place). */
function patch(old: Rec, vnode: VNode, parent: HostNode | null): Rec {
  if (!isSameType(old.vnode, vnode)) {
    const first = old.hosts()[0] ?? null;
    const next = mount(vnode, parent, first);
    unmount(old, true);
    return next;
  }
  const type = vnode.type as unknown;
  if (type === Text) {
    if (old.vnode.children !== vnode.children) be().setText(old.host!, String(vnode.children ?? ''));
    old.vnode = vnode;
    return old;
  }
  if (type === Comment) {
    old.vnode = vnode;
    return old;
  }
  if (type === HostRef) {
    patchHostProps(old.host!, hostPropsOf(vnode), old, true);
    old.vnode = vnode;
    return old;
  }
  if (type === Fragment) {
    old.children = patchChildren(old.children ?? [], childList(vnode.children), parent, nextHostAfter(old));
    old.vnode = vnode;
    return old;
  }
  if (type === Teleport) {
    const target = old.teleportTarget ?? parent;
    old.children = patchChildren(old.children ?? [], childList(vnode.children), target ?? null, old.teleportTarget ? null : old.host!);
    old.vnode = vnode;
    return old;
  }
  if (typeof type === 'string') {
    const host = old.host!;
    patchHostProps(host, hostPropsOf(vnode), old);
    const textNow = typeof vnode.children === 'string' || typeof vnode.children === 'number';
    const textBefore = typeof old.vnode.children === 'string' || typeof old.vnode.children === 'number';
    if (textNow) {
      if (!textBefore) for (const c of old.children ?? []) unmount(c, true);
      old.children = [];
      if (!textBefore || old.vnode.children !== vnode.children) setElementText(host, vnode.children);
    } else {
      if (textBefore) setElementText(host, '');
      old.children = patchChildren(textBefore ? [] : old.children ?? [], childList(vnode.children), host, null);
    }
    if (old.vnode.ref !== vnode.ref) {
      old.unsetRef?.();
      old.unsetRef = applyRef(vnode, host);
    }
    old.vnode = vnode;
    return old;
  }
  if (old.propsBox) {
    old.propsBox.value = (vnode.props as Record<string, unknown>) ?? null;
    old.childrenBox!.value = vnode.children;
    old.vnode = vnode;
    return old;
  }
  // functional component: re-render it
  const next = mount(vnode, parent, old.hosts()[0] ?? null);
  unmount(old, true);
  return next;
}

/** The host right after this record's own: unknown for a fragment (it
 * has no anchor of its own), so its new children append at the parent's
 * end — fine for the shapes these components produce (slot output and
 * fragments sit last in their parent). */
function nextHostAfter(_rec: Rec): HostNode | null {
  return null;
}

/** Positional children (no keys) patch in place: the shared prefix keeps
 * its hosts where they are, new ones append, extra ones leave — nothing
 * moves. Keyed children reuse by key and move only when the reused order
 * changed: re-attaching hosts that are already in order would scramble a
 * vapor fragment, whose node list is not in DOM order (createIf keeps its
 * anchor first in the list, last in the tree). */
function patchChildren(old: Rec[], next: VNode[], parent: HostNode | null, endAnchor: HostNode | null): Rec[] {
  const keyed = next.length > 0 && next.every((v) => v.key != null) && old.every((r) => r.vnode.key != null);
  if (!keyed) {
    const result: Rec[] = [];
    for (let i = 0; i < next.length; i++) {
      const prev = old[i];
      result.push(prev ? patch(prev, next[i], parent) : mount(next[i], parent, endAnchor));
    }
    for (let i = next.length; i < old.length; i++) unmount(old[i], true);
    return result;
  }
  const byKey = new Map<unknown, { rec: Rec; index: number }>();
  old.forEach((rec, index) => byKey.set(rec.vnode.key, { rec, index }));
  const result: (Rec | null)[] = new Array(next.length).fill(null);
  const reusedOldIndex: number[] = [];
  const used = new Set<Rec>();
  next.forEach((vnode, i) => {
    const hit = byKey.get(vnode.key);
    if (hit && !used.has(hit.rec) && isSameType(hit.rec.vnode, vnode)) {
      used.add(hit.rec);
      result[i] = patch(hit.rec, vnode, parent);
      reusedOldIndex.push(hit.index);
    }
  });
  for (const r of old) if (!used.has(r)) unmount(r, true);
  const inOrder = reusedOldIndex.every((v, i) => i === 0 || v > reusedOldIndex[i - 1]);
  // back to front: each record lands before the one after it
  let cursor: HostNode | null = endAnchor;
  for (let i = next.length - 1; i >= 0; i--) {
    let rec = result[i];
    if (!rec) {
      rec = mount(next[i], parent, cursor);
      result[i] = rec;
    } else if (!inOrder && parent) {
      const hosts = rec.hosts();
      for (let k = hosts.length - 1; k >= 0; k--) {
        be().attach(hosts[k], parent, cursor);
        cursor = hosts[k];
      }
      continue;
    }
    cursor = rec.hosts()[0] ?? cursor;
  }
  return result as Rec[];
}

// ---- slots handed to render functions -----------------------------------------------------

/** A vapor slot's result as one Block — a Block, a template node, a host,
 * or an ARRAY of those (a slot with several roots returns one per root) —
 * or null when it is VDOM-shaped (vnodes), which is a plain value. */
function vaporSlotBlock(result: unknown): Block | null {
  if (result == null) return null;
  if (isVNode(result)) return null;
  if (isArray(result)) {
    if (result.some((r) => isVNode(r) || typeof r === 'string' || typeof r === 'number')) return null;
    // host.ts's list block follows its parts in place (specs/181): a
    // flattened copy went stale when a v-if inside the slot switched, and
    // the next re-render put the removed hosts back (three-gltf's mask).
    // The parts' scopes are children of the slot's own scope, stopped with it.
    return blockOf(result.filter((r) => r != null && r !== false));
  }
  if (typeof result === 'object') return blockOf(result);
  return null;
}


interface SlotCacheEntry {
  block: Block;
  props: Record<string, unknown>;
  scope: EffectScope;
}

/** A render function's view of the slots its (vapor) parent passed: each
 * call returns marker vnodes over a Block. Blocks are cached per slot and
 * call order — the i-th `slots.default({ item })` of this render reuses
 * the i-th block of the last one, its slot props updated in place — so a
 * re-render does not rebuild (and reset) the parent's content. */
function vnodeSlots(raw: Slots, owner: { cache: Map<string, SlotCacheEntry[]>; counters: Map<string, number>; home: EffectScope | undefined }): Slots {
  const out: Slots = {};
  for (const name of Object.keys(raw)) {
    const fn = raw[name];
    out[name] = (props?: unknown) => {
      const at = owner.counters.get(name) ?? 0;
      owner.counters.set(name, at + 1);
      const list = owner.cache.get(name) ?? [];
      owner.cache.set(name, list);
      let entry = list[at];
      const p = (props && typeof props === 'object' ? props : {}) as Record<string, unknown>;
      if (entry) {
        Object.assign(entry.props, p);
      } else {
        const state = shallowReactive({ ...p });
        // a child of the component's own scope, not of whatever runs the
        // slot: a render function may call it lazily from INSIDE another
        // component's slot (canvas hands its slot to the box), and that
        // one stops its own throwaway scope right after — this one with it,
        // killing every effect of the content (specs/181: a v-if mask that
        // never went away)
        const scope = owner.home ? owner.home.run(() => new EffectScope())! : new EffectScope();
        const result = scope.run(() => fn(state));
        const block = vaporSlotBlock(result);
        if (block) {
          if (!block.scopes) block.scopes = [];
          block.scopes.push(scope);
          entry = { block, props: state, scope };
          list[at] = entry;
        } else {
          // a VDOM-shaped slot (vnodes): no caching needed, it is a value
          scope.stop();
          return result;
        }
      }
      // the render function sees one vnode per top-level host (it may
      // iterate, clone or wrap its children); the Block stays cached here
      return hostMarkers(entry.block);
    };
  }
  return out;
}

// ---- the render block ----------------------------------------------------------------------

/** A Block whose content is [render]'s vnode tree, kept in step by a
 * renderEffect. Top-level hosts sit before an end anchor (always the last
 * node), so a re-render can re-place them once the block is inserted. */
export function renderBlock(render: () => unknown, hooks?: { before?: () => void; after?: () => void }): Block {
  const end = makeAnchor('render');
  const block: Block & { nodes: HostNode[] } = { nodes: [end] };
  let root: Rec | null = null;
  renderEffect(() => {
    const tree = normalizeChild(render()) ?? createVNode(Comment);
    if (!root) {
      root = mount(tree, null, null);
      block.nodes.splice(0, block.nodes.length, ...root.hosts(), end);
      return;
    }
    hooks?.before?.();
    const parent = be().parentNode?.(end) ?? null;
    root = patch(root, tree, parent);
    block.nodes.splice(0, block.nodes.length, ...root.hosts(), end);
    nodesChanged(block.nodes);
    hooks?.after?.();
  });
  (block as Block & { cleanups?: (() => void)[] }).cleanups = [
    () => {
      if (root) unmountQuiet(root);
    },
  ];
  return block;
}

// ---- the component wrapper -------------------------------------------------------------------

interface RenderComponent {
  name?: string;
  props?: unknown;
  emits?: unknown;
  inheritAttrs?: boolean;
  setup?: (props: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
  render?: (...args: unknown[]) => unknown;
}

const wrappers = new WeakMap<object, VaporComponent>();

/** The vapor component standing for a render-function component: the vapor
 * layer supplies props / attrs / emit / expose / lifecycle / provide-inject;
 * the render function runs in a render block. Attrs merge into the root
 * vnode (Vue's fallthrough) unless the component opts out. */
function wrapperOf(comp: RenderComponent): VaporComponent {
  let w = wrappers.get(comp);
  if (w) return w;
  w = defineVaporComponent({
    name: comp.name,
    props: comp.props as VaporComponent['props'],
    emits: comp.emits as VaporComponent['emits'],
    inheritAttrs: false,
    setup(props, ctx) {
      const inst = currentVaporInstance();
      if (inst) inst.renderHost = true;
      const owner = { cache: new Map<string, SlotCacheEntry[]>(), counters: new Map<string, number>(), home: getCurrentScope() };
      const slots = vnodeSlots(ctx.slots, owner);
      const result = comp.setup?.(props, { ...ctx, slots });
      const render =
        typeof result === 'function'
          ? (result as () => unknown)
          : comp.render
            ? () => comp.render!.call(result ?? {}, result ?? {})
            : null;
      if (!render) {
        warnVaporOnce(`rh-norender:${comp.name}`, `render-host: <${comp.name ?? 'component'}> has no render function`);
        return null;
      }
      const inherit = comp.inheritAttrs !== false;
      return renderBlock(
        () => {
          owner.counters.clear();
          // Vue updates a component whenever a prop changes, whether its
          // render reads that prop or not — onUpdated is where FjsScrollView
          // applies scroll-into-view / scroll-top. Depend on every prop so
          // the same change re-renders here too (specs/181: the sticky
          // demo's group jumps did nothing)
          for (const k in props) void (props as Record<string, unknown>)[k];
          let tree = render();
          if (inherit && isVNode(tree) && Object.keys(ctx.attrs).length) {
            const attrs: Record<string, unknown> = {};
            for (const k of Object.keys(ctx.attrs)) attrs[k] = ctx.attrs[k];
            tree = cloneVNode(tree, attrs);
          }
          // slot blocks this render did not ask for again leave
          for (const [name, list] of owner.cache) {
            const used = owner.counters.get(name) ?? 0;
            for (const e of list.splice(used)) removeBlock(e.block);
          }
          return tree;
        },
        inst ? { before: () => runBeforeUpdate(inst), after: () => runUpdated(inst) } : undefined,
      );
    },
  });
  wrappers.set(comp, w);
  return w;
}

setRenderHost((comp, rawProps, slots, parent, anchor) => {
  if (parent) setInsertionState(parent, anchor ?? undefined);
  return createComponent(wrapperOf(comp as RenderComponent), rawProps, slots);
});
