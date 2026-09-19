// Element API — the HTML-like UI layer. JS apps build node trees with
// h()/element functions; ops are batched per microtask and flushed to the
// native host in one frame (mirrors React Native's batched shadow commits).
import { getWriter, scheduleFlush, flushNow } from '../host';
import { attachCanvas, detachCanvas } from '../canvas/surface';
import type { FjsCanvasRenderingContext2D } from '../canvas/context-2d';

/** The drawing surface's tag. `canvas` is the COMPONENT a page writes
 * (components/canvas.ts); it wraps this element in a box that can also hold
 * an overlay. Two names because a component cannot render a tag of its own
 * name. */
const INNER_CANVAS_TAG = 'inner-canvas';
import { decodeTouchEvent, isTouchEvent, type FjsTouchEvent } from './touch';
import { boundingRectOf, type FjsRect } from './geometry';

/** Event names accepted in props; handlers never cross the JSI boundary —
 * only their existence is sent (e.g. onTap: true) and native dispatches
 * arrive via __fjsDispatchEvent. */
const EVENT_PREFIX = 'on';
export const EventType: Record<string, number> = {
  onTap: 1,
  onClick: 1,
  onLongPress: 2,
  onTextChanged: 3,
  onSubmit: 4,
  onValueChanged: 5,
  onPageChanged: 6,
  onModalClosed: 7,
  onRefresh: 8,
  onScroll: 12,
  // 20-23: focus/blur carry the field's current text; form submit carries a
  // {name: value} JSON string (see widgets/form.dart for the shape).
  onFocus: 20,
  onBlur: 21,
  onFormSubmit: 22,
  onFormReset: 23,
  // scroll-view's edge events. The scroll event itself is 12; its payload is
  // the JSON scroll/metrics.ts writes, not a bare offset.
  // `@scrolltolower` in a template becomes `onScrolltolower` — the all-lower
  // spelling is the one that actually shows up, so it is canonical here and
  // on the Dart side; the camelCase alias is for hand-written h() calls.
  onScrolltoupper: 24,
  onScrollToUpper: 24,
  onScrolltolower: 25,
  onScrollToLower: 25,
  // 26/27 are not image-only: they are "this node's resource loaded /
  // failed", and the payload's shape is the tag's (image sends
  // {width,height}, web-view sends {src}). A module tag uses these numbers
  // rather than inventing its own — the three tables are the one authority
  // on the numbering (constitution II).
  onLoad: 26,
  onError: 27,
  // textarea's line count. Same all-lower-first rule as the edge events:
  // `@linechange` in a template becomes `onLinechange`.
  onLinechange: 28,
  onLineChange: 28,
  // a webview's page called fjs.postMessage; payload is {"data":"…"}
  onMessage: 29,
  // a canvas node was laid out or resized; payload is
  // {"width":n,"height":n} in LOGICAL pixels. Number 30 is the canvas
  // subsystem's (fjs.h FJS_EVENT_CANVAS) — the same number also carries
  // image/dataURL results, which is why the payload is discriminated and
  // why canvas/surface.ts, not this dispatcher, decides which of the two
  // a given event is.
  onResize: 30,
  // touch: the DOM names, so `@touchstart` in a template lands here. The
  // camelCase spellings are aliases for hand-written h() calls.
  onTouchstart: 15,
  onTouchStart: 15,
  onTouchmove: 16,
  onTouchMove: 16,
  onTouchend: 17,
  onTouchEnd: 17,
  onTouchcancel: 18,
  onTouchCancel: 18,
  // sticky-header's pin-state flip (specs/052). Same all-lower-first rule
  // as the edge events: `@stickontopchange` becomes `onStickontopchange`.
  // Payload is the JSON string {"isStickOnTop":boolean}.
  onStickontopchange: 34,
  onStickOnTopChange: 34,
  // page-container's transition lifecycle (specs/065), no payloads. The
  // camelCase spellings are canonical — `@before-enter` in a template
  // becomes the prop `onBeforeEnter` — with the all-lower aliases for
  // hand-written h() calls, mirroring the wx event names.
  onBeforeEnter: 35,
  onBeforeenter: 35,
  onEnter: 36,
  onAfterEnter: 37,
  onAfterenter: 37,
  onBeforeLeave: 38,
  onBeforeleave: 38,
  onLeave: 39,
  onAfterLeave: 40,
  onAfterleave: 40,
  onClickoverlay: 41,
  onClickOverlay: 41,
};

