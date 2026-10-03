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
  /** Called for a scope that is about to stop, BEFORE its hosts leave the
   * tree (specs/167) — the binding's beforeUnmount point. Optional: an
   * engine with no component layer (the Solid seam test) leaves it out. */
  beforeStopScope?(scope: S): void;
}

let rx: HostReactivity | null = null;

/** The binding calls this at module init, before any helper can run. The
 * last caller wins (a test may re-inject another engine). */
export function setHostReactivity(impl: HostReactivity): void {
  rx = impl;
}

/** opts for an effect nobody schedules — the micro bench's tight loops. */
const NO_SCHED = { scheduler: () => {}, onStop: () => {} };

/** Runs after every flushed effect job (specs/167): the binding fires the
 * mounted hooks of components a re-run created — their hosts are in the
 * tree by the time the job returns. */
let jobHook: (() => void) | null = null;
export function setVaporJobHook(fn: (() => void) | null): void {
  jobHook = fn;
}

/** Where a throwing effect goes (specs/167): the binding routes it to the
 * app's errorHandler. One bad effect must not take the rest of its batch —
 * or the queue — down with it. */
let errorReporter: (err: unknown, info: string) => void = (err) => {
  console.error('[fjs vapor] effect error:', err);
};
export function setVaporErrorReporter(fn: (err: unknown, info: string) => void): void {
  errorReporter = fn;
}
export function reportVaporError(err: unknown, info: string): void {
  try {
    errorReporter(err, info);
  } catch (e) {
    console.error('[fjs vapor] error handler threw:', e, 'while reporting', err);
  }
}

/** Anchors (v-if / v-for / slot placeholders) a block may consist of —
 * attrs fallthrough must never land on one (specs/170). */
const anchorHosts = new WeakSet<object>();
export function makeAnchor(label: string): HostNode {
  const a = be().createAnchor(label);
  if (a && typeof a === 'object') anchorHosts.add(a as object);
  return a;
}
export function isAnchorHost(host: unknown): boolean {
  return !!host && typeof host === 'object' && anchorHosts.has(host as object);
}

function beforeStop(scope: unknown): void {
  const hook = rx?.beforeStopScope;
  if (hook) hook.call(rx, scope);
}

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
  /** static attributes other than class / scope (`src`, `name`,
   * `placeholder`…), in template order — specs/171: the Flutter backend
   * dropped them (its native clone carries class + scope only), so every
   * `<image src>` / `<input placeholder>` in a vapor template lost its
   * value. A backend that clones from the HTML keeps them on its own. */
  attrs?: [string, string][] | null;
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
   * component's slot contract. Optional: the pure-vapor web surface
   * (specs/166) omits it, and createComponent then rejects VDOM components
   * with a plain error. */
  mountVdomComponent?(
    comp: Record<string, unknown>,
    props: Record<string, unknown>,
    slots: Slots,
    parent: HostNode | null,
    anchor: HostNode | null,
    /** the vapor parent's provides and app context (specs/182) */
    ctx?: {
      provides?: Record<string | symbol, unknown> | null;
      appContext?: unknown;
      /** the scoped-style id the component's root takes (Vue: the parent's,
       * or the slot author's for slot content) */
      scopeId?: string | null;
      /** registers the VDOM subtree's activated / deactivated runner */
      onKeepAlive?: (run: (kind: 'a' | 'da') => void) => void;
      /** Set while the vapor tree is not in the page yet: `cb` runs once its
       * hosts are in. The VDOM component's mounted hooks wait for it
       * (specs/199). Absent under a live parent. */
      afterMount?: (cb: () => void) => void;
    },
  ): Block;
  /** v-bind() in CSS (specs/166): write the useVaporCssVars variable map
   * onto [host] as inline custom properties. Optional — a backend without
   * it silently drops the vars. Keys are custom-property names (engine
   * convention, `--` implied), values their current values. */
  setCssVars?(host: HostNode, vars: Record<string, unknown>): void;
  // ---- specs/170: what compiler-vapor's remaining helpers need. All
  // optional — the shared helpers (helpers.ts) fall back or warn when a
  // backend has no counterpart (constitution V: never a ReferenceError).
  /** `:value` on input/textarea/select (a DOM property on web, the fjs
   * input's `value` prop on Flutter). Default: setAttr. */
  setValue?(host: HostNode, value: unknown): void;
  /** A DOM property write (`.prop` / `^attr` binding). Default: setAttr. */
  setDOMProp?(host: HostNode, key: string, value: unknown): void;
  /** v-html. Absent = no HTML parser here: the helper writes text. */
  setHtml?(host: HostNode, html: string): void;
  /** The host's current class string — the static template classes a
   * fallthrough class merges with. */
  classOf?(host: HostNode): string;
  /** v-model on a text field: which event carries an edit (`lazy`: the
   * commit event) and how to read the field's text out of its payload.
   * Absent = text v-model unsupported. */
  textModel?: {
    event(lazy: boolean): string;
    read(payload: unknown, host: HostNode): string;
  };
  /** v-model on checkbox / radio / select (DOM only). Returns false when
   * the backend has no such control. */
  applyChoiceModel?(
    host: HostNode,
    kind: 'checkbox' | 'radio' | 'select' | 'dynamic',
    get: () => unknown,
    set: (v: unknown) => void,
    modifiers: Record<string, boolean | undefined>,
  ): boolean;
  /** `<component :is="'tag'">`: a bare element of that tag, unattached. */
  createElement?(tag: string): HostNode;
  /** The host's current parent (render-host re-places a changed root). */
  parentNode?(host: HostNode): HostNode | null;
  /** <Transition>'s platform half (specs/174); without it Transition only
   * runs its JS hooks. */
  transition?: TransitionBackend;
  /** <Teleport to="…">'s target (specs/175): the DOM's querySelector on
   * web; on Flutter `body` / `html` name the app overlay host. */
  querySelector?(selector: string): HostNode | null;
}

