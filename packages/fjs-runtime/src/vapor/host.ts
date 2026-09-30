// The vapor host contract (specs/163): the framework-NEUTRAL core every
// framework binding drives — template parsing/cloning, walkers, writers,
// block bookkeeping, insertion state, createIf/createFor/repeatTemplate,
// the effect queue and the backend seam (Flutter/web). Reactivity is a seam
// (HostReactivity below): this module never imports an engine, the binding
// (runtime.ts for Vue) injects one before any helper runs.
//
// Layering discipline: framework assumptions stop at this module's edge.
// A binding supplies HostReactivity + the component layer; a compiler emits
// the functions here; the backend seam turns writes into element ops. See
// docs/vapor-contract.md.

/** A slot bag: name → render function. Declared here because the backend
 * seam's mountVdomComponent takes one; the bindings layer the semantics. */
export type Slots = Record<string, (...args: unknown[]) => unknown>;

/** The reactivity seam: what a framework binding supplies. `scheduler` /
 * `onStop` are exactly Vue `effect()`'s shape — flushing (the microtask
 * queue below) is owned by this module, the engine only tracks and
 * triggers. A scope owns the effects created under it; stopping it stops
 * them all (createIf branches, per-item v-for scopes, the list scope). */
export interface HostReactivity<S = unknown, R = unknown> {
  createScope(): S;
  runInScope<T>(scope: S, fn: () => T): T;
  stopScope(scope: S): void;
  effect(fn: () => unknown, opts: { scheduler: () => void; onStop: () => void }): R;
  stopEffect(runner: R): void;
  /** A writable box: `.value` reads track, writes trigger. */
  box<T>(value: T): { value: T };
}

let rx: HostReactivity | null = null;

/** The binding calls this at module init, before any helper can run. The
 * last caller wins (a test may re-inject another engine). */
export function setHostReactivity(impl: HostReactivity): void {
  rx = impl;
}

/** opts for an effect nobody schedules — the micro bench's tight loops. */
const NO_SCHED = { scheduler: () => {}, onStop: () => {} };

function needRx(): HostReactivity {
  if (rx === null) throw new Error('[fjs vapor] no reactivity bound — the framework binding must call setHostReactivity at module init');
  return rx;
}

import { camelize, normalizeClass, toDisplayString, toHandlerKey } from '@vue/shared';

// ---- backend seam ---------------------------------------------------------------

/** TEMP profiling (specs/161 mount analysis). Off unless the bench turns it
 * on for a single mount — the hot path only reads the flag. Exclusive time:
 * a nested region pauses its parent. `nameN` is the call count. */
export const __prof: Record<string, number> = {};
const __hasPerf = typeof performance !== 'undefined' && typeof performance.now === 'function';
const __now = (): number => (__hasPerf ? (performance as { now(): number }).now() : Date.now());
/** Same clock, exported for the backends' profiling blocks. */
export const __perfNow = __now;
let __on = false;
interface ProfFrame { name: string; t0: number }
const __stack: ProfFrame[] = [];
export function __profOn(on: boolean): void {
  __on = on;
  (globalThis as { __fjsVaporProfOn?: boolean }).__fjsVaporProfOn = on;
  if (!on) __stack.length = 0;
}
export function __zoneEnter(name: string): void {
  if (!__on) return;
  const now = __now();
  const n = __stack.length;
  if (n !== 0) {
    const top = __stack[n - 1];
    __prof[top.name] = (__prof[top.name] ?? 0) + (now - top.t0);
  }
  __stack.push({ name, t0: now });
  __prof[name + 'N'] = (__prof[name + 'N'] ?? 0) + 1;
}
export function __zoneExit(name: string): void {
  if (!__on) return;
  const top = __stack.pop();
  if (!top || top.name !== name) {
    if (top) __stack.push(top);
    return;
  }
  const now = __now();
  __prof[name] = (__prof[name] ?? 0) + (now - top.t0);
  const n = __stack.length;
  if (n !== 0) __stack[n - 1].t0 = now;
}
function __bump(name: string): void {
  if (__on) __prof[name] = (__prof[name] ?? 0) + 1;
}
/** Which insert the backend's attach should charge: the keyed list inserts
 * every item twice (once while building, once in the reorder walk). */
let insertZone = 'insert';
export function insertZoneName(): string {
  return insertZone;
}
function withInsertZone<T>(name: string, fn: () => T): T {
  const prev = insertZone;
  insertZone = name;
  try {
    return fn();
  } finally {
    insertZone = prev;
  }
}
/** renderEffect tag, so a v-for's effect is not mixed with the per-cell text
 * effects it runs. Nested renderEffect calls see the default again. */
let fxTag = 'fx';
(globalThis as Record<string, unknown>).__fjsVaporProf = __prof;
(globalThis as Record<string, unknown>).__fjsVaporProfOn = false;
(globalThis as Record<string, unknown>).__fjsVaporZone = {
  enter: __zoneEnter,
  exit: __zoneExit,
  bump: __bump,
};

/** What a template parse produced, shared by every instance of it. */
export interface TemplateDef {
  /** 0 is a virtual root; the template's own nodes from 1, pre-order */
  nodes: TemplateNode[];
}

export interface TemplateNode {
  kind: 'element' | 'text' | 'anchor' | 'folded';
  tag: string;
  /** index into the same list; -1 for top-level nodes */
  parent: number;
  children: number[];
  /** element whose only child is a text: the text is the element's own
   * content on both ends (the child is folded out of the shape) */
  inline: boolean;
  /** the folded inline text / bare text / anchor label, as the template has it */
  raw: string;
  classes: string | null;
  scope: string | null;
}

/** The platform's node shape: on Flutter an element-API element, on web a
 * DOM node. Vapor code only ever holds it opaquely. */
export type HostNode = unknown;

/** The primitives the shared machinery needs. Kept to what compiled pages
 * exercise — this is a Vapor backend, not a general DOM. */
