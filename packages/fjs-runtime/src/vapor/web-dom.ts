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
import { hyphenate, looseEqual, looseIndexOf, looseToNumber } from '@vue/shared';
import { normalizeStyleValues } from '../web/style';
import { touchBindings } from '../web/components/touch';
import { addListener, renderEffect } from './runtime';
import { createInvoker } from './helpers';
import { trackTransitionClass, transitionClassesOf, untrackTransitionClass } from '../vue/transition-classes';

/** runtime-dom's getTransitionInfo, reduced: the longest layer of the
 * element's transition / animation, from its computed style, and how many
 * end events that layer kind sends (one per property / animation). */
function domTransitionInfo(el: Element): { timeout: number; propCount: number } {
  if (typeof getComputedStyle !== 'function') return { timeout: 0, propCount: 0 };
  const cs = getComputedStyle(el);
  const ms = (v: string): number => {
    const t = v.trim();
    if (t.endsWith('ms')) return parseFloat(t) || 0;
    if (t.endsWith('s')) return (parseFloat(t) || 0) * 1000;
    return 0;
  };
  const longest = (durations: string, delays: string): number => {
    const d = (durations || '').split(',').map(ms);
    const l = (delays || '').split(',').map(ms);
    let max = 0;
    for (let i = 0; i < d.length; i++) if (d[i] > 0) max = Math.max(max, d[i] + (l[i] ?? l[0] ?? 0));
    return max;
  };
  const transition = longest(cs.transitionDuration, cs.transitionDelay);
  const animation = longest(cs.animationDuration, cs.animationDelay);
  const count = (v: string) => (v ? v.split(',').length : 0);
  return transition >= animation
    ? { timeout: transition, propCount: transition > 0 ? count(cs.transitionDuration) : 0 }
    : { timeout: animation, propCount: count(cs.animationDuration) };
}

/** Done at the element's own transitionend / animationend, or when its
 * longest layer must be over (an event that never comes — a property that
 * did not change — would otherwise hang the transition). */
function whenDomTransitionEnds(host: unknown, explicitMs: number | undefined, cb: () => void): void {
  const el = host as Element;
  if (explicitMs != null) {
    setTimeout(cb, explicitMs);
    return;
  }
  const { timeout, propCount } = domTransitionInfo(el);
  if (timeout <= 0) {
    cb();
    return;
  }
  let done = false;
  // every property's end, as runtime-dom counts them: one property's early
  // end (a transition reversed before it got anywhere) is not the end
  let ended = 0;
  const finish = (): void => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', onEnd);
    el.removeEventListener('animationend', onEnd);
    cb();
  };
  const onEnd = (e: Event): void => {
    if (e.target === el && ++ended >= propCount) finish();
  };
  el.addEventListener('transitionend', onEnd);
  el.addEventListener('animationend', onEnd);
  setTimeout(finish, timeout + 1);
}

// ---- v-model on DOM controls (specs/170) ------------------------------------------
// runtime-dom's vModelCheckbox / vModelRadio / vModelSelect, on the vapor
// effect: the control's state follows the model through a renderEffect,
// user changes go back through `set`.

const modelValueOf = (el: HTMLInputElement | HTMLOptionElement): unknown =>
  '_value' in el ? (el as unknown as { _value: unknown })._value : el.value;

