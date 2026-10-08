// createFjsApp for Flutter targets. Each route is a native Navigator page
// with its own Vue app rooted in its own element tree, so the platform's
// back gesture and push animation apply to real Flutter routes — see
// router/flutter.ts for the wire protocol.
import type { App } from '@vue/runtime-core';
import { createRouter, ROUTER_KEY, ROUTE_KEY, onPageSettled, type FlutterRouterOptions } from '../router/flutter';
// VDOM pages mount through the renderer (specs/169: registered here, never
// by the enableVapor app — app/flutter-vapor.ts)
import '../router/flutter-vdom';
// the global tab bar (specs/210) mounts through the same renderer, into the
// tab bar host root the base view docks (the TabGroup)
import { createApp as createVueApp } from '../vue/renderer';
import { createGlobalHost, createTabBarHost, modalMaskCount, viewportSize } from '../vue/host-ops';
import type { Router } from '../router/types';
import { FjsTabBarSurface, tabBarItems } from './tabbar';
import { FjsGlobalSurface, normalizeGlobalComponents } from './global-components';
import { createFjsCanvas } from '../components/canvas';
// the inner-canvas surface (specs/185): registered by whoever registers the
// canvas component, not by the element layer
import '../canvas/surface';
import { createDefer } from '../components/defer';
import { FjsForm } from '../components/form';
import { FjsListView } from '../components/list-view';
import { FjsPicker } from '../components/picker';
import { FjsRichText } from '../components/rich-text';
import { FjsTextarea } from '../components/textarea';
import { applyPlugins, type FjsPlugin } from './plugin';
import { createVaporAppShell } from './vapor-app';
import type { VaporAppContext } from '../vapor/instance';

export interface FjsAppOptions extends FlutterRouterOptions {
  /** App plugins, applied in order before [setup]. Normally the generated
   * list: `import { plugins } from 'fjs/plugins'`. */
  plugins?: readonly FjsPlugin[];
  /** Called with the Vue app before it is mounted. On Flutter this runs
   * once per page (each page is its own app). With [enableVapor] it runs
   * ONCE, with the app shell (specs/167: use / provide / component /
   * runWithContext / config — enough for pinia). */
  setup?: (app: App) => void;
  /** Web only: mount target. Ignored here. */
  el?: string | unknown;
  /** specs/166: every page is a Vapor SFC. Pages mount through the vapor
   * runtime directly — no per-page Vue app, no compile-time wrapper (the
   * CLI reads this option at build time and skips it; it must be the
   * literal `true`). `setup` and [plugins] run once against the app shell
   * (specs/167); global component resolution goes through [components]
   * plus the built-in fjs component set. */
  enableVapor?: boolean;
  /** Global components (enableVapor): what a vapor page's
   * `resolveComponent` may name. The built-in fjs components
   * (canvas/list-view/form/picker/rich-text/textarea/defer) are always
   * included — they replace what onCreateApp registered on the Vue app in
   * the vdom path. */
  components?: Record<string, unknown>;
}

export interface FjsApp {
  readonly router: Router;
  mount(): void;
}

