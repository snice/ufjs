// LeaferJS on the fjs <canvas>, all three ends (spec 059).
//
// Why the *miniapp* build of Leafer on every end, not @leafer-ui/web on web:
// the miniapp platform assumes a `wx`-shaped host object and a 2d canvas
// node, and nothing else — no DOM, no window listeners. That is exactly what
// the fjs canvas contract gives on the Flutter host (docs/canvas-compat.md),
// and on the mini program it is the real thing. One package, one code path.
//
//   mini program  the package's own `useCanvas('miniapp', wx)` runs on import
//                 with the real wx (offscreen canvases, window info all real)
//   Flutter / web no wx: we hand `useCanvas` a host whose offscreen canvas is
//                 a no-op stub. The Flutter host has no OffscreenCanvas at all,
//                 and web takes the same stub so both ends run the same code.
//
// What the stub costs, i.e. what pages on this adapter must not use: every
// Leafer path that renders through a second canvas or measures on
// Platform.canvas — Text (measureText), images/patterns, group opacity and
// blend modes (`__single` → getSameCanvas), masks/erasers, shadows, and the
// interaction module's hit canvas (isPointInPath is ❌ on the Flutter host
// anyway). Plain vector shapes with fills/strokes and transforms draw
// straight onto the view context and are unaffected.
import { Leafer, Platform, RectHelper, useCanvas } from '@leafer-ui/miniapp';
import type { FjsCanvasApi } from 'fjs';

/** Swallows every call. A class (not a bare Proxy target) so that Leafer's
 * `canvasPatch(context.__proto__)` finds `roundRect` on the prototype —
 * otherwise it would install roundRect on Object.prototype. */
class StubContext2D {
  roundRect(): void {}
}

function stubCanvas(width: number, height: number): object {
  const noop = () => undefined;
  const context = new Proxy(new StubContext2D() as unknown as Record<PropertyKey, unknown>, {
    get: (target, key) => (key in target ? target[key] : noop),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { width, height, getContext: () => context };
}

let hasWx = false;
try {
  // Feature-gate, not just presence: a ported mini-GAME also defines a
  // `wx` global (specs/214's plane-war shim), but without the offscreen
  // canvases the miniapp runtime provides. Treating that shim as "the real
  // wx" would send Leafer down its miniapp path and break this page.
  const wxLike = globalThis as { wx?: { createOffscreenCanvas?: unknown } };
  hasWx = typeof wxLike.wx !== 'undefined' && !!wxLike.wx &&
    typeof wxLike.wx.createOffscreenCanvas === 'function';
} catch {
  hasWx = false;
}

if (!hasWx) {
  useCanvas('miniapp', {
    createOffscreenCanvas: (opts: { width: number; height: number }) => stubCanvas(opts.width, opts.height),
    // only feeds Platform.devicePixelRatio; mountLeafer always passes the
    // canvas's real backing ratio, so this default is never what draws
    getWindowInfo: () => ({ pixelRatio: 1 }),
    onWindowResize: () => {},
    offWindowResize: () => {},
  });
  // the stub has no conic gradient; do not let Leafer think it does
  Platform.conicGradientSupport = false;
}

// Leafer schedules frames on `Platform.getCanvas().view.requestAnimationFrame`
// and falls back to setTimeout(16) — neither our view object nor a wx
// offscreen canvas has that method.
//
// Read off globalThis, not as a bare name: the mini-program module wrapper
// declares its own (undefined) `requestAnimationFrame`. The compiler imports
// the wx runtime's one into any module that names it (and spec 060 taught it
// to read code rather than comments, which is what broke this line first),
// but going through the global keeps this module independent of that step —
// the wx runtime installs it (wx/raf.ts) and the other two ends have a real
// one.
const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => unknown })
  .requestAnimationFrame;
Platform.requestRender = (render: () => void) => {
  if (raf) raf(() => render());
  else setTimeout(render, 16);
};

/**
 * A Leafer drawing into `cv`'s 2d context, sized to the canvas's current
 * logical size. Call from `@resize` (the size is 0 before it). Leafer cannot
 * resize one of these in place without a scratch canvas — on a size change,
 * destroy it and mount again.
 */
export function mountLeafer(cv: FjsCanvasApi, width: number, height: number): Leafer {
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('canvas has no 2d context');
  // A plain object, not the fjs canvas: LeaferCanvas writes the bitmap size
  // onto view.width/height, and the fjs canvas's are read-only (the same
  // reason the ECharts adapter wraps it).
  const view = { width, height, getContext: () => ctx };

  // roundRect: native on web and wx, ❌ on the Flutter host's context. Leafer
  // binds context methods once, at mount — a context without roundRect
  // leaves LeaferCanvas.roundRect as its empty stub, and every Rect with a
  // cornerRadius silently draws nothing. Give this canvas's context one
  // (Leafer's own arcTo-based helper; arcTo is ✅ on the host) before that
  // bind. Leafer then also polyfills the context *class* prototype
  // (canvasPatch) — undo that, so other pages still see the host as it is.
  const target = ctx as unknown as Record<string, unknown>;
  const proto = Object.getPrototypeOf(ctx) as Record<string, unknown>;
  const protoHad = Object.prototype.hasOwnProperty.call(proto, 'roundRect');
  // The host context does *have* a roundRect — the warn-once placeholder
  // every ❌ API gets — so a typeof check is not enough: only a browser
  // context or a wx one is trusted to have a real one.
  const browserCtx =
    typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D;
  const nativeRoundRect = (browserCtx || hasWx) && typeof target.roundRect === 'function';
  if (!nativeRoundRect) {
    Object.defineProperty(ctx, 'roundRect', {
      value(x: number, y: number, w: number, h: number, radius?: number | number[]) {
        RectHelper.drawRoundRect(ctx as never, x, y, w, h, radius ?? 0);
      },
      configurable: true,
      writable: true,
    });
  }
  const leafer = new Leafer({
    view: view as never,
    width,
    height,
    // Leafer sets absolute transforms (world × pixelRatio), wiping the dpr
    // scale the host preset on web and wx: it has to know the backing ratio.
    // 1 on the Flutter host, which rasterises the whole scene at device dpr.
    pixelRatio: cv.devicePixelRatio || 1,
    // Leafer's default partial redraw clips + clears dirty rects. On the
    // Flutter host only a full clearRect drops the retained display list, so
    // dirty-rect frames pile up (canvas-compat §10). Full redraws are cheap
    // for a board of ~70 shapes.
    usePartRender: false,
  });
  // (on wx the context is a plain forwarding object, so this can even be
  // Object.prototype if a base library lacks roundRect)
  if (!protoHad) delete proto.roundRect;
  return leafer;
}
