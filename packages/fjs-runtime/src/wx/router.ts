// Router for the wx target: the same surface as router/flutter.ts and
// router/web.ts, mapped onto wx.navigateTo / redirectTo / navigateBack.
// The route table is injected at build time (the shared chunk calls
// registerRoutes with every compiled page); paths resolve against it to
// mini-program page paths.
import { reactive } from '@vue/reactivity';
import { onMounted, onUnmounted } from './vue';
import type {
  RouteLocation,
  RouteLocationRaw,
  RouteMeta,
  RouteRecord,
  Router,
} from '../router/types';

export interface MpRouteRecord {
  path: string;
  name: string;
  meta: RouteMeta;
  /** The real mini-program page path relative to the miniprogram root.
   * Subpackaged pages (specs/063) live under their package root
   * (`canvas/pages/x/x`); absent for plain builds, where the historical
   * `pages/<name>/<name>` shape applies. */
  mpPage?: string;
}

let routes: MpRouteRecord[] = [];
let activeRoute: RouteLocation | null = null;

export function registerRoutes(table: MpRouteRecord[]): void {
  // idempotent: every page entry module (and the shared chunk) may register
  routes = table.slice();
}

/** Whether a mini-program page path (`pages/index/index`, leading slash
 * optional) is a tab page — the native tabBar covers the bottom inset there.
 * Published on the __fjsWx global for fjs-safe-area (a plain JS component).
 * Exact match against the table (subpackage pages carry their root in
 * mpPage); a tab page can never live in a subpackage, so unknown paths are
 * simply not tabs. */
export function isTabPagePath(pagePath: string): boolean {
  const clean = String(pagePath).replace(/^\//, '');
  const record = routes.find((r) => (r.mpPage ?? `pages/${r.name}/${r.name}`) === clean);
  return typeof record?.meta?.tab === 'number';
}
(globalThis as Record<string, unknown>).__fjsWx = {
  ...((globalThis as Record<string, unknown>).__fjsWx as object | undefined),
  isTabPagePath,
};

/** @internal — shell-page.ts. */
export function setActiveRoute(location: RouteLocation): void {
  activeRoute = location;
}

function recordFor(path: string): MpRouteRecord | undefined {
  return routes.find((r) => r.path === path);
}

function toLocation(raw: RouteLocationRaw): RouteLocation {
  const obj = typeof raw === 'string' ? { path: raw } : raw;
  let path = String(obj.path ?? '');
  if (obj.name && !path) {
    path = routes.find((r) => r.meta.name === obj.name)?.path ?? '';
  }
  if (!path.startsWith('/')) path = '/' + path;
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.query ?? {})) {
    if (v !== undefined && v !== null) query[k] = String(v);
  }
  const search = Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return {
    path,
    fullPath: search ? `${path}?${search}` : path,
    params: Object.fromEntries(Object.entries(obj.params ?? {}).map(([k, v]) => [k, String(v)])),
    query,
    meta: recordFor(path)?.meta ?? {},
  };
}

/** Route path -> mini-program page path. The compiler knows where each page
 * physically landed (a subpackaged page lives under its package root,
 * specs/063) and hands the record an `mpPage`; without one, the historical
 * `pages/<name>/<name>` shape applies (`/comp/switch` ->
 * `/pages/comp-switch/comp-switch`). */
function mpUrl(loc: RouteLocation): string {
  const record = recordFor(loc.path);
  const name = record?.name ?? loc.path.slice(1).replace(/\//g, '-');
  const page = record?.mpPage ?? `pages/${name}/${name}`;
  const search = loc.fullPath.includes('?') ? '?' + loc.fullPath.split('?')[1] : '';
  return `/${page}${search}`;
}

function navigate(loc: RouteLocation, mode: 'navigateTo' | 'redirectTo'): Promise<void> {
  // a tab page can only be reached with switchTab — and switchTab takes no
  // query (tab pages are singletons, there is nobody to receive it)
  if (typeof loc.meta?.tab === 'number') {
    if (loc.fullPath.includes('?')) {
      console.warn(`[fjs/wx] query is dropped when switching to tab page ${loc.path}`);
    }
    return new Promise((resolve, reject) => {
      wx.switchTab({
        url: mpUrl(loc).split('?')[0],
        success: () => resolve(),
        fail: (res: { errMsg?: string }) => reject(new Error(res.errMsg ?? 'switchTab failed')),
      });
    });
  }
  return new Promise((resolve, reject) => {
    wx[mode]({
      url: mpUrl(loc),
      success: () => resolve(),
      fail: (res: { errMsg?: string }) => reject(new Error(res.errMsg ?? 'navigate failed')),
    });
  });
}

export function createRouter(): Router & { start(): void } {
  const currentRoute = reactive<RouteLocation>({
    path: '/',
    fullPath: '/',
    params: {},
    query: {},
    meta: {},
  });
  return {
    // currentRoute on wx is the active page's location object (kept in sync
    // by the page wrapper); the reactive stub keeps the type shape honest
    get currentRoute(): RouteLocation {
      return activeRoute ?? currentRoute;
    },
    get routes(): RouteRecord[] {
      return routes.map((r) => ({
        path: r.path,
        name: r.name,
        meta: r.meta,
      }));
    },
    push: (to) => navigate(toLocation(to), 'navigateTo'),
    replace: (to) => navigate(toLocation(to), 'redirectTo'),
    back: () => wx.navigateBack({ delta: 1 }),
    go: (delta) => {
      if (delta < 0) wx.navigateBack({ delta: -delta });
      else console.warn('[fjs/wx] router.go() only supports negative deltas');
    },
    resolve: (to) => toLocation(to),
    start: () => {},
  };
}

let router: ReturnType<typeof createRouter> | null = null;

export function useRouter(): Router {
  router ??= createRouter();
  return router;
}

export function useRoute(): RouteLocation {
  return useRouter().currentRoute;
}

/** onPageSettled on wx. The mini program exposes no "push transition
 * finished" event, so the closest honest point is the first render being on
 * screen (onMounted — a page's onReady, a component's ready) plus one
 * macrotask. The contract the other two ends keep still holds: always
 * asynchronous, at most once, never after the page unmounted. Call it from
 * setup(), like every lifecycle registrar. */
export function onPageSettled(cb: () => void): void {
  let done = false;
  onMounted(() =>
    setTimeout(() => {
      if (done) return;
      done = true;
      cb();
    }, 0),
  );
  onUnmounted(() => {
    done = true;
  });
}