/** Handler props with more than one spelling: the native side is told the
 * canonical one, so it has a single name to look for. */
const CANONICAL_EVENT_PROP: Record<string, string> = {
  onScrollToUpper: 'onScrolltoupper',
  onScrollToLower: 'onScrolltolower',
  onLineChange: 'onLinechange',
  onTouchStart: 'onTouchstart',
  onTouchMove: 'onTouchmove',
  onTouchEnd: 'onTouchend',
  onTouchCancel: 'onTouchcancel',
  onBeforeenter: 'onBeforeEnter',
  onAfterenter: 'onAfterEnter',
  onBeforeleave: 'onBeforeLeave',
  onAfterleave: 'onAfterLeave',
  onClickOverlay: 'onClickoverlay',
};

let nextId = 1;
export type EventPayload = string | FjsTouchEvent | undefined;
const eventHandlers = new Map<string, (payload?: EventPayload) => void>();
/** addEventListener registrations, next to (not instead of) the one prop
 * handler per event: a library attaches its own listener to an element a
 * template also binds (vant's Slider button has `@touchstart` from its
 * render function and a touchmove from useEventListener). */
const domListeners = new Map<string, Set<(event: unknown) => void>>();
const workerHandlers = new Map<number, (data: string) => void>();
/** Events that address a subsystem instead of a node (worker messages,
 * navigator callbacks). `id` is that subsystem's own handle. */
const systemHandlers = new Map<number, (id: number, payload?: string) => void>();

/** Same warn-once channel the CSS layer uses, minus the import cycle. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** The handler a node has registered for [type], if any. The canvas layer
 * needs this because its events arrive on the SUBSYSTEM channel (one number
 * for three kinds of message) and it has to route the size ones on to the
 * page itself. */
export function nodeHandler(
  nodeId: number,
  type: number,
): ((payload?: EventPayload) => void) | undefined {
  return eventHandlers.get(handlerKey(nodeId, type));
}

export function handlerKey(nodeId: number, type: number): string {
  return `${nodeId}:${type}`;
}

// ---- form bookkeeping -------------------------------------------------------
//
// A <form> has to answer "which controls are under me and what do they hold
// right now" — including a control the page never bound a value to, whose
// text exists only inside the host widget. The element layer is the one
// place that sees both halves: every prop write comes through setProps, and
// every value-bearing event comes back through the dispatcher.
//
// It lives HERE and not in the Vue renderer on purpose: this is the
// framework-agnostic layer, so a page built on the raw element API gets the
// same <form> behaviour (docs/custom-renderer.md).

/** `name` / `form-type` per node — the props a form reads structurally. */
const fieldNames = new Map<number, string>();
const fieldFormTypes = new Map<number, string>();
/** The value a control currently holds: the last bound `value` prop, then
 * whatever the user did to it. */
const fieldValues = new Map<number, string>();

export function fieldName(nodeId: number): string | undefined {
  return fieldNames.get(nodeId);
}

export function fieldFormType(nodeId: number): string | undefined {
  return fieldFormTypes.get(nodeId);
}

export function fieldValue(nodeId: number): string | undefined {
  return fieldValues.get(nodeId);
}