/** What <Transition> needs from a platform: class flips that survive the
 * template's own class writes, a two-frame hop, and "this element's
 * transition / animation is over". */
export interface TransitionBackend {
  addClass(host: HostNode, cls: string): void;
  removeClass(host: HostNode, cls: string): void;
  nextFrame(cb: () => void): void;
  /** Calls `cb` when the element's running transition / animation ends;
   * `explicitMs` (the `duration` prop) overrides the measurement. */
  whenEnds(host: HostNode, explicitMs: number | undefined, cb: () => void): void;
  /** Only elements animate (anchors, text runs do not). */
  isElement(host: HostNode): boolean;
  /** The element's box in window coordinates, read synchronously (a
   * <TransitionGroup> move pass, specs/176). */
  rectOf(host: HostNode): { left: number; top: number };
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

// ---- live node lists (specs/181) ----------------------------------------------------
//
// A fragment (v-if / v-for / dynamic component) changes its `nodes` IN
// PLACE when it switches. A block built over several parts — a multi-root
// template or slot returning `[text, <Comp/>, <view v-if>]` — lists the
// parts' hosts flattened, so it has to hear about those changes, or the
// enclosing removal would leave the new hosts behind.

const nodeWatchers = new WeakMap<readonly HostNode[], Set<() => void>>();

/** A `nodes` array was changed in place: blocks derived from it follow. */
export function nodesChanged(nodes: readonly HostNode[]): void {
  const set = nodeWatchers.get(nodes);
  if (set) for (const fn of [...set]) fn();
}

function watchNodes(nodes: readonly HostNode[], fn: () => void): () => void {
  let set = nodeWatchers.get(nodes);
  if (!set) nodeWatchers.set(nodes, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

const isBlockLike = (node: unknown): node is Block =>
  !!node && typeof node === 'object' && !(node instanceof TplNode) && Array.isArray((node as Block).nodes);

/** What setup() may return: a template node, a bare host, a block, a list,
 * nothing (a component that renders only anchors). */
export function blockOf(node: unknown): Block {
  if (node instanceof TplNode) return { nodes: [node.host] };
  if (Array.isArray(node)) {
    // a one-item list is that item — sharing its `nodes` keeps a fragment
    // findable by switchOf / listOf (a <Transition> slot returns `[frag]`)
    if (node.length === 1) {
      const only = blockOf(node[0]);
      return { nodes: only.nodes };
    }
    const parts = node.map((n) => (Array.isArray(n) || isBlockLike(n) ? blockOf(n) : hostOf(n)));
    if (!parts.some(isBlockLike)) return { nodes: parts as HostNode[] };
    // the parts' scopes stay with whoever owns them (as before): this list
    // only tracks where their hosts are
    const nodes: HostNode[] = [];
    const sync = (): void => {
      const flat: HostNode[] = [];
      for (const p of parts) {
        if (isBlockLike(p)) flat.push(...p.nodes);
        else flat.push(p);
      }
      nodes.splice(0, nodes.length, ...flat);
    };
    sync();
    for (const p of parts) {
      if (isBlockLike(p)) {
        watchNodes(p.nodes, () => {
          sync();
          nodesChanged(nodes);
        });
      }
    }
    return { nodes };
  }
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

/** Removes a block's hosts and tears down everything created for it. The
 * beforeStop pass comes first: beforeUnmount hooks still see their hosts. */
export function removeBlock(block: Block): void {
  for (const s of block.scopes ?? []) beforeStop(s);
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
  // the compiler's appendIndex form: a NUMBER means APPEND (specs/169). It
  // is the block's LOGICAL index (a `<!>` placeholder or an earlier dynamic
  // block counts as one unit), which Vue only uses to locate hydration
  // targets. compiler-vapor emits it only for a block after the parent's
  // last template node — anything earlier gets a `<!>` placeholder anchor —
  // and blocks are created in source order, so appending lands each one
  // right. Reading it as a raw child index broke once an earlier v-if in the
  // same parent had inserted its anchor and branch.
  insertionAnchor = anchor == null || typeof anchor === 'number' ? null : hostOf(anchor);
}

export function takeInsertionState(): { parent: HostNode | null; anchor: HostNode | null } {
  const state = { parent: insertionParent, anchor: insertionAnchor };
  insertionParent = insertionAnchor = null;
  return state;
}

/** Template nodes, blocks and bare hosts all flow through compiled code;
 * every helper boundary unwraps. */
export function hostOf(node: unknown): HostNode {
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
      let rest: [string, string][] | null = null;
      for (const [k, v] of attrs) {
        if (k === 'class') classes = v;
        else if (v === '' && k.startsWith('data-v-') && scope === null) scope = k;
        else (rest ??= []).push([k, v]);
      }
      const idx = addNode({ kind: 'element', tag, inline: false, raw: '', classes, scope, attrs: rest });
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
export function setClass(node: TplNode | HostNode, value: unknown): void {
  const host = node instanceof TplNode ? node.host : node;
  const cls = value == null ? '' : normalizeClass(value as never);
  const layer = classLayers.get(host as object);
  if (layer) {
    layer.own = cls;
    writeClasses(host);
    return;
  }
  be().setClasses(host, cls);
}

export function setClassName(node: TplNode, value: string): void {
  setClass(node, value);
}

/** DOM merge semantics against what this element already has — the applied
 * record kept per host, so a second writer (component root + fallthrough)
 * merges instead of replacing. */
const styleRecords = new WeakMap<object, Record<string, unknown>>();

/** The keys this element's own `:style` binding wrote last time (specs/198).
 * A binding that returns `{}` after `{ transform }` must take the transform
 * off, as VDOM's patchStyle(prev, next) does; the merge above only ever adds.
 * Removing exactly what the binding itself wrote — not replacing the record —
 * keeps the keys other writers put there (fallthrough style, v-show). */
const boundStyleKeys = new WeakMap<object, string[]>();

export function setStyle(node: TplNode, value: Record<string, unknown>): void {
  const current = styleRecords.get(node.host as object) ?? null;
  const merged: Record<string, unknown> = { ...current };
  const wrote = boundStyleKeys.get(node.host as object);
  if (wrote) for (const k of wrote) if (!(k in value)) delete merged[k];
  boundStyleKeys.set(node.host as object, Object.keys(value));
  for (const k in value) {
    const v = value[k];
    if (v == null || v === '') delete merged[k];
    else merged[k] = v;
  }
  be().patchStyle(node.host, current, merged);
  styleRecords.set(node.host as object, merged);
}

/** Bound values per element, once an object-hook (VDOM) directive is in
 * use: such a directive reads its element's props off `vnode.props`
 * (@vueuse/motion's `:initial` / `:enter`), and a vapor element has no
 * vnode — the adapter in runtime.ts hands it this record (specs/181). Off
 * until the first such directive resolves, so plain pages pay one branch. */
let recordProps = false;
const boundProps = new WeakMap<object, Record<string, unknown>>();

export function recordBoundProps(): void {
  recordProps = true;
}

export function boundPropsOf(host: HostNode): Record<string, unknown> {
  let rec = boundProps.get(host as object);
  if (!rec) boundProps.set(host as object, (rec = {}));
  return rec;
}

export function setAttr(node: TplNode, key: string, value: unknown): void {
  if (recordProps) boundPropsOf(node.host)[key] = value;
  be().setAttr(node.host, key, value);
}

export function setProp(node: TplNode, key: string, value: unknown): void {
  setAttr(node, key, value);
}

/** v-show / the `show` helper: one inline-layer key, like runtime-dom's
 * vShow — everything else stays with the cascade. */
export function show(node: TplNode, value: unknown): void {
  showHost(node.host, value);
}

export function showHost(host: HostNode, value: unknown): void {
  const current = styleRecords.get(host as object) ?? null;
  const next = { ...current };
  if (value) delete next.display;
  else next.display = 'none';
  be().patchStyle(host, current, next);
  styleRecords.set(host as object, next);
}

/** setStyle against a bare host (fallthrough / dynamic props). */
export function setStyleHost(host: HostNode, value: Record<string, unknown>): void {
  const current = styleRecords.get(host as object) ?? null;
  const merged: Record<string, unknown> = { ...current };
  for (const k in value) {
    const v = value[k];
    if (v == null || v === '') delete merged[k];
    else merged[k] = v;
  }
  be().patchStyle(host, current, merged);
  styleRecords.set(host as object, merged);
}

// Class layers (specs/170): a component root's own class (its template's
// static classes, then its :class) and the class a parent passes through
// attrs are written independently and joined — setClass used to replace
// the whole list, so fallthrough had nowhere to go.
const classLayers = new WeakMap<object, { own: string | null; fall: string }>();

function writeClasses(host: HostNode): void {
  const layer = classLayers.get(host as object);
  if (!layer) return;
  const own = layer.own ?? '';
  be().setClasses(host, layer.fall ? (own ? own + ' ' + layer.fall : layer.fall) : own);
}

function layerOf(host: HostNode): { own: string | null; fall: string } {
  let layer = classLayers.get(host as object);
  if (!layer) {
    layer = { own: null, fall: '' };
    classLayers.set(host as object, layer);
  }
  return layer;
}

/** The fallthrough half: the static template classes are read once, the
 * first time anything falls through onto this host. */
export function setFallthroughClass(host: HostNode, value: unknown): void {
  const layer = layerOf(host);
  if (layer.own === null) layer.own = be().classOf?.(host) ?? '';
  layer.fall = value == null ? '' : normalizeClass(value as never);
  writeClasses(host);
}

// ---- events --------------------------------------------------------------------------

/** Listeners per (host, key), dispatched by ONE backend registration
 * (specs/170). The Flutter backend keeps a single handler per event key
 * (patchProp), so a second `on` for the same key — a component root's own
 * `@tap` plus the parent's fallthrough `@tap`, v-on="obj" next to `@tap` —
 * used to replace the first; the DOM would have stacked them. Now both ends
 * stack, in registration order. */
const listeners = new WeakMap<object, Map<string, ((...args: unknown[]) => void)[]>>();

export function addListener(host: HostNode, key: string, fn: (...args: unknown[]) => void): () => void {
  let map = listeners.get(host as object);
  if (!map) {
    map = new Map();
    listeners.set(host as object, map);
  }
  let list = map.get(key);
  if (!list) {
    const fresh: ((...args: unknown[]) => void)[] = [];
    list = fresh;
    map.set(key, fresh);
    be().on(host, key, (...args: unknown[]) => {
      for (const f of fresh.slice()) f(...args);
    });
  }
  list.push(fn);
  const own = list;
  return () => {
    const at = own.indexOf(fn);
    if (at >= 0) own.splice(at, 1);
  };
}

export function on(node: TplNode | HostNode, event: string, handler: unknown, options?: { once?: boolean }): void {
  const host = node instanceof TplNode ? node.host : node;
  const key = toHandlerKey(camelize(event));
  let remove: () => void = () => {};
  const fn = options?.once
    ? (...args: unknown[]) => {
        remove();
        (handler as (...a: unknown[]) => void)(...args);
      }
    : (handler as (...a: unknown[]) => void);
  remove = addListener(host, key, fn);
}

export function off(node: TplNode | HostNode, event: string): void {
  const host = node instanceof TplNode ? node.host : node;
  const key = toHandlerKey(camelize(event));
  listeners.get(host as object)?.get(key)?.splice(0);
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
        if (!alive()) continue;
        try {
          run();
        } catch (e) {
          reportVaporError(e, 'vapor effect');
        }
        if (jobHook) jobHook();
      }
    });
  }
}

/** Tracks what fn reads and re-runs it — batched over a microtask, the
 * scheduling runtime-vapor uses — when any of it changes. Runs fn once now;
 * call inside withScope so the first run (and anything it constructs) lands
 * in the enclosing scope. Neither 3.5 nor 3.6 exposes ReactiveEffect's
 * active flag, so liveness goes through onStop. */
/** v-once (specs/170): inside withOnce, a renderEffect runs its body once
 * and tracks nothing — the content never updates, which is the point. */
let inOnce = false;
export function withOnce<T>(fn: () => T, value = true): T {
  if (inOnce === value) return fn();
  const prev = inOnce;
  inOnce = value;
  try {
    return fn();
  } finally {
    inOnce = prev;
  }
}

export function renderEffect(fn: () => unknown): void {
  if (inOnce) {
    fn();
    return;
  }
  const scope = currentScope;
  let alive = true;
  // one queue entry per effect per flush (specs/167): five writes in one
  // handler used to run a v-for reconcile five times. Cleared BEFORE the
  // run, so a trigger the run itself causes queues again (the engine drops
  // self-triggers while running, so this cannot spin).
  let pending = false;
  let runner: () => unknown = () => {};
  const job = (): void => {
    pending = false;
    if (scope) withScope(scope, () => runner());
    else runner();
  };
  const opts = {
    scheduler: () => {
      if (pending) return;
      pending = true;
      enqueue(job, () => alive);
    },
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


// ---- switching fragments (v-if, :key, <component :is>) ------------------------------

/** One rendered branch of a switching fragment. `owner` / `insts` let the
 * component layer find the components mounted directly in it (KeepAlive
 * matches and activates them, specs/174). */
export interface Branch {
  key: unknown;
  nodes: HostNode[];
  scope: unknown;
  cleanups: (() => void)[];
  owner: unknown;
  insts?: unknown[];
  /** In KeepAlive's hands: a leave animation still owes it the move into
   * storage — unless a switch back took it first. */
  retiring?: boolean;
}

/** What <Transition> hangs on a fragment (specs/174). `enter` / `leave`
 * get the branch's hosts; `leave`'s done removes them. */
export interface SwitchTransition {
  readonly mode?: unknown;
  enter(nodes: readonly HostNode[], done?: () => void): void;
  leave(nodes: readonly HostNode[], done: () => void): void;
}

/** What <KeepAlive> hangs on a fragment (specs/174). */
export interface SwitchKeepAlive {
  /** Whether this branch is to be kept instead of destroyed. */
  wants(branch: Branch): boolean;
  /** The branch left (its deactivated hooks); nodes still in place. */
  deactivate(branch: Branch): void;
  /** Its nodes may go now (after any leave animation). */
  store(branch: Branch): void;
  /** A kept branch for this key, removed from the cache. */
  take(key: unknown): Branch | undefined;
  /** A kept branch is back in the tree. */
  activate(branch: Branch): void;
}

export interface SwitchState {
  current: Branch | null;
  transition: SwitchTransition | null;
  keepAlive: SwitchKeepAlive | null;
}

/** Fragment → its switch, keyed by the fragment's own `nodes` array: blockOf
 * copies a Block but shares that array, so the switch is still found behind
 * a slot or a component boundary. */
const switches = new WeakMap<readonly HostNode[], SwitchState>();

/** What <TransitionGroup> hangs on a v-for list (specs/176): enter for new
 * items, leave before a removed item's hosts go, and the move pass around
 * each update (positions before, FLIP after — kept items only). */
export interface ListTransition {
  enter(nodes: readonly HostNode[], done?: () => void): void;
  leave(nodes: readonly HostNode[], done: () => void): void;
  beforeUpdate?(hosts: readonly HostNode[]): void;
  afterUpdate?(hosts: readonly HostNode[]): void;
}

export interface ListState {
  transition: ListTransition | null;
}

/** List block → its state, keyed by the live `nodes` array like switches. */
const lists = new WeakMap<readonly HostNode[], ListState>();

/** The v-for list behind a block a slot returned, if it is one. */
export function listOf(block: unknown): ListState | undefined {
  const nodes = (block as Block | null)?.nodes;
  return nodes ? lists.get(nodes) : undefined;
}

/** The switch behind a block a slot / component returned, if it is one. */
export function switchOf(block: unknown): SwitchState | undefined {
  const nodes = (block as Block | null)?.nodes;
  return nodes ? switches.get(nodes) : undefined;
}

/** The branch being rendered right now (the component layer records the
 * components mounted in it), and who owns it. */
let renderingBranch: Branch | null = null;
let branchOwner: () => unknown = () => null;

export function setBranchOwnerResolver(fn: () => unknown): void {
  branchOwner = fn;
}

export function currentBranch(): Branch | null {
  return renderingBranch;
}

/** Stops a branch's scope and runs its cleanups, its hosts left alone. The
 * beforeStop pass first: beforeUnmount hooks still see their hosts. */
function disposeBranch(branch: Branch): void {
  beforeStop(branch.scope);
  needRx().stopScope(branch.scope);
  for (const cleanup of branch.cleanups) cleanup();
}

/** The shared machinery of v-if, keyed blocks and dynamic components: an
 * anchor holds the spot, each branch renders into a fresh scope whose
 * effects die with it. `swap` replaces the branch; a <Transition> or
 * <KeepAlive> around the fragment changes how the old one leaves and where
 * the new one comes from (specs/174). */
function createSwitch(label: string): {
  frag: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] };
  swap: (key: unknown, render: () => unknown) => void;
} {
  const { parent: insertedInto, anchor: before } = takeInsertionState();
  const anchor = makeAnchor(label);
  if (insertedInto) be().attach(anchor, insertedInto, before);
  const frag: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] } = { nodes: [anchor], scopes: [], cleanups: [] };
  const state: SwitchState = { current: null, transition: null, keepAlive: null };
  switches.set(frag.nodes, state);
  const owner = currentScope;
  /** Hosts of left branches whose leave animation is still running. */
  const leaving = new Set<HostNode>();
  let outIn: { key: unknown; render: () => unknown } | null = null;
  let outInLeaving = false;
  let disposed = false;
  let unwatchBranch: (() => void) | null = null;

  // a fragment created as a component's / slot's root had no insertion
  // point: it joined the tree with its block, so ask where it is now
  const parentNow = (): HostNode | null => insertedInto ?? be().parentNode?.(anchor) ?? null;

  const renderBranch = (key: unknown, render: () => unknown): Branch => {
    const scope = needRx().createScope();
    const branch: Branch = { key, nodes: [], scope, cleanups: [], owner: branchOwner() };
    const prev = renderingBranch;
    renderingBranch = branch;
    let block: Block;
    try {
      block = withScope(scope, () => blockOf(render()));
    } catch (e) {
      needRx().stopScope(scope);
      throw e;
    } finally {
      renderingBranch = prev;
    }
    // shared, not copied: content that is itself a fragment changes it in
    // place, and the switch follows (specs/181)
    branch.nodes = block.nodes as HostNode[];
    if (block.cleanups) branch.cleanups.push(...block.cleanups);
    return branch;
  };

  const mount = (key: unknown, render: () => unknown, animate: boolean, afterEnter?: () => void): void => {
    const cached = state.keepAlive?.take(key);
    if (cached) cached.retiring = false;
    const branch = cached ?? withScope(owner, () => renderBranch(key, render));
    const parent = parentNow();
    if (parent) for (const node of branch.nodes) be().attach(node, parent, anchor);
    frag.nodes.push(...branch.nodes);
    unwatchBranch?.();
    unwatchBranch = watchNodes(branch.nodes, () => {
      if (state.current !== branch) return;
      frag.nodes.splice(1, frag.nodes.length - 1, ...branch.nodes);
      nodesChanged(frag.nodes);
    });
    nodesChanged(frag.nodes);
    frag.scopes.length = 0;
    frag.scopes.push(branch.scope);
    state.current = branch;
    // Vue's KeepAlive activates a kept component on its first mount too
    const keep = state.keepAlive;
    if (cached) keep!.activate(cached);
    else if (keep && keep.wants(branch)) keep.activate(branch);
    const t = state.transition;
    if (animate && t) t.enter(branch.nodes, afterEnter);
    else afterEnter?.();
  };

  /** Takes the current branch out of the fragment and lets it go: kept by a
   * KeepAlive or destroyed, its hosts removed (or stored) once any leave
   * animation is over. */
  const retire = (branch: Branch, after?: () => void): void => {
    frag.nodes.length = 1;
    unwatchBranch?.();
    unwatchBranch = null;
    nodesChanged(frag.nodes);
    frag.scopes.length = 0;
    state.current = null;
    const keep = state.keepAlive;
    const kept = keep !== null && keep.wants(branch);
    const t = state.transition && !disposed ? state.transition : null;
    if (kept) {
      keep.deactivate(branch);
      branch.retiring = true;
    } else if (t) {
      // unmounted now (as Vue does); the hosts stay for the leave animation
      disposeBranch(branch);
    } else {
      // no animation: beforeUnmount sees its hosts, unmounted sees them gone
      beforeStop(branch.scope);
    }
    const finish = (): void => {
      for (const node of branch.nodes) leaving.delete(node);
      if (kept) {
        if (branch.retiring) {
          branch.retiring = false;
          keep.store(branch);
        }
      } else {
        for (let i = branch.nodes.length - 1; i >= 0; i--) be().remove(branch.nodes[i]);
        if (!t) {
          needRx().stopScope(branch.scope);
          for (const cleanup of branch.cleanups) cleanup();
        }
      }
      after?.();
    };
    if (t) {
      for (const node of branch.nodes) leaving.add(node);
      t.leave(branch.nodes, finish);
    } else {
      finish();
    }
  };

  const swap = (key: unknown, render: () => unknown): void => {
    const old = state.current;
    const t = state.transition;
    const mode = t?.mode;
    if (mode === 'out-in' && (old || outInLeaving)) {
      // the new branch renders once the old one has left; a switch in the
      // meantime only changes WHICH branch that will be
      outIn = { key, render };
      if (outInLeaving) return;
      outInLeaving = true;
      retire(old!, () => {
        outInLeaving = false;
        const next = outIn;
        outIn = null;
        if (next && !disposed) mount(next.key, next.render, true);
      });
      return;
    }
    if (old && mode === 'in-out') {
      frag.nodes.length = 1;
      nodesChanged(frag.nodes);
      state.current = null;
      mount(key, render, true, () => {
        if (!disposed) retire(old);
      });
      return;
    }
    if (old) retire(old);
    mount(key, render, old !== null);
  };

  // an enclosing removal: the current branch goes with the fragment's hosts
  // (removeBlock removes frag.nodes, stops frag.scopes, then runs these)
  frag.cleanups.push(() => {
    disposed = true;
    const cur = state.current;
    if (cur) {
      needRx().stopScope(cur.scope);
      for (const cleanup of cur.cleanups) cleanup();
    }
    for (const node of leaving) be().remove(node);
    leaving.clear();
  });
  return { frag, swap };
}

