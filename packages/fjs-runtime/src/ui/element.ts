// Element API — the HTML-like UI layer. JS apps build node trees with
// h()/element functions; ops are batched per microtask and flushed to the
// native host in one frame (mirrors React Native's batched shadow commits).
import { getWriter, scheduleFlush, flushNow, hasNativeHost, invokeHost } from '../host';
import { attachCanvas, detachCanvas } from '../canvas/surface';
import type { FjsCanvasRenderingContext2D } from '../canvas/context-2d';

/** The drawing surface's tag. `canvas` is the COMPONENT a page writes
 * (components/canvas.ts); it wraps this element in a box that can also hold
 * an overlay. Two names because a component cannot render a tag of its own
 * name. */
const INNER_CANVAS_TAG = 'inner-canvas';
import { decodeTouchEvent, isTouchEvent, type FjsTouchEvent } from './touch';
import { devtoolsSlots, devtoolsStructuralVersion } from '../devtools-hooks';
import { boundingRectOf, type FjsRect } from './geometry';
import { utf8Encode } from './utf8';

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
  // a CSS transform/opacity transition ran to its end (specs/073), no
  // payload. `@transitionend` in a template becomes `onTransitionend` (the
  // canonical spelling); vant's NoticeBar restarts its marquee on it.
  onTransitionend: 42,
  onTransitionEnd: 42,
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
  onTransitionEnd: 'onTransitionend',
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
/** Which event types each node ever registered (prop handler or DOM
 * listener). forgetHandlers walks this instead of every type there is:
 * trying all 33 cost two key strings and two Map deletes per type, per
 * removed node — ~33k strings to tear down one vant form, the bulk of its
 * 29 ms unmount (specs/118). Most nodes register nothing and pay nothing. */
const nodeEventTypes = new Map<number, number[]>();

function noteEventType(nodeId: number, type: number): void {
  const types = nodeEventTypes.get(nodeId);
  if (types === undefined) nodeEventTypes.set(nodeId, [type]);
  else if (!types.includes(type)) types.push(type);
}
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
/** Last reported scroll offset per scroller (from its scroll events), or
 * what a library wrote to `scrollTop` / `scrollLeft`. Only nodes that ever
 * scrolled or were written to have an entry. */
const scrollOffsets = new Map<number, { top: number; left: number }>();

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

/** Forgets every handler registered for one node.
 *
 * Handlers outlive their node otherwise, and a handler is a closure over its
 * component's render scope — one surviving `@tap` pins the whole page it was
 * written in. The tree bookkeeping lives in the renderer, so dropping a
 * SUBTREE is its job (see forgetSubtree); this drops one node. */
export function forgetHandlers(nodeId: number): void {
  // Only the types this node registered (nodeEventTypes above) — never a
  // scan of the registry, which holds every handler in the app and would
  // make teardown slower the longer the app has run.
  const types = nodeEventTypes.get(nodeId);
  if (types !== undefined) {
    for (let i = 0; i < types.length; i++) {
      const key = handlerKey(nodeId, types[i]);
      eventHandlers.delete(key);
      domListeners.delete(key);
    }
    nodeEventTypes.delete(nodeId);
  }
  fieldNames.delete(nodeId);
  fieldFormTypes.delete(nodeId);
  fieldValues.delete(nodeId);
  scrollOffsets.delete(nodeId);
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
      if (eventType === SCROLL_EVENT && payload) recordScroll(nodeId, payload);
      if (eventType === TAP_EVENT && parentResolver) {
        bubbleTap(nodeId, payload);
        return;
      }
      deliver(nodeId, eventType, payload);
    };
}

/** The tap being delivered right now: where it landed and whether a
 * handler stopped it. The renderer's DOM-shaped event reads it for
 * `target` and wires `stopPropagation()` to it. Null outside a tap. */
export interface TapDispatch {
  readonly targetId: number;
  stopped: boolean;
}
let tapDispatch: TapDispatch | null = null;

export function currentTapDispatch(): TapDispatch | null {
  return tapDispatch;
}

const TAP_EVENT = 1;
const SCROLL_EVENT = 12;