function recordField(nodeId: number, key: string, value: unknown): void {
  if (key === 'name') {
    if (value == null || value === '') fieldNames.delete(nodeId);
    else fieldNames.set(nodeId, String(value));
    return;
  }
  if (key === 'formType') {
    if (value == null || value === '') fieldFormTypes.delete(nodeId);
    else fieldFormTypes.set(nodeId, String(value));
    return;
  }
  if (key !== 'value') return;
  if (value == null) fieldValues.delete(nodeId);
  else fieldValues.set(nodeId, typeof value === 'boolean'
    ? (value ? '1' : '0')
    : String(value));
}

/** The distinct event type numbers (onTap and onClick are one). Dropping a
 * node's handlers walks these instead of the registry: the registry holds
 * every handler in the app, and scanning it per removed node made teardown
 * cost more the longer the app had been running. */
const EVENT_TYPES: number[] = [...new Set(Object.values(EventType))];

/** Forgets every handler registered for one node.
 *
 * Handlers outlive their node otherwise, and a handler is a closure over its
 * component's render scope — one surviving `@tap` pins the whole page it was
 * written in. The tree bookkeeping lives in the renderer, so dropping a
 * SUBTREE is its job (see forgetSubtree); this drops one node. */
export function forgetHandlers(nodeId: number): void {
  for (let i = 0; i < EVENT_TYPES.length; i++) {
    eventHandlers.delete(handlerKey(nodeId, EVENT_TYPES[i]));
    domListeners.delete(handlerKey(nodeId, EVENT_TYPES[i]));
  }
  fieldNames.delete(nodeId);
  fieldFormTypes.delete(nodeId);
  fieldValues.delete(nodeId);
}

export function registerWorkerHandler(
  workerId: number,
  handler: (data: string) => void,
): void {
  workerHandlers.set(workerId, handler);
}

export function unregisterWorkerHandler(workerId: number): void {
  workerHandlers.delete(workerId);
}

/** Registers a handler for a non-node event type (see FjsEvent on the Dart
 * side). Used by the router to receive navigator mount/pop callbacks. */
export function registerSystemHandler(
  type: number,
  handler: (id: number, payload?: string) => void,
): void {
  systemHandlers.set(type, handler);
}

/** Installs the global event dispatcher the native layer calls. */
export function installEventDispatcher(): void {
  globalThis.__fjsDispatchEvent =
    (nodeId: number, eventType: number, payload: string | null) => {
      if (eventType === 9) {
        // worker -> main message (nodeId is the worker handle)
        workerHandlers.get(nodeId)?.(payload ?? '');
        return;
      }
      const system = systemHandlers.get(eventType);
      if (system) {
        // nodeId addresses the subsystem (e.g. a navigator page key)
        system(nodeId, payload ?? undefined);
        return;
      }
      // Recorded whether or not the page listens: a <form> reads this, and
      // an unbound control has no handler of its own.
      if (eventType === 3 || eventType === 5) {
        fieldValues.set(nodeId, payload ?? '');
      }
      const key = handlerKey(nodeId, eventType);
      const handler = eventHandlers.get(key);
      const listeners = domListeners.get(key);
      if (!handler && !listeners) return;
      if (isTouchEvent(eventType)) {
        const event = decodeTouchEvent(eventType, payload);
        if (!event) return;
        handler?.(event);
        if (listeners) for (const fn of [...listeners]) fn(event);
        return;
      }
      handler?.(payload ?? undefined);
      if (listeners) {
        const event = { detail: payload ?? undefined, preventDefault() {}, stopPropagation() {} };
        for (const fn of [...listeners]) fn(event);
      }
    };
}