export interface VaporBackend {
  /** One instance of a parsed template: fills hosts[1..n-1] in def order
   * (def.nodes is pre-order), with the template root UNATTACHED — the
   * enclosing block inserts it. `html` is the template source (the web
   * backend clones through an HTMLTemplateElement; the Flutter backend
   * ignores it). */
  instantiate(def: TemplateDef, hosts: unknown[], html: string): void;
  /** [count] instances, each a hosts array in the same index space as
   * instantiate. The Flutter backend clones them in one pass (a static
   * v-for cell is this, thousands of times); the web backend cloneNodes. */
  instantiateMany(def: TemplateDef, count: number, html: string): unknown[][];
  /** specs/162: the whole list in one op — [count] clones, every root
   * inserted under parent before anchor (null = append) and, when textIdx
   * is set, texts[i] written into copy i's text node. Returns null when the
   * backend cannot batch (no native clone plan) — the caller then falls
   * back to instantiateMany + per-cell attach/write. */
  cloneList?(def: TemplateDef, count: number, parent: HostNode, anchor: HostNode | null, textIdx: number | null, texts: readonly string[] | null, html: string): unknown[][] | null;
  /** A bare-text template instance (a text run with no element around it). */
  instantiateBareText(text: string): HostNode;
  /** An invisible placeholder (v-if / v-for / empty slot anchor). */
  createAnchor(label: string): HostNode;
  attach(host: HostNode, parent: HostNode, anchor: HostNode | null): void;
  /** The current child at [index] (setInsertionState's appendIndex form
   * resolves to it once, at block creation) — null past the end. */
  childAt(parent: HostNode, index: number): HostNode | null;
  remove(host: HostNode): void;
  /** element-content text ({{ }} on an element) vs a bare text node */
  setElementText(host: HostNode, text: string): void;
  setText(host: HostNode, text: string): void;
  setClasses(host: HostNode, value: string): void;
  /** inline style with DOM merge semantics: keys in `prev` not in `next` are
   * dropped; a component root's own :style and a fallthrough one patch the
   * same node independently */
  patchStyle(host: HostNode, prev: Record<string, unknown> | null, next: Record<string, unknown>): void;
  setAttr(host: HostNode, key: string, value: unknown): void;
  /** `onTap` / `onClick` style keys; the backend owns the event shape
   * (string payloads on Flutter, the press gestures on web). */
  on(host: HostNode, key: string, handler: unknown): void;
  off(host: HostNode, key: string): void;
  /** A VDOM component mounted at this spot of a Vapor tree (vant et al).
   * Returns the block whose removal unmounts it. `slots` are the Vapor slot
   * functions the parent passed; the backend bridges them to the VDOM
   * component's slot contract. */
  mountVdomComponent(
    comp: Record<string, unknown>,
    props: Record<string, unknown>,
    slots: Slots,
    parent: HostNode | null,
    anchor: HostNode | null,
  ): Block;
}

let backend: VaporBackend | null = null;

export function setVaporBackend(b: VaporBackend): void {
  if (backend) throw new Error('[fjs vapor] backend set twice');
  backend = b;
}

export function be(): VaporBackend {
  if (!backend) throw new Error('[fjs vapor] no backend set — import fjs/vapor, not vapor/runtime directly');
  return backend;
}

// ---- blocks --------------------------------------------------------------------

/** A mounted unit of template output: the hosts to insert/remove as one,
 * the scopes created for it (an effect made inside a for item must die with
 * the item), and cleanups. Nested content (an if-anchor inside an item's
 * root) is NOT listed — it leaves with the root through the backend's
 * subtree removal. */
export interface Block {
  nodes: readonly HostNode[];
  scopes?: unknown[];
  cleanups?: (() => void)[];
}

export const emptyBlock = (): Block => ({ nodes: [] });

/** What setup() may return: a template node, a bare host, a block, a list,
 * nothing (a component that renders only anchors). */
export function blockOf(node: unknown): Block {
  if (node instanceof TplNode) return { nodes: [node.host] };
  if (Array.isArray(node)) return { nodes: node.map(hostOf) };
  if (node && typeof node === 'object' && Array.isArray((node as Block).nodes)) {
    const b = node as Block;
    return { nodes: b.nodes, scopes: b.scopes, cleanups: b.cleanups };
  }
  if (node && typeof node === 'object') return { nodes: [node as HostNode] };
  if (node == null || node === false) return emptyBlock();
  throw new Error(`[fjs vapor] setup returned something that is not a block: ${typeof node}`);
}

/** Inserts a block's hosts before [anchor] (appends when null). */
export function insertBlock(block: Block, parent: HostNode, anchor: HostNode | null): void {
  for (const node of block.nodes) be().attach(node, parent, anchor);
}

/** Removes a block's hosts and tears down everything created for it. */
export function removeBlock(block: Block): void {
  for (const node of block.nodes) be().remove(node);
  for (const s of block.scopes ?? []) needRx().stopScope(s);
  for (const cleanup of block.cleanups ?? []) cleanup();
}

// ---- insertion state -------------------------------------------------------------

/** Where the next block lands: compiled code calls setInsertionState right
 * before createIf / createFor / createComponent; the construct consumes (and
 * clears) it. A template instance itself is never auto-inserted — it joins
 * the tree when its enclosing block does. */
let insertionParent: HostNode | null = null;
let insertionAnchor: HostNode | null = null;

export function setInsertionState(parent: unknown, anchor?: unknown): void {
  const p = hostOf(parent);
  insertionParent = p;
  // the compiler's appendIndex form: a NUMBER means "before the current
  // child at that index" — resolve it once, here, while the siblings are
  // exactly as the compiler saw them
  if (typeof anchor === 'number') {
    insertionAnchor = be().childAt(p, anchor);
  } else {
    insertionAnchor = anchor == null ? null : hostOf(anchor);
  }
}

export function takeInsertionState(): { parent: HostNode | null; anchor: HostNode | null } {
  const state = { parent: insertionParent, anchor: insertionAnchor };
  insertionParent = insertionAnchor = null;
  return state;
}

/** Template nodes, blocks and bare hosts all flow through compiled code;
 * every helper boundary unwraps. */
function hostOf(node: unknown): HostNode {
  if (node instanceof TplNode) return node.host;
  if (node && typeof node === 'object' && Array.isArray((node as Block).nodes)) return blockRoot(node as Block);
  if (node && typeof node === 'object') return node as HostNode;
  throw new Error(`[fjs vapor] not a node: ${String(node)}`);
}

export function blockRoot(block: Block): HostNode {
  if (block.nodes.length !== 1) throw new Error('[fjs vapor] expected a single-root block');
  return block.nodes[0];
}

// ---- templates ---------------------------------------------------------------------

/** Parsed once per template string, kept for the module's life: the shape
 * the compiled walkers assume. Instantiation is the backend's. */
const templateDefs = new Map<string, TemplateDef>();