/** A v-if position. The branch only changes when the condition's TRUTH
 * does (specs/167): `v-if="n > 5"` going 6 → 7 re-ran this effect, and it
 * used to tear the branch down and rebuild it — losing every bit of state
 * inside. `flags` carry the compiler's shape / keyed-index / once hints —
 * the general path is correct for all of them, so they are not read. */
export function createIf(condition: () => unknown, positive?: () => unknown, negative?: () => unknown, flags = 1): Block {
  void flags;
  const { frag, swap } = createSwitch('if');
  const savedFx = fxTag;
  fxTag = 'ifFx';
  withScope(currentScope, () => {
    let shown: boolean | null = null;
    renderEffect(() => {
      const next = !!condition();
      if (next === shown) return;
      shown = next;
      swap(next, () => (next ? positive?.() : negative?.()));
    });
  });
  fxTag = savedFx;
  return frag;
}

/** A block keyed on a value (specs/170): `<view :key="k">`, `<template v-if
 * :key>`, `<component :is>` (specs/174) — when the key changes the content
 * is torn down and rebuilt in a fresh scope, exactly like a v-if flipping. */
export function createKeyedFragment(key: () => unknown, render: (key: unknown) => unknown): Block {
  const { frag, swap } = createSwitch('key');
  let built = false;
  let last: unknown;
  withScope(currentScope, () => {
    renderEffect(() => {
      const k = key();
      if (built && Object.is(k, last)) return;
      built = true;
      last = k;
      swap(k, () => render(k));
    });
  });
  return frag;
}

