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
// parking — the cache IS the visited set. vue plugins (pinia, vue-i18n)
// have no app to install on and do not apply; a VDOM component inside a
// vapor page cannot work here (the web vdom interop needs the runtime-dom
// renderer this mode exists to avoid).
import { createComponent, createVaporApp, defineVaporComponent, renderEffect, type VaporAppContext, type VaporComponent } from '../vapor/runtime';
import { installBaseCss } from '../web/base-css';
import { createRouter, type FjsWebRouter, type WebRouterOptions } from '../router/web';
import type { Router } from '../router/types';

export interface VaporWebAppOptions extends Omit<WebRouterOptions, 'shell'> {
  /** Ignored here: no Vue app exists to run it against. */
  setup?: unknown;
  /** Ignored here (same reason). */
  plugins?: readonly unknown[];
  /** Mount target. Default '#app'. */
  el?: string | Element;
  /** Ignored (the host element is the page container). */
  rootTag?: unknown;
  /** specs/166: this file IS the enableVapor shell; the flag lives on the
   * shared FjsAppOptions and app/web.ts dispatches here. */
  enableVapor?: boolean;
  /** A Vapor component wrapping every page (receives `route`). */
  shell?: VaporComponent;
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
  const appContext: VaporAppContext = { components: options.components ?? {} };
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

  const currentRouteShape = (): unknown => ({ ...vueRouter.currentRoute.value });

  const buildPage = (fullPath: string): PageInstance => {
    const matched = vueRouter.resolve(fullPath as never);
    const record = matched.matched[matched.matched.length - 1];
    const comp = record?.components?.default as VaporComponent | undefined;
    if (!comp) {
      throw new Error(`[fjs] no component for ${fullPath} — check the route table`);
    }
    const page = options.shell
      ? defineVaporComponent({
          setup() {
            return createComponent(options.shell as VaporComponent, {
              route: () => currentRouteShape(),
            }, { default: () => createComponent(comp) });
          },
        })
      : comp;
    const host = document.createElement('fjs-page');
    const app = createVaporApp(page, appContext);
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
      page = buildPage(fullPath);
      pages.set(fullPath, page);
      container.appendChild(page.host);
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

  const Shell = defineVaporComponent({
    setup() {
      const container = document.createElement('fjs-page-host');
      let previous = '';
      // tracks vue-router's currentRoute ref: every navigation re-runs the
      // swap. The DOM writes here cannot loop — that ref only changes on a
      // real navigation.
      renderEffect(() => {
        const fullPath = String((vueRouter.currentRoute.value as { fullPath?: string }).fullPath ?? '/');
        if (fullPath === previous) return;
        if (previous) hide(previous);
        show(fullPath, container);
        previous = fullPath;
      });
      return container;
    },
  });

  let app: ReturnType<typeof createVaporApp> | null = null;

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
      app = createVaporApp(Shell, appContext);
      app.mount(host as never);
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
