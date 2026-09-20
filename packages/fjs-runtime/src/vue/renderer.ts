// Vue 3 custom renderer for fjs. Maps Vue vnodes onto the fjs element
// protocol: elements are native view nodes, text is a 'text' node, events
// (onTap etc.) cross as markers with handlers kept in the JS registry.
//
// App usage:
//   import { createApp, ref } from 'vue';
//   import { flutterRoot } from 'fjs/vue';
//   const root = flutterRoot();
//   createApp(App).mount(root);
import {
  createRenderer,
  type RendererOptions,
} from '@vue/runtime-core';
import { create, forgetHandlers, forgetElementStyle, insert, remove, setHoverStyle, setText, setProps, setStyle, setElementStyleBridge, createRoot, registerSystemHandler, setOffsetParentResolver, type Element, type EventPayload } from '../ui/element';
import { transitionClassesOf } from './transition-classes';
import { lastPointer } from '../ui/geometry';
import { hasNativeHost, invokeHost, registerPreFlush } from '../host';
import { usesDeclaredFont } from '../css/font-face';
import { INHERITABLE, StyleEngine, type PseudoStyles } from '../css/style';

type HostNode = Element;

// ---- viewport (@media) ------------------------------------------------------
//
// Dart owns the window size; the CSS engine consumes it. Two directions on
// one event number (specs/043-media-queries):
//
//   pull  invokeHost('fjs.viewport.get') — one synchronous host call made
//         HERE, when this module evals. The push below cannot serve the
//         initial value: this module loads with the app bundle, after the
//         VM started, so a push fired "at VM start" would land on no
//         handler. A fresh VM re-evals this module (dev reload rebuilds
//         the VM), so the pull also re-arms every rebuild.
//   push  FjsEvent.viewportChanged (33) on every later metrics change,
//         payload {"width":n,"height":n} — the JSON the Dart side
//         (engine.dart) writes with a fixed field order.
//
// Not in element.ts's EventType: like navMount (10) this is a system event
// subscribed via registerSystemHandler, not a template `@xxx`.
const EVENT_VIEWPORT_CHANGED = 33;

registerSystemHandler(EVENT_VIEWPORT_CHANGED, (_id, payload) => {
  let wire: { width?: unknown; height?: unknown };
  try {
    wire = JSON.parse(payload ?? '{}') as typeof wire;
  } catch {
    return; // a malformed payload would be a host bug; drop, don't throw
  }
  if (typeof wire.width === 'number' && typeof wire.height === 'number') {
    styleEngine.setViewport(wire.width, wire.height);
  }
});

// ---- shadow bookkeeping (parent/child answers for Vue normalization) ----

const parentOf = new Map<number, number | null>();
const childrenOf = new Map<number, number[]>();
const htmlDefaults = new Map<number, Record<string, unknown>>();

// ---- style engine (<style> blocks: cascade + inheritance) ----

const elementsById = new Map<number, Element>();

// ---- position: fixed hoisting (CSS `fixed` without a DOM viewport) ----
//
// The native side has no viewport-anchored positioning: `position: fixed`
// would fall back to flow layout exactly where the element was authored,
// which is why a vant popup showed up in the middle of the page. Web keeps
// these in the viewport via real CSS, so the whole feature is App-side.
//
// The engine hands `position: fixed` through untouched; the style callback
// below re-parents such elements into a dedicated overlay host box (a
// viewport-filling sibling of the page content under the page root). Vue's
// vnode tree is not touched — nodeOps.insert/remove translate the logical
// parent to the host symmetrically, so diffing, anchors and teardown keep
// working (constitution V: a lopsided translation here would silently
// corrupt the shadow tree).
//
// Step 2 (specs/069) re-targets this hoist at the Dart-side top-level
// overlay (`fjs-overlay-host`, see contract.md); the translation point is
// the same.

/** Hoisted element id → the logical parent Vue put it under. The element
 * physically lives in its page's overlay host, but it still belongs to that
 * parent: when Vue removes an ancestor, the hoisted element must go too (a
 * DOM Teleport's content leaves with its owner), and nothing else would
 * ever tell us — Vue names only the root of a removed subtree. */
const hoistedFrom = new Map<number, number | null>();
/** Live page roots by id (flutterRoot → releaseRoot), in mount order. Pages
 * share this module: a page further down the stack stays alive while
 * another is pushed on top, so every root keeps its own overlay host. */
const pageRoots = new Map<number, HostNode>();
/** Page root id → the viewport box its `fixed` elements live in. */
const overlayHosts = new Map<number, HostNode>();

/** The page root an element is mounted under; the most recently mounted
 * root when it is not attached yet (a subtree styled before its insert). */
function pageRootOf(id: number): HostNode | undefined {
  for (let cur: number | null | undefined = id; cur != null; cur = parentOf.get(cur)) {
    const root = pageRoots.get(cur);
    if (root) return root;
  }
  let last: HostNode | undefined;
  for (const root of pageRoots.values()) last = root;
  return last;
}

function ensureOverlayHost(pageRoot: HostNode): HostNode {
  const existing = overlayHosts.get(pageRoot.id);
  if (existing) return existing;
  // the reserved tag (specs/069 contract.md): a Dart adapter renders this
  // subtree in the root Overlay, so popups float above the shell chrome and
  // stay put while the page scrolls. Unknown-tag hosts degrade to a plain
  // view — the step-1 behaviour.
  const host = create('fjs-overlay-host');
  track(host);
  // plain inline style, not engine-registered: the host is a fixture, its
  // style never cascades and never changes (same reasoning as the v-if
  // anchors above)
  setProps(host, {
    style: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  });
  insert(pageRoot, host);
  const at = childrenOf.get(pageRoot.id)?.length ?? 0;
  trackInsert(pageRoot, host, at);
  overlayHosts.set(pageRoot.id, host);
  return host;
}