/** The compiler stamps a block's key for the interop's benefit; the own
 * runtime keys through createKeyedFragment instead. */
export function setBlockKey(block: unknown, key: unknown): void {
  (block as { $key?: unknown }).$key = key;
}

// ---- v-for ----------------------------------------------------------------------------

const FAST_REMOVE = 1;

/** The list block's API the compiler talks to: a v-for whose items use a
 * selector (`:class="{ on: sel === item }"`) registers the selector's reset
 * through `onReset` (specs/170). Our selector keeps no cross-item state to
 * reset, so the hook only has to exist. */
function withListApi<T extends Block>(block: T): T & { onReset: (fn: () => void) => void } {
  (block as T & { onReset: (fn: () => void) => void }).onReset = () => {};
  return block as T & { onReset: (fn: () => void) => void };
}

interface ForItem {
  /** identity: the `:key` value (the index without one) */
  key: unknown;
  item: { value: unknown };
  /** the template's second alias: the index (array / number / iterable)
   * or the property name (object) — NOT the `:key` value */
  keyRef: { value: unknown };
  indexRef: { value: unknown };
  scope: unknown;
  block: Block;
}

/** A v-for source read the way Vue reads it (specs/181): a number counts
 * 1..N, arrays and strings by index, other iterables (Map, Set) through
 * their iterator, a plain object by its own keys. `key(i)` is what the
 * template's second alias sees. */