function parseTemplateHtml(html: string): TemplateDef {
  const cached = templateDefs.get(html);
  if (cached) return cached;

  const nodes: TemplateNode[] = [{ kind: 'element', tag: '#root', parent: -1, children: [], inline: false, raw: '', classes: null, scope: null }];
  const stack: number[] = [0];
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", nbsp: ' ' };
  const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]);
  let i = 0;

  const addNode = (node: Omit<TemplateNode, 'children' | 'parent'>): number => {
    const parent = stack[stack.length - 1];
    const idx = nodes.length;
    nodes.push({ ...node, parent, children: [] });
    nodes[parent].children.push(idx);
    return idx;
  };

  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      addNode({ kind: 'anchor', tag: 'view', inline: false, raw: html.slice(i + 4, end), classes: null, scope: null });
      i = end + 3;
    } else if (html.startsWith('<!', i)) {
      const end = html.indexOf('>', i);
      addNode({ kind: 'anchor', tag: 'view', inline: false, raw: html.slice(i + 2, end), classes: null, scope: null });
      i = end + 1;
    } else if (html.startsWith('</', i)) {
      const end = html.indexOf('>', i);
      const name = html.slice(i + 2, end).trim();
      while (stack.length > 1 && nodes[stack.pop() as number].tag !== name);
      i = end + 1;
    } else if (html[i] === '<') {
      const m = /^<([a-zA-Z][\w-]*)/.exec(html.slice(i, i + 64));
      if (!m) throw new Error(`[fjs vapor] cannot parse template at ${i}: ${html}`);
      const tag = m[1];
      i += m[0].length;
      const attrs: [string, string][] = [];
      const attr = /^\s*([^\s=>/]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/;
      for (;;) {
        const a = attr.exec(html.slice(i));
        if (!a) break;
        attrs.push([a[1], decode(a[2] ?? a[3] ?? a[4] ?? '')]);
        i += a[0].length;
      }
      while (html[i] === ' ') i++;
      const selfClosing = html[i] === '/';
      i = html.indexOf('>', i) + 1;
      let classes: string | null = null;
      let scope: string | null = null;
      for (const [k, v] of attrs) {
        if (k === 'class') classes = v;
        else if (v === '' && k.startsWith('data-v-') && scope === null) scope = k;
        // no other attribute lands in the shape: a template carries class +
        // scope and nothing else, which is exactly what a native clone
        // replays; anything else must come out of the parse as a rejection
      }
      const idx = addNode({ kind: 'element', tag, inline: false, raw: '', classes, scope });
      if (!selfClosing && !VOID.has(tag)) stack.push(idx);
    } else {
      const end = html.indexOf('<', i);
      const text = decode(html.slice(i, end < 0 ? html.length : end));
      if (text) addNode({ kind: 'text', tag: 'text', inline: false, raw: text, classes: null, scope: null });
      i = end < 0 ? html.length : end;
    }
  }

  // fold "element whose only child is a text" into an inline element: on
  // both ends that text is the element's own content, and the compiler
  // addresses it through txt(el) — the text child must vanish from the
  // walker shape or every later child() index is off by one. Mixed text
  // folds the same way: the compiler replaces a whole text run with one
  // placeholder.
  for (let k = 1; k < nodes.length; k++) {
    const n = nodes[k];
    if (n.kind !== 'element' || n.children.length !== 1) continue;
    const only = nodes[n.children[0]];
    if (only.kind !== 'text') continue;
    n.inline = true;
    n.raw = only.raw;
    n.children = [];
    // the text node itself stays in the list (indices are load-bearing for
    // parents) but is marked so no backend ever instantiates it
    only.kind = 'folded';
    only.parent = k;
  }

  const def: TemplateDef = { nodes };
  templateDefs.set(html, def);
  return def;
}

/** One instance of a template: hosts aligned with def.nodes by index (0 =
 * the virtual root, unused). The shape is static, so only this varies. */
export class TemplateInstance {
  hosts: unknown[] = [];
  constructor(public def: TemplateDef) {}
  host(idx: number): HostNode {
    const host = this.hosts[idx];
    if (!host) throw new Error(`[fjs vapor] template node ${idx} was not instantiated`);
    return host;
  }
}

/** A walker cursor: one node of one instance. Compiled code threads these
 * through child / txt / next and hands them to every write helper. */
export class TplNode {
  constructor(
    public inst: TemplateInstance,
    public idx: number,
  ) {}
  get host(): HostNode {
    return this.inst.host(this.idx);
  }
  get def(): TemplateDef {
    return this.inst.def;
  }
}

// ---- template() ----------------------------------------------------------------

/** What `template()` returns. `def` is how repeatTemplate clones a static
 * v-for without calling the factory once per item; null for a bare text
 * template, which has nothing to clone in bulk. */
export interface CompiledTemplate {
  (): TplNode;
  def: TemplateDef | null;
  html: string;
}

function asTemplate(fn: () => TplNode, def: TemplateDef | null, html: string): CompiledTemplate {
  const f = fn as CompiledTemplate;
  f.def = def;
  f.html = html;
  return f;
}

/** `template(html, flags, ns)`: parses once, instantiates per call. flags
 * bit 0 marks the component's single root and bit 1 a fully-static template
 * — neither changes our behavior (every instance still gets its own hosts). */
export function template(html: string, flags = 0, ns?: number): CompiledTemplate {
  void flags;
  void ns;
  // a bare text template ("主要"): a fresh bare text node per instance
  if (html[0] !== '<') {
    const bare: TemplateDef = { nodes: [{ kind: 'text', tag: 'text', parent: -1, children: [], inline: false, raw: html, classes: null, scope: null }] };
    return asTemplate(() => {
      const inst = new TemplateInstance(bare);
      inst.hosts[0] = be().instantiateBareText(html);
      return new TplNode(inst, 0);
    }, null, html);
  }
  const def = parseTemplateHtml(html);
  return asTemplate(() => {
    if (!__on) {
      const inst = new TemplateInstance(def);
      be().instantiate(def, inst.hosts, html);
      return new TplNode(inst, 1);
    }
    __zoneEnter('tpl');
    const inst = new TemplateInstance(def);
    be().instantiate(def, inst.hosts, html);
    const node = new TplNode(inst, 1);
    __zoneExit('tpl');
    return node;
  }, def, html);
}

// ---- walkers ---------------------------------------------------------------------

