// The web Vapor backend core (specs/166 split): the node primitives over
// the DOM — gestures, template cloning, styles — and the `fjs/vapor`
// helper surface, with NO Vue renderer anywhere. A template instance is a
// real `cloneNode(true)` subtree of `<view>` / `<text>` custom elements —
// the same elements the web adapter's VDOM components render — and `tap` /
// `longPress` reproduce GestureDetector through the same pointer dance the
// adapter uses (web/components/gestures.ts): the click that follows a fired
// long press is swallowed, and a tap fires per registered ancestor because
// the native click bubbles through each of them.
//
// Styles are plain CSS here — classes land on the element and the cascade
// is the browser's; the inline-style merge keeps the record-per-host
// semantics the two ends share. The vue surface rides `export * from
// '@vue/runtime-core'` — the standalone package, so the page's `ref` and
// this runtime's effects share one reactivity system. The VDOM interop
// (vant et al, the wrapper's adopt path) lives in web-interop.ts, which
// wires `mountVdomComponent` onto [domBackend]; `vapor/web.ts` re-exports
// both, and `vapor/web-pure.ts` (the enableVapor alias) ships this module
// alone so the renderer engine never enters a pure-vapor bundle.
import {
  type HostNode,
  type Block,
  type TemplateDef,
  type VaporBackend,
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

/** Wired by web-interop.ts (which adds `mountVdomComponent`) or left
 * interop-free by web-pure.ts. */
export const domBackend: VaporBackend = {
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
  // <style> v-bind() on a Vapor component (specs/166): inline custom
  // properties on the host element; CSS inheritance does the rest
  setCssVars(host, vars) {
    if (host instanceof HTMLElement) {
      for (const key of Object.keys(vars)) {
        host.style.setProperty(`--${key}`, String(vars[key]));
      }
    }
  },
};

setVaporBackend(domBackend);
export function enableVapor(): void {}

// Compiled vapor imports template / createFor / repeatTemplate from this
// module on web (vue-plugin's webAliases point fjs/vapor here). The rest of
// the vue surface rides `export * from '@vue/runtime-core'` — NOT 'vue':
// vite prebundles vue with reactivity INLINED, so vue's `ref` and this
// runtime's `effect` (@vue/reactivity, the seam runtime.ts binds) would be
// two reactive systems and a page's `taps.value++` would never reach its
// renderEffect. @vue/runtime-core is the standalone package the shim pins on
// the esbuild side — same reactivity copy, so both platforms are shaped
// alike: the VDOM side (wrapper, vant, this module's own renderer) stays on
// 'vue', the Vapor side on the standalone packages, and the only crossings
// are getter-thunk props, DOM slots and plain handler calls (specs/165).
// The runtime's names are re-exported EXPLICITLY, not with a second star:
// runtime-core exports same-named helpers (resolveComponent, useSlots), and
// two colliding star exports are silently dropped by ESM while an explicit
// re-export shadows the star.
export * from '@vue/runtime-core';
export {
  TemplateInstance,
  TplNode,
  __perfNow,
  __prof,
  __profOn,
  __vaporMicro,
  __zoneEnter,
  __zoneExit,
  be,
  blockOf,
  blockRoot,
  child,
  createAssetComponent,
  createComponent,
  createComponentWithFallback,
  createDynamicComponent,
  createFor,
  createForSlots,
  createIf,
  createSlot,
  createVaporApp,
  defineVaporComponent,
  delegateEvents,
  disposeBlock,
  emptyBlock,
  insertBlock,
  insertZoneName,
  mountVaporComponentForAdopt,
  next,
  normalizeSlots,
  nthChild,
  off,
  on,
  once,
  removeBlock,
  renderEffect,
  repeatTemplate,
  repeatTemplateLive,
  resolveComponent,
  setAttr,
  setClass,
  setClassName,
  setHostReactivity,
  setInsertionState,
  setProp,
  setStyle,
  setText,
  setVaporBackend,
  show,
  takeInsertionState,
  template,
  txt,
  useSlots,
  withScope,
} from './runtime';
export type {
  Block,
  CompiledTemplate,
  HostNode,
  HostReactivity,
  Slots,
  TemplateDef,
  TemplateNode,
  VaporAppContext,
  VaporBackend,
  VaporComponent,
} from './runtime';
export { useVaporCssVars } from './css-vars';
// compiled text interpolations import this helper by name; the runtime only
// imports it for its own use, and the flutter entry gets it from vue-shim
export { toDisplayString } from '@vue/shared';