interface ForSource {
  count: number;
  value(i: number): unknown;
  key(i: number): unknown;
}

function forSource(src: unknown): ForSource {
  if (typeof src === 'number') return { count: src, value: (i) => i + 1, key: (i) => i };
  if (Array.isArray(src) || typeof src === 'string') {
    const list = src as ArrayLike<unknown>;
    return { count: list.length, value: (i) => list[i], key: (i) => i };
  }
  if (src && typeof src === 'object') {
    if (typeof (src as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
      const list = Array.from(src as Iterable<unknown>);
      return { count: list.length, value: (i) => list[i], key: (i) => i };
    }
    const keys = Object.keys(src);
    return { count: keys.length, value: (i) => (src as Record<string, unknown>)[keys[i]], key: (i) => keys[i] };
  }
  return { count: 0, value: () => undefined, key: (i) => i };
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
  source: () => unknown,
  getItem: (item: { value: unknown }, key: { value: unknown }, index: { value: unknown }) => unknown,
  getKey?: (item: unknown, key: unknown, index: number) => unknown,
  flags = 0,
): Block {
  const once = (flags & FOR_ONCE) !== 0;
  const { parent: insertedInto, anchor: before } = takeInsertionState();
  let parent = insertedInto;
  /** A list that is a slot's / component's root (specs/175): no insertion
   * point — its block joins the tree with whoever renders it, so `nodes`
   * must list the items (an enclosing removal, a render-host marker per
   * item), and later runs find the parent through the anchor. */
  const rootLevel = !insertedInto;
  const anchor = makeAnchor('for');
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
        // v-for="r in N" iterates r = 1..N (the index param stays 0-based)
        const src = forSource(source());
        const built: HostNode[] = [];
        for (let i = 0; i < src.count; i++) {
          const block = blockOf(getItem({ value: src.value(i) }, { value: src.key(i) }, { value: i }));
          if (parent) insertBlock(block, parent, slot);
          else built.push(...block.nodes);
        }
        ensureAnchor();
        if (rootLevel) {
          listBlock.nodes.splice(0, listBlock.nodes.length, ...built, anchor);
          nodesChanged(listBlock.nodes);
        }
      });
    });
    return withListApi(listBlock);
  }
  const box = (v: unknown): { value: unknown } => needRx().box(v);

  const buildItem = (value: unknown, key: unknown, srcKey: unknown, index: number): ForItem => {
    if (!__on) {
      const scope = needRx().createScope();
      const item = box(value);
      const keyRef = box(srcKey);
      const indexRef = box(index);
      const block = withScope(scope, () => blockOf(getItem(item, keyRef, indexRef)));
      if (!block.scopes) block.scopes = [];
      block.scopes.push(scope);
      if (parent) insertBlock(block, parent, slot);
      return { key, item, keyRef, indexRef, scope, block };
    }
    __zoneEnter('item');
    __zoneEnter('scope');
    const scope = needRx().createScope();
    __zoneExit('scope');
    __zoneEnter('refs');
    const item = box(value);
    const keyRef = box(srcKey);
    const indexRef = box(index);
    __zoneExit('refs');
    __zoneEnter('body');
    const block = withScope(scope, () => blockOf(getItem(item, keyRef, indexRef)));
    __zoneExit('body');
    if (!block.scopes) block.scopes = [];
    block.scopes.push(scope);
    if (parent) withInsertZone('ins1', () => insertBlock(block, parent, slot));
    const rec = { key, item, keyRef, indexRef, scope, block };
    __zoneExit('item');
    return rec;
  };
  /** A <TransitionGroup> around the list (specs/176), hung on after it
   * rendered; and the hosts of removed items still playing their leave. */
  const listState: ListState = { transition: null };
  lists.set(listBlock.nodes, listState);
  const leaving = new Set<HostNode>();
  let listGone = false;
  const dropItem = (it: ForItem): void => {
    const t = listState.transition;
    if (!t || listGone) {
      removeBlock(it.block);
      needRx().stopScope(it.scope);
      return;
    }
    // unmounted now (Vue's order); the hosts stay for the leave animation
    disposeBlock(it.block);
    needRx().stopScope(it.scope);
    const nodes = [...it.block.nodes];
    for (const node of nodes) leaving.add(node);
    t.leave(nodes, () => {
      for (const node of nodes) {
        leaving.delete(node);
        be().remove(node);
      }
      syncNodes();
    });
  };
  listBlock.cleanups.push(() => {
    listGone = true;
    for (const node of leaving) be().remove(node);
    leaving.clear();
  });
  const syncScopes = (): void => {
    listBlock.scopes = items.map((it) => it.scope);
  };

  const owner = currentScope;
  const savedFx = fxTag;
  fxTag = 'forFx';
  /** Root-level lists: the hosts in order, anchor last. */
  const syncNodes = (): void => {
    if (!rootLevel) return;
    const nodes: HostNode[] = [];
    for (const it of items) nodes.push(...it.block.nodes);
    // leaving hosts are still in the tree: an enclosing removal takes them
    for (const node of leaving) nodes.push(node);
    nodes.push(anchor);
    listBlock.nodes.splice(0, listBlock.nodes.length, ...nodes);
    nodesChanged(listBlock.nodes);
  };
  let firstRun = true;
  const itemHosts = (list: readonly ForItem[]): HostNode[] => {
    const out: HostNode[] = [];
    for (const it of list) out.push(...it.block.nodes);
    return out;
  };
  const run = (): void => {
    const t = firstRun ? null : listState.transition;
    firstRun = false;
    if (!t) {
      reconcile();
      return;
    }
    const before = new Set(items);
    t.beforeUpdate?.(itemHosts(items));
    reconcile();
    // new items take their enter-from classes FIRST: the move pass below
    // reads layout, and a style flush that saw a new item without them
    // starts a visible→hidden transition the enter then cuts short (the
    // order Vue's TransitionGroup has — enter hooks run during the patch,
    // the move pass after it)
    for (const it of items) if (!before.has(it)) t.enter(it.block.nodes);
    // kept items that moved slide (FLIP)
    t.afterUpdate?.(itemHosts(items.filter((it) => before.has(it))));
  };
  const reconcile = (): void => {
          // a root-level list is in the tree once its anchor is
          if (rootLevel) parent = be().parentNode?.(anchor) ?? null;
          const src = forSource(source());
          const count = src.count;
          const value = src.value;

          if (getKey == null) {
            // non-keyed: the same-length prefix updates in place (the
            // item/key writes trigger each item's own effects); grow and
            // shrink at the tail
            let i = 0;
            for (; i < Math.min(items.length, count); i++) {
              items[i].item.value = value(i);
              items[i].keyRef.value = src.key(i);
              items[i].indexRef.value = i;
            }
            for (; i < count; i++) items.push(buildItem(value(i), i, src.key(i), i));
            for (let k = items.length - 1; k >= count; k--) dropItem(items[k]);
            if (items.length > count) items.length = count;
            syncScopes();
            ensureAnchor();
            syncNodes();
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
            const key = getKey(value(i), src.key(i), i);
            const existing = kept.get(key);
            if (existing && !used.has(key)) {
              used.add(key);
              existing.item.value = value(i);
              existing.keyRef.value = src.key(i);
              existing.indexRef.value = i;
              wanted.push(existing);
            } else {
              const built = buildItem(value(i), key, src.key(i), i);
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
          syncNodes();
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
  return withListApi(listBlock);
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
  source: () => unknown,
  textAt: (item: { value: unknown }, key: { value: unknown }, index: { value: unknown }) => unknown,
  getKey?: (item: unknown, key: unknown, index: number) => unknown,
  flags = 0,
): Block {
  const def = tpl.def;
  const textIdx = def ? repeatTextIndex(def) : null;
  if ((flags & FOR_ONCE) === 0 || def == null || textIdx == null) {
    return createFor(
      source,
      (item, key, index) => {
        const n = tpl();
        const target = n.def.nodes[n.idx].inline || n.def.nodes[n.idx].kind === 'text' ? n : txt(child(n));
        setText(target, textAt(item, key, index));
        return n;
      },
      getKey,
      flags,
    );
  }
  const { parent, anchor: before } = takeInsertionState();
  const anchor = makeAnchor('for');
  const listBlock: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] } = { nodes: [anchor], scopes: [], cleanups: [] };
  let slot: HostNode | null = anchor;
  let anchorPlaced = !parent;
  if (parent && before != null) {
    be().attach(anchor, parent, before);
    anchorPlaced = true;
  } else if (parent) {
    slot = null;
  }
  const src = forSource(source());
  const count = src.count;
  const asElement = def.nodes[textIdx].kind !== 'text';
  const rootIdx = def.nodes[0].children[0];
  // one op for the whole list (specs/162): the initial texts ride with the
  // clone. The expressions themselves stay JS — the loop below only turns
  // them into strings; a backend that cannot batch returns null and every
  // cell pays instantiate + write + attach as before.
  const texts: string[] | null = count > 0 ? new Array(count) : null;
  if (texts !== null) {
    for (let i = 0; i < count; i++) {
      const text = textAt({ value: src.value(i) }, { value: src.key(i) }, { value: i });
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
  // a slot / component root (no insertion point): the cells join the tree
  // with the block, so they are its nodes (specs/181 — they were dropped)
  if (!parent) listBlock.nodes.splice(0, 0, ...copies.map((hosts) => hosts[rootIdx]));
  return withListApi(listBlock);
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
 * every effect.
 *
 * Why the per-cell effect stays (specs/197): a lazy one — write the initial
 * text untracked, subscribe on first change — misses every update before
 * that first change, because the dependencies are unknown until the
 * expression has run tracked; and tracking itself has a floor (one effect
 * for the whole list still costs ~4.5 ms of dep links per 2000 cells). What
 * measured as removable is the wrapper around the effect, not the effect. */
export function repeatTemplateLive(
  tpl: CompiledTemplate,
  source: () => unknown,
  textAt: (item: { value: unknown }, key: { value: unknown }, index: { value: unknown }) => unknown,
  getKey?: (item: unknown, key: unknown, index: number) => unknown,
  flags = 0,
): Block {
  const def = tpl.def;
  const textIdx = def ? repeatTextIndex(def) : null;
  if ((flags & FOR_ONCE) === 0 || def == null || textIdx == null) {
    // Degenerate shape: per-cell instances, but the write the compiled
    // renderEffect used to do must stay reactive — re-create it here.
    return createFor(
      source,
      (item, key, index) => {
        const n = tpl();
        const target = n.def.nodes[n.idx].inline || n.def.nodes[n.idx].kind === 'text' ? n : txt(child(n));
        renderEffect(() => setText(target, textAt(item, key, index)));
        return n;
      },
      getKey,
      flags,
    );
  }
  const { parent, anchor: before } = takeInsertionState();
  const anchor = makeAnchor('for');
  const listBlock: Block & { nodes: HostNode[]; scopes: unknown[]; cleanups: (() => void)[] } = { nodes: [anchor], scopes: [], cleanups: [] };
  let slot: HostNode | null = anchor;
  let anchorPlaced = !parent;
  if (parent && before != null) {
    be().attach(anchor, parent, before);
    anchorPlaced = true;
  } else if (parent) {
    slot = null;
  }
  const src = forSource(source());
  const count = src.count;
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
        // hoisted boxes: one allocation per cell, reused by every re-run
        const item = { value: src.value(i) };
        const k = { value: src.key(i) };
        const idx = { value: i };
        const host = cells[i][textIdx];
        renderEffect(() => {
          const s = textAt(item, k, idx);
          const text = s == null ? '' : String(s);
          if (asElement) be().setElementText(host, text);
          else be().setText(host, text);
        });
        if (needAttach && parent) be().attach(cells[i][rootIdx], parent, slot);
      }
      if (!anchorPlaced && parent) be().attach(anchor, parent, null);
    });
  });
  // root position: the cells are the block's nodes (specs/181)
  if (!parent) listBlock.nodes.splice(0, 0, ...cells.map((hosts) => hosts[rootIdx]));
  return withListApi(listBlock);
}

/** Dynamic slot lists (`<template v-for … #[name]>`, specs/170): one slot
 * descriptor per source item. Evaluated when the component mounts — the
 * parent's slot set is fixed for the child's lifetime here. */
export function createForSlots(
  source: unknown,
  getSlot: (item: unknown, key: unknown, index: number) => unknown,
): unknown[] {
  if (Array.isArray(source) || typeof source === 'string') return Array.from(source as ArrayLike<unknown>, (item, i) => getSlot(item, i, i));
  if (typeof source === 'number') return Array.from({ length: source }, (_, i) => getSlot(i + 1, i, i));
  if (source && typeof source === 'object') return Object.keys(source).map((k, i) => getSlot((source as Record<string, unknown>)[k], k, i));
  return [];
}

/** Stops a block's scopes and cleanups WITHOUT removing its hosts — the
 * adopt paths (VDOM owns the placeholder host) dispose this way. */
export function disposeBlock(block: Block): void {
  for (const s of block.scopes ?? []) beforeStop(s);
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
    for (let r = 0; r < 50; r++) anchors.push(makeAnchor('for'));
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
