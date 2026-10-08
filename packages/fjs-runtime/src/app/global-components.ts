// Global components (specs/211): Vue SFCs mounted ONCE for the whole app,
// outside every page tree — a floating ball, a customer-service entry, a
// player bar. createFjsApp({ globalComponents }) takes them; each one is
// visible on the routes its include / exclude patterns allow (default: all).
//
// Same shape as the tab bar (specs/210): one extra Vue app on each platform,
// fed by this surface. What differs is the layer: the tab bar docks inside
// the TabGroup, this layer is above the Navigator on Flutter (a pushed page
// does not cover it) and above the page host on web.
//
// A route that does not match HIDES the component (display:none) instead of
// unmounting it: the ball keeps its position and open menu across a trip
// through an excluded page, which is the point of a single instance.
//
// Events must pass through the layer itself — only the components' own
// elements react. That is structural, not CSS: web sets pointer-events:none
// on the host and re-enables it on descendants (base-css.ts); Flutter hit-
// tests only where a box paints (FjsAppOverlayHost), so the transparent
// full-screen wrapper below takes nothing.
import { computed, defineComponent, h, type Component, type PropType } from '@vue/runtime-core';
import type { Router } from '../router/types';

/** `'/a'` exact, `'/a/*'` the prefix (and `/a` itself), or a RegExp tested
 * against the path. */
export type RoutePattern = string | RegExp;

export interface GlobalComponentOptions {
  component: Component;
  /** Only these routes show it. Default: every route. */
  include?: RoutePattern[];
  /** Routes that never show it. Wins over include. */
  exclude?: RoutePattern[];
}

export type GlobalComponentEntry = Component | GlobalComponentOptions;

function matches(path: string, pattern: RoutePattern): boolean {
  if (pattern instanceof RegExp) {
    // a /g or /y regex keeps lastIndex between calls and would alternate
    pattern.lastIndex = 0;
    return pattern.test(path);
  }
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }
  return path === pattern;
}

/** Whether a global component shows on [path]. */
export function globalVisible(
  path: string,
  opts: Pick<GlobalComponentOptions, 'include' | 'exclude'>,
): boolean {
  if (opts.exclude?.some((p) => matches(path, p))) return false;
  if (opts.include && !opts.include.some((p) => matches(path, p))) return false;
  return true;
}

/** A bare component or an options object. A component is itself an object
 * (or function), so the options form is told apart by its `component` key —
 * no component definition has one. */
export function normalizeGlobalComponents(
  entries: readonly GlobalComponentEntry[] | undefined,
): GlobalComponentOptions[] {
  return (entries ?? []).map((e) =>
    typeof e === 'object' && e !== null && 'component' in e
      ? (e as GlobalComponentOptions)
      : { component: e as Component },
  );
}

function sizeStyle(size: { width: number; height: number } | null): Record<string, string> {
  return size && size.width > 0 && size.height > 0
    ? { width: `${size.width}px`, height: `${size.height}px` }
    : {};
}

export const FjsGlobalSurface = defineComponent({
  name: 'FjsGlobalSurface',
  props: {
    router: { type: Object as PropType<Router>, required: true },
    items: { type: Array as PropType<GlobalComponentOptions[]>, required: true },
    /** Flutter: true while a page modal (mask) is up. The layer is above the
     * Navigator there, so it yields to a modal by hiding. Web needs no such
     * thing — the stylesheet keeps the host below the modal z-index. */
    modalUp: { type: Function as PropType<() => boolean>, default: () => false },
    /** Flutter: the host window size. The layer has no in-flow content, which
     * Flutter lays out at height 0 — `100%` / inset then collapse, and a
     * component measuring its coordinate space reads an empty box. A px size
     * gives it a real one. Web passes nothing: its CSS layer is full-size. */
    size: { type: Function as PropType<() => { width: number; height: number } | null>, default: () => null },
  },
  setup(props) {
    const path = computed(() => props.router.currentRoute.path);
    return () =>
      props.items.map((item, i) =>
        h(
          'view',
          {
            key: i,
            class: 'fjs-global-surface',
            // a full-screen, transparent coordinate space for the component's
            // own absolutely positioned elements; the empty object lets the
            // style diff remove display:none again
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              ...sizeStyle(props.size()),
              ...(globalVisible(path.value, item) && !props.modalUp() ? {} : { display: 'none' }),
            },
          },
          [h(item.component)],
        ),
      );
  },
});
