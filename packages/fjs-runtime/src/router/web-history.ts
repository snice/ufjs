// The enableVapor web router (specs/173): the browser history driven
// directly, instead of vue-router. The vapor shell (app/web-vapor.ts) never
// installed vue-router on an app — no <router-view>, no guards, no nested
// routes — and matching was already ours (router/match.ts, shared with
// Flutter). What is left is small: read / write the address in hash or
// history mode, follow popstate, load the page's lazy module before the
// switch, and keep `current` as the one reactive source the shell tracks.
//
// Kept compatible with what vue-router did for these apps: the same URLs,
// `history.state.position` (historyEntryKey reads it), unmatched paths
// redirecting to `initial`, the window scroll reset / restore.
import { shallowRef, type ShallowRef } from '@vue/reactivity';
import { Matcher } from './match';
import { startPreloadQueue } from './preload-queue';
import { whenSettled } from './settled';
import { isComponentFunction, preloadRecord, whenBrowserIdle } from './web-preload';
import type { RouteLocation, RouteLocationRaw, RouteRecord, Router, RouterOptions } from './types';

export interface HistoryRouterOptions extends RouterOptions {
  /** 'hash' (default) works on any static host; 'history' needs a server
   * rewrite to index.html. */
  history?: 'hash' | 'history';
  /** Base path: the document path in 'history' mode, the part before `#`
   * in 'hash' mode (default: the current document). */
  base?: string;
}

/** What the router is showing: the location and its loaded page
 * component (undefined when the table has no component for it). */
export interface CurrentPage {
  location: RouteLocation;
  component: unknown;
  /** The history entry's position (history.state.position). */
  position: number;
}

export interface HistoryRouter extends Router {
  /** The page on screen; null until start() has run the first navigation. */
  readonly current: ShallowRef<CurrentPage | null>;
  /** Listens to popstate and opens the page the address names. */
  start(): Promise<void>;
}

type NavKind = 'push' | 'replace' | 'pop';

let active: HistoryRouter | null = null;

/** The router createHistoryRouter last built (fjs/router's useRouter). */
export function activeHistoryRouter(): HistoryRouter | null {
  return active;
}

export function createHistoryRouter(options: HistoryRouterOptions): HistoryRouter {
  const matcher = new Matcher(options.routes);
  const initial = options.initial ?? '/';
  const hashMode = options.history !== 'history';
  const base = hashMode ? options.base ?? '' : (options.base ?? '').replace(/\/+$/, '');
  const hasCatchAll = options.routes.some((r) => r.path === '/*');
  const hasRoot = options.routes.some((r) => r.path === '/');
  const current = shallowRef<CurrentPage | null>(null);
  /** Resolved page modules by record — a revisit switches synchronously. */
  const loaded = new Map<RouteRecord, unknown>();
  /** Window scroll per history position, saved when its page is left. */
  const scrolls = new Map<number, { left: number; top: number }>();
  let position = 0;
  let navId = 0;

  const readAddress = (): string => {
    let raw: string;
    if (hashMode) {
      raw = location.hash.replace(/^#/, '');
    } else {
      const path = location.pathname;
      raw = (base && path.startsWith(base) ? path.slice(base.length) : path) + location.search;
    }
    if (!raw.startsWith('/')) raw = '/' + raw;
    try {
      // the address bar carries percent-encoding; pushed paths do not
      return decodeURI(raw);
    } catch {
      return raw;
    }
  };

  const href = (fullPath: string): string => (hashMode ? `${base}#${fullPath}` : `${base}${fullPath}`);

  /** The location `to` lands on, after the two redirects the vue-router
   * table used to carry: `/` → initial when the table has no `/`, and any
   * unmatched path → initial unless the app ships its own `/*` page. */
  const land = (to: RouteLocationRaw): RouteLocation => {
    const loc = matcher.resolve(to);
    // an explicit `/` record in the old table: it beats a `/*` page
    if (loc.path === '/' && initial !== '/' && !hasRoot) return matcher.resolve(initial);
    if (matcher.record(loc.path)) return loc;
    return hasCatchAll ? loc : matcher.resolve(initial);
  };

  const loadPage = async (loc: RouteLocation): Promise<unknown> => {
    const record = matcher.record(loc.path);
    if (!record) return undefined;
    if (loaded.has(record)) return loaded.get(record);
    let comp: unknown = record.component;
    if (typeof comp === 'function' && !isComponentFunction(comp)) {
      const mod = (await (comp as () => Promise<unknown>)()) as { default?: unknown } | null;
      comp = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
    }
    loaded.set(record, comp);
    return comp;
  };

  const scrollWindow = (to: { left: number; top: number }): void => {
    // after the shell has swapped the page in (its effect runs in a
    // microtask): a restored offset must land on the arriving page
    const apply = () => {
      if (typeof window.scrollTo === 'function') window.scrollTo(to.left, to.top);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    else setTimeout(apply, 0);
  };

  const navigate = async (to: RouteLocationRaw, kind: NavKind, popPosition = 0): Promise<void> => {
    const id = ++navId;
    const loc = land(to);
    if (kind !== 'pop' && current.value?.location.fullPath === loc.fullPath) return;
    const component = await loadPage(loc);
    // a later navigation started while this page was loading: it wins
    if (id !== navId) return;
    if (current.value) scrolls.set(position, { left: window.scrollX ?? 0, top: window.scrollY ?? 0 });
    if (kind === 'pop') {
      position = popPosition;
      // an address that redirected (or a hand-edited hash with no state)
      // gets its entry rewritten, as vue-router did
      if (readAddress() !== loc.fullPath || (history.state as { position?: unknown } | null)?.position !== position) {
        history.replaceState({ ...(history.state ?? {}), position }, '', href(loc.fullPath));
      }
    } else if (kind === 'push') {
      position += 1;
      history.pushState({ position }, '', href(loc.fullPath));
    } else {
      history.replaceState({ ...(history.state ?? {}), position }, '', href(loc.fullPath));
    }
    current.value = { location: loc, component, position };
    const restore = kind === 'pop' ? scrolls.get(position) : undefined;
    scrollWindow(restore ?? { left: 0, top: 0 });
  };

  const onPopState = (e: PopStateEvent): void => {
    const state = e.state as { position?: unknown } | null;
    // no position: a new entry the browser made itself (an edited hash)
    const pos = typeof state?.position === 'number' ? state.position : position + 1;
    void navigate(readAddress(), 'pop', pos);
  };

  const router: HistoryRouter = {
    current,
    routes: options.routes,
    get currentRoute(): RouteLocation {
      return current.value?.location ?? land(readAddress());
    },
    push: (to) => navigate(to, 'push'),
    replace: (to) => navigate(to, 'replace'),
    back: () => history.back(),
    go: (delta) => history.go(delta),
    resolve: (to) => matcher.resolve(to),
    preload: (to) => preloadRecord(matcher, to),
    async start() {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      const state = history.state as { position?: unknown } | null;
      position = typeof state?.position === 'number' ? state.position : 0;
      window.addEventListener('popstate', onPopState);
      await navigate(readAddress(), 'replace');
      if (options.preload !== false && current.value) {
        // the web half of specs/143: once the first page has settled, pull
        // every page module down in idle time so a navigation only renders
        whenSettled(current.value.location.fullPath, () => {
          const paths = options.routes.map((r) => r.path).filter((p) => !p.includes(':') && !p.includes('*'));
          startPreloadQueue(paths, async (p) => {
            await whenBrowserIdle();
            await preloadRecord(matcher, p);
          });
        });
      }
    },
  };
  active = router;
  return router;
}
