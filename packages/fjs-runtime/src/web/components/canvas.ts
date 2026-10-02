// `inner-canvas` on the web: the drawing surface a real <canvas> provides,
// with two deliberate differences from what a plain <canvas> would give a
// page. The box around it (and its overlay slot) is components/canvas.ts,
// mounted as `canvas` on both platforms.
//
//   1. THE BITMAP FOLLOWS THE BOX. A DOM canvas has a bitmap size (`width`/
//      `height` attributes) independent of its CSS size, and a page that
//      wants crisp output on a retina screen has to set the former to the
//      latter times devicePixelRatio and then scale the context. On Flutter
//      there is no backing store to size — the scene is rasterized at the
//      device ratio — so a page written for fjs never does that arithmetic.
//      To keep one source running on both, this component does it here:
//      backing store = layout size x dpr, with a matching setTransform, so
//      the page's coordinates are logical pixels on both platforms.
//   2. getContext GOES THROUGH THE REGISTRY. '2d' is handed the browser's
//      own context, but 'webgl' returns null here exactly as it does on
//      Flutter. The browser HAS WebGL; returning it would let a page work in
//      dev and paint nothing in the app, which is the failure constitution I
//      is about.
//
// Resizing clears the picture, as it does in any browser (setting the
// backing store size resets the bitmap). The Flutter side drops its retained
// display list on a resize for the same reason — see widgets/canvas.dart.
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';

import { resolveContext } from '../../canvas/context-registry';
import { whenNoTransition } from '../../router/settled';
import { hostAttrs } from '../style';
import { mergeBindings, pressBindings } from './gestures';

export const FjsCanvasSurface = defineComponent({
  name: 'FjsCanvasSurface',
  inheritAttrs: false,
  emits: ['tap', 'longPress', 'resize'],
  setup(_props, { attrs, emit, expose }) {
    const press = pressBindings(emit);
    const el = ref<HTMLCanvasElement | null>(null);
    const contexts = new Map<string, unknown>();
    let observer: ResizeObserver | null = null;
    let logicalWidth = 0;
    let logicalHeight = 0;
    /** Set once the page has asked for a 2d context. Resizing must
     * re-establish the logical-pixel transform on it — but only then:
     * requesting '2d' here unconditionally would FIX this canvas as a 2d
     * canvas (the DOM hands out one context type per element, ever) and a
     * later `getContext('webgl')` would return null forever. */
    let created2d = false;
    /** See the first-report note in [sync]. */
    let firstReportSent = false;
    /** `defer-resize`: opt in to holding the first report until the page's
     * route transition is over. Off by default — waiting costs a transition's
     * worth of blank canvas, which is the wrong trade unless the first paint
     * is genuinely expensive (a chart, a WebGL scene). */
    const deferResize = (): boolean => {
      const raw = (attrs as Record<string, unknown>).deferResize;
      return raw !== undefined && raw !== false && raw !== 'false';
    };

    function sync(): void {
      const canvas = el.value;
      if (!canvas) return;
      // THE BOX OWNS THE SIZE. The page styles <canvas>, and those styles
      // land on the wrapper box; the bare canvas element's own rect is
      // polluted by its bitmap's intrinsic aspect ratio — a 2:1 default
      // bitmap stretches to 2:1 CSS, the measured rect feeds the next
      // bitmap, and the element stabilizes at the wrong height, overflowing
      // the box (nothing clips it). Measuring the box and pinning the
      // element to it is what makes the web surface agree with Flutter,
      // where the styled box size was always the only size there was.
      const box = canvas.parentElement ?? canvas;
      // a page under the one on screen is display:none here; on Flutter it
      // keeps its size. Reporting 0 x 0 would clear the bitmap and hand the
      // page a size it never has there (hello-fjs' clip demo drew an arc of
      // radius -8) — wait for it to be rendered again (specs/181)
      if (box.getClientRects().length === 0) return;
      const rect = box.getBoundingClientRect();
      const dpr = globalThis.devicePixelRatio || 1;
      const width = Math.max(0, Math.round(rect.width));
      const height = Math.max(0, Math.round(rect.height));
      if (width === logicalWidth && height === logicalHeight) return;
      logicalWidth = width;
      logicalHeight = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (created2d) {
        // the assignment above already cleared the bitmap; re-establish the
        // logical-pixel coordinate system for whatever draws next
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      // Same event, same payload as the Flutter side. It matters more there
      // — a canvas has no size until the host lays it out — but emitting it
      // here too is what lets one page draw on `@resize` and work on both.
      const payload = `{"width":${width},"height":${height}}`;
      // With `defer-resize`, the FIRST report waits for the page transition,
      // exactly as widgets/canvas.dart does. `@resize` is where charting
      // pages build their chart, and building one costs frames the transition
      // needs (specs/027). Later reports are real size changes on a page that
      // is already on screen — those go out immediately either way.
      if (firstReportSent || !deferResize()) {
        firstReportSent = true;
        emit('resize', payload);
        return;
      }
      firstReportSent = true;
      whenNoTransition(() => emit('resize', payload));
    }

    onMounted(() => {
      sync();
      if (typeof ResizeObserver === 'function' && el.value) {
        observer = new ResizeObserver(sync);
        observer.observe(el.value);
      }
    });

    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
    });

    const api = {
      getContext(type: string, attributes?: unknown): unknown {
        const canvas = el.value;
        if (!canvas) return null;
        sync();
        const context = resolveContext(
          contexts,
          type,
          { canvas: api, domCanvas: canvas },
          attributes,
        );
        if (type === '2d' && context) {
          // first 2d context on this canvas: mount-time sync no longer
          // pre-scaled it (that would have fixed the canvas as 2d forever),
          // so the logical-pixel transform is established here — once, not
          // on every call, because a page mid-drawing may have its own
          // transform in flight
          if (!created2d) {
            created2d = true;
            const dpr = globalThis.devicePixelRatio || 1;
            const ctx2d = canvas.getContext('2d');
            ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }
        return context;
      },
      toDataURL(type?: string, quality?: number): Promise<string> {
        // a promise, matching the Flutter side's signature: there the pixels
        // do not exist until the host has painted a frame
        const canvas = el.value;
        return Promise.resolve(canvas ? canvas.toDataURL(type, quality) : '');
      },
      get width(): number {
        return logicalWidth;
      },
      get height(): number {
        return logicalHeight;
      },
      /** What the backing store is scaled by, and therefore what a library
       * that resets the context transform has to scale by itself. 1 on
       * Flutter, where the host owns device pixels. */
      get devicePixelRatio(): number {
        return globalThis.devicePixelRatio || 1;
      },
      /** The real element, for code that genuinely needs the DOM node. */
      get element(): HTMLCanvasElement | null {
        return el.value;
      },
    };
    expose(api);

    return () =>
      h(
        'canvas',
        mergeBindings(hostAttrs(attrs), press, { ref: el, class: 'fjs-canvas' }),
      );
  },
});