function recordScroll(nodeId: number, payload: string): void {
  try {
    const d = JSON.parse(payload) as { scrollTop?: unknown; scrollLeft?: unknown };
    scrollOffsets.set(nodeId, {
      top: typeof d.scrollTop === 'number' ? d.scrollTop : 0,
      left: typeof d.scrollLeft === 'number' ? d.scrollLeft : 0,
    });
  } catch {
    // a payload that is not the scroll JSON leaves the offset as it was
  }
}

function scrollOffset(id: number, axis: 'top' | 'left'): number {
  return scrollOffsets.get(id)?.[axis] ?? 0;
}

function writeScrollOffset(id: number, axis: 'top' | 'left', value: unknown): void {
  const n = Number(value);
  const cur = scrollOffsets.get(id) ?? { top: 0, left: 0 };
  cur[axis] = Number.isFinite(n) ? n : 0;
  scrollOffsets.set(id, cur);
}

/** A DOM click bubbles; a Flutter tap goes to the innermost detector only
 * (the arena's deepest recognizer wins), so an ancestor's handler never
 * ran — vant's Popover listens on a `<span>` around a `van-button` that has
 * a click handler of its own, and never opened (specs/129). The host still
 * reports one node; the walk up to every listening ancestor happens here,
 * which also cannot double-fire: the ancestors' detectors lost the arena. */
function bubbleTap(nodeId: number, payload: string | null): void {
  const outer = tapDispatch;
  const state: TapDispatch = { targetId: nodeId, stopped: false };
  tapDispatch = state;
  try {
    for (let id: number | undefined = nodeId; id !== undefined && !state.stopped; id = parentResolver?.(id)?.id) {
      deliver(id, TAP_EVENT, payload);
    }
  } finally {
    tapDispatch = outer;
  }
}

/** Hands one node's event to its prop handler and DOM listeners. */
function deliver(nodeId: number, eventType: number, payload: string | null): void {
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
    const tap = tapDispatch;
    const event = {
      detail: payload ?? undefined,
      preventDefault() {},
      stopPropagation() {
        if (tap) tap.stopped = true;
      },
    };
    for (const fn of [...listeners]) fn(event);
  }
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
  /** DOM-shaped control focus, for libraries holding a template ref to an
   * input (`inputRef.value.focus()` — vant's Field). Routes to the widget
   * registered for this element id; a no-op when the element is not a
   * control. On web the substrate is a real DOM element and this is the
   * native method. */
  focus(): void;
  /** DOM-shaped control blur — vant rejects focus on a readonly field by
   * blurring it right from `onFocus`. */
  blur(): void;
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
  /** DOM `isConnected`: whether the element is mounted in a live page.
   * vant's TextEllipsis bails out of measuring when it is false — being
   * undefined here left every text uncut on the app (specs/128). */
  readonly isConnected: boolean;
  /** DOM node-walk members. `parentNode` / `parentElement` are the parent
   * in the mounted tree (null above the page root or once removed);
   * `nodeType` is 1 and `tagName` the fjs tag upper-cased (`VIEW`), as the
   * DOM reports an element. */
  readonly parentNode: Element | null;
  readonly parentElement: Element | null;
  readonly nodeType: number;
  readonly tagName: string;
  readonly nodeName: string;
  /** The scroller's offset as of its last scroll event (0 before one).
   * Writable without effect on the host — the DOM-shaped write vant's Tabs
   * makes must not throw. */
  scrollTop: number;
  scrollLeft: number;
  readonly clientTop: number;
  readonly clientLeft: number;
  /** DOM attribute writes, through the renderer's attribute path. */
  setAttribute(name: string, value: unknown): void;
  removeAttribute(name: string): void;
}

/** Finds an element's offsetParent. The Vue renderer owns the tree and the
 * computed `position`, so it injects this; the raw element API has no tree
 * to walk and answers null. */
let offsetParentResolver: ((id: number) => Element | null) | null = null;

export function setOffsetParentResolver(resolver: ((id: number) => Element | null) | null): void {
  offsetParentResolver = resolver;
}

/** Whether an element is mounted in a live page. Injected by the Vue
 * renderer, which owns the tree; the raw element API answers false, as the
 * DOM does for a node it cannot place. */