export interface Element {
  readonly id: number;
  readonly tag: string;
  /** DOM-shaped write surface for style libraries (`el.style.opacity = 0.5`).
   * Goes through the style engine's inline layer, sharing the record with
   * `:style` bindings. Not a real CSSStyleDeclaration: no cascade reads,
   * no computed style. */
  readonly style: FjsElementStyle;
  appendChild(child: Element): Element;
  removeChild(child: Element): Element;
  setText(text: string): Element;
  setProps(props: Record<string, unknown>): Element;
  /** The laid-out box in window coordinates, like the DOM's — as of the
   * last frame (ui/geometry.ts). All zeros before layout. */
  getBoundingClientRect(): FjsRect;
  /** DOM-shaped listener registration, for libraries that attach their own
   * listeners (`el.addEventListener('touchmove', fn)`). The DOM event name
   * maps onto the same event as the `on<Name>` prop; options (passive,
   * capture) mean nothing here and are ignored. */
  addEventListener(type: string, listener: (event: any) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: any) => void, options?: unknown): void;
  /** DOM offset geometry, read from the same last-frame layout as
   * getBoundingClientRect: the border box's size, and its position against
   * the offsetParent's box (the nearest positioned ancestor, resolved by
   * the renderer — null without one, as for a detached DOM node). vant's
   * Tabs centres its underline on `title.offsetLeft + offsetWidth / 2`. */
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly offsetParent: Element | null;
}

/** Finds an element's offsetParent. The Vue renderer owns the tree and the
 * computed `position`, so it injects this; the raw element API has no tree
 * to walk and answers null. */
let offsetParentResolver: ((id: number) => Element | null) | null = null;

export function setOffsetParentResolver(resolver: ((id: number) => Element | null) | null): void {
  offsetParentResolver = resolver;
}

function offsetOf(el: { id: number }, axis: 'left' | 'top'): number {
  const own = boundingRectOf(el.id)[axis];
  const parent = offsetParentResolver?.(el.id);
  return parent ? own - boundingRectOf(parent.id)[axis] : own;
}

/** Shared getters: one descriptor set for every element, `this` is the
 * element — no closures allocated per node. */
const OFFSET_DESCRIPTORS: PropertyDescriptorMap = {
  offsetWidth: {
    get(this: { id: number }) {
      return boundingRectOf(this.id).width;
    },
  },
  offsetHeight: {
    get(this: { id: number }) {
      return boundingRectOf(this.id).height;
    },
  },
  offsetLeft: {
    get(this: { id: number }) {
      return offsetOf(this, 'left');
    },
  },
  offsetTop: {
    get(this: { id: number }) {
      return offsetOf(this, 'top');
    },
  },
  offsetParent: {
    get(this: { id: number }) {
      return offsetParentResolver?.(this.id) ?? null;
    },
  },
};

/** An `inner-canvas` element — the drawing surface inside the `canvas`
 * component. Pages reach these members through a `ref` on `<canvas>`, which
 * forwards to this object. The extra members are the DOM's, deliberately: a
 * page — or a charting library that was written against a browser — calls
 * `getContext('2d')` and reads `width` / `height`, and inventing fjs-only
 * names for them would mean every such library needs a fork.
 *
 * They live on the ELEMENT rather than in a Vue component so a page built on
 * the raw element API, or on a future React adapter, gets the same API: this
 * is the framework-agnostic layer (docs/custom-renderer.md). */
export interface CanvasElement extends Element {
  getContext(type: '2d', attributes?: unknown): FjsCanvasRenderingContext2D | null;
  getContext(type: string, attributes?: unknown): unknown;
  /** Exports the whole canvas. A promise, unlike the DOM's synchronous
   * version: the pixels do not exist until the host has painted and read
   * back a frame. */
  toDataURL(type?: string, quality?: number): Promise<string>;
  /** Laid-out size in logical pixels; 0 until the host reports it. */
  readonly width: number;
  readonly height: number;
}

export function create(tag: string): Element {
  const id = nextId++;
  getWriter().create(id, tag);
  scheduleFlush();
  const el = makeElement(id, tag);
  if (tag === INNER_CANVAS_TAG) {
    attachCanvas(
      el as unknown as Record<string, unknown> & { id: number },
      registerSystemHandler,
    );
  }
  return el;
}

