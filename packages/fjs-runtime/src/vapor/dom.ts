// The DOM that @vue/runtime-vapor runs on, built over the fjs renderer's
// nodeOps (specs/148).
//
// runtime-vapor has no renderer-options hook like createRenderer: it clones
// parsed HTML templates, walks them with firstChild / nextSibling and writes
// nodeValue / className / attributes directly. So each node it sees is a
// thin shell over an fjs element, and every mutation goes through the SAME
// nodeOps / patchProp the VDOM renderer uses: style engine, scope ids, event
// payload wrapping and element bookkeeping are shared, and a Vapor page and a
// VDOM page differ only in what Vue does above them.
//
// These classes are NOT installed as globals. The build injects them into the
// runtime-vapor module alone (vue-plugin.ts, vaporDomInjectPlugin): a global
// `document` would flip third-party libraries that branch on
// `typeof document` onto their browser paths.
//
// Anything outside the implemented surface throws, so a missing member is an
// error, not a silently wrong tree.
import { camelize, isSpecialBooleanAttr, parseStringStyle, toHandlerKey } from '@vue/shared';
import type { Element as Host } from '../ui/element';
import { createDetachedRoot, nodeOps, patchProp } from '../vue/renderer';

// Fields are `declare`d and assigned in constructors: app bundles target
// es2019, where esbuild lowers class fields to Object.defineProperty calls —
// measured at roughly half of a template clone's cost in QuickJS (specs/148).
export class Node {
  declare parentNode: Element | null;
  declare nextSibling: Node | null;
  declare previousSibling: Node | null;
  /** The fjs element once the node is in the mirror tree. Template nodes
   * (parsed from innerHTML) never get one: they are only cloned. */
  declare host: Host | null;

  constructor() {
    this.parentNode = this.nextSibling = this.previousSibling = null;
    this.host = null;
  }

  get nodeType(): number {
    return 0;
  }

  get parentElement(): Element | null {
    return this.parentNode;
  }

  get isConnected(): boolean {
    return this.host ? this.host.isConnected : false;
  }

  /** The host element, created on first insertion for text / anchors. */
  materialize(): Host {
    throw new Error('[fjs vapor] this node cannot enter the mirror tree');
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  // The renderer's nodeOps accept a shell wherever a host goes (a VDOM
  // subtree mounted inside a Vapor block, a Vapor block's anchor next to
  // VDOM nodes): they unwrap through these two without importing this module.
  get $fjsShell(): true {
    return true;
  }

  toHost(): Host {
    return this.host ?? this.materialize();
  }
}


export class Text extends Node {
  declare private value: string;
  /** A template text that is its element's only child: on fjs that text is
   * the element's own content (what the VDOM renderer's setElementText
   * does), not a separate text element. */
  declare inline: boolean;

  constructor(value: string) {
    super();
    this.value = value;
    this.inline = false;
  }

  override get nodeType(): number {
    return 3;
  }

  get nodeValue(): string {
    return this.value;
  }

  set nodeValue(v: string) {
    this.value = v;
    if (this.inline) nodeOps.setElementText(this.parentNode!.host!, v);
    else if (this.host) nodeOps.setText(this.host, v);
  }

  get textContent(): string {
    return this.value;
  }

  set textContent(v: string) {
    this.nodeValue = v;
  }

  get data(): string {
    return this.value;
  }

  set data(v: string) {
    this.nodeValue = v;
  }

  override materialize(): Host {
    return (this.host ??= nodeOps.createText(this.value));
  }
}

export class Comment extends Node {
  declare readonly data: string;

  constructor(data: string) {
    super();
    this.data = data;
  }

  override get nodeType(): number {
    return 8;
  }

  override materialize(): Host {
    return (this.host ??= nodeOps.createComment(this.data));
  }
}

/** `el.style` as runtime-vapor uses it: v-show reads and writes `display`
 * (keeping the original around), transitions do the same. Other keys go to
 * the host's own write surface, which feeds the same inline layer. */
class ShellStyle {
  declare private readonly el: Element;

  constructor(el: Element) {
    this.el = el;
  }

  get display(): string {
    const v = this.el.appliedStyle?.display;
    return v == null ? '' : String(v);
  }

  set display(v: string) {
    patchStyle(this.el, { display: this.display || undefined }, { display: v || undefined });
  }

