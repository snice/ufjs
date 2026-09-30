// The web Vapor backend and `fjs/vapor` twin (specs/161): the same helper
// surface as the Flutter entry, with the node primitives over the DOM. A
// template instance is a real `cloneNode(true)` subtree of `<view>` /
// `<text>` custom elements — the same elements the web adapter's VDOM
// components render — and `tap` / `longPress` reproduce GestureDetector
// through the same pointer dance the adapter uses
// (web/components/gestures.ts): the click that follows a fired long press is
// swallowed, and a tap fires per registered ancestor because the native
// click bubbles through each of them.
//
// Styles are plain CSS here — classes land on the element and the cascade
// is the browser's; the inline-style merge keeps the record-per-host
// semantics the two ends share. `export * from 'vue'` is the REAL vue on
// web (the web pin plugin resolves it), so VDOM interop components run on
// the same reactivity the Vapor helpers use.
import { effect, stop as stopRunner, type ReactiveEffectRunner } from '@vue/reactivity';
import { createRenderer, h } from 'vue';
import {
  type HostNode,
  blockOf,
  type Block,
  type TemplateDef,
  type VaporAppContext,
  type VaporBackend,
  type VaporComponent,
  disposeBlock,
  mountVaporComponentForAdopt,
  setVaporBackend,
} from './runtime';

// ---- gestures -----------------------------------------------------------------

const LONG_PRESS_MS = 350;

interface PressState {
  timer: ReturnType<typeof setTimeout> | null;
  fired: boolean;
  handlers: Record<'tap' | 'longPress', ((...args: unknown[]) => void)[]>;
}

const presses = new WeakMap<object, PressState>();

function pressOf(host: HostNode): void {
  if (presses.has(host as object)) return;
  const el = host as HTMLElement;
  const state: PressState = { timer: null, fired: false, handlers: { tap: [], longPress: [] } };
  presses.set(host as object, state);
  el.addEventListener('pointerdown', () => {
    state.fired = false;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.fired = true;
      for (const fn of state.handlers.longPress) fn();
    }, LONG_PRESS_MS);
  });
  const cancel = (): void => {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
  };
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', (event: MouseEvent) => {
    if (state.fired) {
      // a fired long press swallows the click that follows it, like Flutter
      state.fired = false;
      event.stopPropagation();
      return;
    }
    for (const fn of state.handlers.tap) fn();
  });
}

function eventNameOf(key: string): string {
  // `onTap` → `tap`, `onLongPress` → `longPress`, `onClick` → `click`
  return key.slice(2, 3).toLowerCase() + key.slice(3);
}

const GESTURED = new Set(['tap', 'longPress']);

// ---- the backend ---------------------------------------------------------------

const templates = new WeakMap<TemplateDef, HTMLTemplateElement>();

function templateOf(def: TemplateDef, html: string): HTMLTemplateElement {
  let t = templates.get(def);
  if (!t) {
    t = document.createElement('template');
    t.innerHTML = html;
    templates.set(def, t);
  }
  return t;
}

/** Fills hosts[] in def order by walking the cloned subtree. The parse's
 * inline fold removed a text child wherever an element's only child was
 * text — those DOM children are skipped by the `inline` early return, and
 * every other DOM child maps 1:1 onto a def child, in order. */
function fill(def: TemplateDef, hosts: unknown[], defIdx: number, dom: Node): void {
  hosts[defIdx] = dom;
  const dn = def.nodes[defIdx];
  if (dn.inline || dn.kind !== 'element') return;
  let child = dom.firstChild;
  for (const c of dn.children) {
    if (!child) throw new Error('[fjs vapor] template clone is smaller than the parse');
    fill(def, hosts, c, child);
    child = child.nextSibling;
  }
}