function makeElement(id: number, tag: string): Element {
  const el: Element = {
    id,
    tag,
    // Real value attached by the defineProperty below — lazily, because a
    // page has hundreds of elements and almost none is ever touched by a
    // DOM-style library.
    style: null as unknown as FjsElementStyle,
    // replaced by the OFFSET_DESCRIPTORS getters below
    offsetWidth: 0,
    offsetHeight: 0,
    offsetLeft: 0,
    offsetTop: 0,
    offsetParent: null,
    appendChild(child) {
      insert(el, child);
      return child;
    },
    removeChild(child) {
      getWriter().removeChild(id, child.id);
      getWriter().remove(child.id);
      forgetHandlers(child.id);
      forgetElementStyle(child.id);
      if (child.tag === INNER_CANVAS_TAG) detachCanvas(child as { __canvas?: unknown });
      scheduleFlush();
      return child;
    },
    setText(text) {
      getWriter().setText(id, text);
      scheduleFlush();
      return el;
    },
    setProps(props) {
      setProps(el, props);
      return el;
    },
    getBoundingClientRect() {
      return boundingRectOf(id);
    },
    addEventListener(type, listener) {
      addDomListener(el, type, listener);
    },
    removeEventListener(type, listener) {
      removeDomListener(el, type, listener);
    },
  };
  // Fresh object per access (no per-element cache to clean up on removal) —
  // the allocation is trivial next to the bridge write it wraps.
  Object.defineProperty(el, 'style', {
    get() {
      return createElementStyle(id);
    },
  });
  Object.defineProperties(el, OFFSET_DESCRIPTORS);
  return el;
}

// ---- DOM-shaped element style (el.style) -----------------------------------
//
// DOM animation libraries (@vueuse/motion and friends) never call setStyle —
// they assign `el.style[key] = v` and read it back. The fjs element is not a
// DOM node, so on the Flutter path there was nothing for them to write to
// (Anime.js got around this in spec 031 by animating plain objects; a
// directive-based library cannot). This is the DOM surface subset those
// libraries actually touch: index get/set, setProperty / getPropertyValue /
// removeProperty.
//
// Every write funnels through the style engine's INLINE layer — the same
// record `:style` bindings and useCssVars merge into — so all three writers
// coexist and the cascade re-resolves once per flush. Reads see only the
// inline record, never the resolved cascade (that would be
// getComputedStyle, which is out of scope; docs/web.md logs the difference).

/** DOM `CSSStyleDeclaration` subset an `el.style` object answers to. */
export interface FjsElementStyle {
  [key: string]: unknown;
  setProperty(name: string, value: string): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): string;
}

/** The write path's target, injected by the Vue renderer — the style engine
 * instance lives there, and element.ts cannot import it: the engine reaches
 * back into this module (setStyle / setHoverStyle), so a static import
 * would be a cycle. Without a bridge (raw element API, engine-less tests)
 * writes land in a local record so reads still round-trip, with a warnOnce
 * so the missing restyle is not silent (constitution V). */
export interface ElementStyleBridge {
  read(id: number): Record<string, unknown> | undefined;
  write(id: number, key: string, value: unknown): void;
}

let styleBridge: ElementStyleBridge | null = null;
const fallbackStyles = new Map<number, Record<string, unknown>>();

export function setElementStyleBridge(bridge: ElementStyleBridge | null): void {
  styleBridge = bridge;
}

/** Drops an element's fallback style record; the renderer calls this when it
 * tears down a subtree so removed elements do not pin their last write. */
export function forgetElementStyle(id: number): void {
  fallbackStyles.delete(id);
}

function readStyleRecord(id: number): Record<string, unknown> | undefined {
  if (styleBridge) return styleBridge.read(id);
  return fallbackStyles.get(id);
}