/** The i-th child of a template node. The compiler counts every kind; the
 * inline fold keeps text children only where they are not element content. */
export function child(node: TplNode, i = 0): TplNode {
  __bump('childN');
  const idx = node.def.nodes[node.idx].children[i];
  if (idx == null) throw new Error(`[fjs vapor] child(${i}) is outside the template`);
  return new TplNode(node.inst, idx);
}

export function nthChild(node: TplNode, i: number): TplNode {
  return child(node, i);
}

export function next(node: TplNode): TplNode {
  const n = node.def.nodes[node.idx];
  const siblings = node.def.nodes[n.parent].children;
  const at = siblings.indexOf(node.idx);
  if (at < 0 || at + 1 >= siblings.length) throw new Error('[fjs vapor] next() walked off the template');
  return new TplNode(node.inst, siblings[at + 1]);
}

/** The text position of an element: the text IS the element's content, so
 * txt() returns the node itself and setText picks the write. */
export function txt(node: TplNode): TplNode {
  const n = node.def.nodes[node.idx];
  if (n.kind === 'anchor') throw new Error('[fjs vapor] txt() on an anchor');
  if (n.kind === 'text') return node;
  if (!n.inline) throw new Error('[fjs vapor] txt() on an element without inline text');
  return node;
}

// ---- element writes ----------------------------------------------------------------

export function setText(node: TplNode, value: unknown): void {
  const text = value == null ? '' : String(value);
  const n = node.def.nodes[node.idx];
  if (!__on) {
    if (n.kind === 'text') be().setText(node.host, text);
    else be().setElementText(node.host, text);
    return;
  }
  __zoneEnter('text');
  if (n.kind === 'text') be().setText(node.host, text);
  else be().setElementText(node.host, text);
  __zoneExit('text');
}

/** The compiler hands class bindings through as arrays / objects
 * (`["title", { on }]`) — normalizeClass is what the write needs. */
export function setClass(node: TplNode, value: unknown): void {
  be().setClasses(node.host, value == null ? '' : normalizeClass(value as never));
}

export function setClassName(node: TplNode, value: string): void {
  setClass(node, value);
}

/** DOM merge semantics against what this element already has — the applied
 * record kept per host, so a second writer (component root + fallthrough)
 * merges instead of replacing. */
const styleRecords = new WeakMap<object, Record<string, unknown>>();

export function setStyle(node: TplNode, value: Record<string, unknown>): void {
  const current = styleRecords.get(node.host as object) ?? null;
  const merged: Record<string, unknown> = { ...current };
  for (const k in value) {
    const v = value[k];
    if (v == null || v === '') delete merged[k];
    else merged[k] = v;
  }
  be().patchStyle(node.host, current, merged);
  styleRecords.set(node.host as object, merged);
}

export function setAttr(node: TplNode, key: string, value: unknown): void {
  be().setAttr(node.host, key, value);
}

export function setProp(node: TplNode, key: string, value: unknown): void {
  setAttr(node, key, value);
}

/** v-show / the `show` helper: one inline-layer key, like runtime-dom's
 * vShow — everything else stays with the cascade. */
export function show(node: TplNode, value: unknown): void {
  const current = styleRecords.get(node.host as object) ?? null;
  const next = { ...current };
  if (value) delete next.display;
  else next.display = 'none';
  be().patchStyle(node.host, current, next);
  styleRecords.set(node.host as object, next);
}

// ---- events --------------------------------------------------------------------------

export function on(node: TplNode | HostNode, event: string, handler: unknown, options?: { once?: boolean }): void {
  const host = node instanceof TplNode ? node.host : node;
  const key = toHandlerKey(camelize(event));
  const wrapped = options?.once
    ? (...args: unknown[]) => {
        be().off(host, key);
        (handler as (...a: unknown[]) => void)(...args);
      }
    : handler;
  be().on(host, key, wrapped);
}

export function off(node: TplNode | HostNode, event: string): void {
  const host = node instanceof TplNode ? node.host : node;
  be().off(host, toHandlerKey(camelize(event)));
}

export function once(node: TplNode | HostNode, event: string, handler: unknown): void {
  on(node, event, handler, { once: true });
}

/** Vapor delegates some events off the document; here every event registers
 * on its node. Compiled code calls this at module level, so it stays
 * importable and does nothing. */
export function delegateEvents(..._names: string[]): void {}

// ---- effects ---------------------------------------------------------------------------

/** The scope a new effect belongs to — swapped by withScope, read by
 * renderEffect and the construct helpers. */
let currentScope: unknown = null;

/** Runs fn with [scope] as the enclosing one — effects created inside join
 * the scope (the engine's own active-scope is set by runInScope). Slots are
 * a binding concern: the Vue wrapper layers them over this. */
export function withScope<T>(scope: unknown, fn: () => T): T {
  const savedScope = currentScope;
  currentScope = scope;
  try {
    return scope == null ? fn() : needRx().runInScope(scope, fn);
  } finally {
    currentScope = savedScope;
  }
}

interface QueuedEffect {
  run: () => void;
  alive: () => boolean;
}

const queue: QueuedEffect[] = [];
let queued = false;

function enqueue(run: () => void, alive: () => boolean): void {
  queue.push({ run, alive });
  if (!queued) {
    queued = true;
    Promise.resolve().then(() => {
      queued = false;
      for (const { run, alive } of queue.splice(0)) {
        // a scope stopped between trigger and flush must not write into
        // hosts that no longer exist — onStop() flips `alive`
        if (alive()) run();
      }
    });
  }
}

/** Tracks what fn reads and re-runs it — batched over a microtask, the
 * scheduling runtime-vapor uses — when any of it changes. Runs fn once now;
 * call inside withScope so the first run (and anything it constructs) lands
 * in the enclosing scope. Neither 3.5 nor 3.6 exposes ReactiveEffect's
 * active flag, so liveness goes through onStop. */
export function renderEffect(fn: () => unknown): void {
  const scope = currentScope;
  let alive = true;
  let runner: () => unknown = () => {};
  const opts = {
    scheduler: () =>
      enqueue(
        () => (scope ? withScope(scope, () => runner()) : runner()),
        () => alive,
      ),
    onStop: () => {
      alive = false;
    },
  };
  if (!__on) {
    runner = needRx().effect(fn, opts) as typeof runner;
    return;
  }
  const tag = fxTag;
  __zoneEnter(tag);
  runner = needRx().effect(() => {
    const prev = fxTag;
    fxTag = 'fx';
    __zoneEnter(tag + 'Body');
    try {
      return fn();
    } finally {
      __zoneExit(tag + 'Body');
      fxTag = prev;
    }
  }, opts) as typeof runner;
  __zoneExit(tag);
}


