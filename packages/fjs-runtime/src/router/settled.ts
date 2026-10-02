// "Has this page's transition finished?" — the web half of onPageSettled.
//
// Split out of router/web.ts so the canvas component can read it without
// pulling vue-router in: on Flutter the same job is done by the host
// (widgets/canvas.dart watches the route's animation), and this file is that
// side's counterpart. router/web.ts owns the public API; app/web.ts is the
// only writer.
//
// A path with NO entry counts as settled. That is not a shortcut: an entry
// exists only between "a navigation to this path started" and "its enter
// transition finished", so a page already sitting on screen has none and
// asking about it must answer immediately. It also keeps the map from
// growing with history.

interface PageSettle {
  waiting: (() => void)[];
}

const pending = new Map<string, PageSettle>();

/** A navigation to `fullPath` started an enter transition. */
export function beginPageTransition(fullPath: string): void {
  if (!pending.has(fullPath)) pending.set(fullPath, { waiting: [] });
}

/** That transition is over (or there never was one): release the waiters. */
export function markPageSettled(fullPath: string): void {
  const entry = pending.get(fullPath);
  if (!entry) return;
  pending.delete(fullPath);
  for (const cb of entry.waiting) queueMicrotask(cb);
}

/** The page left before its transition finished — drop the callbacks rather
 * than firing them into an unmounted page. */
export function cancelPageTransition(fullPath: string): void {
  pending.delete(fullPath);
}

/** Runs `cb` when `fullPath`'s transition is over, or on the next microtask
 * if it already is. */
export function whenSettled(fullPath: string | undefined, cb: () => void): void {
  const entry = fullPath !== undefined ? pending.get(fullPath) : undefined;
  if (!entry) {
    queueMicrotask(cb);
    return;
  }
  entry.waiting.push(cb);
}

/** Runs `cb` when no page transition is in flight.
 *
 * For callers that live INSIDE the arriving page and do not know its path —
 * `<canvas>`, whose first `@resize` must not land on the animating frames.
 * If a transition is running it is this page's, because a page only mounts
 * into the navigation that brought it. */
export function whenNoTransition(cb: () => void): void {
  if (pending.size === 0) {
    queueMicrotask(cb);
    return;
  }
  // the newest pending path is the arriving page
  let last: PageSettle | undefined;
  for (const entry of pending.values()) last = entry;
  last?.waiting.push(cb);
}

/** Which page is asking — the web router installed in this bundle answers
 * (specs/173): vue-router's useRoute for a VDOM page, the vapor page's
 * provided route under enableVapor. Injected so <defer> (and anything else
 * shared by both web apps) never imports either router module. */
let pagePathOf: () => string | undefined = () => undefined;

export function setPagePathResolver(fn: () => string | undefined): void {
  pagePathOf = fn;
}

/** Runs `cb` once this page's route transition has finished.
 *
 * Expensive first-paint work costs frames, and during a navigation those are
 * the frames the page transition is animating. Always asynchronous, even
 * when the page has already settled, so a caller in setup() can finish its
 * own initialisation first. Fires at most once.
 *
 * `<canvas>` already does this for its first `@resize`, so a charting page
 * usually needs nothing — this is for everything else. */
export function onPageSettled(cb: () => void): void {
  whenSettled(pagePathOf(), cb);
}
