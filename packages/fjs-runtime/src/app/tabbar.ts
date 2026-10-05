// The global tab bar (specs/210): one instance for the whole app, mounted
// OUTSIDE the page trees where no page transition can touch it. Visible on
// the tab group's pages only (meta.tab), the way a mini program's tabBar
// behaves; a push hides it, returning brings it back. Without `tabBar` in
// createFjsApp nothing here runs and the shell keeps rendering a per-page
// tab bar, exactly as before.
//
// Placement is IN-FLOW chrome, per platform the same shape (pages area
// above, bar below — the TabGroup), so none of the overlay machinery
// applies: no `position: fixed`, no app-level host, no hoisting. A pushed
// page covers the whole group on Flutter (a real Navigator route) and the
// stylesheet lifts the pushed entry above the bar on web; a page modal paints above the bar the
// way it paints above any page content. An earlier draft floated the bar
// through the app-level overlay host — the user reviewed it live and sent
// it to the TabGroup: the overlay rebuild on every tab switch made the bar
// flicker, and half the overlay bookkeeping (back guard, modal census,
// hit-test fallthrough) existed only to serve it.
//
// Constitution VII: this is pure organization — every state it needs (route
// table, current route) already lives JS-side; Dart only learns one layout
// rule (dock `__tabBar` roots below the page area, fjs_view.dart).
import {
  computed,
  defineComponent,
  h,
  type Component,
  type PropType,
} from '@vue/runtime-core';
import type { RouteRecord, Router } from '../router/types';

/** One tab as the bar component sees it: the route table's tab pages, in
 * `meta.tab` order. */
export interface TabBarItem {
  path: string;
  title: string;
  /** The page's `meta.tab` — the index `active` names. */
  tab: number;
}

export interface TabBarSurfaceProps {
  router: Router;
  component: Component;
  tabs: TabBarItem[];
  /** Whether a pushed (non-tab) page is on top of the bar, so the surface
   * leaves it mounted instead of hiding it. Flutter: the pushed route
   * covers the whole TabGroup, and currentRoute lags the pop animation
   * (navPop arrives after the exit animation, specs/003), so hiding on "not
   * a tab page" would strip the bar mid-reveal. Web: the same — the pushed
   * page's entry is lifted above the bar by the stylesheet (data-covers-bar). */
  coveredOnPush: () => boolean;
}

/** The route table's tab pages (`meta.tab` is a number), sorted by it. */
export function tabBarItems(routes: RouteRecord[]): TabBarItem[] {
  return routes
    .filter((r) => typeof r.meta?.tab === 'number')
    .sort((a, b) => (a.meta?.tab as number) - (b.meta?.tab as number))
    .map((r) => ({
      path: r.path,
      title: String(r.meta?.title ?? ''),
      tab: r.meta?.tab as number,
    }));
}

/**
 * The surface every platform mounts the app's tab bar component into: an
 * ordinary in-flow box at the bottom of the TabGroup. The bar itself is the
 * app's component (its look is its own business); this wrapper only
 * collapses on pages without the bar — anything that is not a tab page, a
 * tab page that opted out (`meta.tabBar: false`), and computes the props
 * the component receives.
 *
 * `active` is the current route's `meta.tab` — a number exactly when the
 * bar is visible for route reasons, so the component can key its highlight
 * off it.
 */
export const FjsTabBarSurface = defineComponent({
  name: 'FjsTabBarSurface',
  props: {
    router: { type: Object as PropType<Router>, required: true },
    component: { type: [Object, Function] as PropType<Component>, required: true },
    tabs: { type: Array as PropType<TabBarItem[]>, required: true },
    coveredOnPush: { type: Function as PropType<() => boolean>, required: true },
  },
  setup(props) {
    const active = computed<number | null>(() => {
      const tab = props.router.currentRoute.meta?.tab;
      return typeof tab === 'number' ? tab : null;
    });
    const visible = computed(() => {
      const meta = props.router.currentRoute.meta;
      if (meta?.tabBar === false) return false;
      if (typeof meta?.tab === 'number') return true;
      // a pushed non-tab page: covered platforms keep the bar mounted under
      // the pushed route (it reappears the moment the pop reveals the
      // page); the same on web, where the pushed entry paints above the bar
      return props.coveredOnPush();
    });
    return () =>
      h('view', {
        key: 'fjs-tabbar-surface',
        class: 'fjs-tabbar-surface',
        // display:none collapses the slot (Dart renders a hidden node as
        // SizedBox.shrink); the empty object lets the style diff remove it
        // again — view defaults to the global flex column
        style: visible.value ? {} : { display: 'none' },
      }, [h(props.component, { tabs: props.tabs, active: active.value })]);
  },
});