function writeStyleProp(id: number, key: string, value: unknown): void {
  if (styleBridge) {
    styleBridge.write(id, key, value);
    return;
  }
  warnOnce(
    'element-style-no-engine',
    'el.style write without a style engine: the value is kept for reads but will not restyle the element',
  );
  const record = fallbackStyles.get(id) ?? {};
  if (value == null || value === '') delete record[key];
  else record[key] = value;
  fallbackStyles.set(id, record);
}

function createElementStyle(id: number): FjsElementStyle {
  const methods: Record<string, unknown> = {
    setProperty(name: string, value: string) {
      writeStyleProp(id, name, value);
    },
    getPropertyValue(name: string) {
      const value = readStyleRecord(id)?.[name];
      return value == null ? '' : String(value);
    },
    removeProperty(name: string) {
      const previous = readStyleRecord(id)?.[name];
      writeStyleProp(id, name, null);
      return previous == null ? '' : String(previous);
    },
  };
  return new Proxy(methods, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      const value = readStyleRecord(id)?.[prop as string];
      return value == null ? '' : String(value);
    },
    set(target, prop, value) {
      if (prop in target) {
        target[prop as string] = value;
        return true;
      }
      writeStyleProp(id, prop as string, value);
      return true;
    },
  }) as FjsElementStyle;
}

/** Extracts handler props (functions) into the registry and forwards the
 * rest — plus `on*: true` markers — to the native mirror tree.
 *
 * Handlers never cross the bridge; the native side only learns that one
 * EXISTS. So swapping the closure costs nothing there and must not cost an
 * op — which matters because it is the common case, not an edge case: a
 * template's `@tap="() => open(item)"` compiles to a fresh closure on every
 * render, so Vue sees the prop as changed and calls patchProp for every row
 * of a list on every re-render. Emitting a marker there wrote one redundant
 * SetProps per row, each landing as a jsonDecode and a props-map copy on the
 * Flutter side for a value that was already `true`. (Vue's own DOM renderer
 * solves the same problem with an invoker.) Only a change in PRESENCE is
 * worth telling the peer about. */
export function setProps(el: Element, props: Record<string, unknown>): void {
  const clean: Record<string, unknown> = {};
  let changed = false;
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function' && key.startsWith(EVENT_PREFIX)) {
      const type = EventType[key];
      if (type !== undefined) {
        const registryKey = handlerKey(el.id, type);
        const had = eventHandlers.has(registryKey) || domListeners.has(registryKey);
        eventHandlers.set(registryKey, value as (payload?: EventPayload) => void);
        if (!had) {
          clean[CANONICAL_EVENT_PROP[key] ?? key] = true;
          changed = true;
        }
      } else {
        // Constitution V: a handler nobody listens for is a bug, not a
        // no-op. `@scrolltolower` was dead on Flutter for exactly this
        // reason — the template's all-lower spelling was missing from
        // EventType and the prop was dropped without a word.
        warnOnce(
          `unknown-handler:${key}`,
          `<${el.tag}> got a handler prop "${key}" that fjs does not know; ` +
            'it will never fire. Check the event name against EventType ' +
            '(packages/fjs-runtime/src/ui/element.ts).',
        );
      }
    } else if (value === null && key.startsWith(EVENT_PREFIX) && EventType[key] !== undefined) {
      // detach: drop the JS handler and clear the native marker
      const registryKey = handlerKey(el.id, EventType[key]);
      // an addEventListener listener still wants the event: keep the marker
      if (eventHandlers.delete(registryKey) && !domListeners.has(registryKey)) {
        clean[CANONICAL_EVENT_PROP[key] ?? key] = false;
        changed = true;
      }
    } else {
      recordField(el.id, key, value);
      clean[key] = value;
      changed = true;
    }
  }
  if (!changed) return; // nothing the peer can observe
  getWriter().setProps(el.id, clean);
  scheduleFlush();
}

