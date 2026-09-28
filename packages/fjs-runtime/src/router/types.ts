// Shared router types. The same surface is implemented twice: once on top
// of the native Flutter Navigator (router/flutter.ts) and once on top of
// vue-router (router/web.ts). App code imports 'fjs/router' and the build
// aliases it to the right one, so a page never knows which platform it is
// running on.
import type { Component } from '@vue/runtime-core';

export interface RouteMeta {
  /** Title shown by the app shell / navigation bar. */
  title?: string;
  /** Root-level page reachable from a tab bar (no back button). */
  tab?: number;
  /** How this page comes and goes. `false` means no transition at all —
   * on Flutter the native route is pushed without one, on web the page
   * swaps with no animation. A string is a web CSS transition name and is
   * ignored on Flutter, which only has the platform's own transition.
   * The page that *moves* decides: the one being pushed, and on the way
   * back the one being popped. */
  transition?: string | false;
  [key: string]: unknown;
}

/** What a navigation is, for [TransitionResolver]. `tab` is a replace
 * between two tab pages, `initial` the app's first page. */
export type NavKind = 'initial' | 'push' | 'replace' | 'pop' | 'tab';

export interface Navigation {
  to: RouteLocation;
  from: RouteLocation;
  kind: NavKind;
}

/** App-level transition setting: a web CSS transition name, `false` for no
 * animation anywhere, or a function deciding per navigation. Returning
 * `false` from the function is the same `false`; on Flutter any string
 * means "the platform's transition". */
export type TransitionOption =
  | string
  | false
  | ((nav: Navigation) => string | false);

/** One entry of the generated route table (see `fjs/pages`). */
export interface RouteRecord {
  path: string;
  name?: string;
  meta?: RouteMeta;
  /** Web builds: the page component (sync or `() => import(...)`). */
  component?: Component | (() => Promise<unknown>);
  /** Flutter builds: id of the page chunk to evaluate before mounting. */
  chunk?: string;
}

export interface RouteLocation {
  path: string;
  /** path + query string, the identity used for history entries. */
  fullPath: string;
  name?: string;
  params: Record<string, string>;
  query: Record<string, string>;
  meta: RouteMeta;
}

declare global {
  /** Route name -> route path, for the whole app. Empty here on purpose:
   * `fjs` generates an augmentation of it into the project's
   * `src/fjs-routes.d.ts`, which is what turns `push({ name })` into a
   * checked union and makes paths autocomplete. A project that never
   * generates it keeps plain strings — every type below falls back. */
  interface FjsRoutes {}
}

/** Names in the generated table, or `string` when there is no table. */
export type RouteName = keyof FjsRoutes extends never
  ? string
  : Extract<keyof FjsRoutes, string>;

/** Paths in the generated table, or `string` when there is no table. */
export type RoutePath = keyof FjsRoutes extends never
  ? string
  : Extract<FjsRoutes[keyof FjsRoutes], string>;

/** Suggests the table's paths without rejecting anything else: a dynamic
 * route is pushed as a filled-in path (`/user/7`), which by definition is
 * not one of the declared patterns (`/user/:id`). */
export type RoutePathRaw = RoutePath | (string & {});

export type RouteLocationRaw =
  | RoutePathRaw
  | {
      path?: RoutePathRaw;
      name?: RouteName;
      params?: Record<string, string | number>;
      query?: Record<string, string | number | undefined | null>;
    };

export interface Router {
  /** The active route. Reactive; also injected per page (see useRoute). */
  readonly currentRoute: RouteLocation;
  readonly routes: RouteRecord[];
  /** Pushes a new page. Flutter: a native Navigator push (animated, with
   * the platform's back gesture). Web: router.push. */
  push(to: RouteLocationRaw): Promise<void>;
  /** Replaces the current page in place (what a tab switch wants). */
  replace(to: RouteLocationRaw): Promise<void>;
  back(): void;
  /** Only negative deltas are supported on Flutter (no forward stack). */
  go(delta: number): void;
  resolve(to: RouteLocationRaw): RouteLocation;
  /** Loads a page's code ahead of opening it, so the open itself only
   * mounts. Flutter: the page chunk is read and evaluated (its build-time
   * style snapshot is still imported at the open); web: the page module's
   * dynamic import. Resolves once that is done — at once for a page already loaded,
   * a path no route matches, or a mini program. Call it where a navigation
   * is about to happen, e.g. on touchstart of the thing that will push. */
  preload(to: RouteLocationRaw): Promise<void>;
}

export interface RouterOptions {
  routes: RouteRecord[];
  /** Wraps every page: gets a `route` prop and the page in its default
   * slot. Usually the app shell (navigation bar + tab bar). */
  shell?: Component;
  /** Where to start. Default '/'. */
  initial?: string;
  /** Load every page's code in idle time once the first page has settled
   * (specs/143). Default true; `false` leaves only router.preload(). */
  preload?: boolean;
}
