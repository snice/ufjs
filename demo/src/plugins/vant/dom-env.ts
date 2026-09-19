// The browser globals vant reads, for the fjs app side (specs/073).
//
// vant decides "am I in a browser" ONCE, at module evaluation:
// `inBrowser = typeof window !== 'undefined'` (vant/es/utils/basic.mjs and
// @vant/use each keep a copy). The fjs app host has no `window`, so every
// guarded path goes dead — most visibly `raf()`/`doubleRaf()`, which return
// -1 WITHOUT calling back: NoticeBar's marquee never starts and Circle's
// rate animation never ticks.
//
// fjs itself deliberately does not fake a global window (specs/070: it
// flips inBrowser for every library in the app). This demo opts in for
// vant only: the object below carries just the surface vant touches once
// inBrowser is true, and it is installed before vant is evaluated —
// vant.ts imports this module FIRST, and ESM evaluates imports in order.
// It lives in a subdirectory because every file directly in src/plugins
// is registered as a plugin.
//
// On the web build `window` exists and nothing here runs.

type Style = Record<string, unknown>;

interface FjsShared {
  'fjs/vue'?: {
    styleEngine?: { states?: Map<number, { computed?: Style }> };
  };
}

/** The element's RESOLVED style from the fjs style engine (camelCase,
 * lengths as numbers). The runtime keeps getComputedStyle out of scope
 * (ui/element.ts), so this reads the engine directly; empty when the app
 * was built without the shared chunk. */
function resolvedStyle(el: unknown): Style {
  const id = (el as { id?: unknown } | null)?.id;
  if (typeof id !== 'number') return {};
  const shared = (globalThis as { __FJS_SHARED?: FjsShared }).__FJS_SHARED;
  return shared?.['fjs/vue']?.styleEngine?.states?.get(id)?.computed ?? {};
}

const kebabToCamel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** CSS transform → the `matrix(a, b, c, d, tx, ty)` a browser's computed
 * style reports; vant's Picker reads ty back out of it mid-drag. Only the
 * translations vant writes are understood; anything else stays as written. */
function toMatrix(transform: string): string {
  let tx = 0;
  let ty = 0;
  const num = (s: string | undefined) => parseFloat(s ?? '') || 0;
  const re = /translate(3d|X|Y)?\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = re.exec(transform))) {
    matched = true;
    const args = m[2].split(',').map((s) => s.trim());
    if (m[1] === 'X') tx += num(args[0]);
    else if (m[1] === 'Y') ty += num(args[0]);
    else {
      tx += num(args[0]);
      ty += num(args[1]);
    }
  }
  return matched ? `matrix(1, 0, 0, 1, ${tx}, ${ty})` : transform;
}

/** DOM defaults for the properties vant compares against. */
const INITIAL: Record<string, string> = {
  display: 'block',
  position: 'static',
  transform: 'none',
  perspective: 'none',
  willChange: 'auto',
  overflow: 'visible',
};

function getComputedStyle(el: unknown): Record<string, string> & {
  getPropertyValue(name: string): string;
} {
  const style = resolvedStyle(el);
  const read = (key: string): string => {
    let v = style[key];
    if (v === undefined && (key === 'overflowX' || key === 'overflowY')) v = style.overflow;
    if (v === undefined) return INITIAL[key] ?? (key === 'overflowX' || key === 'overflowY' ? 'visible' : '');
    if (typeof v === 'number') return v === 0 ? '0px' : `${v}px`;
    const s = String(v);
    return key === 'transform' ? toMatrix(s) : s;
  };
  return new Proxy({} as Record<string, string> & { getPropertyValue(name: string): string }, {
    get(_, prop) {
      if (prop === 'getPropertyValue') return (name: string) => read(kebabToCamel(name));
      // Array.prototype.slice.apply(style) (TextEllipsis) — no index list
      if (prop === 'length') return 0;
      return typeof prop === 'string' ? read(prop) : undefined;
    },
  });
}

const noop = () => {};
const classList = () => {
  const set = new Set<string>();
  return {
    add: (...names: string[]) => names.forEach((n) => set.add(n)),
    remove: (...names: string[]) => names.forEach((n) => set.delete(n)),
    contains: (name: string) => set.has(name),
    toggle: (name: string) => (set.has(name) ? (set.delete(name), false) : (set.add(name), true)),
  };
};

/** Pages scroll inside fjs scroll views, never the document: the root
 * element only answers the reads (scrollTop 0) and absorbs the writes
 * (Popup's lock-scroll class, Toast's unclickable class). */
const rootElement = () => ({
  style: {} as Record<string, string>,
  classList: classList(),
  scrollTop: 0,
  scrollLeft: 0,
});