  setProperty(key: string, value: string): void {
    patchStyle(this.el, undefined, { [key]: value });
  }

  removeProperty(key: string): void {
    patchStyle(this.el, { [key]: '' }, undefined);
  }
}

/** Class tokens for the incremental path runtime-vapor takes on component
 * roots (their own class plus fallthrough attrs). */
class ShellClassList {
  declare private readonly el: Element;

  constructor(el: Element) {
    this.el = el;
  }

  private tokens(): string[] {
    return this.el.className ? this.el.className.split(/\s+/).filter(Boolean) : [];
  }

  add(...names: string[]): void {
    const t = this.tokens();
    for (const n of names) if (n && !t.includes(n)) t.push(n);
    this.el.className = t.join(' ');
  }

  remove(...names: string[]): void {
    this.el.className = this.tokens().filter((n) => !names.includes(n)).join(' ');
  }

  contains(name: string): boolean {
    return this.tokens().includes(name);
  }
}

type Listener = (event: unknown) => unknown;

export class Element extends Node {
  declare firstChild: Node | null;
  declare lastChild: Node | null;
  declare readonly localName: string;
  /** Template nodes keep their attributes to replay on clone. */
  declare attrs: [string, string][] | null;
  declare private classValue: string;
  declare private attrValues: Record<string, unknown> | null;
  declare private templateContent: Element | null;
  declare private listeners: Map<string, Set<Listener>> | null;
  declare private styleView: ShellStyle | null;
  declare private classView: ShellClassList | null;
  /** The inline style record last handed to patchProp, for DOM-style merges
   * (a component root takes its own :style and fallthrough ones). */
  declare appliedStyle: Record<string, unknown> | null;

  constructor(tag: string) {
    super();
    this.localName = tag;
    this.firstChild = this.lastChild = null;
    this.attrs = null;
    this.classValue = '';
    this.attrValues = null;
    this.templateContent = null;
    this.listeners = null;
    this.styleView = null;
    this.classView = null;
    this.appliedStyle = null;
  }

  override get nodeType(): number {
    return 1;
  }

  get tagName(): string {
    return this.localName.toUpperCase();
  }

  /** runtime-core asks a container for its namespace (svg / mathml). */
  get namespaceURI(): string {
    return 'http://www.w3.org/1999/xhtml';
  }

  get nodeName(): string {
    return this.tagName;
  }

  get childNodes(): Node[] {
    const out: Node[] = [];
    for (let n = this.firstChild; n; n = n.nextSibling) out.push(n);
    return out;
  }

  hasChildNodes(): boolean {
    return this.firstChild !== null;
  }

  insertBefore<T extends Node>(child: T, anchor: Node | null): T {
    if (child.parentNode) unlink(child.parentNode, child);
    // A wrapper over an element the VDOM renderer built (shellOf) does not
    // know that element's children, and a VDOM anchor is not in its list:
    // the list is only exact for subtrees built here. Unknown anchors append
    // list-wise; the host insert below uses the real index either way.
    const known = anchor !== null && anchor.parentNode === this;
    const before = known ? anchor.previousSibling : this.lastChild;
    const after = known ? anchor : null;
    child.parentNode = this;
    child.previousSibling = before;
    child.nextSibling = after;
    if (before) before.nextSibling = child;
    else this.firstChild = child;
    if (after) after.previousSibling = child;
    else this.lastChild = child;
    if (this.host) {
      // a move (keyed v-for) reuses the host: nodeOps.insert detaches it
      nodeOps.insert(child.host ?? child.materialize(), this.host, anchor ? (anchor.host ?? anchor.materialize()) : null);
    }
    return child;
  }

  appendChild<T extends Node>(child: T): T {
    return this.insertBefore(child, null);
  }

  removeChild<T extends Node>(child: T): T {
    if (child.parentNode === this) unlink(this, child);
    if (child.host) nodeOps.remove(child.host);
    return child;
  }

  get textContent(): string {
    let out = '';
    for (let n = this.firstChild; n; n = n.nextSibling) {
      out += (n as Text | Element).textContent ?? '';
    }
    return out;
  }