const domBackend: VaporBackend = {
  instantiate(def, hosts, html) {
    const frag = templateOf(def, html).content.cloneNode(true) as DocumentFragment;
    const roots = def.nodes[0].children;
    if (roots.length !== 1) throw new Error('[fjs vapor] a template must have exactly one root element');
    fill(def, hosts, roots[0], frag.firstChild as Node);
  },

  instantiateMany(def, count, html) {
    const all: unknown[][] = new Array(count);
    for (let i = 0; i < count; i++) {
      const hosts: unknown[] = [];
      const frag = templateOf(def, html).content.cloneNode(true) as DocumentFragment;
      const roots = def.nodes[0].children;
      if (roots.length !== 1) throw new Error('[fjs vapor] a template must have exactly one root element');
      fill(def, hosts, roots[0], frag.firstChild as Node);
      all[i] = hosts;
    }
    return all;
  },

  // specs/162: the DOM twin of the native CLONE_MANY — cloneNode per copy
  // (never one op), then the same semantics: roots before the anchor in
  // order, texts[i] into copy i's text node.
  cloneList(def, count, parent, anchor, textIdx, texts, html) {
    if (count === 0) return [];
    const roots = def.nodes[0].children;
    if (roots.length !== 1) throw new Error('[fjs vapor] a template must have exactly one root element');
    const all: unknown[][] = new Array(count);
    for (let i = 0; i < count; i++) {
      const hosts: unknown[] = [];
      const frag = templateOf(def, html).content.cloneNode(true) as DocumentFragment;
      fill(def, hosts, roots[0], frag.firstChild as Node);
      all[i] = hosts;
    }
    for (let i = 0; i < count; i++) {
      (parent as Node).insertBefore(all[i][roots[0]] as Node, (anchor ?? null) as Node | null);
    }
    if (textIdx !== null && texts !== null) {
      for (let i = 0; i < count; i++) {
        (all[i][textIdx] as { textContent: string }).textContent = texts[i];
      }
    }
    return all;
  },

  instantiateBareText(text) {
    return document.createTextNode(text);
  },

  createAnchor(label) {
    return document.createComment(` ${label} `);
  },

  attach(host, parent, anchor) {
    (parent as Node).insertBefore(host as Node, anchor as Node | null);
  },

  childAt(parent, index) {
    return (parent as Node).childNodes[index] ?? null;
  },

  remove(host) {
    (host as Node).parentNode?.removeChild(host as Node);
  },

  setElementText(host, text) {
    (host as Element).textContent = text;
  },

  setText(host, text) {
    (host as Text).nodeValue = text;
  },

  setClasses(host, value) {
    (host as Element).setAttribute('class', value);
  },

  patchStyle(host, prev, next) {
    const style = (host as HTMLElement).style;
    for (const k in prev ?? {}) {
      if (!(k in next)) style.removeProperty(k);
    }
    for (const k in next) {
      const v = next[k];
      if (v == null || v === '') style.removeProperty(k);
      else style.setProperty(k, String(v));
    }
  },

  setAttr(host, key, value) {
    if (value === false || value == null) (host as Element).removeAttribute(key);
    else (host as Element).setAttribute(key, value === true ? '' : String(value));
  },

  on(host, key, handler) {
    const name = eventNameOf(key);
    if (GESTURED.has(name)) {
      pressOf(host);
      presses.get(host as object)!.handlers[name as 'tap' | 'longPress'].push(handler as (...args: unknown[]) => void);
      return;
    }
    (host as Element).addEventListener(name, handler as EventListener);
  },

  off(host, key) {
    const name = eventNameOf(key);
    if (GESTURED.has(name)) {
      const state = presses.get(host as object);
      if (state) state.handlers[name as 'tap' | 'longPress'] = [];
      return;
    }
    // the runtime's off() cannot hand the original handler back through the
    // key alone; removal is only used through `once`, which never reaches
    // non-gestured events in practice — a plain drop of the gesture list is
    // the honest bound here
    void name;
  },

  mountVdomComponent(comp, props, slots, parent, anchor) {
    // vant et al on web: a real-vue renderer over the DOM, same as the web
    // adapter's VDOM path. runtime-core copies props into its own container
    // at mount, so this effect tracks every getter and re-renders with a
    // plain snapshot — the child's props diff runs as under a VDOM parent.
    // Slots bridge directly: a Vapor slot function returns hosts, and the
    // browser slot hands back a fragment of them per render.
    const container = document.createElement('div');
    const reposition = (): void => {
      if (!parent) return;
      let cursor: Node | null = (anchor ?? null) as Node | null;
      for (const child of [...container.childNodes]) {
        (parent as Node).insertBefore(child, cursor);
        cursor = child;
      }
    };
    const vdomSlots: Record<string, () => unknown> = {};
    for (const name in slots) {
      const renderSlot = slots[name];
      vdomSlots[name] = (): unknown => {
        const frag = document.createDocumentFragment();
        for (const node of blockOf(renderSlot()).nodes) frag.appendChild(node as Node);
        return frag;
      };
    }
    let alive = true;
    const runner = effect(
      () => {
        const snapshot: Record<string, unknown> = {};
        for (const k in props) snapshot[k] = (props as Record<string, unknown>)[k];
        vdomRender(h(comp as never, snapshot as never, vdomSlots as never), container);
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
    const roots = [...container.childNodes] as unknown[];
    const block: Block = {
      nodes: roots,
      scopes: [],
      cleanups: [
        () => {
          alive = false;
          stopRunner(runner);
          if (roots.every((r) => !(r as Node).isConnected)) {
            // the vapor tree already dropped the subtree
          } else {
            vdomRender(null, container);
          }
        },
      ],
    };
    return block;
  },
};

setVaporBackend(domBackend);

// the VDOM interop effect re-runs outside any vapor component scope — it is
// disposed through its block's cleanup, not a vapor scope
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

let vdomRender: (vnode: unknown, container: Element) => void;
{
  const { render } = createRenderer<Node, Node>({
    createElement: (tag) => document.createElement(tag),
    createText: (text) => document.createTextNode(text),
    createComment: (text) => document.createComment(text),
    setText: (node, text) => {
      (node as Text).nodeValue = text;
    },
    setElementText: (el, text) => {
      (el as Element).textContent = text;
    },
    insert: (child, parent, anchor) => {
      parent.insertBefore(child, anchor ?? null);
    },
    remove: (child) => {
      const parent = child.parentNode;
      if (parent) parent.removeChild(child);
    },
    parentNode: (node) => node.parentNode,
    nextSibling: (node) => node.nextSibling,
    querySelector: (sel) => document.querySelector(sel),
    patchProp: (el, key, prev, next) => {
      void prev;
      if (key === 'class') (el as Element).className = String(next ?? '');
      else if (key === 'style') (el as HTMLElement).style.cssText = String(next ?? '');
      else if (next == null || next === false) (el as Element).removeAttribute(key);
      else (el as Element).setAttribute(key, next === true ? '' : String(next));
    },
  });
  vdomRender = render as unknown as typeof vdomRender;
}

// ---- adoption (a VDOM page embedding a Vapor component on web) ----------------

/** Same contract as the Flutter interop: the generated wrapper mounts the
 * block here, renders an `fjs-vapor-root` placeholder (an unknown element
 * carrying `display: contents`, so the vapor children join the parent's
 * flex line directly), and on mount the block's nodes are appended under
 * it. Host removal is the VDOM's — it owns the placeholder. */
interface WebAdopt {
  block: Block;
  el: HTMLElement | null;
}

const adopts = new Map<number, WebAdopt>();
let adoptSeq = 0;

export function adoptVaporComponent(
  comp: VaporComponent,
  props: Record<string, unknown> | undefined,
  appContext: VaporAppContext | null,
): { id: number } {
  const { block } = mountVaporComponentForAdopt(comp, props, appContext);
  const id = ++adoptSeq;
  adopts.set(id, { block, el: null });
  return { id };
}

/** The wrapper's onMounted: [instance] is the wrapper's component instance —
 * its `$el` is the placeholder element. */
export function mountAdoptNodes(id: number, instance?: unknown): void {
  const adopt = adopts.get(id);
  if (!adopt) return;
  const el = ((instance as { proxy?: { $el?: HTMLElement } } | undefined)?.proxy?.$el ?? null) as HTMLElement | null;
  adopt.el = el;
  if (!el) throw new Error('[fjs vapor] vapor-root placeholder did not mount');
  for (const node of adopt.block.nodes) el.appendChild(node as Node);
}

export function releaseAdopt(id: number): void {
  const adopt = adopts.get(id);
  if (!adopt) return;
  adopts.delete(id);
  disposeBlock(adopt.block);
}

/** specs/148's enableVapor, kept a no-op for the CLI injection. */
export function enableVapor(): void {}

// Compiled vapor imports template / createFor / repeatTemplate from this
// module on web (vue-plugin's webAliases point fjs/vapor here).
export * from './runtime';
// compiled text interpolations import this helper by name; the runtime only
// imports it for its own use, and the flutter entry gets it from vue-shim
export { toDisplayString } from '@vue/shared';
