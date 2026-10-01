// createFjsApp for web in enableVapor mode (specs/166): every page is a
// Vapor SFC and the SHELL is vapor too — the app root is createVaporApp over
// the DOM backend, vue-router drives navigation without ever being
// installed on a Vue app (its currentRoute ref is the reactive source the
// shell's effect tracks; pages read it through useRoute's no-instance
// fallback), and nothing imports runtime-dom — `vue` resolves to the
// runtime-core shim, so the DOM renderer never enters the bundle.
//
// Deliberately smaller than the vdom shell (app/web.ts): visited pages stay
// in an LRU cache instead of being destroyed on pop (a pop hides the host;
// the cap recycles), transitions play no animation, and there is no tab
// parking — the cache IS the visited set. vue plugins (pinia) install on
// the app shell (specs/167, app/vapor-app.ts) and run once; a VDOM
// component inside a vapor page cannot work here (the web vdom interop
// needs the runtime-dom renderer this mode exists to avoid).
import { EffectScope, reactive } from '@vue/reactivity';
import type { App } from '@vue/runtime-core';
import { createVaporApp, renderEffect, withScope, withVaporShell, type VaporAppContext, type VaporComponent } from '../vapor/runtime';
// the DOM backend registers on import. The shell mounts before any page
// chunk (whose `fjs/vapor` import would register it) has loaded — a split
// production build threw "no backend set" at mount (specs/167). Same module
// as the enableVapor `fjs/vapor` alias (web-pure re-exports it): one
// registration either way.
import '../vapor/web-dom';
import { installBaseCss } from '../web/base-css';
import { createRouter, ROUTE_KEY, ROUTER_KEY, type FjsWebRouter, type WebRouterOptions } from '../router/web';
import type { Router } from '../router/types';
import { applyPlugins, type FjsPlugin } from './plugin';
import { createVaporAppShell } from './vapor-app';

export interface VaporWebAppOptions extends Omit<WebRouterOptions, 'shell'> {
  /** Runs once with the app shell (specs/167): `app.use(createPinia())`. */
  setup?: (app: App) => void;
  /** App plugins, applied in order before [setup] — against the shell. */
  plugins?: readonly FjsPlugin[];
  /** Mount target. Default '#app'. */
  el?: string | Element;
  /** Ignored (the host element is the page container). */
  rootTag?: unknown;
  /** specs/166: this file IS the enableVapor shell; the flag lives on the
   * shared FjsAppOptions and app/web.ts dispatches here. */
  enableVapor?: boolean;
  /** A Vapor component wrapping every page: gets the page's own `route`
   * and renders the page in its default slot. A VDOM shell warns and is
   * skipped (specs/167 §8). */
  shell?: unknown;
  /** Global components vapor pages resolve by name. */
  components?: Record<string, unknown>;
  /** Pages kept alive (mounted hosts retained). Default 16. */
  keepAlive?: number;
}

export interface VaporWebApp {
  readonly router: Router;
  mount(): void;
}

/** The createFjsApp shape for an enableVapor web app: the CLI aliases
 * 'fjs/app' here (web-vapor mode), so the vdom shell — whose static
 * `createApp`/`Transition` imports need runtime-dom — never enters the
 * bundle graph at all (specs/166). No `vueApp` field: there is no Vue
 * app. */
export function createFjsApp(options: VaporWebAppOptions): VaporWebApp {
  return createVaporWebApp(options);
}

interface PageInstance {
  host: HTMLElement;
  unmount: () => void;
}

