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

type Measured = { width: number; height: number; lines: number } | null;

interface FjsShared {
  'fjs/vue'?: {
    styleEngine?: { states?: Map<number, { computed?: Style }>; flushPending?: () => void };
    measureTextBlock?: (style: Style, text: string, maxWidth?: number) => Measured;
  };
}

const sharedVue = () => (globalThis as { __FJS_SHARED?: FjsShared }).__FJS_SHARED?.['fjs/vue'];

/** The element's RESOLVED style from the fjs style engine (camelCase,
 * lengths as numbers). The runtime keeps getComputedStyle out of scope
 * (ui/element.ts), so this reads the engine directly; empty when the app
 * was built without the shared chunk. */
function resolvedStyle(el: unknown): Style {
  const id = (el as { id?: unknown } | null)?.id;
  if (typeof id !== 'number') return {};
  return sharedVue()?.styleEngine?.states?.get(id)?.computed ?? {};
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

/** Values a browser reports without a unit. Everything else numeric is a
 * length the engine keeps in px. */
const UNITLESS = new Set(['fontWeight', 'zIndex', 'opacity', 'flexGrow', 'flexShrink', 'order']);

/** What `Array.prototype.slice.apply(getComputedStyle(el))` enumerates.
 * TextEllipsis copies every listed property onto its measuring div
 * (specs/128), so this is the set that decides how a text lays out. */
const ENUMERATED = [
  'width',
  'box-sizing',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'line-height',
  'letter-spacing',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'white-space',
];

const px = (value: unknown): number => {
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
};

function getComputedStyle(el: unknown): Record<string, string> & {
  getPropertyValue(name: string): string;
} {
  // A browser recalculates style before answering. The engine batches per
  // microtask, so an element created in this tick — TextEllipsis reads its
  // root in onMounted — had no computed style yet: line-height came back
  // "normal" and every cut measured against a 0px line (specs/128).
  sharedVue()?.styleEngine?.flushPending?.();
  const style = resolvedStyle(el);
  const fontSize = () => px(style.fontSize) || 14;
  const read = (key: string): string => {
    // computed width is the USED width — the layout, not the declaration;
    // for content-box that excludes the padding
    if (key === 'width') {
      const rect = (el as { getBoundingClientRect?: () => { width: number } } | null)?.getBoundingClientRect?.();
      if (rect && rect.width === 0) remeasureWhenLaidOut(el);
      if (rect) {
        const inner = style.boxSizing === 'border-box' ? rect.width : rect.width - px(style.paddingLeft) - px(style.paddingRight);
        return `${Math.max(0, inner)}px`;
      }
    }
    // a browser resolves a unitless line-height to px in computed style;
    // vant multiplies it by the row count
    if (key === 'lineHeight') {
      const v = style.lineHeight;
      // the engine keeps a unitless value as written — a number, or the
      // string "1.6" when it came through a var()
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*[\d.]+\s*$/.test(v) ? parseFloat(v) : NaN;
      if (Number.isFinite(n)) return `${n * fontSize()}px`;
      if (v === undefined) return 'normal';
      return String(v);
    }
    if (key === 'fontSize' && style.fontSize === undefined) return '14px';
    let v = style[key];
    if (v === undefined && (key === 'overflowX' || key === 'overflowY')) v = style.overflow;
    if (v === undefined) return INITIAL[key] ?? (key === 'overflowX' || key === 'overflowY' ? 'visible' : '');
    if (typeof v === 'number') return UNITLESS.has(key) ? String(v) : v === 0 ? '0px' : `${v}px`;
    const s = String(v);
    return key === 'transform' ? toMatrix(s) : s;
  };
  return new Proxy({} as Record<string, string> & { getPropertyValue(name: string): string }, {
    get(_, prop) {
      if (prop === 'getPropertyValue') return (name: string) => read(kebabToCamel(name));
      if (prop === 'length') return ENUMERATED.length;
      if (typeof prop !== 'string') return undefined;
      if (/^\d+$/.test(prop)) return ENUMERATED[Number(prop)];
      return read(prop);
    },
    // slice() asks HasProperty before each Get; without this every index
    // was a hole, the name list came back all null, and vant's
    // setProperty(null, …) threw inside onMounted where Vue swallowed it
    has(_, prop) {
      if (typeof prop !== 'string') return false;
      return /^\d+$/.test(prop) ? Number(prop) < ENUMERATED.length : prop === 'length' || prop === 'getPropertyValue';
    },
  });
}

/** `<` `>` `&` as the DOM's innerHTML getter serialises text. */
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** innerHTML written as markup → the text it shows. */
const htmlToText = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/** A detached `<div>` that can only be measured — what vant's TextEllipsis
 * builds to binary-search its cut: styles copied off the real element, text
 * written through innerText / innerHTML, `offsetHeight` read back after
 * each write (specs/128). It never enters the page; the host lays the text
 * out on its own (fjs.ui.measureText) with the font and width copied here. */
class MeasureBox {
  readonly style: Record<string, string> & { setProperty(name: string, value: string): void };
  private text = '';
  constructor() {
    const style = {} as Record<string, string> & { setProperty(name: string, value: string): void };
    Object.defineProperty(style, 'setProperty', {
      value: (name: string, value: string) => {
        if (typeof name === 'string') style[kebabToCamel(name)] = value;
      },
    });
    this.style = style;
  }
  get innerText(): string {
    return this.text;
  }
  set innerText(value: string) {
    this.text = String(value ?? '');
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(value: string) {
    this.text = String(value ?? '');
  }
  get innerHTML(): string {
    return escapeHtml(this.text);
  }
  set innerHTML(value: string) {
    this.text = htmlToText(String(value ?? ''));
  }
  private measure(): Measured {
    const s = this.style;
    const pad = (k: string) => px(s[k]);
    const width = px(s.width) - (s.boxSizing === 'border-box' ? pad('paddingLeft') + pad('paddingRight') : 0);
    const fontSize = px(s.fontSize) || 14;
    const textStyle: Style = { fontSize };
    if (s.lineHeight && s.lineHeight !== 'normal') textStyle.lineHeight = s.lineHeight.endsWith('px') ? s.lineHeight : px(s.lineHeight);
    if (s.fontWeight) textStyle.fontWeight = s.fontWeight;
    if (s.fontStyle) textStyle.fontStyle = s.fontStyle;
    if (s.fontFamily) textStyle.fontFamily = s.fontFamily;
    if (s.letterSpacing && s.letterSpacing !== 'normal') textStyle.letterSpacing = px(s.letterSpacing);
    // no width yet (see remeasureWhenLaidOut): unmeasurable, which reads
    // as 0 — "everything fits", the text shows uncut until the re-measure
    if (!(width > 0)) return null;
    return sharedVue()?.measureTextBlock?.(textStyle, this.text, width) ?? null;
  }
  get offsetHeight(): number {
    const m = this.measure();
    return m ? m.height + px(this.style.paddingTop) + px(this.style.paddingBottom) : 0;
  }
  get offsetWidth(): number {
    const m = this.measure();
    return m ? m.width + px(this.style.paddingLeft) + px(this.style.paddingRight) : 0;
  }
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

/** `resize` listeners on window — vant's useWindowSize is the only one,
 * and its windowWidth ref is what TextEllipsis (and Swipe, Sticky…) watch
 * to measure again. */
const resizeListeners = new Set<() => void>();

/** A page mounts while its route is still pushing, and the host lays
 * nothing out then (geometry.dart runWithoutGeometryReflow): what vant
 * measures in onMounted has width 0. A browser would lay out first. So
 * when a width read comes back 0, wait frame by frame for the element to
 * get one, then fire `resize` — vant measures again. The window has no
 * size of its own here (innerWidth stays ~0, what vant always saw); it is
 * nudged by a hair each time only so useWindowSize's ref actually changes
 * and the watchers run. */
const awaitingLayout = new Set<unknown>();
function remeasureWhenLaidOut(el: unknown): void {
  if (awaitingLayout.has(el)) return;
  awaitingLayout.add(el);
  let frames = 0;
  const check = () => {
    const rect = (el as { getBoundingClientRect?: () => { width: number } }).getBoundingClientRect?.();
    if (rect && rect.width > 0) {
      awaitingLayout.delete(el);
      const win = (globalThis as { window?: { innerWidth: number } }).window;
      if (win) win.innerWidth = win.innerWidth === 0 ? 0.001 : 0;
      for (const listener of resizeListeners) listener();
    } else if (++frames < 120) {
      requestAnimationFrame(check);
    } else {
      awaitingLayout.delete(el);
    }
  };
  requestAnimationFrame(check);
}

/** Pages scroll inside fjs scroll views, never the document: the root
 * element only answers the reads (scrollTop 0) and absorbs the writes
 * (Popup's lock-scroll class, Toast's unclickable class). */
const rootElement = () => ({
  style: {} as Record<string, string>,
  classList: classList(),
  scrollTop: 0,
  scrollLeft: 0,
  // TextEllipsis mounts its measuring div here for the length of one
  // measurement; a MeasureBox needs no parent to be measured
  appendChild: <T>(child: T): T => child,
  removeChild: <T>(child: T): T => child,
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
    // only what a library builds to measure; anything else has no DOM here
    createElement: () => new MeasureBox(),
  };
  const nav = { userAgent: 'fjs' }; // not iOS/Android: no WebView scroll workarounds
  g.window = {
    requestAnimationFrame: (cb: FrameRequestCallback) => requestAnimationFrame(cb),
    cancelAnimationFrame: (id: number) => cancelAnimationFrame(id),
    setTimeout,
    clearTimeout,
    getComputedStyle,
    addEventListener: (type: string, listener: () => void) => {
      if ((type === 'resize' || type === 'orientationchange') && typeof listener === 'function') resizeListeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'resize' || type === 'orientationchange') resizeListeners.delete(listener);
    },
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