export function createFjsApp(options: FjsAppOptions): FjsApp {
  if (options.enableVapor && options.tabBar) {
    // constitution V: ignoring an option quietly looks like a bug
    console.warn('[fjs] tabBar is not supported with enableVapor yet — ignored (specs/210)');
  }
  if (options.enableVapor && options.globalComponents?.length) {
    console.warn('[fjs] globalComponents is not supported with enableVapor yet — ignored (specs/211)');
  }
  // enableVapor (specs/166/167): no per-page Vue app. The built-in component
  // set — what onCreateApp registers on each page's app in the vdom path —
  // and the app's own components resolve through one vapor app context;
  // plugins and setup run ONCE, here, against the app shell (the vdom path
  // runs them per page)
  let vaporContext: VaporAppContext | undefined;
  if (options.enableVapor) {
    vaporContext = {
      components: {
        canvas: createFjsCanvas('inner-canvas'),
        'list-view': FjsListView,
        form: FjsForm,
        picker: FjsPicker,
        'rich-text': FjsRichText,
        textarea: FjsTextarea,
        defer: FjsDefer,
        ...options.components,
      },
      provides: Object.create(null) as Record<string | symbol, unknown>,
    };
    const shell = createVaporAppShell(vaporContext);
    applyPlugins(shell as unknown as App, options.plugins);
    options.setup?.(shell as unknown as App);
  }
  const configureApp = (app: App): void => {
    // the surface is the `inner-canvas` ELEMENT here; on web the same
    // factory is pointed at the web adapter's component
    app.component('canvas', createFjsCanvas('inner-canvas'));
    app.component('list-view', FjsListView);
    app.component('form', FjsForm);
    app.component('picker', FjsPicker);
    app.component('rich-text', FjsRichText);
    app.component('textarea', FjsTextarea);
    app.component('defer', FjsDefer);
    applyPlugins(app, options.plugins);
    options.setup?.(app);
  };
  const router = createRouter({
    ...options,
    ...(vaporContext ? { vaporContext } : {}),
    onCreateApp: configureApp,
  });
  installTabBar(options, router, configureApp);
  if (!options.enableVapor) installGlobalComponents(options, router, configureApp);
  return {
    router,
    mount() {
      router.start();
    },
  };
}

/** specs/210: the global tab bar — a second Vue app (the same custom
 * renderer a page app uses) in a dedicated tab bar host root. The base
 * FjsView docks that root BELOW the page area (the TabGroup: tab pages
 * above, bar below), so the bar is in-flow chrome: a pushed route covers
 * the whole group, a page modal paints above the bar, and no overlay
 * machinery is involved. Runs at createFjsApp — before any page — so the
 * bar is up from the first frame. */
function installTabBar(
  options: FjsAppOptions,
  router: Router & { readonly pushedDepth: number },
  configureApp: (app: App) => void,
): void {
  const component = options.tabBar?.component;
  if (!component) return;
  const root = createTabBarHost();
  const app = createVueApp(FjsTabBarSurface, {
    router,
    component,
    tabs: tabBarItems(options.routes),
    // a pushed route covers the whole TabGroup (it is a real Navigator
    // route): the bar stays mounted under it — no hide/show churn around a
    // push, and the pop reveals the bar already in place
    coveredOnPush: () => router.pushedDepth > 0,
  });
  // the same provides a page app gets: the bar's component may useRouter() /
  // useRoute() (the module fallback would answer too, but pages get the
  // injected pair — keep the bar identical)
  app.provide(ROUTER_KEY, router);
  app.provide(ROUTE_KEY, router.currentRoute);
  configureApp(app);
  app.mount(root);
}

/** specs/211: global components — ONE Vue app (the page renderer) in a
 * dedicated `__global` root that FjsApp paints above the Navigator, so a
 * pushed page does not cover it. The layer yields to page modals by hiding
 * while a mask is up: it is above them in the widget tree, but a dialog's
 * mask must still cover the ball. */
function installGlobalComponents(
  options: FjsAppOptions,
  router: Router,
  configureApp: (app: App) => void,
): void {
  const items = normalizeGlobalComponents(options.globalComponents);
  if (items.length === 0) return;
  const root = createGlobalHost();
  const app = createVueApp(FjsGlobalSurface, {
    router,
    items,
    modalUp: () => modalMaskCount.value > 0,
    size: () => viewportSize.value,
  });
  app.provide(ROUTER_KEY, router);
  app.provide(ROUTE_KEY, router.currentRoute);
  configureApp(app);
  app.mount(root);
}

/** `<defer>` on the Flutter host (components/defer.ts). Exported for code
 * that builds its own app outside createFjsApp — demo/bench/mount.ts. */
export const FjsDefer = createDefer(onPageSettled, 'view');

export { useRouter, useRoute, definePage } from '../router/flutter';
export type { FjsPlugin } from './plugin';
export type { Router, RouteLocation, RouteRecord, RouteMeta } from '../router/types';