function hoistIfNeeded(el: Element, style: Record<string, unknown>): void {
  if (style.position !== 'fixed' || hoistedFrom.has(el.id)) return;
  const pageRoot = pageRootOf(el.id);
  if (!pageRoot) return; // no page root mounted yet — nothing to hoist into
  const host = ensureOverlayHost(pageRoot);
  const logical = parentOf.get(el.id) ?? null;
  hoistedFrom.set(el.id, logical === host.id ? null : logical);
  if (logical === host.id) return;
  trackDetach(el);
  const at = childrenOf.get(host.id)?.length ?? 0;
  insert(host, el, at);
  trackInsert(host, el, at);
  // the element changed parents: its inheritance chain is now the host (a
  // clean root), which is what web achieves by teleporting to <body>
  styleEngine.recomputeSubtree(el.id);
}

// ---- pseudo-element decoration boxes (::before / ::after) ----
//
// The engine computes their styles from the same cascade (selector match,
// var(), em, inheritance from the originating element) and reports them
// through the style callback below; this layer materializes each one as a
// real mirror child — first position for ::before, last for ::after — so
// layout, painting and hit-testing reuse the existing pipeline (constitution
// VII: no Dart-side re-implementation of the cascade).
//
// The boxes are engine-owned: they are NOT in the Vue-facing shadow
// childrenOf/parentOf lists, and nodeOps.insert corrects real-child indexes
// by the number of ::before boxes. In CSS, pseudo-elements never take part
// in structural pseudo-class counting either, so the exclusion is exact.

const pseudoBoxes = new Map<number, { before?: Element; after?: Element }>();

/** CSS escape sequences (`\e728`, `\e 728`) decode to their code points —
 * the same transformation a browser applies to `content` before rendering. */
function unescapeCssContent(text: string): string {
  return text.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|(.))/g, (_, hex: string | undefined, ch: string | undefined) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : ch!,
  );
}

/** Icon fonts put their glyph code points in the private-use areas. A peer
 * without the icon font cannot render them — a literal "\e728" (or tofu)
 * inside a 20px box overflows it, which is strictly worse than the empty
 * decoration box web draws when the font is missing. So the glyph only goes
 * through when the box's font stack names a family some `@font-face`
 * declared (specs/071 loads those into the Flutter font table). */
function isPrivateUseOnly(text: string): boolean {
  if (text.length === 0) return false;
  return [...text].every((ch) => {
    const c = ch.codePointAt(0)!;
    return (c >= 0xe000 && c <= 0xf8ff) || (c >= 0xf0000 && c <= 0xffffd) || (c >= 0x100000 && c <= 0x10fffd);
  });
}

/** `content` values: '' / "text" produce the box (empty or with a text
 * child); none / normal produce nothing; attr()/counter() are outside the
 * supported subset (warned, treated as none — constitution V). */
