// createFjsApp for web in enableVapor mode (specs/166): every page is a
// Vapor SFC and the SHELL is vapor too — the app root is createVaporApp over
// the DOM backend, the history router (router/web-history.ts, specs/173 —
// no vue-router) drives navigation (its `current` ref is the reactive
// source the shell's effect tracks; pages read their route from the
// provides), and nothing imports runtime-dom — `vue` resolves to the
// runtime-core shim, so the DOM renderer never enters the bundle.
//
// Deliberately smaller than the vdom shell (app/web.ts): visited pages stay
// in an LRU cache instead of being destroyed on pop (a pop hides the host;
// the cap recycles), page transitions run on the vapor <Transition> engine
// with the VDOM shell's class names and CSS (specs/178), and there is no tab
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
import { createHistoryRouter, type CurrentPage, type HistoryRouter, type HistoryRouterOptions } from '../router/web-history';
import { ROUTE_KEY, ROUTER_KEY } from '../router/web-vapor';
import type { NavKind, RouteLocation, Router, TransitionOption } from '../router/types';
import { resolveTransition } from '../router/transition';
import { beginPageTransition, markPageSettled } from '../router/settled';
import { createTransitionHooks } from '../vapor/transition';
import { applyPlugins, type FjsPlugin } from './plugin';
import { createVaporAppShell } from './vapor-app';

export interface VaporWebAppOptions extends Omit<HistoryRouterOptions, 'shell'> {
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
  /** Page transition, as in the VDOM shell (app/web.ts, specs/178): a CSS
   * family name (default 'fjs-page'), `false`, or a function of the
   * navigation; a page's `meta.transition` overrides it. */
  transition?: TransitionOption;
  /** Pages kept alive, as in the VDOM shell (specs/183): the ones on the
   * history stack (default `true`) — a popped or replaced page is destroyed,
   * so pushing its path again starts fresh — a number to also cap how many
   * stay mounted, or `false` to keep only the page on screen. */
  keepAlive?: boolean | number;
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
  deactivate: () => void;
  activate: () => void;
}