// ---- v-if ---------------------------------------------------------------------------

/** A v-if position: an invisible anchor holds the spot; each branch renders
 * into a fresh scope whose effects die with the branch. `flags` carry the
 * compiler's shape / keyed-index / once hints — the general path is correct
 * for all of them, so they are not read. */
export function createIf(condition: () => unknown, positive?: () => unknown, negative?: () => unknown, flags = 1): Block {
  void flags;
  const { parent, anchor: before } = takeInsertionState();
  const anchor = be().createAnchor('if');
  if (parent) be().attach(anchor, parent, before);
  const frag: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] } = { nodes: [anchor], scopes: [], cleanups: [] };
  let current: { scope: unknown; cleanups: (() => void)[] } | null = null;
  const teardown = (): void => {
    for (let i = frag.nodes.length - 1; i >= 1; i--) be().remove(frag.nodes[i]);
    frag.nodes.length = 1;
    if (current) {
      needRx().stopScope(current.scope);
      for (const cleanup of current.cleanups) cleanup();
      current = null;
      frag.scopes.length = 0;
    }
  };
  const owner = currentScope;
  const savedFx = fxTag;
  fxTag = 'ifFx';
  withScope(
    owner,
    () => {
      renderEffect(() => {
        teardown();
        const branchScope = needRx().createScope();
        let branch: Block;
        try {
          branch = withScope(branchScope, () => blockOf(condition() ? positive?.() : negative?.()));
        } catch (e) {
          needRx().stopScope(branchScope);
          throw e;
        }
        if (parent) insertBlock(branch, parent, anchor);
        frag.nodes.push(...branch.nodes);
        for (const scope of branch.scopes ?? []) frag.scopes.push(scope);
        frag.scopes.push(branchScope);
        current = { scope: branchScope, cleanups: branch.cleanups ? [...branch.cleanups] : [] };
      });
    },
  );
  fxTag = savedFx;
  // an enclosing removal stops the branch scope and runs its cleanups after
  // the hosts are gone (removeBlock orders nodes, scopes, then cleanups)
  frag.cleanups.push(() => {
    if (current) needRx().stopScope(current.scope);
    for (const cleanup of current?.cleanups ?? []) cleanup();
  });
  return frag;
}

// ---- v-for ----------------------------------------------------------------------------

const FAST_REMOVE = 1;

interface ForItem {
  key: unknown;
  item: { value: unknown };
  keyRef: { value: unknown };
  scope: unknown;
  block: Block;
}

/** Compiler bit: the v-for source is a static expression or v-once, so the
 * list is built once and item/key never change (compiler-vapor genForFlags). */
const FOR_ONCE = 4;

/** Keyed list: after new items have been appended and removals dropped, the
 * DOM is already in wanted order when every surviving item kept its relative
 * order and every fresh item is a suffix. The backwards move is only for a
 * real reorder (unshift, reverse, insert in the middle). */
function forOutOfOrder(prev: readonly ForItem[], wanted: readonly ForItem[], fresh: ReadonlySet<ForItem>): boolean {
  const still = new Set<ForItem>();
  for (let i = 0; i < wanted.length; i++) {
    if (!fresh.has(wanted[i])) still.add(wanted[i]);
  }
  let si = 0;
  let passedFresh = false;
  for (let i = 0; i < wanted.length; i++) {
    const w = wanted[i];
    if (fresh.has(w)) {
      passedFresh = true;
      continue;
    }
    if (passedFresh) return true;
    while (si < prev.length && !still.has(prev[si])) si++;
    if (si >= prev.length || prev[si] !== w) return true;
    si++;
  }
  return false;
}

/** v-for over a count or an array. Items mount before a private anchor in
 * item order; a keyed diff reorders with plain inserts (attach is a move for
 * already-attached hosts) and drops go through the backend's subtree removal.
 * FAST_REMOVE only says the compiler proved items are single nodes — the
 * general removal is correct either way.
 *
 * The anchor is what later insertions sit in front of. On the initial fill of
 * a list that is itself being appended, items go on with a null anchor (the
 * renderer's fast append) and the anchor is placed after them — inserting
 * each item before an anchor that is already the last child, then moving
 * every item to where it already was, is the whole mount cost of a static
 * keyed list. */
