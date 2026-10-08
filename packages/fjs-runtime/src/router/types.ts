// Shared router types. The same surface is implemented twice: once on top
// of the native Flutter Navigator (router/flutter.ts) and once on top of
// vue-router (router/web.ts). App code imports 'fjs/router' and the build
// aliases it to the right one, so a page never knows which platform it is
// running on.
import type { Component } from '@vue/runtime-core';
import type { GlobalComponentEntry } from '../app/global-components';

export interface RouteMeta {
  /** Title shown by the app shell / navigation bar. */
  title?: string;
  /** Root-level page reachable from a tab bar (no back button). */
  tab?: number;
  /** `false` hides the global tab bar on this page (a full-screen player or
   * game). Only read when the app passed `tabBar` to createFjsApp; the bar
   * is persistent otherwise — pushed pages keep it (specs/210). */
  tabBar?: boolean;
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
   * mounts. Flutter: the page chunk is read and evaluated; web: the page
   * module's dynamic import. Resolves once that is done — at once for a page already loaded,
   * a path no route matches, or a mini program. Call it where a navigation
   * is about to happen, e.g. on touchstart of the thing that will push. */
  preload(to: RouteLocationRaw): Promise<void>;
}

/** The global tab bar (specs/210): `createFjsApp({ tabBar })` mounts the
 * component ONCE, outside the page trees, where pushes cannot cover it —
 * the App Store shape. Without the option nothing changes: the shell keeps
 * rendering whatever tab bar it wants, per page. */
export interface TabBarOptions {
  /** The tab bar component. Receives `tabs` (the route table's tab pages,
   * `{ path, title, tab }` sorted by tab) and `active` (the tab branch the
   * user is in — sticky across pushes, `null` before any tab page) as
   * props; switching stays `router.replace(path)`, which parks the leaving
   * tab exactly as before. */
  component: Component;
}

export interface RouterOptions {
  routes: RouteRecord[];
  /** Wraps every page: gets a `route` prop and the page in its default
   * slot. Usually the app shell (navigation bar + tab bar). */
  shell?: Component;
  /** The global tab bar (specs/210). Consumed by createFjsApp, which mounts
   * it above the page trees; the routers themselves ignore it. Ignored on
   * the mini program build, which keeps the native tabBar generated from
   * `meta.tab`. */
  tabBar?: TabBarOptions;
  /** Global components (specs/211): Vue SFCs mounted once, above every page
   * (and above a pushed page), shown on all routes unless `include` /
   * `exclude` narrow it. Consumed by createFjsApp; ignored on the mini
   * program build and with enableVapor (warned). */
  globalComponents?: GlobalComponentEntry[];
  /** Where to start. Default '/'. */
  initial?: string;
  /** Load every page's code in idle time once the first page has settled
   * (specs/143). Default true; `false` leaves only router.preload(). */
  preload?: boolean;
}