  set textContent(v: string) {
    while (this.firstChild) this.removeChild(this.firstChild);
    if (v === '' || v == null) return;
    const text = new Text(String(v));
    text.inline = true;
    text.parentNode = this;
    this.firstChild = this.lastChild = text;
    if (this.host) nodeOps.setElementText(this.host, String(v));
  }

  get className(): string {
    return this.classValue;
  }

  set className(v: string) {
    if (this.host) patchProp(this.host, 'class', this.classValue || null, v);
    else (this.attrs ??= []).push(['class', v]);
    this.classValue = v;
  }

  get classList(): ShellClassList {
    return (this.classView ??= new ShellClassList(this));
  }

  get style(): ShellStyle {
    return (this.styleView ??= new ShellStyle(this));
  }

  getAttribute(name: string): unknown {
    if (name === 'class') return this.classValue;
    return this.attrValues?.[name] ?? null;
  }

  setAttribute(name: string, value: unknown): void {
    if (!this.host) {
      (this.attrs ??= []).push([name, String(value)]);
      return;
    }
    // scoped CSS stamps `data-v-<hash>` with an empty value, exactly what
    // the VDOM renderer receives as setScopeId
    if (value === '' && name.startsWith('data-v-')) {
      nodeOps.setScopeId!(this.host, name);
      return;
    }
    if (name === 'class') {
      this.className = String(value);
      return;
    }
    if (name === 'style') {
      patchStyle(this, null, typeof value === 'string' ? parseStringStyle(value) : value);
      return;
    }
    // runtime-vapor writes a present boolean attribute as '': the VDOM
    // renderer gets `true` for the same template
    const next = value === '' && isSpecialBooleanAttr(name) ? true : value;
    const values = (this.attrValues ??= {});
    patchProp(this.host, name, values[name] ?? null, next);
    values[name] = next;
  }

  removeAttribute(name: string): void {
    if (!this.host) return;
    if (name === 'class') this.className = '';
    else if (this.attrValues && name in this.attrValues) {
      patchProp(this.host, name, this.attrValues[name], null);
      delete this.attrValues[name];
    }
  }

  /** Listeners go through the same `on<Name>` prop the VDOM renderer patches
   * for `@name`: one dispatcher per event, so several listeners (component
   * fallthrough plus the element's own) share it. */
  addEventListener(type: string, listener: Listener): void {
    const map = (this.listeners ??= new Map());
    let set = map.get(type);
    if (!set) {
      map.set(type, (set = new Set()));
      const all = set;
      if (this.host) {
        patchProp(this.host, toHandlerKey(camelize(type)), null, (e: unknown) => {
          for (const fn of all) fn(e);
        });
      }
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    const set = this.listeners?.get(type);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0 && this.host) {
      this.listeners!.delete(type);
      patchProp(this.host, toHandlerKey(camelize(type)), () => {}, null);
    }
  }

  // ---- forwarded to the fjs element (template refs) ---------------------

  get value(): unknown {
    return (this.host as unknown as { value?: unknown } | null)?.value;
  }

  set value(v: unknown) {
    if (!this.host) throw new Error('[fjs vapor] value on a template node');
    const values = (this.attrValues ??= {});
    patchProp(this.host, 'value', values.value ?? null, v);
    values.value = v;
  }

  getBoundingClientRect() {
    return this.requireHost().getBoundingClientRect();
  }

  focus(): void {
    this.requireHost().focus();
  }

  blur(): void {
    this.requireHost().blur();
  }

  get offsetWidth(): number {
    return this.requireHost().offsetWidth;
  }

  get offsetHeight(): number {
    return this.requireHost().offsetHeight;
  }

  get offsetLeft(): number {
    return this.requireHost().offsetLeft;
  }

  get offsetTop(): number {
    return this.requireHost().offsetTop;
  }

  get scrollTop(): number {
    return this.requireHost().scrollTop;
  }

  get scrollLeft(): number {
    return this.requireHost().scrollLeft;
  }

  get clientTop(): number {
    return this.requireHost().clientTop;
  }

  get clientLeft(): number {
    return this.requireHost().clientLeft;
  }

  private requireHost(): Host {
    if (!this.host) throw new Error('[fjs vapor] template nodes have no layout');
    return this.host;
  }

  // ---- <template> -------------------------------------------------------

  get content(): Element {
    return (this.templateContent ??= new Element('#template-content'));
  }