export function createFor(
  source: () => number | unknown[],
  getItem: (item: { value: unknown }, key: { value: unknown }) => unknown,
  getKey?: (item: unknown, index: number) => unknown,
  flags = 0,
): Block {
  const once = (flags & FOR_ONCE) !== 0;
  const { parent, anchor: before } = takeInsertionState();
  const anchor = be().createAnchor('for');
  const listBlock: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] } = { nodes: [anchor], scopes: [], cleanups: [] };
  let items: ForItem[] = [];
  // null = append. A list inserted at the end defers its anchor so the
  // initial fill hits the fast path; afterwards new items insert before it.
  let slot: HostNode | null = anchor;
  let anchorPlaced = !parent;
  if (parent && before != null) {
    be().attach(anchor, parent, before);
    anchorPlaced = true;
  } else if (parent) {
    slot = null;
  }
  const ensureAnchor = (): void => {
    if (anchorPlaced || !parent) return;
    be().attach(anchor, parent, null);
    slot = anchor;
    anchorPlaced = true;
  };
  // ONCE: the compiler proved the source never changes (a numeric literal,
  // v-once, a literal const). Items are never removed on their own, so one
  // scope for the whole list replaces a per-item EffectScope — that scope
  // is created inside the caller's run, and the v-if / component that owns
  // the list stops it. Item and key are plain boxes: nothing writes them,
  // and a text effect that only read them was inlined at compile time.
  if (once) {
    const owner = currentScope;
    withScope(owner, () => {
      const listScope = needRx().createScope();
      listBlock.scopes.push(listScope);
      withScope(listScope, () => {
        const src = source();
        const count = typeof src === 'number' ? src : src.length;
        // v-for="r in N" iterates r = 1..N (the index param stays 0-based) —
        // getItem's item box is the VALUE, so the number source is i + 1
        const value = (i: number): unknown => (typeof src === 'number' ? i + 1 : src[i]);
        for (let i = 0; i < count; i++) {
          const v = value(i);
          const key = getKey ? getKey(v, i) : i;
          const block = blockOf(getItem({ value: v }, { value: key }));
          if (parent) insertBlock(block, parent, slot);
        }
        ensureAnchor();
      });
    });
    return listBlock;
  }
  const box = (v: unknown): { value: unknown } => needRx().box(v);

  const buildItem = (value: unknown, key: unknown): ForItem => {
    if (!__on) {
      const scope = needRx().createScope();
      const item = box(value);
      const keyRef = box(key);
      const block = withScope(scope, () => blockOf(getItem(item, keyRef)));
      if (!block.scopes) block.scopes = [];
      block.scopes.push(scope);
      if (parent) insertBlock(block, parent, slot);
      return { key, item, keyRef, scope, block };
    }
    __zoneEnter('item');
    __zoneEnter('scope');
    const scope = needRx().createScope();
    __zoneExit('scope');
    __zoneEnter('refs');
    const item = box(value);
    const keyRef = box(key);
    __zoneExit('refs');
    __zoneEnter('body');
    const block = withScope(scope, () => blockOf(getItem(item, keyRef)));
    __zoneExit('body');
    if (!block.scopes) block.scopes = [];
    block.scopes.push(scope);
    if (parent) withInsertZone('ins1', () => insertBlock(block, parent, slot));
    const rec = { key, item, keyRef, scope, block };
    __zoneExit('item');
    return rec;
  };
  const dropItem = (it: ForItem): void => {
    removeBlock(it.block);
    needRx().stopScope(it.scope);
  };
  const syncScopes = (): void => {
    listBlock.scopes = items.map((it) => it.scope);
  };

  const owner = currentScope;
  const savedFx = fxTag;
  fxTag = 'forFx';
  const run = (): void => {
          const src = source();
          const count = typeof src === 'number' ? src : src.length;
          // number source: item is the VALUE (1..N), same as the ONCE path
          const value = (i: number): unknown => (typeof src === 'number' ? i + 1 : src[i]);

          if (getKey == null) {
            // non-keyed: the same-length prefix updates in place (the
            // item/key writes trigger each item's own effects); grow and
            // shrink at the tail
            let i = 0;
            for (; i < Math.min(items.length, count); i++) {
              items[i].item.value = value(i);
              items[i].keyRef.value = i;
            }
            for (; i < count; i++) items.push(buildItem(value(i), i));
            for (let k = items.length - 1; k >= count; k--) dropItem(items[k]);
            if (items.length > count) items.length = count;
            syncScopes();
            ensureAnchor();
            return;
          }

          // keyed: match by key. New items are inserted at `slot` (the end,
          // in front of the anchor). A backwards move runs only when that
          // left them out of wanted order.
          const prev = items;
          const kept = new Map<unknown, ForItem>();
          for (const it of prev) kept.set(it.key, it);
          const wanted: ForItem[] = [];
          const fresh = new Set<ForItem>();
          const used = new Set<unknown>();
          for (let i = 0; i < count; i++) {
            const key = getKey(value(i), i);
            const existing = kept.get(key);
            if (existing && !used.has(key)) {
              used.add(key);
              existing.item.value = value(i);
              existing.keyRef.value = key;
              wanted.push(existing);
            } else {
              const built = buildItem(value(i), key);
              fresh.add(built);
              wanted.push(built);
            }
          }
          for (const it of prev) {
            if (!used.has(it.key)) dropItem(it);
          }
          items = wanted;
          syncScopes();
          ensureAnchor();
          if (parent && forOutOfOrder(prev, wanted, fresh)) {
            const hostParent = parent;
            let cursor: HostNode | null = anchor;
            const reorder = (): void => {
              for (let i = items.length - 1; i >= 0; i--) {
                const block = items[i].block;
                for (let k = block.nodes.length - 1; k >= 0; k--) {
                  be().attach(block.nodes[k], hostParent, cursor);
                }
                cursor = block.nodes[0];
              }
            };
            if (__on) withInsertZone('ins2', reorder);
            else reorder();
          }
  };
  withScope(owner, () => {
    renderEffect(run);
  });
  fxTag = savedFx;
  return listBlock;
}

/** The dynamic text node of a template whose only dynamic part is one
 * inline text: the root itself (`<text>{{ i }}</text>`) or its first child
 * (`<view><text>{{ i }}</text></view>`). Anything else is not a cell the
 * batch cloner knows how to fill. */
function repeatTextIndex(def: TemplateDef): number | null {
  const root = def.nodes[0]?.children[0];
  if (root == null) return null;
  const rn = def.nodes[root];
  if (rn.inline || rn.kind === 'text') return root;
  if (rn.children.length === 1) {
    const c = rn.children[0];
    const cn = def.nodes[c];
    if (cn && (cn.inline || cn.kind === 'text')) return c;
  }
  return null;
}

/** A static v-for whose body is one template plus one text write of the
 * loop variable (compiler-vapor emits a per-cell renderEffect for that;
 * inlineVaporOnce rewrites it here). One batch of clones, one text write
 * each, no per-cell effect and no per-cell scope — that effect only existed
 * to track a value ONCE promises never changes. A body that reads anything
 * else stays on createFor. */