function applyDomChoiceModel(
  el: HTMLInputElement,
  kind: 'checkbox' | 'radio' | 'select' | 'dynamic',
  get: () => unknown,
  set: (v: unknown) => void,
  modifiers: Record<string, boolean | undefined>,
): boolean {
  if (kind === 'dynamic') {
    const tag = el.tagName;
    if (tag === 'SELECT') kind = 'select';
    else if (tag === 'INPUT' && el.type === 'checkbox') kind = 'checkbox';
    else if (tag === 'INPUT' && el.type === 'radio') kind = 'radio';
    else return false; // text fields: the caller falls back to the text model
  }
  if (kind === 'checkbox') {
    addListener(el, 'onChange', () => {
      const model = get();
      const checked = el.checked;
      const value = modelValueOf(el);
      if (Array.isArray(model)) {
        const at = looseIndexOf(model, value);
        if (checked && at < 0) set(model.concat(value));
        else if (!checked && at >= 0) set(model.filter((_, i) => i !== at));
      } else if (model instanceof Set) {
        const next = new Set(model);
        if (checked) next.add(value);
        else next.delete(value);
        set(next);
      } else {
        const tv = (el as unknown as { _trueValue?: unknown })._trueValue;
        const fv = (el as unknown as { _falseValue?: unknown })._falseValue;
        set(checked ? (tv !== undefined ? tv : true) : (fv !== undefined ? fv : false));
      }
    });
    renderEffect(() => {
      const model = get();
      const value = modelValueOf(el);
      el.checked = Array.isArray(model)
        ? looseIndexOf(model, value) > -1
        : model instanceof Set
          ? model.has(value)
          : looseEqual(model, (el as unknown as { _trueValue?: unknown })._trueValue ?? true);
    });
    return true;
  }
  if (kind === 'radio') {
    addListener(el, 'onChange', () => set(modelValueOf(el)));
    renderEffect(() => {
      el.checked = looseEqual(get(), modelValueOf(el));
    });
    return true;
  }
  const select = el as unknown as HTMLSelectElement;
  addListener(select, 'onChange', () => {
    const picked = Array.prototype.filter
      .call(select.options, (o: HTMLOptionElement) => o.selected)
      .map((o: HTMLOptionElement) => (modifiers.number ? looseToNumber(modelValueOf(o) as string) : modelValueOf(o)));
    set(select.multiple ? picked : picked[0]);
  });
  renderEffect(() => {
    const model = get();
    for (const o of Array.from(select.options)) {
      const v = modelValueOf(o);
      o.selected = select.multiple
        ? Array.isArray(model) ? looseIndexOf(model, v) > -1 : model instanceof Set ? model.has(v) : false
        : looseEqual(v, model);
    }
  });
  return true;
}

// ---- event modifiers (specs/170) ------------------------------------------------------
// runtime-dom's withModifiers / withKeys, over real DOM events. (The
// Flutter twins live in vue/modifiers.ts: there, key events do not exist.)

const SYSTEM_MODIFIERS = ['ctrl', 'shift', 'alt', 'meta'] as const;
type DomEventLike = Event & Partial<MouseEvent & KeyboardEvent>;
const GUARDS: Record<string, (e: DomEventLike, mods: string[]) => boolean | void> = {
  stop: (e) => e.stopPropagation(),
  prevent: (e) => e.preventDefault(),
  self: (e) => e.target !== e.currentTarget,
  ctrl: (e) => !e.ctrlKey,
  shift: (e) => !e.shiftKey,
  alt: (e) => !e.altKey,
  meta: (e) => !e.metaKey,
  left: (e) => 'button' in e && e.button !== 0,
  middle: (e) => 'button' in e && e.button !== 1,
  right: (e) => 'button' in e && e.button !== 2,
  exact: (e, mods) => SYSTEM_MODIFIERS.some((m) => (e as unknown as Record<string, boolean>)[`${m}Key`] && !mods.includes(m)),
};

export function withModifiers<T extends (...args: unknown[]) => unknown>(fn: T, modifiers: string[]): T {
  return ((event: unknown, ...args: unknown[]) => {
    if (event instanceof Event) {
      for (const m of modifiers) if (GUARDS[m]?.(event as DomEventLike, modifiers)) return undefined;
    }
    return fn(event, ...args);
  }) as T;
}

const KEY_ALIASES: Record<string, string | string[]> = {
  esc: 'escape',
  space: ' ',
  up: 'arrow-up',
  left: 'arrow-left',
  right: 'arrow-right',
  down: 'arrow-down',
  delete: 'backspace',
};

