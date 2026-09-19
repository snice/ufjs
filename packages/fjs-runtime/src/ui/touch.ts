// Touch events, shaped like the DOM's.
//
// The event object a handler receives is the same on both platforms:
//
//   <view @touchmove="onMove" style="touch-action: none">
//   function onMove(e: FjsTouchEvent) { e.touches[0].clientX }
//
// On Flutter it is decoded from the compact wire form below; on the web the
// adapter builds the same object from pointer events (web/components/
// touch.ts), so a mouse drags in a browser exactly like a finger does on a
// phone.
//
// Wire form (Dart render/touch.dart -> here), one JSON object per event:
//
//   {"ts":1234.5,"id":"card-3","o":[8,120],"touches":[[7,120.5,300]],"tt":[...],"changed":[...]}
//
// Each touch is [identifier, x, y] in logical pixels. `tt` (targetTouches)
// and `changed` (changedTouches) are omitted when they are the same list as
// `touches` — the single-finger case, which is every frame of a drag.
// `o` is the LISTENING NODE'S origin, which is what turns those page
// coordinates into the DOM's offsetX/offsetY. A canvas needs it on every
// move, and asking with getBoundingClientRect (a sync host call, see
// ui/geometry.ts) per event would cost a bridge round trip each time;
// hit-testing a drawing against page coordinates is meaningless. Absent from an older host's payload, in
// which case the offsets fall back to the client coordinates.

/** One contact point. Mirrors the DOM `Touch`, minus the radius/force
 * fields Flutter does not report the same way on every platform.
 *
 * fjs has no page scrolling of its own — the window never scrolls, only
 * scroll-views inside it — so client/page/screen coordinates are all the
 * same number, as they are in a full-screen web app. */
export interface FjsTouch {
  /** Stable for the life of one finger/pointer, as in the DOM. */
  readonly identifier: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly screenX: number;
  readonly screenY: number;
  /** Lynx spelling of clientX/clientY. */
  readonly x: number;
  readonly y: number;
  /** Relative to the listening element's top-left corner, as in the DOM.
   * This is the coordinate a `<canvas>` hit-tests against. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export type FjsTouchType =
  | 'touchstart'
  | 'touchmove'
  | 'touchend'
  | 'touchcancel';

/** The node an event is on. fjs resolves no deeper than the listening node,
 * so `target` and `currentTarget` are the same object — there is no DOM
 * event delegation. `id` is the element's `id` prop, '' when it has none. */
export interface FjsEventTarget {
  readonly id: string;
}

/** DOM-shaped touch event. */
export interface FjsTouchEvent {
  readonly type: FjsTouchType;
  /** Milliseconds, same clock the platform stamps its pointer events with. */
  readonly timeStamp: number;
  readonly target: FjsEventTarget;
  readonly currentTarget: FjsEventTarget;
  /** Every pointer currently down, anywhere in the app. */
  readonly touches: readonly FjsTouch[];
  /** The ones that went down on this node. */
  readonly targetTouches: readonly FjsTouch[];
  /** The ones this event is about. */
  readonly changedTouches: readonly FjsTouch[];
  /** Web only — the native default is already suppressed on Flutter.
   * Declare `touch-action` to keep a parent scroller from taking over; that
   * one works on both platforms. */
  preventDefault(): void;
  /** Web only. Flutter delivers an event to every listening node under the
   * finger, deepest first, and that cannot be stopped yet. */
  stopPropagation(): void;
}

const TOUCH_TYPES: Record<number, FjsTouchType> = {
  15: 'touchstart',
  16: 'touchmove',
  17: 'touchend',
  18: 'touchcancel',
};

/** Whether [eventType] is one of the touch events. */
export function isTouchEvent(eventType: number): boolean {
  return eventType >= 15 && eventType <= 18;
}

interface TouchWire {
  ts?: number;
  id?: string;
  /** The listening node's origin in page coordinates. */
  o?: [number, number];
  touches?: [number, number, number][];
  tt?: [number, number, number][];
  changed?: [number, number, number][];
}

function noop(): void {}

function makeTouch(
  t: [number, number, number],
  origin: [number, number],
): FjsTouch {
  const [identifier, x, y] = t;
  return {
    identifier,
    x,
    y,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    screenX: x,
    screenY: y,
    offsetX: x - origin[0],
    offsetY: y - origin[1],
  };
}

function makeList(
  raw: [number, number, number][] | undefined,
  fallback: FjsTouch[],
  origin: [number, number],
): FjsTouch[] {
  return raw === undefined ? fallback : raw.map((t) => makeTouch(t, origin));
}

/** Decodes one native touch payload. Returns null for a malformed one
 * rather than throwing inside the native dispatch. */
export function decodeTouchEvent(
  eventType: number,
  payload: string | null | undefined,
): FjsTouchEvent | null {
  const type = TOUCH_TYPES[eventType];
  if (!type || !payload) return null;
  let wire: TouchWire;
  try {
    wire = JSON.parse(payload) as TouchWire;
  } catch {
    console.warn('[fjs] bad touch payload', payload);
    return null;
  }
  // no origin from an older host: offsets degrade to client coordinates
  const origin: [number, number] = wire.o ?? [0, 0];
  const touches = (wire.touches ?? []).map((t) => makeTouch(t, origin));
  const target: FjsEventTarget = { id: wire.id ?? '' };
  return {
    type,
    timeStamp: wire.ts ?? 0,
    target,
    currentTarget: target,
    touches,
    targetTouches: makeList(wire.tt, touches, origin),
    changedTouches: makeList(wire.changed, touches, origin),
    preventDefault: noop,
    stopPropagation: noop,
  };
}