export function repeatTemplate(
  tpl: CompiledTemplate,
  source: () => number | unknown[],
  textAt: (item: { value: unknown }, key: { value: unknown }) => unknown,
  getKey?: (item: unknown, index: number) => unknown,
  flags = 0,
): Block {
  const def = tpl.def;
  const textIdx = def ? repeatTextIndex(def) : null;
  if ((flags & FOR_ONCE) === 0 || def == null || textIdx == null) {
    return createFor(
      source,
      (item, key) => {
        const n = tpl();
        const target = n.def.nodes[n.idx].inline || n.def.nodes[n.idx].kind === 'text' ? n : txt(child(n));
        setText(target, textAt(item, key));
        return n;
      },
      getKey,
      flags,
    );
  }
  const { parent, anchor: before } = takeInsertionState();
  const anchor = be().createAnchor('for');
  const listBlock: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] } = { nodes: [anchor], scopes: [], cleanups: [] };
  let slot: HostNode | null = anchor;
  let anchorPlaced = !parent;
  if (parent && before != null) {
    be().attach(anchor, parent, before);
    anchorPlaced = true;
  } else if (parent) {
    slot = null;
  }
  const src = source();
  const count = typeof src === 'number' ? src : src.length;
  const asElement = def.nodes[textIdx].kind !== 'text';
  const rootIdx = def.nodes[0].children[0];
  // one op for the whole list (specs/162): the initial texts ride with the
  // clone. The expressions themselves stay JS — the loop below only turns
  // them into strings; a backend that cannot batch returns null and every
  // cell pays instantiate + write + attach as before.
  const texts: string[] | null = count > 0 ? new Array(count) : null;
  if (texts !== null) {
    for (let i = 0; i < count; i++) {
      const v = typeof src === 'number' ? i + 1 : src[i];
      const text = textAt({ value: v }, { value: getKey ? getKey(v, i) : i });
      texts[i] = text == null ? '' : String(text);
    }
  }
  let copies: unknown[][] | null = null;
  if (count > 0 && parent) {
    copies = be().cloneList?.(def, count, parent, anchorPlaced ? anchor : null, textIdx, texts, tpl.html) ?? null;
  }
  if (copies === null) {
    copies = count > 0 ? be().instantiateMany(def, count, tpl.html) : [];
    for (let i = 0; i < count; i++) {
      const hosts = copies[i];
      const s = texts![i];
      if (asElement) be().setElementText(hosts[textIdx], s);
      else be().setText(hosts[textIdx], s);
      if (parent) be().attach(hosts[rootIdx], parent, slot);
    }
  }
  if (!anchorPlaced && parent) be().attach(anchor, parent, null);
  return listBlock;
}

/** The reactive twin of repeatTemplate: same structural cell (one template,
 * one text write — inlineVaporOnce only asks for the shape), but the text
 * expression may read anything (the flat-4050 grid reads its slot of the
 * `vals` prop), so each cell keeps one renderEffect on a single list scope.
 * What is still saved against a plain ONCE createFor is the per-cell
 * template machinery: the clones run as one batch and there is no per-cell
 * TplNode / child / txt / blockOf — the effect's first run IS the initial
 * write. ONCE items never drop on their own, so one scope covers teardown:
 * the enclosing subtree removal takes the hosts, stopping the scope stops
 * every effect. */
export function repeatTemplateLive(
  tpl: CompiledTemplate,
  source: () => number | unknown[],
  textAt: (item: { value: unknown }, key: { value: unknown }) => unknown,
  getKey?: (item: unknown, index: number) => unknown,
  flags = 0,
): Block {
  const def = tpl.def;
  const textIdx = def ? repeatTextIndex(def) : null;
  if ((flags & FOR_ONCE) === 0 || def == null || textIdx == null) {
    // Degenerate shape: per-cell instances, but the write the compiled
    // renderEffect used to do must stay reactive — re-create it here.
    return createFor(
      source,
      (item, key) => {
        const n = tpl();
        const target = n.def.nodes[n.idx].inline || n.def.nodes[n.idx].kind === 'text' ? n : txt(child(n));
        renderEffect(() => setText(target, textAt(item, key)));
        return n;
      },
      getKey,
      flags,
    );
  }
  const { parent, anchor: before } = takeInsertionState();
  const anchor = be().createAnchor('for');
  const listBlock: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] } = { nodes: [anchor], scopes: [], cleanups: [] };
  let slot: HostNode | null = anchor;
  let anchorPlaced = !parent;
  if (parent && before != null) {
    be().attach(anchor, parent, before);
    anchorPlaced = true;
  } else if (parent) {
    slot = null;
  }
  const src = source();
  const count = typeof src === 'number' ? src : src.length;
  const asElement = def.nodes[textIdx].kind !== 'text';
  const rootIdx = def.nodes[0].children[0];
  // the list in one op (specs/162), roots inserted by the engine; texts
  // stay per-cell — the effects own them
  const copies =
    count > 0 && parent
      ? (be().cloneList?.(def, count, parent, anchorPlaced ? anchor : null, null, null, tpl.html) ?? null)
      : null;
  const needAttach = copies === null;
  const cells = copies === null ? (count > 0 ? be().instantiateMany(def, count, tpl.html) : []) : copies;
  const owner = currentScope;
  withScope(owner, () => {
    const listScope = needRx().createScope();
    listBlock.scopes.push(listScope);
    withScope(listScope, () => {
      for (let i = 0; i < count; i++) {
        const v = typeof src === 'number' ? i + 1 : src[i];
        const key = getKey ? getKey(v, i) : i;
        // hoisted boxes: one allocation per cell, reused by every re-run
        const item = { value: v };
        const k = { value: key };
        const host = cells[i][textIdx];
        renderEffect(() => {
          const s = textAt(item, k);
          const text = s == null ? '' : String(s);
          if (asElement) be().setElementText(host, text);
          else be().setText(host, text);
        });
        if (needAttach && parent) be().attach(cells[i][rootIdx], parent, slot);
      }
      if (!anchorPlaced && parent) be().attach(anchor, parent, null);
    });
  });
  return listBlock;
}

export function createForSlots(
  _rawSource: unknown,
  _renderSlot: unknown,
  _getName: unknown,
  _getKey: unknown,
): never {
  throw new Error('[fjs vapor] dynamic slot lists (createForSlots) are not supported');
}

/** Stops a block's scopes and cleanups WITHOUT removing its hosts — the
 * adopt paths (VDOM owns the placeholder host) dispose this way. */
export function disposeBlock(block: Block): void {
  for (const s of block.scopes ?? []) needRx().stopScope(s);
  for (const cleanup of block.cleanups ?? []) cleanup();
}

/** TEMP: isolated costs of the flat-4050 mount, N = 2000 cells, same engine
 * as the profiled mount. The trees it creates are removed before return. */