export function withKeys<T extends (...args: unknown[]) => unknown>(fn: T, modifiers: string[]): T {
  return ((event: unknown, ...args: unknown[]) => {
    if (!(event instanceof Event) || !('key' in event)) return fn(event, ...args);
    const key = hyphenate(String((event as KeyboardEvent).key));
    if (modifiers.some((k) => k === key || KEY_ALIASES[k] === key)) return fn(event, ...args);
    return undefined;
  }) as T;
}

export const withVaporModifiers = <T extends (...args: unknown[]) => unknown>(fn: T, modifiers: string[]): T =>
  createInvoker(typeof fn === 'function' ? withModifiers(fn, modifiers) : fn);
export const withVaporKeys = <T extends (...args: unknown[]) => unknown>(fn: T, modifiers: string[]): T =>
  createInvoker(typeof fn === 'function' ? withKeys(fn, modifiers) : fn);

// ---- touch (specs/171) --------------------------------------------------------------
// `@touchstart` & co on a native vapor element: the web adapter's pointer
// emulation (web/components/touch.ts), which delivers the payload shape the
// Flutter side does. One set of pointer listeners per element feeds all
// four: touchBindings routes a pointer from its pointerdown to the move /
// end handlers known then, so they have to be bound together.
const TOUCH_KEYS: Record<string, 'start' | 'move' | 'end' | 'cancel'> = {
  onTouchstart: 'start',
  onTouchStart: 'start',
  onTouchmove: 'move',
  onTouchMove: 'move',
  onTouchend: 'end',
  onTouchEnd: 'end',
  onTouchcancel: 'cancel',
  onTouchCancel: 'cancel',
};
const touchHandlers = new WeakMap<Element, Partial<Record<'start' | 'move' | 'end' | 'cancel', (...a: unknown[]) => void>>>();

