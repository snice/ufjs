// 'fjs/router' for an enableVapor web build (specs/173): the same surface as
// router/web.ts, over the history router (router/web-history.ts) instead of
// vue-router — the CLI aliases it here so vue-router never enters the
// bundle. Pages are vapor: everything they ask comes through the provides
// the shell hands each page (ROUTER_KEY / ROUTE_KEY, the Flutter router's
// symbols), with the active router as the fallback outside a page.
import { hasVaporInjectionContext, inject as vaporInject } from '../vapor/instance';
import { onPageSettled, setPagePathResolver } from './settled';
import { activeHistoryRouter, createHistoryRouter } from './web-history';
import type { RouteLocation, Router } from './types';

/** Same values as router/web.ts and router/flutter.ts (Symbol.for). */
export const ROUTER_KEY = Symbol.for('fjs.router');
export const ROUTE_KEY = Symbol.for('fjs.route');

setPagePathResolver(() => {
  if (hasVaporInjectionContext()) {
    const route = vaporInject(ROUTE_KEY, null) as { fullPath?: string } | null;
    if (route?.fullPath !== undefined) return route.fullPath;
  }
  return activeHistoryRouter()?.currentRoute.fullPath;
});

export { onPageSettled };
export { createHistoryRouter as createRouter };

export function useRouter(): Router {
  if (hasVaporInjectionContext()) {
    const provided = vaporInject(ROUTER_KEY, null) as Router | null;
    if (provided) return provided;
  }
  const router = activeHistoryRouter();
  if (!router) throw new Error('useRouter(): no router — call createFjsApp first');
  return router;
}

/** This page's route (a reactive copy the shell provided); outside a page,
 * the router's current route. */
export function useRoute(): RouteLocation {
  if (hasVaporInjectionContext()) {
    const provided = vaporInject(ROUTE_KEY, null) as RouteLocation | null;
    if (provided) return provided;
  }
  const router = activeHistoryRouter();
  if (!router) throw new Error('useRoute(): no router — call createFjsApp first');
  return router.currentRoute;
}

/** No-op on web: page components are imported by the generated route
 * table instead of registering themselves from a chunk. */
export function definePage(): void {}

export type { HistoryRouter, HistoryRouterOptions } from './web-history';
export type {
  RouteLocation,
  RouteLocationRaw,
  RouteName,
  RoutePath,
  Router,
  RouterOptions,
} from './types';
export type { RouteRecord, RouteMeta } from './types';
