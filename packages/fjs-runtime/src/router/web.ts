// Router for web targets: a thin facade over vue-router so app code can
// call the same `useRouter().push(...)` it calls on Flutter. The facade
// exists only to keep `currentRoute` a plain object on both platforms
// (vue-router exposes a Ref) — everything else delegates.
import {
  createRouter as createVueRouter,
  createWebHashHistory,
  createWebHistory,
  useRoute as vueUseRoute,
  type RouteRecordRaw,
  type Router as VueRouter,
} from 'vue-router';
import { Matcher } from './match';
import { startPreloadQueue } from './preload-queue';
import { whenSettled } from './settled';
import type { RouteLocation, RouteLocationRaw, Router, RouterOptions } from './types';

/** One KeepAlive slot per history stack entry. Path alone is not enough:
 * two visits to `/` are two pages (a push starts at 0, 0; a pop restores). */
export function historyEntryKey(
  route: { fullPath: string },
  state?: { position?: number } | null,
): string {
  const raw =
    state !== undefined
      ? state
      : typeof history !== 'undefined'
        ? (history.state as { position?: number } | null)
        : null;
  const pos = raw?.position;
  return `${typeof pos === 'number' ? pos : 0}:${route.fullPath}`;
}

export interface WebRouterOptions extends RouterOptions {
  /** 'hash' (default) works on any static host; 'history' needs a server
   * rewrite to index.html. */
  history?: 'hash' | 'history';
  /** Base path for 'history' mode. */
  base?: string;
}

export interface FjsWebRouter extends Router {
  /** The underlying vue-router, for `app.use()` and <router-view>. */
  readonly vueRouter: VueRouter;
}

let active: FjsWebRouter | null = null;

/** Translates the catch-all `*` segment the generated table uses into
 * vue-router's own syntax. `(.*)` and not `(.*)*`: the repeatable form hands
 * back an array of segments, while the Flutter matcher's `params.pathMatch`
 * is the joined string — same route, same param, one shape. */
function vueRouterPath(path: string): string {
  return path.replace(/\/\*$/, '/:pathMatch(.*)');
}

export function createRouter(options: WebRouterOptions): FjsWebRouter {
  const matcher = new Matcher(options.routes);
  const records: RouteRecordRaw[] = options.routes.map(
    (route) =>
      ({
        path: vueRouterPath(route.path),
        name: route.name,
        meta: route.meta ?? {},
        component: route.component,
      }) as RouteRecordRaw,
  );
  const initial = options.initial ?? '/';
  if (initial !== '/' && !options.routes.some((r) => r.path === '/')) {
    records.push({ path: '/', redirect: initial } as RouteRecordRaw);
  }
  // unknown paths would otherwise warn and render nothing — unless the app
  // ships its own catch-all page, which should render instead of redirecting
  if (!options.routes.some((r) => r.path === '/*')) {
    records.push({
      path: '/:pathMatch(.*)*',
      redirect: initial,
    } as RouteRecordRaw);
  }

  const vueRouter = createVueRouter({
    history:
      options.history === 'history'
        ? createWebHistory(options.base)
        : createWebHashHistory(options.base),
    routes: records,
    scrollBehavior(_to, _from, savedPosition) {
      // Window only. Page / shell scroll-views are per history entry
      // (KeepAlive), so they do not need a restore hook.
      return savedPosition ?? { left: 0, top: 0 };
    },
  });
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  const router: FjsWebRouter = {
    vueRouter,
    routes: options.routes,
    get currentRoute(): RouteLocation {
      return vueRouter.currentRoute.value as unknown as RouteLocation;
    },
    push: (to) => vueRouter.push(to as never).then(() => undefined),
    replace: (to) => vueRouter.replace(to as never).then(() => undefined),
    back: () => vueRouter.back(),
    go: (delta) => vueRouter.go(delta),
    resolve: (to: RouteLocationRaw) => matcher.resolve(to),
    preload: (to) => preloadRecord(matcher, to),
  };
  active = router;
  if (options.preload !== false) {
    // the web half of specs/143: once the first page has settled, pull every
    // page module down in idle time so a navigation only renders. Starting
    // earlier would compete with the first page's own imports.
    void vueRouter.isReady().then(() => {
      whenSettled(vueRouter.currentRoute.value.fullPath, () => {
        const paths = options.routes
          .map((r) => r.path)
          .filter((p) => !p.includes(':') && !p.includes('*'));
        startPreloadQueue(paths, async (p) => {
          await whenBrowserIdle();
          await preloadRecord(matcher, p);
        });
      });
    });
  }
  return router;
}

/** Runs the route's lazy `() => import(...)` (the generated web table's
 * shape); the browser keeps the module, so the navigation's own import
 * resolves from cache. A synchronous component is already loaded. */
async function preloadRecord(matcher: Matcher, to: RouteLocationRaw): Promise<void> {
  const record = matcher.record(matcher.resolve(to).path);
  const component = record?.component;
  if (typeof component !== 'function' || isComponentFunction(component)) return;
  await (component as () => Promise<unknown>)();
}

/** A functional component or a class-style one, not a lazy loader. */
function isComponentFunction(fn: object): boolean {
  return 'props' in fn || 'setup' in fn || 'render' in fn || '__vccOpts' in fn;
}

/** requestIdleCallback where there is one (Safari has none), bounded so a
 * page that is never idle still gets its modules. */
function whenBrowserIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 50);
  });
}

// ---- page settled ----------------------------------------------------------
//
// State lives in ./settled so <canvas> can read it without pulling
// vue-router in (app/web.ts is the only writer); this file exports just the
// public API, so the two platforms' 'fjs/router' surfaces stay identical
// (specs/027).

/** Runs `cb` once this page's route transition has finished.
 *
 * Expensive first-paint work costs frames, and during a navigation those are
 * the frames the page transition is animating. Always asynchronous, even
 * when the page has already settled, so a caller in setup() can finish its
 * own initialisation first. Fires at most once.
 *
 * `<canvas>` already does this for its first `@resize`, so a charting page
 * usually needs nothing — this is for everything else. */
export function onPageSettled(cb: () => void): void {
  let path: string | undefined;
  try {
    // inside a page's setup this is that page's route; outside it falls back
    // to whatever the router is on
    path = (vueUseRoute() as unknown as { fullPath?: string })?.fullPath;
  } catch {
    path = active?.currentRoute?.fullPath;
  }
  whenSettled(path, cb);
}

export function useRouter(): Router {
  if (!active) throw new Error('useRouter(): no router — call createFjsApp first');
  return active;
}

/** vue-router's own useRoute: reactive, and correct inside a page that is
 * not the currently active one (kept-alive views). */
export const useRoute = vueUseRoute as unknown as () => RouteLocation;

/** No-op on web: page components are imported by the generated route
 * table instead of registering themselves from a chunk. */
export function definePage(): void {}

export type {
  RouteLocation,
  RouteLocationRaw,
  RouteName,
  RoutePath,
  Router,
  RouterOptions,
} from './types';
export type { RouteRecord, RouteMeta } from './types';