/** The first-sight half of IntersectionObserver. A page's tree is built
 * BEFORE its route shows it, so what vant measures on mount reads 0 (the
 * tabs underline sat at translateX(0)); in a browser the observer's first
 * callback comes after layout, and vant re-measures on it
 * (useVisibilityChange → Tabs setLine). This one waits, frame by frame, for
 * the target to get a laid-out size, then reports it visible once. Later
 * visibility changes are not tracked. */
type IOCallback = (entries: { target: unknown; isIntersecting: boolean; intersectionRatio: number }[]) => void;
class FirstSightObserver {
  private readonly pending = new Set<unknown>();
  constructor(private readonly callback: IOCallback) {}
  observe(target: unknown): void {
    this.pending.add(target);
    let frames = 0;
    const check = () => {
      if (!this.pending.has(target)) return;
      const rect = (target as { getBoundingClientRect?: () => { width: number; height: number } })
        .getBoundingClientRect?.();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        this.pending.delete(target);
        this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }]);
      } else if (++frames < 120) {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  }
  unobserve(target: unknown): void {
    this.pending.delete(target);
  }
  disconnect(): void {
    this.pending.clear();
  }
}

/** `document.addEventListener` for the pointer-down family, fed by the app's
 * document-level pointer stream (fjs/vue onGlobalPointerDown, specs/073).
 * vant's click-away — the number keyboard closing on a touch outside it —
 * listens on `document` and tests `el.contains(event.target)`; with a no-op
 * here the keyboard never closed. Other document events stay no-ops. */
const POINTER_DOWN = new Set(['touchstart', 'mousedown', 'pointerdown', 'click']);
type GlobalDown = { target: unknown; clientX: number; clientY: number };
type DocListener = (event: unknown) => void;
const docSubscriptions = new Map<DocListener, Map<string, () => void>>();
function onDocumentPointer(listener: DocListener, type: string): (() => void) | null {
  const vue = (globalThis as { __FJS_SHARED?: Record<string, { onGlobalPointerDown?: (fn: (e: GlobalDown) => void) => () => void }> })
    .__FJS_SHARED?.['fjs/vue'];
  const subscribe = vue?.onGlobalPointerDown;
  if (!subscribe) return null;
  return subscribe(({ target, clientX, clientY }) => {
    const point = { clientX, clientY, pageX: clientX, pageY: clientY };
    listener({
      type,
      target,
      ...point,
      touches: [point],
      changedTouches: [point],
      preventDefault: noop,
      stopPropagation: noop,
    });
  });
}
function addDocumentListener(type: string, listener: DocListener): void {
  if (!POINTER_DOWN.has(type) || typeof listener !== 'function') return;
  let byType = docSubscriptions.get(listener);
  if (byType?.has(type)) return;
  const off = onDocumentPointer(listener, type);
  if (!off) return;
  if (!byType) docSubscriptions.set(listener, (byType = new Map()));
  byType.set(type, off);
}
function removeDocumentListener(type: string, listener: DocListener): void {
  const byType = docSubscriptions.get(listener);
  byType?.get(type)?.();
  byType?.delete(type);
  if (byType && byType.size === 0) docSubscriptions.delete(listener);
}

if (typeof window === 'undefined') {
  const g = globalThis as Record<string, unknown>;
  // useVisibilityChange checks window.IntersectionObserver, then news the
  // bare global. No IntersectionObserverEntry: vant's lazyload keeps its
  // scroll-listener fallback rather than trusting this partial observer.
  if (typeof g.IntersectionObserver === 'undefined') g.IntersectionObserver = FirstSightObserver;
  const doc = {
    body: rootElement(),
    documentElement: rootElement(),
    hidden: false,
    visibilityState: 'visible',
    addEventListener: addDocumentListener,
    removeEventListener: removeDocumentListener,
  };
  const nav = { userAgent: 'fjs' }; // not iOS/Android: no WebView scroll workarounds
  g.window = {
    requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
    cancelAnimationFrame: (id: number) => cancelAnimationFrame(id),
    setTimeout,
    clearTimeout,
    getComputedStyle,
    addEventListener: noop,
    removeEventListener: noop,
    scrollTo: noop,
    // useWindowSize: the host gives no viewport size to JS here; 0 is what
    // vant saw before (its non-browser branch)
    innerWidth: 0,
    innerHeight: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    devicePixelRatio: 1,
    IntersectionObserver: g.IntersectionObserver,
    document: doc,
    navigator: nav,
  };
  if (typeof g.document === 'undefined') g.document = doc;
  if (typeof g.navigator === 'undefined') g.navigator = nav;
}

export {};
