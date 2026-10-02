// The per-node canvas surface: what the element layer attaches to a
// `canvas` element, and the drain that puts its commands into the UI frame.
//
// Drawing rides the SAME frame as the node ops. That is not a detail: a page
// that resizes a box and redraws its canvas in one tick must have both reach
// the host together, or the host paints one against the other's geometry for
// a frame. So this registers a pre-flush hook instead of calling uiOps
// itself.
//
// Context types beyond '2d' (WebGL, via @ufjs/webgl) are MODULES: they bring
// their own command writers and attach them here through attachOpWriter —
// this file only knows "extra op streams exist", not which one is which.
import { getWriter, registerPreFlush, scheduleFlush } from '../host';
import { nodeHandler, setCanvasHooks } from '../ui/element';
import { registerContextType, resolveContext } from './context-registry';
import { FjsCanvasRenderingContext2D } from './context-2d';
import { CanvasWriter } from './display-list';
import {
  canvasToDataURL,
  forgetCanvasSize,
  listenCanvasSize,
  setCanvasEventRegistrar,
} from './image';
import type { CanvasSurface } from './context-2d';

/** `@resize`'s event number; see EventType in ui/element.ts. */
const CANVAS_RESIZE_EVENT = 30;

/** What a context module attaches per surface: its own command buffer plus
 * how its chunks become ops. `write` picks the op (e.g. op 11 for webgl);
 * the surface never interprets the bytes. */
export interface FjsCanvasOpWriter {
  takeChunks(): Uint8Array[];
  write(nodeId: number, chunk: Uint8Array): void;
}

/** Canvases with commands waiting for the next frame. */
const dirty = new Set<FjsCanvasSurface>();
let drainInstalled = false;

class FjsCanvasSurface implements CanvasSurface {
  readonly writer: CanvasWriter;
  /** Contexts by type, so getContext returns the same object every time. */
  private readonly contexts = new Map<string, unknown>();
  private w = 0;
  private h = 0;
  /** Device ratio the host renders this canvas's bitmap at. 1 until the
   * host's size event says otherwise; context modules that own a real
   * backing store multiply their bitmap size by it (the 2d context ignores
   * it — logical pixels there). */
  private dpr = 1;
  /** Attached context-module writers. Empty for a page that never leaves
   * the 2d context — the common case pays nothing. */
  private readonly opWriters: FjsCanvasOpWriter[] = [];

  constructor(
    readonly nodeId: number,
    private readonly element: unknown,
  ) {
    this.writer = new CanvasWriter(() => {
      dirty.add(this);
      scheduleFlush();
    });
    listenCanvasSize(nodeId, (width, height, devicePixelRatio) => {
      this.w = width;
      this.h = height;
      if (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) {
        this.dpr = devicePixelRatio;
      }
      // Tell the page. A canvas has no size until the host has laid it out,
      // so a page that draws relative to its box — anything responsive, and
      // every charting library — cannot do its first draw in onMounted the
      // way it can in a browser. `@resize` is that first draw's trigger, and
      // the web adapter emits the same event with the same payload.
      nodeHandler(nodeId, CANVAS_RESIZE_EVENT)?.(
        `{"width":${width},"height":${height}}`,
      );
    });
  }

  width(): number {
    return this.w;
  }

  height(): number {
    return this.h;
  }

  devicePixelRatio(): number {
    return this.dpr;
  }

  /** Context-module extension point (see FjsCanvasOpWriter). */
  attachOpWriter(w: FjsCanvasOpWriter): void {
    this.opWriters.push(w);
  }

  /** What a module's writer calls when it has new bytes: same dirty set the
   * 2d writer feeds, one flush per tick. */
  markDirty(): void {
    dirty.add(this);
    scheduleFlush();
  }

  getContext(type: string, attributes?: unknown): unknown {
    return resolveContext(this.contexts, type, {
      canvas: this.element,
      surface: this,
    }, attributes);
  }

  flush(): void {
    for (const chunk of this.writer.takeChunks()) {
      getWriter().canvas(this.nodeId, chunk);
    }
    for (const w of this.opWriters) {
      for (const chunk of w.takeChunks()) {
        w.write(this.nodeId, chunk);
      }
    }
  }

  dispose(): void {
    dirty.delete(this);
    forgetCanvasSize(this.nodeId);
  }
}

export type { FjsCanvasSurface };

/** Makes `el` a canvas: adds the DOM-shaped members a page (or a charting
 * library) reaches for. Called by the element layer for `canvas` tags only,
 * so no other node pays for any of this. */
export function attachCanvas(
  el: Record<string, unknown> & { id: number },
  registerSystemHandler: (
    type: number,
    handler: (id: number, payload?: string) => void,
  ) => void,
): void {
  setCanvasEventRegistrar(registerSystemHandler);
  installDrain();
  const surface = new FjsCanvasSurface(el.id, el);
  el.__canvas = surface;
  el.getContext = (type: string, attributes?: unknown) =>
    surface.getContext(type, attributes);
  el.toDataURL = (type?: string, quality?: number) =>
    canvasToDataURL(el.id, type, quality);
  // width/height are the laid-out size in LOGICAL pixels, reported by the
  // host. Unlike the DOM they are not the bitmap's size and are not
  // writable: the host owns device pixels (it rasterizes the whole scene at
  // the device ratio), so a page never has to scale for dpr — see
  // docs/canvas-compat.md.
  Object.defineProperty(el, 'width', {
    get: () => surface.width(),
    configurable: true,
  });
  Object.defineProperty(el, 'height', {
    get: () => surface.height(),
    configurable: true,
  });
  // Always 1 here: Flutter rasterizes the whole scene at the device ratio,
  // so a canvas draws in logical pixels and nothing scales them. The web
  // surface reports the browser's real ratio, because there the backing
  // store IS scaled and a library that resets the context transform has to
  // put that scale back itself (see docs/canvas-compat.md §11).
  Object.defineProperty(el, 'devicePixelRatio', {
    get: () => 1,
    configurable: true,
  });
}

/** Drops a canvas's bookkeeping when its node goes away. */
export function detachCanvas(el: { __canvas?: unknown }): void {
  const surface = el.__canvas;
  if (surface instanceof FjsCanvasSurface) surface.dispose();
}

function installDrain(): void {
  if (drainInstalled) return;
  drainInstalled = true;
  registerPreFlush(() => {
    if (dirty.size === 0) return;
    const pending = [...dirty];
    dirty.clear();
    for (const surface of pending) surface.flush();
  });
}

// specs/185: the element layer reaches this file only through its hook —
// whoever imports it (the canvas component's Flutter registration) brings
// the 2d implementation along
setCanvasHooks({ attach: attachCanvas, detach: detachCanvas });
registerContextType('2d', (target) => {
  if (target.domCanvas) return target.domCanvas.getContext('2d');
  if (!target.surface) return null;
  return new FjsCanvasRenderingContext2D(target.surface, target.canvas);
});