export function __vaporMicro(): Record<string, number> {
  const N = 2000;
  const out: Record<string, number> = {};
  const time = (name: string, fn: () => void): void => {
    const t0 = __now();
    fn();
    out[name] = __now() - t0;
  };
  const scopes: unknown[] = new Array(N);
  time('scope', () => {
    for (let i = 0; i < N; i++) scopes[i] = needRx().createScope();
  });
  time('scopeRun', () => {
    for (let i = 0; i < N; i++) needRx().runInScope(scopes[i], () => undefined);
  });
  for (const s of scopes) needRx().stopScope(s);
  time('refs', () => {
    for (let i = 0; i < N; i++) {
      needRx().box(i);
      needRx().box(i);
    }
  });
  const runners: unknown[] = new Array(N);
  time('fxEmpty', () => {
    for (let i = 0; i < N; i++) runners[i] = needRx().effect(() => undefined, NO_SCHED);
  });
  for (const r of runners) needRx().stopEffect(r);
  time('fxTrack', () => {
    for (let i = 0; i < N; i++) {
      const r = needRx().box(i);
      runners[i] = needRx().effect(() => {
        void r.value;
      }, NO_SCHED);
    }
  });
  for (const r of runners) needRx().stopEffect(r);
  time('display', () => {
    for (let i = 0; i < N; i++) toDisplayString(i);
  });
  const cell = template('<view data-v-x class=cell><text data-v-x class=tiny> ');
  const nodes: TplNode[] = new Array(N);
  time('cellTpl', () => {
    for (let i = 0; i < N; i++) nodes[i] = cell();
  });
  const one = nodes[0];
  time('walk', () => {
    for (let i = 0; i < N; i++) txt(child(one));
  });
  time('block', () => {
    for (let i = 0; i < N; i++) blockOf(one);
  });
  time('cursors', () => {
    const inst = one.inst;
    for (let i = 0; i < N * 2; i++) new TplNode(inst, 1);
  });
  const textNode = txt(child(one));
  time('setText', () => {
    for (let i = 0; i < N; i++) setText(textNode, i);
  });
  for (const n of nodes) be().remove(n.host);
  time('keyedGlue', () => {
    for (let row = 0; row < 50; row++) {
      const kept = new Map<number, number>();
      const used = new Set<number>();
      const wanted: number[] = [];
      for (let i = 0; i < 40; i++) {
        if (kept.has(i) && !used.has(i)) {
          used.add(i);
          wanted.push(kept.get(i) as number);
        } else wanted.push(i);
      }
      void wanted;
    }
  });
  time('reorderScan', () => {
    for (let row = 0; row < 50; row++) {
      const siblings: number[] = [];
      for (let i = 0; i < 41; i++) siblings.push(i);
      let cursor = 40;
      for (let i = 39; i >= 0; i--) {
        const at = siblings.indexOf(i);
        if (at >= 0) siblings.splice(at, 1);
        const ai = siblings.indexOf(cursor);
        siblings.splice(ai < 0 ? siblings.length : ai, 0, i);
        cursor = i;
      }
    }
  });
  // Insert-only, nodes built outside the timer. `twice` is what keyed
  // createFor does on first mount: append-before-anchor, then move every
  // item before the anchor again.
  const rowT = template('<view class=row>');
  const forest = (): { rows: TplNode[]; cells: TplNode[][] } => {
    const rows: TplNode[] = [];
    const cells: TplNode[][] = [];
    for (let r = 0; r < 50; r++) {
      rows.push(rowT());
      const xs: TplNode[] = [];
      for (let i = 0; i < 40; i++) xs.push(cell());
      cells.push(xs);
    }
    return { rows, cells };
  };
  const timeIns = (mode: 'fast' | 'once' | 'twice'): number => {
    const holder = template('<view>')();
    const { rows, cells } = forest();
    const anchors: HostNode[] = [];
    for (let r = 0; r < 50; r++) anchors.push(be().createAnchor('for'));
    const t0 = __now();
    for (let r = 0; r < 50; r++) {
      be().attach(rows[r].host, holder.host, null);
      if (mode === 'fast') {
        for (let i = 0; i < 40; i++) be().attach(cells[r][i].host, rows[r].host, null);
      } else {
        be().attach(anchors[r], rows[r].host, null);
        for (let i = 0; i < 40; i++) be().attach(cells[r][i].host, rows[r].host, anchors[r]);
        if (mode === 'twice') {
          let cursor = anchors[r];
          for (let i = 39; i >= 0; i--) {
            be().attach(cells[r][i].host, rows[r].host, cursor);
            cursor = cells[r][i].host;
          }
        }
      }
    }
    const dt = __now() - t0;
    be().remove(holder.host);
    return dt;
  };
  out.fastIns = timeIns('fast');
  out.slowOnce = timeIns('once');
  out.slowTwice = timeIns('twice');
  // The ONCE cell, layered, 50×40, nodes created inside the timer (what the
  // mount actually does). Each layer adds one piece of the compiled callback.
  const layer = (mode: 'host' | 'text' | 'fx' | 'full'): number => {
    const holder = template('<view>')();
    const runners: unknown[] = [];
    const scopes: unknown[] = [];
    const t0 = __now();
    for (let r = 0; r < 50; r++) {
      const row = rowT();
      be().attach(row.host, holder.host, null);
      for (let i = 0; i < 40; i++) {
        if (mode === 'host') {
          be().attach(cell().host, row.host, null);
        } else if (mode === 'text') {
          const n = cell();
          setText(txt(child(n)), toDisplayString(i));
          be().attach(n.host, row.host, null);
        } else if (mode === 'fx') {
          const n = cell();
          const x = txt(child(n));
          const key = { value: i };
          runners.push(needRx().effect(() => setText(x, toDisplayString(key.value)), NO_SCHED));
          be().attach(n.host, row.host, null);
        } else {
          const scope = needRx().createScope();
          scopes.push(scope);
          const key = { value: i };
          const block = needRx().runInScope(scope, () => {
            const n = cell();
            const x = txt(child(n));
            needRx().effect(() => setText(x, toDisplayString(key.value)), NO_SCHED);
            return blockOf(n);
          }) as Block;
          be().attach(block.nodes[0], row.host, null);
        }
      }
    }
    const dt = __now() - t0;
    for (const s of scopes) needRx().stopScope(s);
    for (const rn of runners) needRx().stopEffect(rn);
    be().remove(holder.host);
    return dt;
  };
  out.layerHost = layer('host');
  out.layerText = layer('text');
  out.layerFx = layer('fx');
  out.layerFull = layer('full');
  const nCal = 20000;
  let t0 = __now();
  for (let i = 0; i < nCal; i++) __now();
  out.nowCall = (__now() - t0) / nCal;
  __profOn(true);
  t0 = __now();
  for (let i = 0; i < nCal; i++) {
    __zoneEnter('cal');
    __zoneExit('cal');
  }
  out.calPair = (__now() - t0) / nCal;
  out.calInside = (__prof.cal ?? 0) / (__prof.calN || 1);
  __profOn(false);
  return out;
}