/** `touchmove` → the `onTouchmove` prop's event. Undefined for a DOM event
 * this side has no equivalent of. */
function domEventProp(type: string): string | undefined {
  const prop = `on${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  return EventType[prop] !== undefined ? prop : undefined;
}

function addDomListener(el: Element, type: string, listener: (event: unknown) => void): void {
  const prop = domEventProp(type);
  if (!prop) {
    warnOnce(
      `unknown-listener:${type}`,
      `<${el.tag}> addEventListener('${type}'): fjs has no such event; the listener will never fire.`,
    );
    return;
  }
  const key = handlerKey(el.id, EventType[prop]);
  const marked = eventHandlers.has(key) || domListeners.has(key);
  let set = domListeners.get(key);
  if (!set) domListeners.set(key, (set = new Set()));
  set.add(listener);
  if (!marked) {
    getWriter().setProps(el.id, { [CANONICAL_EVENT_PROP[prop] ?? prop]: true });
    scheduleFlush();
  }
}

function removeDomListener(el: Element, type: string, listener: (event: unknown) => void): void {
  const prop = domEventProp(type);
  if (!prop) return;
  const key = handlerKey(el.id, EventType[prop]);
  const set = domListeners.get(key);
  if (!set?.delete(listener) || set.size) return;
  domListeners.delete(key);
  if (!eventHandlers.has(key)) {
    getWriter().setProps(el.id, { [CANONICAL_EVENT_PROP[prop] ?? prop]: false });
    scheduleFlush();
  }
}

/** Style-only fast path used by the style engine: no handler extraction
 * (a computed style never holds functions) and the serialized form is
 * shared between elements that resolve to the same style object. */
export function setStyle(
  el: Element,
  style: Record<string, unknown>,
  activeStyle?: Record<string, unknown> | null,
): void {
  getWriter().setStyle(el.id, style, activeStyle);
  scheduleFlush();
}

/** The `:hover` variant slot (op 12); `null` clears. */
export function setHoverStyle(el: Element, hoverStyle: Record<string, unknown> | null): void {
  getWriter().setHoverStyle(el.id, hoverStyle);
  scheduleFlush();
}

export function setText(el: Element, text: string): void {
  el.setText(text);
}

export function insert(parent: Element, child: Element, index?: number): void {
  getWriter().insert(parent.id, child.id, index ?? 0x7fffffff);
  scheduleFlush();
}

export function remove(el: Element): void {
  getWriter().remove(el.id);
  forgetHandlers(el.id);
  if (el.tag === INNER_CANVAS_TAG) detachCanvas(el as { __canvas?: unknown });
  scheduleFlush();
}

/** Immediate flush — most apps rely on the microtask auto-flush instead. */
export function flush(): void {
  flushNow();
}

/** Creates the app root. parentId 0 = the host's implicit root container. */
export function createRoot(tag = 'view'): Element {
  const root = create(tag);
  getWriter().insert(0, root.id, 0);
  scheduleFlush();
  return root;
}

/** h() — hyperscript sugar: h('text', {style:...}, 'hello').
 * Children may be passed as an array too: h('view', props, [a, b]). */
export function h(
  tag: string,
  props?: Record<string, unknown>,
  ...children: Array<Element | string | number | Array<Element | string | number>>
): Element {
  const el = create(tag);
  if (props) setProps(el, props);
  const flat = children.flat(Infinity) as Array<Element | string | number>;
  for (const child of flat) {
    if (typeof child === 'string' || typeof child === 'number') {
      if (tag === 'text') {
        // keep text content on the text node itself so setText updates flow
        el.setText(String(child));
      } else {
        const textNode = create('text');
        textNode.setText(String(child));
        insert(el, textNode);
      }
    } else if (child && typeof (child as Element).id === 'number') {
      insert(el, child);
    }
  }
  return el;
}

// install dispatcher eagerly on module load
installEventDispatcher();