let connectedResolver: ((id: number) => boolean) | null = null;

export function setConnectedResolver(resolver: ((id: number) => boolean) | null): void {
  connectedResolver = resolver;
}

/** An element's parent in the mounted tree — the logical one, so a node
 * hoisted into an overlay reports its overlay host, as a teleported DOM
 * node reports its new parent. Injected by the Vue renderer; without it
 * `parentNode` is null and taps do not bubble. */
let parentResolver: ((id: number) => Element | null) | null = null;

export function setParentResolver(resolver: ((id: number) => Element | null) | null): void {
  parentResolver = resolver;
}

/** Where `setAttribute` goes: the renderer's attribute path (its
 * patchProp), so an attribute a library writes lands exactly where the
 * same attribute from a template would. Without a renderer it is dropped. */
let attributeSink: ((el: Element, name: string, value: string | null) => void) | null = null;

export function setAttributeSink(sink: ((el: Element, name: string, value: string | null) => void) | null): void {
  attributeSink = sink;
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
  isConnected: {
    get(this: { id: number }) {
      return connectedResolver?.(this.id) ?? false;
    },
  },
  // The node-walk members: vant's useScrollParent climbs `parentNode` while
  // `nodeType === 1`, looking for the overflow-y scroller its Sticky
  // listens to — without them it stopped at the first step and listened
  // on window, which never scrolls here (specs/129).
  parentNode: {
    get(this: { id: number }) {
      return parentResolver?.(this.id) ?? null;
    },
  },
  parentElement: {
    get(this: { id: number }) {
      return parentResolver?.(this.id) ?? null;
    },
  },
  nodeType: {
    get() {
      return 1;
    },
  },
  tagName: {
    get(this: { tag: string }) {
      return this.tag.toUpperCase();
    },
  },
  nodeName: {
    get(this: { tag: string }) {
      return this.tag.toUpperCase();
    },
  },
  // popperjs adds an offsetParent's scroll offset and border to every
  // coordinate; undefined made them NaN, and the popover sat at 0,0
  // (specs/129). The offset is the last one the scroller reported. A write
  // is remembered but does not scroll: the host has no synchronous scroll
  // command. It must not throw either — vant's Tabs assigns scrollLeft.
  scrollTop: {
    get(this: { id: number }) {
      return scrollOffset(this.id, 'top');
    },
    set(this: { id: number }, v: unknown) {
      writeScrollOffset(this.id, 'top', v);
    },
  },
  scrollLeft: {
    get(this: { id: number }) {
      return scrollOffset(this.id, 'left');
    },
    set(this: { id: number }, v: unknown) {
      writeScrollOffset(this.id, 'left', v);
    },
  },
  // the DOM's top/left border width. Not tracked here: 0, which is exact for
  // the overlay host popovers are positioned in (it has no border)
  clientTop: {
    get() {
      return 0;
    },
  },
  clientLeft: {
    get() {
      return 0;
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

/** Everything an element does, on ONE shared prototype.
 *
 * Elements used to be object literals carrying their own closures: nine
 * methods plus a `style` getter and five offset getters installed with
 * defineProperty, per node. Under the interpreter that was ~7 µs of a
 * 12 µs create() (specs/118) — all allocation, since nothing here needs
 * per-node state beyond `id` and `tag`. `this` is the element; every
 * member reads its id off `this` instead of a captured variable.
 *
 * Members a subsystem adds to one element (a text control's `value`, a
 * canvas surface's `getContext`) are still own properties set on that
 * instance, and shadow nothing here. */
const ELEMENT_PROTO = {
  appendChild(this: Element, child: Element): Element {
    insert(this, child);
    return child;
  },
  removeChild(this: Element, child: Element): Element {
    getWriter().removeChild(this.id, child.id);
    getWriter().remove(child.id);
    forgetHandlers(child.id);
    forgetElementStyle(child.id);
    if (child.tag === INNER_CANVAS_TAG) detachCanvas(child as { __canvas?: unknown });
    scheduleFlush();
    return child;
  },
  setText(this: Element, text: string): Element {
    getWriter().setText(this.id, text);
    scheduleFlush();
    return this;
  },
  setProps(this: Element, props: Record<string, unknown>): Element {
    setProps(this, props);
    return this;
  },
  getBoundingClientRect(this: Element): FjsRect {
    return boundingRectOf(this.id);
  },
  addEventListener(this: Element, type: string, listener: (event: unknown) => void): void {
    addDomListener(this, type, listener);
  },
  removeEventListener(this: Element, type: string, listener: (event: unknown) => void): void {
    removeDomListener(this, type, listener);
  },
  // popperjs writes its `data-popper-placement` this way, and skips the
  // element (no position at all) unless it looks like an HTML element
  setAttribute(this: Element, name: string, value: unknown): void {
    attributeSink?.(this, String(name), value == null ? null : String(value));
  },
  removeAttribute(this: Element, name: string): void {
    attributeSink?.(this, String(name), null);
  },
  focus(this: Element): void {
    if (hasNativeHost) invokeHost('fjs.control.focus', this.id);
  },
  blur(this: Element): void {
    if (hasNativeHost) invokeHost('fjs.control.blur', this.id);
  },
};
// Fresh style object per access (no per-element cache to clean up on
// removal) — the allocation is trivial next to the bridge write it wraps.
Object.defineProperty(ELEMENT_PROTO, 'style', {
  get(this: Element) {
    return createElementStyle(this.id);
  },
});
Object.defineProperties(ELEMENT_PROTO, OFFSET_DESCRIPTORS);

function makeElement(id: number, tag: string): Element {
  const el = Object.create(ELEMENT_PROTO) as { id: number; tag: string };
  el.id = id;
  el.tag = tag;
  return el as Element;
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
  // for-in, not Object.entries: the renderer calls this once per prop
  // patch, and the entries array plus a pair array per key was allocation
  // for a loop that almost always runs exactly once
  for (const key in props) {
    const value = props[key];
    if (typeof value === 'function' && key.startsWith(EVENT_PREFIX)) {
      const type = EventType[key];
      if (type !== undefined) {
        const registryKey = handlerKey(el.id, type);
        const had = eventHandlers.has(registryKey) || domListeners.has(registryKey);
        eventHandlers.set(registryKey, value as (payload?: EventPayload) => void);
        noteEventType(el.id, type);
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
  devtoolsSlots.recordProps(el.id, clean);
  scheduleFlush();
}

const constPropsJson = new WeakMap<object, Uint8Array>();

/** setProps for a props object that never changes — a module-level
 * constant such as the renderer's v-if anchor style. Its JSON is built once
 * per object and reused for every node: a page has one anchor per falsy
 * v-if, and serializing the same `{style: {display: 'none'}}` for each was
 * 20 µs apiece (specs/118). The frame bytes are exactly what setProps
 * writes for the same object.
 *
 * Contract: plain data only — no `on*` handlers (they need the registry
 * path above) — and the object must not be mutated after its first use,
 * or later nodes get the stale JSON. Freeze it at the definition site. */
export function setConstProps(el: Element, props: Readonly<Record<string, unknown>>): void {
  // cached as encoded bytes, not the JSON string: writing even an ASCII
  // string walks it char by char, a byte copy does not
  let json = constPropsJson.get(props);
  if (json === undefined) {
    json = utf8Encode(JSON.stringify(props));
    constPropsJson.set(props, json);
  }
  for (const key in props) recordField(el.id, key, props[key]);
  getWriter().setPropsEncoded(el.id, json);
  devtoolsSlots.recordProps(el.id, props as Record<string, unknown>);
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
  noteEventType(el.id, EventType[prop]);
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
  // STRUCTURE change (spec 093): the relay's low-frequency poll watches this
  // counter and pushes DOM.documentUpdated when it moves. Pure prop/text
  // writes must NOT bump it (092 R14: a per-frame poll spins the Styles
  // sidebar on a busy app).
  devtoolsStructuralVersion.value++;
  scheduleFlush();
}

export function remove(el: Element): void {
  getWriter().remove(el.id);
  forgetHandlers(el.id);
  if (el.tag === INNER_CANVAS_TAG) detachCanvas(el as { __canvas?: unknown });
  devtoolsStructuralVersion.value++;
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