  set innerHTML(html: string) {
    const root = this.content;
    root.firstChild = root.lastChild = null;
    parseTemplate(html, root);
  }

  cloneNode(deep?: boolean): Element {
    if (this.host || !deep) throw new Error('[fjs vapor] only template nodes are cloned (deep)');
    return instantiate(this);
  }
}

// runtime-vapor delegates some events (Solid-style): it stores the handler
// on the node as `$evt<name>` — a function, or an array it pushes onto — and
// listens once on the document. Here the store is an accessor: the first
// write registers one `on<Name>` dispatcher that reads the store at dispatch
// time, so later pushes are seen.
const DELEGATED = ['beforeinput', 'click', 'dblclick', 'contextmenu', 'focusin', 'focusout', 'input', 'keydown', 'keyup',
  'mousedown', 'mousemove', 'mouseout', 'mouseover', 'mouseup', 'pointerdown', 'pointermove', 'pointerout', 'pointerover',
  'pointerup', 'touchend', 'touchmove', 'touchstart'];
let delegation = false;

/** Installs the `$evt<name>` accessors, once. Called when Vapor is enabled
 * (vapor/index.ts) rather than at module evaluation: a module with top-level
 * side effects stays in every bundle that merely references it, and this one
 * is referenced by runtime-vapor, which non-Vapor bundles tree-shake away. */
export function installDelegation(): void {
  if (delegation) return;
  delegation = true;
  for (const name of DELEGATED) defineDelegated(name);
}

function defineDelegated(name: string): void {
  const store = `__evt_${name}`;
  Object.defineProperty(Element.prototype, `$evt${name}`, {
    configurable: true,
    get(this: Record<string, unknown>) {
      return this[store];
    },
    set(this: Element & Record<string, unknown>, handlers: unknown) {
      const first = this[store] === undefined;
      this[store] = handlers;
      if (first && handlers !== undefined && this.host) {
        patchProp(this.host, toHandlerKey(name), null, (e: unknown) => {
          const h = this[store] as Listener | Listener[] | undefined;
          if (Array.isArray(h)) for (const fn of h) fn(e);
          else h?.(e);
        });
      }
    },
  });
}

/** Aliases for `instanceof` checks runtime-vapor makes. Nothing here is an
 * SVG / MathML element (fjs has no such namespace). */
export const HTMLElement = Element;
export class SVGElement {}
export class DocumentFragment extends Element {
  override get nodeType(): number {
    return 11;
  }
}

function unlink(parent: Element, child: Node): void {
  const { previousSibling: prev, nextSibling: next } = child;
  if (prev) prev.nextSibling = next;
  else parent.firstChild = next;
  if (next) next.previousSibling = prev;
  else parent.lastChild = prev;
  child.parentNode = child.previousSibling = child.nextSibling = null;
}

/** DOM merge semantics for style writes: keys in `prev` not in `next` are
 * dropped, everything else stays — so a component root's own :style and
 * its fallthrough :style can patch the same element independently. One
 * patchProp with the whole record, as the VDOM renderer sends. */
export function patchStyle(el: Element, prev: unknown, next: unknown): void {
  if (!el.host) throw new Error('[fjs vapor] style on a template node');
  const current = el.appliedStyle;
  const merged: Record<string, unknown> = { ...(current ?? {}) };
  if (prev && typeof prev === 'object') for (const k in prev) delete merged[k];
  if (typeof next === 'string') throw new Error('[fjs vapor] string style is normalized before patchStyle');
  if (next && typeof next === 'object') {
    for (const k in next) {
      const v = (next as Record<string, unknown>)[k];
      if (v == null || v === '') delete merged[k];
      else merged[k] = v;
    }
  }
  patchProp(el.host, 'style', current, merged);
  el.appliedStyle = merged;
}

/** Builds the live fjs subtree for a parsed template node. The element gets
 * its scope and class before its children land, as in the VDOM renderer's
 * mountElement. */
function instantiate(t: Element): Element {
  const el = new Element(t.localName);
  el.host = nodeOps.createElement(t.localName);
  if (t.attrs) for (const [k, v] of t.attrs) el.setAttribute(k, v);
  const only = t.firstChild;
  if (only && only === t.lastChild && only instanceof Text) {
    const text = new Text(only.nodeValue);
    text.inline = true;
    text.parentNode = el;
    el.firstChild = el.lastChild = text;
    // the compiler's single-space placeholder is always overwritten by the
    // text binding right after; writing it would add an op the VDOM path
    // never sends
    if (only.nodeValue.trim() !== '') nodeOps.setElementText(el.host, only.nodeValue);
    return el;
  }
  for (let n = t.firstChild; n; n = n.nextSibling) {
    if (n instanceof Element) el.appendChild(instantiate(n));
    else if (n instanceof Text) el.appendChild(new Text(n.nodeValue));
    else el.appendChild(new Comment((n as Comment).data));
  }
  return el;
}

const VOID = /*@__PURE__*/ new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]);