export function createVaporWebApp(options: VaporWebAppOptions): VaporWebApp {
  const router: FjsWebRouter = createRouter(options as unknown as WebRouterOptions);
  const vueRouter = router.vueRouter;
  const appContext: VaporAppContext = {
    components: { ...options.components },
    provides: Object.create(null) as Record<string | symbol, unknown>,
  };
  const shell = createVaporAppShell(appContext);
  applyPlugins(shell as unknown as App, options.plugins);
  options.setup?.(shell as unknown as App);
  const keepAlive = options.keepAlive ?? 16;

  // fullPath → mounted page. A pop hides the leaving page's host but keeps
  // the instance (its scroll position and state ride the DOM); the LRU cap
  // unmounts the coldest entry when the cache overflows.
  const pages = new Map<string, PageInstance>();
  const shots = new Map<string, { top: number; left: number }[]>();

  const pageScrollers = (root: HTMLElement | null): HTMLElement[] =>
    root ? [...root.querySelectorAll<HTMLElement>('scroll-view, list-view')] : [];

  const saveShot = (fullPath: string, host: HTMLElement | null): void => {
    if (!host || !pages.has(fullPath)) return;
    shots.set(
      fullPath,
      pageScrollers(host).map((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
    );
  };

  const restoreShot = (fullPath: string, host: HTMLElement | null): void => {
    if (!host) return;
    const shot = shots.get(fullPath);
    pageScrollers(host).forEach((el, i) => {
      const pos = shot?.[i];
      el.scrollTop = pos?.top ?? 0;
      el.scrollLeft = pos?.left ?? 0;
    });
  };

  const buildPage = (fullPath: string, container: HTMLElement): PageInstance => {
    const matched = vueRouter.resolve(fullPath as never);
    const record = matched.matched[matched.matched.length - 1];
    const comp = record?.components?.default as VaporComponent | undefined;
    if (!comp) {
      throw new Error(`[fjs] no component for ${fullPath} — check the route table`);
    }
    // this page's own context (specs/167): the app's provides plus its
    // router and route — a reactive copy, the Flutter router's shape. The
    // cache keys pages by fullPath, so a page's route never changes in place
    const provides = Object.create(appContext.provides ?? null) as Record<string | symbol, unknown>;
    provides[ROUTER_KEY] = router;
    // fjs's RouteLocation shape (not vue-router's resolved object: that one
    // carries the matched records and their components, which a deep
    // reactive() would proxy)
    const route = reactive({
      path: matched.path,
      fullPath: matched.fullPath,
      name: typeof matched.name === 'string' ? matched.name : undefined,
      params: { ...(matched.params as Record<string, string>) },
      query: { ...(matched.query as Record<string, string>) },
      meta: { ...matched.meta },
    });
    provides[ROUTE_KEY] = route;
    // the shell reads THIS page's route (it used to read the router's
    // current one): a cached page's nav bar keeps its own title
    const page = withVaporShell(comp, options.shell, () => route);
    // the host joins the document BEFORE the page mounts: onMounted runs
    // synchronously at mount (specs/167 Q1) and must see attached nodes
    const host = document.createElement('fjs-page');
    container.appendChild(host);
    const app = createVaporApp(page, { components: appContext.components, provides });
    app.mount(host as never);
    return {
      host,
      unmount: () => {
        app.unmount();
        host.remove();
      },
    };
  };

  const show = (fullPath: string, container: HTMLElement): void => {
    let page = pages.get(fullPath);
    if (!page) {
      page = buildPage(fullPath, container);
      pages.set(fullPath, page);
    } else {
      page.host.style.display = '';
    }
    // LRU: freshen, then evict the coldest beyond the cap (never the live one)
    pages.delete(fullPath);
    pages.set(fullPath, page);
    while (pages.size > keepAlive) {
      const coldest = pages.keys().next().value as string | undefined;
      if (coldest === undefined || coldest === fullPath) break;
      const gone = pages.get(coldest);
      if (gone) gone.unmount();
      pages.delete(coldest);
      shots.delete(coldest);
    }
    restoreShot(fullPath, page.host);
  };

  const hide = (fullPath: string): void => {
    const page = pages.get(fullPath);
    if (!page) return;
    saveShot(fullPath, page.host);
    page.host.style.display = 'none';
  };

  // the navigation driver. Not a vapor component (specs/167): a component's
  // setup runs before its block is inserted, and pages mounted from its
  // first run would fire onMounted while still detached. Here the
  // container is in the document first, then the effect starts.
  const startShell = (host: HTMLElement): void => {
    const container = document.createElement('fjs-page-host');
    host.appendChild(container);
    let previous = '';
    const scope = new EffectScope(true);
    withScope(scope, () => {
      // tracks vue-router's currentRoute ref: every navigation re-runs the
      // swap. The DOM writes here cannot loop — that ref only changes on a
      // real navigation.
      renderEffect(() => {
        const current = vueRouter.currentRoute.value as { fullPath?: string; matched: unknown[] };
        // START_LOCATION (before the initial navigation resolves) matches
        // nothing, and its fullPath '/' would be built from the route
        // table's LAZY loader — an empty page that the real '/' then never
        // replaces (same fullPath). Wait for the navigation: vue-router has
        // loaded the page component into the record by then (specs/167)
        if (current.matched.length === 0) return;
        const fullPath = String(current.fullPath ?? '/');
        if (fullPath === previous) return;
        if (previous) hide(previous);
        show(fullPath, container);
        previous = fullPath;
      });
    });
  };

  return {
    router,
    mount() {
      installBaseCss();
      const el = options.el ?? '#app';
      let host: HTMLElement;
      if (typeof el === 'string') {
        const found = document.querySelector<HTMLElement>(el);
        if (found) {
          host = found;
        } else {
          host = document.createElement('div');
          host.id = el.replace(/^#/, '');
          document.body.appendChild(host);
        }
      } else {
        host = el as HTMLElement;
      }
      startShell(host);
      // vue-router starts its initial navigation — which honors the URL the
      // page was opened at and registers the history (back/forward)
      // listeners — only inside install(), and a pure-vapor app never
      // installs it on a Vue app. Replicate the start: install does exactly
      // this push when it runs (the history instance rides the public
      // router options).
      const history = (
        vueRouter as unknown as { options: { history?: { location: string } } }
      ).options.history;
      if (history && vueRouter.currentRoute.value.matched.length === 0) {
        void vueRouter.push(history.location).catch(() => undefined);
      }
    },
  };
}