function bindTouch(el: Element, phase: 'start' | 'move' | 'end' | 'cancel', handler: (...a: unknown[]) => void): void {
  let record = touchHandlers.get(el);
  if (!record) {
    const rec: Partial<Record<'start' | 'move' | 'end' | 'cancel', (...a: unknown[]) => void>> = {};
    record = rec;
    touchHandlers.set(el, rec);
    const bindings = touchBindings({
      onTouchstart: (...a: unknown[]) => rec.start?.(...a),
      onTouchmove: (...a: unknown[]) => rec.move?.(...a),
      onTouchend: (...a: unknown[]) => rec.end?.(...a),
      onTouchcancel: (...a: unknown[]) => rec.cancel?.(...a),
    });
    for (const [key, fn] of Object.entries(bindings)) {
      el.addEventListener(key.slice(2).toLowerCase(), fn as EventListener);
    }
  }
  record[phase] = handler;
}

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
    // a running <Transition>'s classes ride along (runtime-dom's `_vtc`):
    // a :class re-render mid-animation must not drop them (specs/174)
    const vtc = transitionClassesOf(host as object);
    (host as Element).setAttribute('class', vtc.length ? (value ? value + ' ' : '') + vtc.join(' ') : value);
  },

  querySelector: (selector) => (typeof document === 'undefined' ? null : document.querySelector(selector)),

  transition: {
    addClass(host, cls) {
      for (const c of cls.split(/\s+/)) {
        if (!c) continue;
        trackTransitionClass(host as object, c);
        (host as Element).classList.add(c);
      }
    },
    removeClass(host, cls) {
      for (const c of cls.split(/\s+/)) {
        if (!c) continue;
        untrackTransitionClass(host as object, c);
        (host as Element).classList.remove(c);
      }
    },
    nextFrame: (cb) => {
      const hop = (inner: () => void): void => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => inner());
        else setTimeout(inner, 16);
      };
      hop(() => hop(cb));
    },
    whenEnds: whenDomTransitionEnds,
    isElement: (host) => (host as Node).nodeType === 1,
    rectOf: (host) => (host as Element).getBoundingClientRect(),
  },

  patchStyle(host, prev, next) {
    // the same value rules the web adapter applies (specs/171): numbers
    // are px, `direction` is fjs's scroll-axis key — and the property names
    // arrive camelCase from templates (`fontSize`), which setProperty does
    // not accept: it wants `font-size`, and silently drops anything else
    const style = (host as HTMLElement).style;
    const norm = (normalizeStyleValues(next) ?? {}) as Record<string, unknown>;
    const cssName = (k: string): string => (k.startsWith('--') ? k : hyphenate(k));
    for (const k in (normalizeStyleValues(prev) as Record<string, unknown>) ?? {}) {
      if (!(k in norm)) style.removeProperty(cssName(k));
    }
    for (const k in norm) {
      const v = norm[k];
      if (v == null || v === '') style.removeProperty(cssName(k));
      else style.setProperty(cssName(k), String(v));
    }
  },

  setAttr(host, key, value) {
    if (value === false || value == null) (host as Element).removeAttribute(key);
    else (host as Element).setAttribute(key, value === true ? '' : String(value));
  },

  on(host, key, handler) {
    if (TOUCH_KEYS[key]) {
      bindTouch(host as Element, TOUCH_KEYS[key], handler as (...a: unknown[]) => void);
      return;
    }
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
  // ---- specs/170 ------------------------------------------------------------------------
  setValue(host, value) {
    const el = host as HTMLInputElement;
    const next = value == null ? '' : String(value);
    // the DOM property, not the attribute (the attribute is only the
    // default); skipped when equal so the caret does not jump
    if ('value' in el) {
      if (el.value !== next) el.value = next;
    } else (host as Element).setAttribute('value', next);
  },
  setDOMProp(host, key, value) {
    (host as unknown as Record<string, unknown>)[key] = value;
  },
  setHtml(host, html) {
    (host as Element).innerHTML = html;
  },
  classOf(host) {
    return (host as Element).getAttribute?.('class') ?? '';
  },
  textModel: {
    event: (lazy) => (lazy ? 'onChange' : 'onInput'),
    read: (_payload, host) => String((host as HTMLInputElement).value ?? ''),
  },
  applyChoiceModel(host, kind, get, set, modifiers) {
    return applyDomChoiceModel(host as HTMLInputElement, kind, get, set, modifiers);
  },
  createElement(tag) {
    return document.createElement(tag);
  },
  parentNode(host) {
    return (host as Node).parentNode;
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
  // specs/170: the rest of compiler-vapor's helper surface
  registerTagComponent,
  applyCheckboxModel,
  applyDynamicModel,
  applyRadioModel,
  applySelectModel,
  applyTextModel,
  applyVShow,
  createInvoker,
  createKeyedFragment,
  createPlainElement,
  createSelector,
  createTemplateRefSetter,
  extend,
  getDefaultValue,
  getRestElement,
  insert,
  onBinding,
  setBlockKey,
  setDOMProp,
  setDynamicEvents,
  setDynamicProps,
  setElementText,
  setHtml,
  setStaticTemplateRef,
  setTemplateRefBinding,
  setValue,
  withOnce,
  withVaporDirectives,
  VaporKeepAlive,
  VaporTeleport,
  VaporTransition,
  VaporTransitionGroup,
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
// specs/167: vapor-aware lifecycle + provide/inject, shadowing the
// runtime-core star above like the runtime's names do
export {
  onBeforeMount, onMounted, onBeforeUnmount, onUnmounted, onBeforeUpdate, onUpdated, onActivated, onDeactivated, onErrorCaptured, onRenderTracked, onRenderTriggered, onServerPrefetch, provide, inject, hasInjectionContext, useAttrs, resolveDynamicComponent,
} from './instance';
// compiled text interpolations import this helper by name; the runtime only
// imports it for its own use, and the flutter entry gets it from vue-shim
export { toDisplayString } from '@vue/shared';
