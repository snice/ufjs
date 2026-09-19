// `<canvas>` — a component wrapping the `inner-canvas` element.
//
// The drawing surface itself has to be a host element (only Flutter can turn
// commands into pixels), but a bare surface leaves a page with nowhere to
// put what belongs ON a canvas rather than IN it: a tooltip, a legend, a
// loading mask, a hit-area button. Drawing those into the bitmap means
// re-implementing text layout, wrapping and theming that the element layer
// already has, and it puts them outside the reach of everything a page
// normally uses (CSS, `v-if`, event handlers).
//
// So `canvas` is a box with the surface inside it and a slot for that
// overlay, and the surface tag is renamed `inner-canvas` so the two names
// cannot collide (a component that renders a tag of its own name is a
// self-reference; see specs/019-canvas/plan.md §3.1).
//
//   <canvas ref="cv" class="chart" @resize="paint">
//     <view class="tip" :style="tipStyle">{{ label }}</view>   <- overlay
//   </canvas>
//
// The page still sees the DOM's API: `ref` gives getContext / toDataURL /
// width / height, forwarded to the surface. Overlay nodes are ordinary fjs
// nodes, so they position with `position: absolute` against this box.
//
// One component, two substrates — the Flutter path renders the
// `inner-canvas` ELEMENT, the web path renders the web adapter's component
// (web/components/canvas.ts). Same props, same events, same exposed API.
import {
  defineComponent,
  h,
  ref,
  type Component,
} from '@vue/runtime-core';

/** The members a page reaches through `ref`. Mirrors what the element layer
 * attaches to a canvas element (ui/element.ts). */
interface CanvasApi {
  getContext(type: string, attributes?: unknown): unknown;
  toDataURL(type?: string, quality?: number): Promise<string>;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

/** [surface] is the drawing element/component, [box] the container around
 * it. BOTH are parameters, and the box is the one that is easy to get wrong:
 * `h('view', …)` in a render function creates a raw DOM element on web — the
 * template compiler is what turns `<view>` into a component, and a render
 * function gets no such treatment. The result renders, takes the class, and
 * silently does nothing fjs does: no touch layer, no style normalization. */
export function createFjsCanvas(
  target: string | Component,
  box: string | Component = 'view',
) {
  return defineComponent({
    name: 'FjsCanvas',
    inheritAttrs: false,
    emits: ['resize'],
    setup(_props, { attrs, slots, emit, expose }) {
      const surface = ref<CanvasApi | null>(null);

      function api(): CanvasApi | null {
        const inner = surface.value as CanvasApi | null;
        return inner;
      }

      expose({
        getContext: (type: string, attributes?: unknown) =>
          api()?.getContext(type, attributes) ?? null,
        toDataURL: (type?: string, quality?: number) =>
          api()?.toDataURL(type, quality) ?? Promise.resolve(''),
        get width(): number {
          return api()?.width ?? 0;
        },
        get height(): number {
          return api()?.height ?? 0;
        },
        get devicePixelRatio(): number {
          return api()?.devicePixelRatio ?? 1;
        },
      });

      return () => {
        // `defer-resize` belongs to the SURFACE, not the box: it changes when
        // the surface reports its size. Pulled out of attrs so it does not
        // also land on the box as a stray prop.
        const { 'defer-resize': deferKebab, deferResize, ...boxAttrs } = attrs as
          Record<string, unknown>;
        const defer = deferKebab !== undefined ? deferKebab : deferResize;
        return h(box, {
          ...boxAttrs,
          class: ['fjs-canvas-box', attrs.class],
          // the box is the positioning context for both the surface and any
          // overlay the page puts in the slot. Merged UNDER the page's own
          // style so a page that positions the box itself still wins.
          style: {
            position: 'relative',
            alignItems: 'stretch',
            ...(attrs.style as object ?? {}),
          },
        }, {
          default: () => [
            h(target, {
            ref: surface,
            deferResize: defer,
            // fills the box, whatever the page sized the box to. The overlay
            // sits on top by being absolutely positioned, not by order.
            style: SURFACE_STYLE,
              onResize: (payload: string) => emit('resize', payload),
            }),
            ...(slots.default?.() ?? []),
          ],
        });
      };
    },
  });
}

/** The surface always fills its box. A page styles `<canvas>`; the element
 * inside it is not something the page addresses.
 *
 * In FLOW, not absolutely positioned: a positioned box sizes itself to its
 * in-flow children (render/flex.dart), so a surface that took itself out of
 * flow would leave the box with nothing to measure — the canvas ends up
 * 0x0, never reports a size, and the page never gets its first `@resize`.
 * The cross axis is handled by the box's `align-items: stretch` rather than
 * `align-self`: a self-aligned item makes the app side lay its box out in
 * two passes (render/flex.dart), a cost the surface has no reason to add. */
const SURFACE_STYLE = { flexGrow: 1 } as const;