export function createVaporWebApp(options: VaporWebAppOptions): VaporWebApp {
  const router: HistoryRouter = createHistoryRouter(options as unknown as HistoryRouterOptions);
  const appContext: VaporAppContext = {
    components: { ...options.components },
    provides: Object.create(null) as Record<string | symbol, unknown>,
  };
  const shell = createVaporAppShell(appContext);
  applyPlugins(shell as unknown as App, options.plugins);
  options.setup?.(shell as unknown as App);
  const keepAlive = options.keepAlive ?? true;
  const cap = typeof keepAlive === 'number' ? keepAlive : Infinity;

  // fullPath → mounted page. Only pages on the history stack (and parked
  // tabs) stay — a page under the one on screen is hidden with its state
  // and scroll position; a popped / replaced page is destroyed, as the VDOM
  // shell's KeepAlive `include` and a Flutter Navigator pop do (specs/183).
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

  const buildPage = (current: CurrentPage, container: HTMLElement, enterClasses: readonly string[] | null): PageInstance => {
    const { location: matched, component } = current;
    const comp = component as VaporComponent | undefined;
    if (!comp) {
      throw new Error(`[fjs] no component for ${matched.fullPath} — check the route table`);
    }
    // this page's own context (specs/167): the app's provides plus its
    // router and route — a reactive copy, the Flutter router's shape. The
    // cache keys pages by fullPath, so a page's route never changes in place
    const provides = Object.create(appContext.provides ?? null) as Record<string | symbol, unknown>;
    provides[ROUTER_KEY] = router;
    const route = reactive({
      path: matched.path,
      fullPath: matched.fullPath,
      name: matched.name,
      params: { ...matched.params },
      query: { ...matched.query },
      meta: { ...matched.meta },
    });
    provides[ROUTE_KEY] = route;
    // the shell reads THIS page's route (it used to read the router's
    // current one): a cached page's nav bar keeps its own title
    const page = withVaporShell(comp, options.shell, () => route);
    // the host joins the document BEFORE the page mounts: onMounted runs
    // synchronously at mount (specs/167 Q1) and must see attached nodes
    // the VDOM shell's page element: base-css's page transition and
    // stacking rules are written against it (specs/178)
    const host = document.createElement('fjs-page-entry');
    // an arriving page starts in its enter state, as Vue's <Transition>
    // inserts it: base-css takes `-active` pages out of the flow, so the
    // page's onMounted measures where it will be — not stacked under the
    // page it replaces (specs/181 follow-up: vant Sticky read a 468px top)
    if (enterClasses) host.classList.add(...enterClasses);
    container.appendChild(host);
    const app = createVaporApp(page, { components: appContext.components, directives: appContext.directives, provides });
    app.mount(host as never);
    return {
      host,
      unmount: () => {
        app.unmount();
        host.remove();
      },
      deactivate: app.deactivate,
      activate: app.activate,
    };
  };

  const show = (current: CurrentPage, container: HTMLElement, enterClasses: readonly string[] | null = null): void => {
    const fullPath = current.location.fullPath;
    let page = pages.get(fullPath);
    if (!page) {
      page = buildPage(current, container, enterClasses);
      pages.set(fullPath, page);
    } else {
      page.host.style.display = '';
      // a cached page back on screen: onActivated, as the VDOM shell's
      // KeepAlive runs it (specs/181)
      page.activate();
    }
    // LRU: freshen, then evict the coldest beyond the cap (never the live one)
    pages.delete(fullPath);
    pages.set(fullPath, page);
    while (pages.size > cap) {
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
    let previousLocation: RouteLocation | null = null;
    const isTab = (loc: RouteLocation): boolean => typeof loc.meta?.tab === 'number';
    // the history stack as the shell sees it, and the tab pages parked by a
    // tab → tab replace (the VDOM shell's `stack` / `tabs`, app/web.ts)
    const stack: string[] = [];
    const tabs: string[] = [];
    const tabPaths = new Set<string>();
    const kept = (path: string): boolean => keepAlive !== false && (stack.includes(path) || tabs.includes(path));
    const destroy = (path: string): void => {
      const page = pages.get(path);
      if (!page) return;
      page.unmount();
      pages.delete(path);
      shots.delete(path);
    };
    const track = (current: CurrentPage): void => {
      const path = current.location.fullPath;
      if (isTab(current.location)) tabPaths.add(path);
      const top = stack[stack.length - 1];
      if (current.kind === 'initial') {
        stack.splice(0, stack.length, path);
      } else if (current.kind === 'pop') {
        // back (or the browser's back / forward): everything above the
        // arrived page leaves the stack; an address the stack does not hold
        // (a forward, an edited hash) lands on top
        while (stack.length && stack[stack.length - 1] !== path) stack.pop();
        if (!stack.length) stack.push(path);
      } else if (current.kind === 'replace') {
        const parkGone = keepAlive !== false && top !== undefined && top !== path && tabPaths.has(top) && isTab(current.location);
        if (parkGone && !tabs.includes(top)) tabs.push(top);
        // the base page left the tab group: the parked tabs go with it
        if (!isTab(current.location)) tabs.length = 0;
        if (stack.length) stack[stack.length - 1] = path;
        else stack.push(path);
      } else if (top !== path) {
        stack.push(path);
      }
      const parked = tabs.indexOf(path);
      if (parked >= 0) tabs.splice(parked, 1);
    };
    const scope = new EffectScope(true);
    withScope(scope, () => {
      // tracks the router's `current` ref: every navigation re-runs the
      // swap. The DOM writes here cannot loop — that ref only changes on a
      // real navigation, after the page's module has loaded.
      renderEffect(() => {
        const current = router.current.value;
        if (!current) return;
        const fullPath = current.location.fullPath;
        if (fullPath === previous) return;
        // the VDOM shell's rules (app/web.ts): which family, which way, and
        // when the arriving page counts as settled
        const kind: NavKind =
          current.kind === 'replace' && previousLocation && isTab(previousLocation) && isTab(current.location)
            ? 'tab'
            : current.kind;
        const name =
          options.transition === false
            ? false
            : resolveTransition(options.transition, { to: current.location, from: previousLocation ?? current.location, kind });
        container.setAttribute('data-nav', name === false ? 'none' : kind);
        beginPageTransition(fullPath);
        const leavingPath = previous;
        const leaving = leavingPath ? pages.get(leavingPath) : undefined;
        // the page being left is deactivated now, as KeepAlive does it — its
        // teleported layers (vant's Popover) close instead of staying over
        // the next page (specs/181)
        leaving?.deactivate();
        track(current);
        // the leaving side first: a new page mounts (and its onMounted
        // measures) with the old one already out of the flow
        const hooks = name === false || !leaving ? null : createTransitionHooks({ name });
        if (!hooks) {
          if (leavingPath) hide(leavingPath);
        } else {
          // both pages overlap for the length of it (base-css positions the
          // -active ones); the leaving page hides once its leave is over —
          // an enter on it first (back before it finished) cancels that
          saveShot(leavingPath, leaving!.host);
          hooks.leave([leaving!.host], () => {
            leaving!.host.style.display = 'none';
            // off the stack by the time its leave is over (and not brought
            // back meanwhile): destroyed, as a popped Navigator route is
            if (!kept(leavingPath) && pages.get(leavingPath) === leaving && leavingPath !== previous) destroy(leavingPath);
          });
        }
        show(current, container, hooks ? [`${name}-enter-from`, `${name}-enter-active`] : null);
        // what left the stack goes now — except a page still playing its
        // leave, which goes when that is over (above)
        for (const path of [...pages.keys()]) {
          if (path === fullPath || kept(path)) continue;
          if (hooks && path === leavingPath) continue;
          destroy(path);
        }
        const entering = pages.get(fullPath)!.host;
        if (!hooks) markPageSettled(fullPath);
        else hooks.enter([entering], () => markPageSettled(fullPath));
        previous = fullPath;
        previousLocation = current.location;
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
      // the first navigation honors the address the page was opened at
      void router.start();
    },
  };
}