function pseudoContent(value: unknown, fontFamily?: unknown): string | null {
  // no `content` declared is CSS's `normal`: no box at all. vant's
  // `.van-sidebar-item:not(:last-child)::after { border-bottom-width: 1px }`
  // only tops up a hairline some other rule creates; boxed on its own it
  // drew a grey line under every sidebar title
  if (value === undefined || value === null) return null;
  const v = value.toString().trim();
  if (v === 'none' || v === 'normal') return null;
  const quoted = /^(["'])(.*)\1$/s.exec(v);
  if (!quoted) {
    if (/^[a-z-]+\(/.test(v)) {
      console.warn(
        `[fjs css] pseudo-element content "${v}" is not supported (only quoted strings / empty); box skipped`,
      );
      return null;
    }
    return v;
  }
  const text = unescapeCssContent(quoted[2]);
  // `content: " "` is vant's hairline idiom: the space collapses away in a
  // browser, leaving a box as tall as its border. A real text child here
  // gave the box a full line box, and scaleY(.5) then lifted the cell's
  // bottom hairline ~6px above the cell's edge.
  if (/^[ \t\n\r\f]*$/.test(text)) return '';
  return isPrivateUseOnly(text) && !usesDeclaredFont(fontFamily) ? '' : text;
}

/** The text child of each decoration box that has content, by box id. */
const pseudoTexts = new Map<number, Element>();

/** A decoration box's text is created here, not by the style engine, and
 * the peer's text reads only its OWN style — so it gets the box's
 * inheritable text properties explicitly. Without them an icon glyph drew
 * in the default font at 14px #333 (a `?` box on iOS, specs/071). */
function pseudoTextStyle(style: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of INHERITABLE) {
    if (style[k] !== undefined) out[k] = style[k];
  }
  return out;
}

/** Brings a box's text child in line with [content]: created, updated or
 * removed. A box is reused across restyles, and its content changes with
 * the class (vant's Rate and Checkbox swap `content` between glyphs). */
function syncPseudoText(box: Element, content: string, style: Record<string, unknown>): void {
  const existing = pseudoTexts.get(box.id);
  if (!content) {
    if (existing) {
      remove(existing);
      elementsById.delete(existing.id);
      pseudoTexts.delete(box.id);
    }
    return;
  }
  if (existing) {
    setText(existing, content);
    setStyle(existing, pseudoTextStyle(style));
    return;
  }
  const text = create('text');
  setText(text, content);
  setStyle(text, pseudoTextStyle(style));
  elementsById.set(text.id, text);
  insert(box, text);
  pseudoTexts.set(box.id, text);
}

function dropPseudoBox(box: Element): void {
  pseudoTexts.delete(box.id);
  remove(box);
}

function syncPseudoBoxes(el: Element, styles: PseudoStyles | null): void {
  if (styles === null) {
    for (const box of [pseudoBoxes.get(el.id)?.before, pseudoBoxes.get(el.id)?.after]) {
      if (box) dropPseudoBox(box);
    }
    pseudoBoxes.delete(el.id);
    return;
  }
  let entry = pseudoBoxes.get(el.id);
  if (!entry) pseudoBoxes.set(el.id, (entry = {}));
  for (const kind of ['before', 'after'] as const) {
    const decls = styles[kind];
    const existing = entry[kind];
    if (decls === undefined) {
      if (existing) {
        dropPseudoBox(existing);
        delete entry[kind];
      }
      continue;
    }
    const content = pseudoContent(decls.content, decls.fontFamily);
    if (content === null) {
      // content none / normal / unset: CSS generates no box
      if (existing) {
        dropPseudoBox(existing);
        delete entry[kind];
      }
      continue;
    }
    const style = { ...decls };
    delete style.content;
    if (!existing) {
      const box = create('view');
      elementsById.set(box.id, box);
      setStyle(box, style);
      syncPseudoText(box, content ?? '', style);
      // ::before leads the Dart child list (real children shift by one —
      // nodeOps.insert corrects), ::after trails it (append)
      insert(el, box, kind === 'before' ? 0 : undefined);
      entry[kind] = box;
    } else {
      setStyle(existing, style);
      syncPseudoText(existing, content ?? '', style);
    }
  }
}

/** Shared engine instance; css-vars.ts also drives it (useCssVars). */
export const styleEngine = new StyleEngine(parentOf, childrenOf, (id, style, activeStyle, hoverStyle, pseudo) => {
  const el = elementsById.get(id);
  if (!el) return;
  // `activeStyle` only rides along for elements that some `:active` rule
  // matched; null clears one the native side is still holding
  if (activeStyle === null && !hadActiveStyle.has(id)) {
    setStyle(el, style);
  } else {
    if (activeStyle) hadActiveStyle.add(id);
    else hadActiveStyle.delete(id);
    setStyle(el, style, activeStyle);
  }
  // :hover crosses as its own op (op 12). The engine sends undefined for
  // elements that never matched a hover rule (the common case — no bytes at
  // all) and null to clear one the native side may still hold.
  if (hoverStyle !== undefined) setHoverStyle(el, hoverStyle);
  if (pseudo !== undefined) syncPseudoBoxes(el, pseudo);
  if (style.position === 'fixed') hoistIfNeeded(el, style);
});

// Styles go out with the ops that create their elements: the host flush
// finishes the engine's pending recompute first (see flushPending)
registerPreFlush(() => styleEngine.flushPending());

// The DOM-shaped `el.style` writes funnel into the same engine: libraries
// like @vueuse/motion assign `el.style[key] = v`, a `:style` binding calls
// setInlineStyle, useCssVars batches custom props — one inline record, one
// recompute. The bridge is injectable because ui/element.ts cannot import
// this module back (cycle).
setElementStyleBridge({
  read: (id) => styleEngine.inlineRecord(id),
  write: (id, key, value) => styleEngine.mutateInline(id, key, value),
});

// The initial viewport pull (see the viewport block above for why it is a
// pull, and why it sits here: after styleEngine exists, still at module
// eval so it precedes any page's registerStyles).
if (hasNativeHost) {
  try {
    const wire = JSON.parse(invokeHost<string>('fjs.viewport.get') ?? '{}') as {
      width?: unknown;
      height?: unknown;
    };
    if (typeof wire.width === 'number' && typeof wire.height === 'number') {
      styleEngine.setViewport(wire.width, wire.height);
    }
  } catch {
    // older hosts predate the handler — the fallback viewport stands
  }
}

/** Elements the native side is holding an `:active` style for. */
const hadActiveStyle = new Set<number>();

/** The whole style a v-if / fragment anchor ever needs. */
const ANCHOR_STYLE = { display: 'none' };

/** DOM `Node.contains` over the shadow tree: true when `other` is this node
 * or one of its descendants. vant's Checker does
 * `icon === target || icon.contains(target)` on every tap, so without it the
 * tap threw `not a function` and Checkbox/Radio never toggled (specs/072).
 *
 * It lives here rather than on `Element` in ui/element.ts because that layer
 * holds no tree — `appendChild` writes an op and forgets. When the React
 * adapter moves parentOf/childrenOf into a shared ui/tree.ts
 * (docs/custom-renderer.md), this moves with them.
 *
 * One shared function reading `this`, not a closure per node: a page has
 * thousands of nodes and almost none is ever asked.
 *
 * A `position: fixed` element hoisted into the overlay host is, like a
 * teleported node in the DOM, no longer inside its logical parent. */
function hostContains(this: HostNode, other: unknown): boolean {
  let id = (other as { id?: unknown } | null | undefined)?.id;
  // not one of ours, or already unmounted (forgetSubtree drops it) — the
  // DOM's answer for a node outside this tree is false too
  if (typeof id !== 'number' || !elementsById.has(id)) return false;
  while (id != null) {
    if (id === this.id) return true;
    id = parentOf.get(id as number);
  }
  return false;
}

// ---- document-level pointer stream -------------------------------------------
//
// Dart reports every pointer down anywhere in the app — page, overlay, modal —
// with the deepest node under it (system event 43, payload {"x","y"}). This is
// what DOM code gets from `document.addEventListener('touchstart' | 'click')`:
// vant's click-away (number keyboard, popover) checks `el.contains(target)`
// against it. Web has the real document; this is the app side's.
const EVENT_GLOBAL_POINTER_DOWN = 43;

export interface GlobalPointerDown {
  /** The deepest element under the pointer; null over no fjs node. */
  target: HostNode | null;
  clientX: number;
  clientY: number;
}

const globalPointerListeners = new Set<(event: GlobalPointerDown) => void>();

/** Subscribes to every pointer down in the app; returns the unsubscriber. */
export function onGlobalPointerDown(listener: (event: GlobalPointerDown) => void): () => void {
  globalPointerListeners.add(listener);
  return () => globalPointerListeners.delete(listener);
}

registerSystemHandler(EVENT_GLOBAL_POINTER_DOWN, (id, payload) => {
  if (globalPointerListeners.size === 0) return;
  let x = 0;
  let y = 0;
  try {
    const p = JSON.parse(String(payload ?? '{}')) as { x?: number; y?: number };
    x = p.x ?? 0;
    y = p.y ?? 0;
  } catch {
    // a malformed payload still reports the target
  }
  const target = elementsById.get(id) ?? pageRoots.get(id) ?? null;
  for (const listener of [...globalPointerListeners]) listener({ target, clientX: x, clientY: y });
});

const POSITIONED = new Set(['relative', 'absolute', 'fixed', 'sticky']);

// offsetParent (ui/element.ts): the nearest positioned ancestor, else the
// page root the element hangs under — the DOM's `<body>` fallback.
setOffsetParentResolver((id) => {
  let cur = parentOf.get(id);
  let last: number | null = null;
  while (cur != null) {
    const position = styleEngine.computedOf(cur)?.position;
    if (typeof position === 'string' && POSITIONED.has(position)) return elementsById.get(cur) ?? null;
    last = cur;
    cur = parentOf.get(cur);
  }
  // the top of the chain is usually the page root, which flutterRoot()
  // registers in pageRoots, not elementsById — null here made vant's
  // isHidden() call every tabs bar hidden, so its underline never moved
  return last == null ? null : (elementsById.get(last) ?? pageRoots.get(last) ?? null);
});

/** Registers a renderer-created node and gives it the DOM-shaped members. */
function track(el: HostNode): void {
  elementsById.set(el.id, el);
  (el as HostNode & { contains: typeof hostContains }).contains = hostContains;
}

/** Takes the child out of its current parent's child list, keeping its own
 * subtree bookkeeping (this is half of a move, not a removal). */
function trackDetach(child: HostNode) {
  const parentId = parentOf.get(child.id);
  if (parentId == null) return;
  const list = childrenOf.get(parentId);
  const idx = list ? list.indexOf(child.id) : -1;
  if (idx >= 0) list!.splice(idx, 1);
  parentOf.delete(child.id);
}

function trackInsert(parent: HostNode, child: HostNode, index: number) {
  parentOf.set(child.id, parent.id);
  const list = childrenOf.get(parent.id) ?? [];
  const at = Math.min(index, list.length);
  list.splice(at, 0, child.id);
  childrenOf.set(parent.id, list);
}

/** Drops the engine/renderer state for `id` and everything under it. The
 * native side needs no help — one Remove op takes the subtree with it. */
function forgetSubtree(id: number) {
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    const kids = childrenOf.get(current);
    if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    // the root's own parent/child bookkeeping is trackRemove's job
    if (current !== id) {
      parentOf.delete(current);
      childrenOf.delete(current);
    }
    elementsById.delete(current);
    hadActiveStyle.delete(current);
    htmlDefaults.delete(current);
    textValues.delete(current);
    if (onceFired.size) for (const key of onceFired) if (key.startsWith(`${current}:`)) onceFired.delete(key);
    forgetElementStyle(current);
    // event handlers too, and for the same reason the engine state goes:
    // Vue names only the subtree root, so nothing else would ever drop the
    // descendants'. A handler closes over its component's render scope, so
    // one leftover `@tap` keeps its whole page — every element, every
    // reactive object — alive for as long as the app runs.
    forgetHandlers(current);
    styleEngine.forget(current);
  }
}

function trackRemove(child: HostNode) {
  const parentId = parentOf.get(child.id);
  if (parentId != null) {
    const list = childrenOf.get(parentId);
    if (list) {
      const idx = list.indexOf(child.id);
      if (idx >= 0) list.splice(idx, 1);
    }
  }
  parentOf.delete(child.id);
  childrenOf.delete(child.id);
  hadActiveStyle.delete(child.id);
}

// ---- HTML tag mapping --------------------------------------------------------
//
// Vue apps may author with standard HTML tags; they are translated to the
// fjs tag set at createElement time, so `<div>/<span>/<img>` etc. work
// out of the box. Unknown tags pass through verbatim (Dart component
// registry handles them).

interface HtmlTagMapping {
  tag: string;
  style?: Record<string, unknown>;
  props?: Record<string, unknown>;
}

const H: Record<string, HtmlTagMapping> = {
  // containers. `flexShrink: 1` restores the CSS initial value the fjs tag
  // set deliberately lacks: base-css pins `view { flex-shrink: 0 }` so an
  // fjs view matches Flutter's keep-its-natural-size flex child, and the
  // Dart side (_noShrinkTags) keys the same pin off the MAPPED tag. A vant
  // `div` on the web stays a real DOM node with that initial, so e.g.
  // `.van-skeleton__content { width: 100% }` yields to a fixed-size avatar
  // there, while the mapped view held its width and pushed the row past the
  // edge (RIGHT OVERFLOWED BY 84px, spec 073). Defaults sit under matched
  // rules, so declared values — vant's own `flex-shrink: 0` on
  // `.van-skeleton-avatar` — still win. Mapped *text* tags keep the view
  // behavior: no known vant row competes on a definite-width text, and the
  // narrower default keeps already-accepted pages stable.
  div: { tag: 'view', style: { flexShrink: 1 } },
  section: { tag: 'view', style: { flexShrink: 1 } },
  main: { tag: 'view', style: { flexShrink: 1 } },
  article: { tag: 'view', style: { flexShrink: 1 } },
  aside: { tag: 'view', style: { flexShrink: 1 } },
  nav: { tag: 'view', style: { flexShrink: 1 } },
  header: { tag: 'view', style: { flexShrink: 1 } },
  footer: { tag: 'view', style: { flexShrink: 1 } },
  ul: { tag: 'view', style: { flexShrink: 1 } },
  ol: { tag: 'view', style: { flexShrink: 1 } },
  li: { tag: 'view', style: { flexShrink: 1 } },
  // `label` is an fjs tag of its own now (it forwards taps); it stays in
  // this table so the defaults an HTML page relied on still apply, mapping
  // to itself. `form` is NOT here: on this path it resolves to the Vue
  // component in components/form.ts, which renders a plain view.
  table: { tag: 'view', style: { flexShrink: 1 } },
  tr: { tag: 'view', style: { flexDirection: 'row', flexShrink: 1 } },
  td: { tag: 'view', style: { flexShrink: 1 } },
  th: { tag: 'view', style: { flexShrink: 1 } },

  // text
  span: { tag: 'text' },
  p: { tag: 'text', style: { margin: 8, fontSize: 15 } },
  b: { tag: 'text', style: { fontWeight: 'bold' } },
  strong: { tag: 'text', style: { fontWeight: 'bold' } },
  em: { tag: 'text', style: { fontWeight: '500' } },
  i: { tag: 'text', style: { fontWeight: '500' } },
  small: { tag: 'text', style: { fontSize: 12 } },
  a: { tag: 'text', style: { color: '#1a73e8' } },
  h1: { tag: 'text', style: { fontSize: 28, fontWeight: 'bold' } },
  h2: { tag: 'text', style: { fontSize: 24, fontWeight: 'bold' } },
  h3: { tag: 'text', style: { fontSize: 20, fontWeight: 'bold' } },
  h4: { tag: 'text', style: { fontSize: 18, fontWeight: '600' } },
  h5: { tag: 'text', style: { fontSize: 16, fontWeight: '600' } },
  h6: { tag: 'text', style: { fontSize: 14, fontWeight: '600' } },
  br: { tag: 'text' },

  // controls (map onto native widgets)
  img: { tag: 'image' },
  // The button's chrome (padding / radius / hairline / label color) is a
  // Dart-side default now — widgets/button.dart — because a filled variant
  // (`type="primary"`) must NOT have the hairline, and a border injected
  // from here reaches Dart indistinguishable from one the page wrote.
  // A page's own `border: none` / `border-color: …` still wins, exactly as
  // before (render/style.dart resolves the two the way CSS does).
  button: { tag: 'button' },
  input: { tag: 'input' },
  // same numbers the web base stylesheet gives `label` (base-css.ts)
  label: { tag: 'label', style: { margin: 4, fontSize: 14, color: '#666666' } },
  // `textarea` used to be an alias for `input multiline`. It is a real
  // component now (components/textarea.ts); an alias here would rewrite the
  // tag before the component is ever instantiated. A render function that
  // asks for the ELEMENT (`h('textarea')`, vant's Field) never meets the
  // component — createElement turns that one into the same multiline input.
  hr: { tag: 'divider' },
};

const HTML_BLOCK_TAGS = new Set([
  'div', 'section', 'main', 'article', 'aside', 'nav', 'header', 'footer', 'li', 'td', 'th',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

const htmlTagCache = new Map<string, { tag: string; defaults: Record<string, unknown> } | null>();

/** Resolves an HTML tag to its fjs tag + injected defaults. */
export function resolveHtmlTag(
  tag: string,
): { tag: string; defaults: Record<string, unknown> } | null {
  const cached = htmlTagCache.get(tag);
  if (cached !== undefined) return cached;
  const m = H[tag];
  // the result is shared by every element of this tag (never mutated), so
  // the style engine can key its cache on the defaults object's identity
  const resolved = m
    ? { tag: m.tag, defaults: { ...(m.style ? { style: m.style } : {}), ...(m.props ?? {}) } }
    : null;
  htmlTagCache.set(tag, resolved);
  return resolved;
}

// ---- nodeOps ---------------------------------------------------------------

/** Removes one element and its subtree, native side and bookkeeping. */
function dropElement(child: HostNode): void {
  // Vue removes only the ROOT of a subtree — the descendants go with it
  // implicitly, and it never tells us about them. Their engine state does
  // not go anywhere on its own: forgetting just this node leaves every
  // element of every unmounted page registered forever, and a later
  // restyle keeps walking and recomputing them. Measured on the theme
  // page: one switch between two list containers took `elements` from
  // 3510 to 6798.
  const parentId = parentOf.get(child.id);
  // pseudo-element boxes of the subtree are real mirror nodes the shadow
  // lists never tracked — drop them explicitly or they outlive their
  // element (constitution V: silent leaks are still leaks).
  const stack = [child.id];
  while (stack.length) {
    const current = stack.pop()!;
    const boxes = pseudoBoxes.get(current);
    if (boxes) {
      if (boxes.before) remove(boxes.before);
      if (boxes.after) remove(boxes.after);
      pseudoBoxes.delete(current);
    }
    for (const kid of childrenOf.get(current) ?? []) stack.push(kid);
  }
  hoistedFrom.delete(child.id);
  forgetSubtree(child.id);
  trackRemove(child);
  remove(child);
  if (parentId != null) styleEngine.noteStructureChange(parentId);
}

/** Hoisted elements whose logical parent is inside the subtree at [id],
 * nested ones included (a popup inside a popup). */
function hoistedUnder(id: number): number[] {
  if (!hoistedFrom.size) return [];
  const out: number[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    for (const kid of childrenOf.get(current) ?? []) stack.push(kid);
    for (const [el, from] of hoistedFrom) {
      if (from === current && el !== id) {
        out.push(el);
        stack.push(el);
      }
    }
  }
  return out;
}

const nodeOps: Omit<RendererOptions<HostNode, HostNode>, 'patchProp'> = {
  createElement: (rawTag) => {
    const mapped = resolveHtmlTag(rawTag);
    // the textarea ELEMENT (see the H table): an unknown tag on the Dart
    // side rendered nothing at all
    const el = create(mapped ? mapped.tag : rawTag === 'textarea' ? 'input' : rawTag);
    if (rawTag === 'textarea') {
      // vant's Field textarea: auto-height inside a vant cell is still
      // broken — the field grows natively but the fjs flex's line-extent
      // computation caps the element box at one line and the cell clips it
      // (specs/077 遗留，诊断数据在该 spec 的 tasks 里)。挂账未修。
      setProps(el, { multiline: true });
    }
    // An HTML block box keeps its inline content on one line (`<div><span>0
    // </span>/50</div>`, vant's word limit), where an fjs view stacks its
    // children. The marker lets the Dart view tell the two apart
    // (node_adapters.dart, _ViewNodeAdapter); `p` / `h1`… carry it too, so
    // they are never taken for inline runs inside such a box.
    if (HTML_BLOCK_TAGS.has(rawTag)) setProps(el, { htmlBlock: true });
    if (mapped) {
      // remember defaults; the style engine merges them ahead of matched
      // rules and user style
      htmlDefaults.set(el.id, mapped.defaults);
      if (rawTag === 'br') setText(el, '\n');
    }
    track(el);
    if (TEXT_CONTROL_TAGS.has(el.tag)) installTextControlValue(el);
    styleEngine.ensure(el.id, rawTag, mapped?.defaults.style as Record<string, unknown> | undefined);
    childrenOf.set(el.id, []);
    parentOf.set(el.id, null);
    return el;
  },

  createText: (text) => {
    const el = create('text');
    if (text) setText(el, text);
    track(el);
    // raw = renderer-synthesized bare text: excluded from structural-pseudo
    // sibling position (in the browser DOM this child is a text node, not an
    // element — an explicit <text> the page wrote IS one on both ends)
    styleEngine.ensure(el.id, 'text', undefined, true);
    return el;
  },

  insertStaticContent: (content) => {
    // Only reachable from hand-written render functions that call
    // createStaticVNode: the app build compiles with hoistStatic:false
    // (specs/070) precisely because this contract is DOM-innerHTML — a
    // browser clones template nodes between el and anchor. Fail with the
    // remedy in the message rather than "not a function" from deep inside
    // vue's mount (which used to blank the whole page, silently).
    void content;
    throw new Error(
      '[fjs] createStaticVNode is not supported by the fjs renderer: ' +
        'static content mounts through DOM innerHTML semantics. ' +
        'Hand-written render functions must build regular vnodes (h/crea' +
        'teVNode); SFC templates are already compiled with hoistStatic:f' +
        'alse.',
    );
  },

  createComment: (text) => {
    // v-if / fragment anchors: a view with display:none. An empty text node
    // would still take a line's height (and a flex gap) on the native side.
    //
    // Deliberately NOT registered with the style engine, and the style goes
    // over as a plain prop. An anchor is invisible, childless, and its style
    // never changes — but an inline style is exactly what makes an element
    // non-memoizable, so registering one made every anchor pay a full
    // cascade (inherit, copy the custom props, merge, resolve var()) on
    // every restyle. They are easy to overlook because nothing draws them,
    // and a list puts one in every row: on hello-fjs's theme page they were
    // 968 of 4364 elements and essentially all of the compute cache's
    // misses.
    void text;
    const el = create('view');
    track(el);
    setProps(el, { style: ANCHOR_STYLE });
    return el;
  },

  setText: (node, text) => {
    setText(node, text);
  },

  setElementText: (node, text) => {
    // v1: element text replaces the whole content (used for {{ }} on views)
    setText(node, text);
  },

  insert: (child, parent, anchor) => {
    // Vue also calls insert to MOVE a node that is already mounted (a keyed
    // v-for reorder). The native side detaches the child before inserting it
    // at the index this computes, so the index has to be read off the list
    // WITHOUT the child in it — otherwise a node moving later in the list
    // lands one slot too far, and the shadow list ends up holding its id
    // twice.
    trackDetach(child);
    // A `position: fixed` element lives in the overlay host, whatever Vue's
    // vnode tree says; moves redirect there so the translation stays
    // symmetric with remove() (see the hoisting block above).
    let target = parent;
    if (hoistedFrom.has(child.id)) {
      // Vue moved it: it now belongs to `parent`, and lives in the overlay
      // host of whatever page that parent is on
      hoistedFrom.set(child.id, parent.id);
      const pageRoot = pageRootOf(parent.id);
      if (pageRoot) target = ensureOverlayHost(pageRoot);
    }
    const siblings = childrenOf.get(target.id) ?? [];
    let index = siblings.length;
    if (target === parent && anchor) {
      const ai = siblings.indexOf(anchor.id);
      if (ai >= 0) index = ai;
    }
    // ::before decoration boxes lead the native child list but are not in
    // the shadow list Vue indexes against — shift real children past them.
    const beforeBoxes = target === parent ? (pseudoBoxes.get(parent.id)?.before ? 1 : 0) : 0;
    insert(target, child, index + beforeBoxes);
    trackInsert(target, child, index);
    // the child just gained an ancestor chain: recompute inheritance and
    // descendant/:deep selectors for its subtree
    styleEngine.recomputeSubtree(child.id);
    // the child also landed between siblings: first/last positions may have
    // flipped for the neighbors it displaced (structural pseudos)
    styleEngine.noteStructureChange(target.id);
  },

  remove: (child) => {
    // hoisted descendants first: they are not under `child` in the lists
    // below (they live in the overlay host), but they leave with it
    for (const id of hoistedUnder(child.id)) {
      const el = elementsById.get(id);
      if (el) dropElement(el);
    }
    dropElement(child);
  },

  parentNode: (node) => {
    const parentId = parentOf.get(node.id);
    if (parentId == null) return null;
    // the REAL element, not a fresh wrapper — see nextSibling
    return elementsById.get(parentId) ?? makeHandle(parentId);
  },

  nextSibling: (node) => {
    const parentId = parentOf.get(node.id);
    if (parentId == null) return null;
    const list = childrenOf.get(parentId) ?? [];
    const idx = list.indexOf(node.id);
    if (idx < 0 || idx + 1 >= list.length) return null;
    // the REAL element, not a fresh wrapper: vue's removeFragment walks
    // siblings until `cur === end`, comparing by IDENTITY against the anchor
    // element it stored at mount. A fresh handle never equals it, the walk
    // runs off the child list, and the next call hands us null — vant's
    // click-to-loading button unmounts a fragment exactly this way and took
    // the whole patch down with it.
    return elementsById.get(list[idx + 1]) ?? makeHandle(list[idx + 1]);
  },

  querySelector: () => null, // not supported (no DOM)

  // scoped CSS: Vue calls this for every element inside a component whose
  // SFC defines <style scoped> (id comes from __sfc__.__scopeId)
  setScopeId: (el, scopeId) => {
    if (typeof scopeId === 'string' && scopeId) styleEngine.addScope(el.id, scopeId);
  },
};

// Handles for parentNode/nextSibling: Vue only reads identity/ordering from
// them, so a minimal Element-shaped object is enough.
function makeHandle(id: number): HostNode {
  return {
    id,
    tag: 'view',
    appendChild: () => {
      throw new Error('handle is read-only');
    },
    removeChild: () => {
      throw new Error('handle is read-only');
    },
    setText: () => {
      throw new Error('handle is read-only');
    },
    setProps: () => {
      throw new Error('handle is read-only');
    },
  } as unknown as HostNode;
}

// ---- patchProp ---------------------------------------------------------------

/** Vue hands us raw attribute keys (`:on-tap` stays 'on-tap'); the element
 * API expects camelCase (onTap). HTML event names map to native ones. */
function camelize(key: string): string {
  return key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

const HTML_EVENT_ALIASES: Record<string, string> = {
  onClick: 'onTap',
  onInput: 'onTextChanged',
  onChange: 'onValueChanged',
  onReset: 'onFormReset',
};

/** `@submit` means two different things: on an input it is the keyboard's
 * return key (textSubmitted, payload = the text), on a form it is the
 * collected `{name: value}` JSON. Same spelling, different event number —
 * so the alias has to look at the tag.
 *
 * `@change` is the same story: on a control it is the value that changed,
 * on a swiper it is the page. The web adapter emits `change` from the
 * swiper too, so without this the same template would work on web and be
 * dead on Flutter — the handler would sit under the wrong event number and
 * nothing would ever call it. */
function aliasEvent(tag: string, prop: string): string {
  if (prop === 'onSubmit') return tag === 'form' ? 'onFormSubmit' : prop;
  if (prop === 'onChange' && tag === 'swiper') return 'onPageChanged';
  return HTML_EVENT_ALIASES[prop] ?? prop;
}

/** Wraps the raw payload string in the DOM-shaped event object Vue-authored
 * code expects (vant's onClick starts with `event.stopPropagation()`). Touch
 * payloads are already objects and pass through untouched; `detail` carries
 * the payload string, matching the DOM event's shape. A payload-less event
 * (a tap) still gets the object — a DOM click handler always receives one,
 * and vant's stepper calls `preventDefault(event)` on it first thing.
 *
 * `target` / `currentTarget` are the element itself, as in the DOM. On a
 * text control the event's text is also its `value` — the DOM input's
 * `value` property is the live text — because that is where DOM code reads
 * it: vant's Field does `if (!event.target.composing)
 * updateValue(event.target.value)`, and without a target every keystroke
 * threw and v-model never updated (specs/070). */
function asDomEvent(el: HostNode, payload: EventPayload): unknown {
  if (payload !== undefined && typeof payload === 'object') return payload;
  // the native side already shows this text: record it, do not echo it back
  if (typeof payload === 'string' && textValues.has(el.id)) textValues.set(el.id, payload);
  const event = {
    detail: payload,
    target: el,
    currentTarget: el,
    stopPropagation() {},
    stopImmediatePropagation() {},
    preventDefault() {},
  };
  // A click's position, read lazily (a sync host call) because almost no
  // handler wants it — vant's Slider does: `clientX - rect.left` on a tap
  // of the track is the new value.
  let point: { x: number; y: number } | null | undefined;
  const at = (): { x: number; y: number } | null => (point === undefined ? (point = lastPointer()) : point);
  for (const [key, axis] of [['clientX', 'x'], ['clientY', 'y'], ['pageX', 'x'], ['pageY', 'y']] as const) {
    Object.defineProperty(event, key, { enumerable: true, get: () => at()?.[axis] ?? 0 });
  }
  return event;
}

/** Vue compiles event modifiers into the prop name (`@touchstart.passive`
 * → `onTouchstartPassive`, and vant writes that key by hand); runtime-dom
 * peels them off before registering the listener. Passive and capture mean
 * nothing on this side — there is no default action to protect and no
 * capture phase — so only `once` changes behaviour. */
const OPTION_MODIFIER = /(?:Once|Passive|Capture)$/;

/** `${elementId}:${event}` of every `.once` handler that already ran. */
const onceFired = new Set<string>();

function parseEventName(prop: string): { name: string; once: boolean } {
  let name = prop;
  let once = false;
  let m: RegExpMatchArray | null;
  while ((m = name.match(OPTION_MODIFIER))) {
    if (m[0] === 'Once') once = true;
    name = name.slice(0, name.length - m[0].length);
  }
  return { name, once };
}

/** Tags whose string event payload is the control's current text. */
const TEXT_CONTROL_TAGS = new Set(['input', 'textarea']);

/** Live text of each text control, keyed by element id. */
const textValues = new Map<number, string>();

/** Gives a text control the DOM input's `value` property. Reading returns
 * the live text (the last input event, or the last write); writing pushes
 * the text to the native control — vant's Field shows its v-model value,
 * clears, and applies formatters exclusively through
 * `inputRef.value.value = text`, so a plain data property there left the
 * App input stuck on whatever was typed (specs/070). */
function installTextControlValue(el: HostNode): void {
  textValues.set(el.id, '');
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: () => textValues.get(el.id) ?? '',
    set: (v: unknown) => {
      const next = v == null ? '' : String(v);
      if (next === textValues.get(el.id)) return;
      textValues.set(el.id, next);
      setProps(el, { value: next });
    },
  });
  // The caret is native-side state with no bridge; vant calls this right
  // after rewriting the value while focused. A no-op leaves the caret where
  // the native control puts it (at the end) instead of throwing.
  (el as HostNode & { setSelectionRange?: () => void }).setSelectionRange = () => {};
}

/** innerHTML → the text it shows. No HTML layout on this side: line breaks
 * survive, other tags drop (warned once), common entities decode. */
let warnedInnerHtml = false;
function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html;
  const text = html.replace(/<br\s*\/?>/gi, '\n');
  if (!warnedInnerHtml && /<[a-z!/]/i.test(text)) {
    warnedInnerHtml = true;
    console.warn('[fjs] innerHTML markup is shown as plain text on the app side (tags dropped)');
  }
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export const patchProp: RendererOptions<HostNode, HostNode>['patchProp'] = (
  el,
  key,
  prevValue,
  nextValue,
) => {
  const prop = camelize(key);
  if (prop === 'class') {
    // Vue hands us the normalized class string; the style engine matches
    // CSS rules against it. Classes a running <Transition> put on the
    // element ride outside Vue's value — merge them back or the class patch
    // would drop them mid-animation (runtime-dom does the same via `_vtc`).
    const vtc = transitionClassesOf(el);
    styleEngine.setClasses(el.id, vtc.length ? `${nextValue ?? ''} ${vtc.join(' ')}` : nextValue);
    return;
  }
  if (prop === 'href' || prop === 'srcset') {
    return; // unsupported in v1
  }
  // DOM text properties set as props — vant's picker column renders each
  // option as `<div :textContent="text">` (innerHTML under allow-html),
  // Toast/Dialog put their message through innerHTML. Passed on as plain
  // props the native side never saw any text: every option was blank.
  if (prop === 'textContent' || prop === 'innerText' || prop === 'innerHTML') {
    const raw = nextValue == null ? '' : String(nextValue);
    setText(el, prop === 'innerHTML' ? htmlToText(raw) : raw);
    return;
  }
  if (prop === 'id') {
    // no selector engine matches on it, but a touch event reports it as
    // `event.target.id`, the way the DOM does
    setProps(el, { id: nextValue == null ? null : String(nextValue) });
    return;
  }
  if (prop === 'value' && textValues.has(el.id)) {
    // keep the DOM-shaped `el.value` in step with a `:value` binding
    textValues.set(el.id, nextValue == null ? '' : String(nextValue));
  }
  if (prop === 'src' || prop === 'value' || prop === 'placeholder') {
    setProps(el, { [prop]: nextValue });
    return;
  }
  if (prop.startsWith('on')) {
    const { name, once } = parseEventName(prop);
    const native = aliasEvent(el.tag, name);
    if (nextValue == null) {
      // detach: marker false + drop registry entry (handled in setProps util)
      onceFired.delete(`${el.id}:${native}`);
      setProps(el, { [native]: null });
    } else {
      // Vue-authored handlers speak DOM: vant's onClick calls
      // event.stopPropagation() before anything else, so handing them the
      // raw payload string (the element-API convention) crashes on the
      // first tap. Wrap once here: the handler gets a DOM-shaped event
      // whose `detail` carries the original payload. The raw element API
      // (ui/element.ts dispatch) keeps passing the payload unchanged.
      //
      // A component that binds its own onClick and also lets the parent's
      // `@click` fall through gets both merged into an array (mergeProps):
      // vant's Cell is `[route, userHandler]`. The DOM renderer calls each in
      // turn; calling the array itself threw and the user's handler never ran.
      const handlers = (Array.isArray(nextValue) ? nextValue : [nextValue]) as ((
        e: unknown,
      ) => void)[];
      // `.once` is remembered per element and event, not per closure: an
      // inline handler is a new function every render, and Vue re-patches
      // the prop each time — a closure flag would re-arm on every render
      const onceKey = `${el.id}:${native}`;
      setProps(el, {
        [native]: (payload?: EventPayload) => {
          if (once) {
            if (onceFired.has(onceKey)) return;
            onceFired.add(onceKey);
          }
          const event = asDomEvent(el, payload);
          for (const h of handlers) h(event);
        },
      });
    }
    return;
  }
  if (prop === 'disabled') {
    // `:disabled` rules (vant greys a disabled field's text with one); the
    // prop still reaches the native control below. Vue hands a boolean
    // attribute over as '' when present.
    styleEngine.setDisabled(el.id, nextValue != null && nextValue !== false);
  }
  if (prop === 'style') {
    // object or inline CSS string; the engine merges tag defaults, matched
    // rules, inherited values and inline style before crossing the bridge.
    // The prev value matters: an object binding re-patch DIFFS keys (DOM
    // patchStyle semantics), which is what lets an el.style write from a
    // library like @vueuse/motion survive a parent re-render.
    styleEngine.patchInlineStyle(el.id, prevValue, nextValue);
    return;
  }
  setProps(el, { [prop]: nextValue });
};

// ---- public API ---------------------------------------------------------------

const { createApp: rendererCreateApp, render } = createRenderer<HostNode, HostNode>({
  ...nodeOps,
  patchProp,
});

export function createApp(...args: Parameters<typeof rendererCreateApp>) {
  return rendererCreateApp(...args);
}

/** Creates the flutter root container element and returns it as the mount
 * target. All Vue updates flush to native in batched frames. */
/** The JS-side shadow tree, for components that have to reason about a
 * SUBTREE rather than their own slots — `<form>` is the case: on Flutter its
 * fields are elements (not components), and they can sit any number of
 * page components deep, so slots and provide/inject cannot find them.
 * @internal used by components/form.ts */
export function childElementIds(id: number): readonly number[] {
  return childrenOf.get(id) ?? [];
}

/** @internal used by components/form.ts */
export function elementTag(id: number): string | undefined {
  return elementsById.get(id)?.tag;
}

/** @internal used by components/form.ts */
export function elementById(id: number): Element | undefined {
  return elementsById.get(id);
}

export function flutterRoot(tag = 'view'): HostNode {
  const root = createRoot(tag);
  childrenOf.set(root.id, []);
  parentOf.set(root.id, null);
  pageRoots.set(root.id, root);
  return root;
}

/** Retires a page root after its app unmounted (the router's teardown). Its
 * Dart subtree — the overlay host and everything left in it — goes with the
 * page; keeping the ids here would let a later write target a parent the
 * host already dropped ("op references unknown parent": a blank page after
 * a hot swap). */
export function releaseRoot(root: HostNode): void {
  const host = overlayHosts.get(root.id);
  if (host) {
    for (const id of childrenOf.get(host.id) ?? []) hoistedFrom.delete(id);
    forgetSubtree(host.id);
    overlayHosts.delete(root.id);
  }
  forgetSubtree(root.id);
  parentOf.delete(root.id);
  childrenOf.delete(root.id);
  pageRoots.delete(root.id);
}

/** Registers a SFC <style> block with the style engine (called by the code
 * the fjs esbuild plugin injects). scope=null means a global (non-scoped)
 * block. */
export function registerStyles(scope: string | null, cssText: string): void {
  styleEngine.register(scope, cssText);
}

/** Manual render escape hatch (mostly for tests). */
export { render };