/** Parses the HTML subset compiler-vapor emits: tags, quoted or bare
 * attribute values, omitted closing tags, `<!>` anchors, text. */
function parseTemplate(html: string, root: Element): void {
  const stack: Element[] = [root];
  let i = 0;
  while (i < html.length) {
    const top = stack[stack.length - 1];
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      top.appendChild(new Comment(html.slice(i + 4, end)));
      i = end + 3;
    } else if (html.startsWith('<!', i)) {
      const end = html.indexOf('>', i);
      top.appendChild(new Comment(html.slice(i + 2, end)));
      i = end + 1;
    } else if (html.startsWith('</', i)) {
      const end = html.indexOf('>', i);
      const name = html.slice(i + 2, end).trim();
      while (stack.length > 1 && stack.pop()!.localName !== name);
      i = end + 1;
    } else if (html[i] === '<') {
      const m = /^<([a-zA-Z][\w-]*)/.exec(html.slice(i, i + 64));
      if (!m) throw new Error(`[fjs vapor] cannot parse template at ${i}: ${html}`);
      const el = new Element(m[1]);
      i += m[0].length;
      const attr = /^\s*([^\s=>/]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/;
      for (;;) {
        const a = attr.exec(html.slice(i));
        if (!a) break;
        (el.attrs ??= []).push([a[1], decode(a[2] ?? a[3] ?? a[4] ?? '')]);
        i += a[0].length;
      }
      while (html[i] === ' ') i++;
      const selfClosing = html[i] === '/';
      i = html.indexOf('>', i) + 1;
      top.appendChild(el);
      if (!selfClosing && !VOID.has(el.localName)) stack.push(el);
    } else {
      const end = html.indexOf('<', i);
      top.appendChild(new Text(decode(html.slice(i, end < 0 ? html.length : end))));
      i = end < 0 ? html.length : end;
    }
  }
}

/** The shell over an existing fjs element — a VDOM container or anchor
 * handed to a Vapor component. One per element, so identity checks hold. */
export function shellOf(host: Host): Element {
  const h = host as Host & { __vaporShell?: Element };
  let el = h.__vaporShell;
  if (!el) {
    el = new Element(host.tag);
    el.host = host;
    h.__vaporShell = el;
  }
  return el;
}

const unsupported = (what: string) => () => {
  throw new Error(`[fjs vapor] ${what} is not supported`);
};

export const document = {
  createElement(tag: string): Element {
    if (tag === 'template') return new Element('template');
    const el = new Element(tag);
    el.host = nodeOps.createElement(tag);
    return el;
  },
  createTextNode: (v = '') => new Text(v),
  createComment: (d: string) => new Comment(d),
  /** A live container outside every page: KeepAlive parks deactivated
   * blocks here, and nodes moved in keep their host. */
  createDocumentFragment(): DocumentFragment {
    const frag = new DocumentFragment('#fragment');
    frag.host = createDetachedRoot();
    return frag;
  },
  /** `<Teleport to="body">`: the renderer's app overlay host. */
  querySelector(selector: string): Element | null {
    const host = nodeOps.querySelector!(selector);
    return host ? shellOf(host) : null;
  },
  // delegation needs no document listener: `$evt<name>` registers on the
  // element itself (see DELEGATED above)
  addEventListener() {},
  removeEventListener() {},
  createElementNS: /*@__PURE__*/ unsupported('createElementNS (SVG / MathML)'),
  createTreeWalker: /*@__PURE__*/ unsupported('createTreeWalker (SSR hydration)'),
};
