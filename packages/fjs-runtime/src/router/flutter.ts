// Router for Flutter targets: every page is a real Flutter Navigator route,
// so the platform's back gesture and page transition come for free. This
// module only owns the JS half — creating a root element per page, mounting
// the page component into it and tearing it down when the native navigator
// says the route is gone.
//
// Wire protocol (all through the existing host/event channels):
//   JS -> Dart   invokeHost('fjs.nav.push'    , key, fullPath, title, chunk, anim)
//                invokeHost('fjs.nav.replace' , key, fullPath, title, chunk, anim)
//                invokeHost('fjs.nav.pop')
//   Dart -> JS   dispatchEvent(key, 10 /* navMount */)  chunk is in the VM,
//                                                       mount the page now
//                dispatchEvent(key, 11 /* navPop */)    route is gone
//
// The page component itself lives in a separate chunk (`fjs build --pages`);
// Dart loads it before sending navMount, which is why mounting is always
// driven by the callback instead of happening inline in push().
//
// Tab pages (`meta.tab` is a number) are the one thing that is not torn
// down: switching between two of them parks the leaving page — its app
// stays mounted and its root only goes offstage (`__navHidden`) — so the
// tab is found exactly as it was left, the way a mini program's tabBar
// behaves. Leaving the tab group for any other page drops the parked
// pages with it.
import {
  getCurrentInstance,
  inject,
  reactive,
  type App,
  type Component,
} from '@vue/runtime-core';
// host primitives only (specs/169): the Vue renderer (createApp) is reached
// through the injected VDOM page mounter, so a pure-vapor build of this
// router carries no rendering engine
import { flutterRoot, releaseRoot } from '../vue/host-ops';
// enableVapor (specs/166): a vapor page mounts through the own runtime
import { createVaporApp, isVaporComponent, withVaporShell, type VaporAppContext } from '../vapor/runtime';
// specs/167: a vapor page's useRoute/useRouter/onPageSettled inject through
// the vapor provides the mount below hands the page
import { hasVaporInjectionContext, inject as vaporInject } from '../vapor/instance';
import { remove, setProps, registerSystemHandler, type Element } from '../ui/element';
import { hasNativeHost, invokeHost } from '../host';
import { invokeHostAsync } from '../host-async';
import { Matcher } from './match';
import { startPreloadQueue, type PreloadQueue } from './preload-queue';
import { PAGE_TRANSITION, resolveTransition } from './transition';
import type {
  NavKind,
  RouteLocation,
  RouteLocationRaw,
  Router,
  RouterOptions,
  TransitionOption,
} from './types';

const EVENT_NAV_MOUNT = 10;
const EVENT_NAV_POP = 11;
/** The route's push transition finished (fjs.h FJS_EVENT_NAV_SETTLED). */
const EVENT_NAV_SETTLED = 31;
/** How long to wait for [EVENT_NAV_SETTLED] before assuming it is not
 * coming. A page that never settles never does its deferred work, which
 * looks like a blank chart with no error — so we give up loudly instead
 * (constitution V). Comfortably longer than any platform transition. */
const SETTLE_FALLBACK_MS = 1000;
// dev only: `fjs dev` re-evaluated one page chunk, payload is its name
const EVENT_DEV_PAGE_RELOAD = 13;

export const ROUTER_KEY = Symbol.for('fjs.router');
export const ROUTE_KEY = Symbol.for('fjs.route');
/** The calling component's own page entry, so onPageSettled() knows which
 * page it is being asked about. */
export const PAGE_KEY = Symbol.for('fjs.page');

/** What mounting a VDOM page needs (router/flutter-vdom.ts implements it). */
export interface VdomPageMount {
  page: Component | undefined;
  root: Element;
  route: RouteLocation;
  shell: unknown;
  provides: [symbol, unknown][];
  onCreateApp?: (app: App) => void;
}
type VdomPageMounter = (mount: VdomPageMount) => { unmount: () => void };
let vdomPageMounter: VdomPageMounter | null = null;

/** Registers how VDOM pages mount (specs/169). app/flutter.ts does it at
 * module init; the enableVapor app (app/flutter-vapor.ts) never does, which
 * is what keeps the Vue renderer out of its bundle. */
export function setVdomPageMounter(mounter: VdomPageMounter): void {
  vdomPageMounter = mounter;
}

// ---- page registry ---------------------------------------------------------

interface PageRegistry {
  [path: string]: Component;
}

/** Page chunks register themselves here as they are evaluated into the VM. */
function registry(): PageRegistry {
  const g = globalThis as unknown as { __FJS_PAGES?: PageRegistry };
  return (g.__FJS_PAGES ??= {});
}

/** Called by the page-chunk entry the CLI generates. */
export function definePage(path: string, component: Component): void {
  registry()[path] = component;
}

/** Pages of a single bundle (and `fjs dev`), evaluated on first open. */
const pageLoaders: Record<string, () => Component> = {};

/** Called by the single bundle's generated route table: the page module
 * runs the first time the page opens, as a split build's chunk does. Were
 * every page imported up front, `fjs/pages` would run before `fjs/plugins`
 * (main.ts imports it first) and each page's scoped sheet would register
 * ahead of the library styles the plugins pull in (vant) — the reverse of
 * the split build, so an equal-specificity override could win in one build
 * and lose in the other (specs/121). */
export function definePageLoader(path: string, load: () => Component): void {
  pageLoaders[path] = load;
}

/** The page's code is in the VM (a chunk registered it, or a single-bundle
 * loader already ran). */
function pageLoaded(path: string): boolean {
  return registry()[path] !== undefined;
}

export function pageComponent(path: string): Component | undefined {
  const pages = registry();
  let page = pages[path];
  const load = pageLoaders[path];
  if (page === undefined && load !== undefined) {
    delete pageLoaders[path];
    page = pages[path] = load();
  }
  return page;
}

// ---- router ----------------------------------------------------------------

interface PageEntry {
  key: number;
  location: RouteLocation;
  route: RouteLocation; // reactive copy handed to the page
  root: Element | null;
  /** the page's app — a Vue app (vdom page) or `{ unmount }` (a vapor page,
   * enableVapor mode, specs/166); teardown only ever unmounts */
  app: { unmount: () => void } | null;
  /** The route's push transition is over (or there never was one), so the
   * page may do work that would have janked the animation. */
  settled: boolean;
  /** onPageSettled() callbacks still waiting for that. */
  waiting: (() => void)[];
  settleTimer: ReturnType<typeof setTimeout> | null;
}

export interface FlutterRouterOptions extends RouterOptions {
  /** Tag of each page's root element. Default `view`. */
  rootTag?: string;
  /** Hook to configure every page's Vue app (plugins, error handler). */
  onCreateApp?: (app: App) => void;
  /** specs/166: every page is a Vapor SFC — pages mount through the vapor
   * runtime (`createVaporApp` into the page root) instead of a per-page
   * Vue app, and the compile-time wrapper is not generated. `onCreateApp`
   * does not run (there is no Vue app); global components resolve through
   * the app context instead. */
  enableVapor?: boolean;
  /** The vapor app context (enableVapor, specs/167): global components (the
   * built-in fjs set plus the app's) and app-level provides — what the app
   * shell's `app.provide` / plugins wrote. Every vapor page mounts with a
   * context of its own that inherits these provides. */
  vaporContext?: VaporAppContext;
  /** Page transition. The names in `TRANSITIONS` ('fjs-fade',
   * 'fjs-slide', 'fjs-slide-up', 'fjs-zoom') are native page routes here
   * and the matching CSS families on web, so the same name animates the
   * same way on both. The default, 'fjs-page', is the *platform's* own
   * transition (Cupertino on iOS, the theme's builder on Android) — pick
   * one of the named ones when iOS and Android should match. Any other
   * string is a web CSS name and falls back to the platform transition
   * here. `false` (or `meta.transition: false`) pushes the route with no
   * animation at all. */
  transition?: TransitionOption;
}

class FlutterRouter implements Router {
  readonly routes;
  readonly currentRoute: RouteLocation;

  private matcher: Matcher;
  private stack: PageEntry[] = [];
  private nextKey = 1;
  private pending = new Map<number, { entry: PageEntry; replaceKey?: number }>();
  /** Tab pages kept alive across a tab switch, by path. */
  private parked = new Map<string, PageEntry>();
  /** Idle-time preloading (specs/143): armed by start(), launched by the
   * first page to settle. */
  private preloadArmed = false;
  private preloadQueue: PreloadQueue | null = null;

  constructor(private options: FlutterRouterOptions) {
    this.routes = options.routes;
    this.matcher = new Matcher(options.routes);
    this.currentRoute = reactive(blankLocation()) as RouteLocation;
    registerSystemHandler(EVENT_NAV_MOUNT, (key) => this.onNavMount(key));
    registerSystemHandler(EVENT_NAV_POP, (key) => this.onNavPop(key));
    registerSystemHandler(EVENT_NAV_SETTLED, (key) => this.onNavSettled(key));
    registerSystemHandler(EVENT_DEV_PAGE_RELOAD, (_key, chunk) =>
      this.onDevPageReload(chunk ?? ''),
    );
  }

  resolve(to: RouteLocationRaw): RouteLocation {
    return this.matcher.resolve(to);
  }

  /** Mounts the initial page into the base root. Called by createFjsApp.
   * Goes through replace() so the initial page is chunk-loaded like any
   * other one. */
  /** Mounts the initial page into the base root. Called by createFjsApp.
   * Goes through replace() so the initial page is chunk-loaded like any
   * other one. */
  start(): void {
    this.preloadArmed = this.options.preload !== false;
    void this.replace(this.options.initial ?? '/');
  }

  preload(to: RouteLocationRaw): Promise<void> {
    return this.preloadPage(this.resolve(to), false);
  }

  /** Gets `location`'s page code into the VM without mounting it. `idle`:
   * wait until the host says the app is idle (the automatic queue); a direct
   * preload() is made at the moment a navigation is about to happen and must
   * not wait. Keyed by location.path, as mount() looks the page up.
   *
   * The page's style snapshot is deliberately NOT imported here: nothing
   * references the imported cache entries until the page mounts, so they sit
   * in the style engine's retired-chain queue (RETIRED_CHAIN_LIMIT, first in
   * first out). A dozen pages' snapshots evict each other, and — the epoch
   * unchanged — mount would not import again: the page opened cold, slower
   * than with no preload at all (specs/143 plan §3.5). mount() imports it,
   * 2–3 ms right before it is used. */
  private async preloadPage(location: RouteLocation, idle: boolean): Promise<void> {
    const record = this.matcher.record(location.path);
    if (!record) return;
    const path = location.path;
    if (!pageLoaded(path) && hasNativeHost) {
      // A split build's chunk is evaluated by the host. A single bundle's
      // page runs below, in pageComponent(); '' only asks for the idle wait.
      await invokeHostAsync('fjs.nav.preload', record.chunk ?? '', idle);
    }
    pageComponent(path);
  }

  /** Every static route's code, in table order, once the first page has
   * settled. */
  private startPreloadQueue(): void {
    if (!this.preloadArmed || this.preloadQueue) return;
    this.preloadQueue = startPreloadQueue(staticPaths(this.options.routes), (p) =>
      this.preloadPage(this.resolve(p), true),
    );
  }

  async push(to: RouteLocationRaw): Promise<void> {
    const location = this.resolve(to);
    if (!hasNativeHost) {
      // headless (fjsrun / tests): no navigator, so swap in place
      return this.replace(to);
    }
    const key = this.nextKey++;
    const anim = this.animationOf(location, 'push');
    const entry = this.newEntry(key, location, anim !== 'none');
    this.pending.set(key, { entry });
    invokeHost(
      'fjs.nav.push',
      key,
      location.fullPath,
      String(location.meta.title ?? ''),
      this.chunkOf(location),
      anim,
    );
  }

  async replace(to: RouteLocationRaw): Promise<void> {
    const location = this.resolve(to);
    const current = this.stack[this.stack.length - 1];
    if (!current || current.key === 0 || !hasNativeHost) {
      // replacing the base page: no navigator involved, remount in place —
      // except between two tab pages, where the leaving one is parked and
      // the arriving one, if it was parked before, comes back as it was
      if (current && isTabRoute(current.location) && isTabRoute(location)) {
        this.park(current);
      } else {
        this.teardown(current);
        this.dropParked();
      }
      const parked = isTabRoute(location) ? this.parked.get(location.path) : undefined;
      if (parked) {
        this.parked.delete(location.path);
        if (parked.location.fullPath === location.fullPath) {
          this.stack = [parked];
          this.unpark(parked);
          Object.assign(this.currentRoute, parked.location);
          return;
        }
        // same tab, different query: the parked copy is stale
        this.teardown(parked);
      }
      // the base page is not a Navigator route: nothing animates it
      const entry = this.newEntry(0, location, false);
      this.stack = [entry];
      const chunk = this.chunkOf(location);
      if (chunk && !pageComponent(location.path) && hasNativeHost) {
        // the base page lives in a chunk that is not in the VM yet
        this.pending.set(0, { entry });
        invokeHost('fjs.nav.load', 0, location.fullPath, chunk);
        return;
      }
      this.mount(entry);
      return;
    }
    const key = this.nextKey++;
    const anim = this.animationOf(location, 'replace');
    const entry = this.newEntry(key, location, anim !== 'none');
    this.pending.set(key, { entry, replaceKey: current.key });
    invokeHost(
      'fjs.nav.replace',
      key,
      location.fullPath,
      String(location.meta.title ?? ''),
      this.chunkOf(location),
      anim,
    );
  }

  back(): void {
    if (this.stack.length <= 1) return;
    if (!hasNativeHost) {
      this.onNavPop(this.stack[this.stack.length - 1].key);
      return;
    }
    invokeHost('fjs.nav.pop');
  }

  go(delta: number): void {
    if (delta >= 0) {
      console.warn('[fjs-router] forward navigation is not available on Flutter');
      return;
    }
    for (let i = 0; i < -delta; i++) this.back();
  }

  // ---- internals -----------------------------------------------------------

  private chunkOf(location: RouteLocation): string {
    const record = this.matcher.record(location.path);
    return record?.chunk ?? '';
  }

  /** The transition name for the host: '' = the platform's own, 'none' =
   * no animation, otherwise one of TRANSITIONS (an unknown name reaches
   * Dart too and falls back there). A pop is the mirror of the push that
   * put the route there, so the native side needs no second answer for the
   * way back. */
  private animationOf(location: RouteLocation, kind: NavKind): string {
    const from = this.stack[this.stack.length - 1]?.location ?? blankLocation();
    const resolved = resolveTransition(this.options.transition, {
      to: location,
      from,
      kind,
    });
    if (resolved === false) return 'none';
    return resolved === PAGE_TRANSITION ? '' : resolved;
  }

  /** `animated` is what we told the host: a route with a real transition
   * has to wait for EVENT_NAV_SETTLED, anything else (the base page, a tab
   * swap, `transition: false`) is settled the moment it exists. Getting
   * this wrong in the "not animated" direction would make every such page
   * sit on the 1s fallback — worse than not having the feature. */
  private newEntry(key: number, location: RouteLocation, animated: boolean): PageEntry {
    return {
      key,
      location,
      route: reactive({ ...location }) as RouteLocation,
      root: null,
      app: null,
      settled: !animated,
      waiting: [],
      settleTimer: null,
    };
  }

  /** Dart says the push transition for `key` is over. */
  private onNavSettled(key: number): void {
    const entry = this.stack.find((e) => e.key === key) ?? this.pending.get(key)?.entry;
    if (entry) this.markSettled(entry);
  }

  private markSettled(entry: PageEntry, viaFallback = false): void {
    if (entry.settled) return;
    entry.settled = true;
    if (entry.settleTimer !== null) {
      clearTimeout(entry.settleTimer);
      entry.settleTimer = null;
    }
    if (viaFallback) warnSettleFallback(entry.location.fullPath);
    const waiting = entry.waiting;
    entry.waiting = [];
    for (const cb of waiting) queueMicrotask(cb);
  }

  /** Subscribes `cb` to `entry` settling. Always asynchronous, even when the
   * page has already settled: a page calling this from setup() must be able
   * to finish its own initialisation first. */
  subscribeSettled(entry: PageEntry, cb: () => void): void {
    if (entry.settled) {
      queueMicrotask(cb);
      return;
    }
    entry.waiting.push(cb);
  }

  /** The entry a component belongs to, or the top of the stack for a
   * module-level caller. */
  topEntry(): PageEntry | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** Dart finished loading the page chunk for `key`. */
  private onNavMount(key: number): void {
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    const { entry, replaceKey } = pending;
    if (replaceKey !== undefined) {
      const index = this.stack.findIndex((e) => e.key === replaceKey);
      if (index >= 0) {
        this.teardown(this.stack[index]);
        this.stack.splice(index, 1);
      }
    }
    this.stack.push(entry);
    this.mount(entry);
  }

  /** The native navigator dropped the route (back gesture, pop, or the
   * replace we asked for). */
  private onNavPop(key: number): void {
    this.pending.delete(key);
    const index = this.stack.findIndex((e) => e.key === key);
    if (index < 0) return;
    this.teardown(this.stack[index]);
    this.stack.splice(index, 1);
    const top = this.stack[this.stack.length - 1];
    if (top) Object.assign(this.currentRoute, top.location);
  }

  /** `fjs dev` rebuilt one page chunk and the host has already evaluated
   * the new copy: remount the pages that came from it so the edit shows,
   * and leave the rest of the app — other pages on the stack, their state,
   * the VM itself — alone. A chunk whose page is not on the stack needs
   * nothing: the registry already holds the new component for the next
   * time that page is opened. */
  private onDevPageReload(chunk: string): void {
    if (!chunk) return;
    // a parked page is off screen: dropping it is enough — the next switch
    // to that tab builds it from the new chunk
    for (const [path, entry] of [...this.parked]) {
      if (this.chunkOf(entry.location) !== chunk) continue;
      this.parked.delete(path);
      this.teardown(entry);
    }
    for (const entry of [...this.stack]) {
      if (this.chunkOf(entry.location) !== chunk) continue;
      this.teardown(entry);
      this.mount(entry);
    }
  }

  /** Takes a tab page off screen without unmounting it. The root element
   * stays in the tree so Flutter keeps the page's widget state (scroll
   * offsets, focus, animations) — see FjsView, which renders a hidden root
   * offstage. */
  private park(entry: PageEntry): void {
    const previous = this.parked.get(entry.location.path);
    if (previous && previous !== entry) this.teardown(previous);
    this.parked.set(entry.location.path, entry);
    if (entry.root) setProps(entry.root, { __navHidden: true });
  }

  private unpark(entry: PageEntry): void {
    if (entry.root) setProps(entry.root, { __navHidden: false });
  }

  private dropParked(): void {
    for (const entry of this.parked.values()) this.teardown(entry);
    this.parked.clear();
  }

  private mount(entry: PageEntry): void {
    const page = pageComponent(entry.location.path);
    if (!page) {
      // Dart sends navMount only after the chunk evaluated (a failed load
      // pops the route instead — engine.dart), so reaching this with a
      // chunked route means the page never registered itself: usually the
      // chunk's module init threw before definePage ran.
      console.error(
        `[fjs-router] no page registered for ${entry.location.fullPath} ` +
          `(chunk "${this.chunkOf(entry.location) || '(inline)'}" evaluated ` +
          'without calling definePage — check the chunk eval error above)',
      );
    }
    const root = flutterRoot(this.options.rootTag ?? 'view');
    // the marker the Dart navigator matches its route against
    setProps(root, { __navKey: entry.key });
    entry.root = root;

    // enableVapor (specs/166): a Vapor page mounts through the own runtime —
    // no per-page Vue app. specs/167: the page gets the same three provides
    // a vdom page's app carries, through its own vapor context (inheriting
    // the app's), and the app's (vapor) shell around it like the vdom path
    if (this.options.enableVapor && page && isVaporComponent(page)) {
      if (!entry.settled && entry.settleTimer === null) {
        entry.settleTimer = setTimeout(() => this.markSettled(entry, true), SETTLE_FALLBACK_MS);
      }
      const wrapped = withVaporShell(page, this.options.shell, () => entry.route);
      const vaporApp = createVaporApp(wrapped, this.vaporPageContext(entry));
      entry.app = vaporApp;
      vaporApp.mount(root);
      Object.assign(this.currentRoute, entry.location);
      if (this.preloadArmed && !this.preloadQueue) {
        this.subscribeSettled(entry, () => this.startPreloadQueue());
      }
      return;
    }

    // a VDOM page: its own Vue app through the injected mounter
    // (router/flutter-vdom.ts, registered by app/flutter.ts — specs/169)
    if (!vdomPageMounter) {
      throw new Error(
        `[fjs-router] ${entry.location.fullPath} is not a vapor page, and this enableVapor build carries no VDOM renderer — ` +
          'give the page `<script setup vapor>` or drop enableVapor.',
      );
    }
    if (!entry.settled && entry.settleTimer === null) {
      entry.settleTimer = setTimeout(
        () => this.markSettled(entry, true),
        SETTLE_FALLBACK_MS,
      );
    }
    entry.app = vdomPageMounter({
      page,
      root,
      route: entry.route,
      shell: this.options.shell,
      provides: [
        [ROUTER_KEY, this],
        [ROUTE_KEY, entry.route],
        [PAGE_KEY, entry],
      ],
      onCreateApp: this.options.onCreateApp,
    });
    Object.assign(this.currentRoute, entry.location);
    // Subscribed rather than hooked into markSettled: the base page is not
    // animated, is settled from birth and never passes through there.
    if (this.preloadArmed && !this.preloadQueue) {
      this.subscribeSettled(entry, () => this.startPreloadQueue());
    }
  }

  /** The context a native-mounted vapor page resolves against: the app's
   * components, and provides that inherit the app's plus this page's
   * router / route / entry (what injectOr reads on the vdom path). */
  private vaporPageContext(entry: PageEntry): VaporAppContext {
    const app = this.options.vaporContext ?? { components: {} };
    const provides = Object.create(app.provides ?? null) as Record<string | symbol, unknown>;
    provides[ROUTER_KEY] = this;
    provides[ROUTE_KEY] = entry.route;
    provides[PAGE_KEY] = entry;
    return { components: app.components, directives: app.directives, provides };
  }

  private teardown(entry: PageEntry | undefined): void {
    if (!entry) return;
    // the page is going away: whoever was waiting for the transition is not
    // getting called, and the fallback must not fire into a dead page
    if (entry.settleTimer !== null) {
      clearTimeout(entry.settleTimer);
      entry.settleTimer = null;
    }
    entry.waiting = [];
    entry.app?.unmount();
    entry.app = null;
    if (entry.root) {
      releaseRoot(entry.root);
      remove(entry.root);
    }
    entry.root = null;
  }
}

/** A tab page: reachable from the tab bar, kept alive across a switch. */
function isTabRoute(location: RouteLocation): boolean {
  return typeof location.meta.tab === 'number';
}

function blankLocation(): RouteLocation {
  return { path: '/', fullPath: '/', params: {}, query: {}, meta: {} };
}

let active: FlutterRouter | null = null;

/** Routes with one page to load: patterns (`/user/:id`, `/*`) have none. */
function staticPaths(routes: readonly { path: string }[]): string[] {
  return routes.map((r) => r.path).filter((p) => !p.includes(':') && !p.includes('*'));
}

export function createRouter(
  options: FlutterRouterOptions,
): Router & { start(): void } {
  const router = new FlutterRouter(options);
  active = router;
  return router;
}

/** inject() only works inside setup(); module-level helpers get the
 * process-wide router/route instead of an undefined. */
function injectOr<T>(key: symbol, fallback: T): T {
  if (hasVaporInjectionContext()) return vaporInject(key, fallback) as T;
  if (!getCurrentInstance()) return fallback;
  return inject<T>(key as never, fallback);
}

/** The router instance. Works outside setup() too (module-level helpers). */
export function useRouter(): Router {
  if (!active) throw new Error('useRouter(): no router — call createFjsApp first');
  return injectOr<Router>(ROUTER_KEY, active as Router);
}

let warnedSettleFallback = false;

function warnSettleFallback(path: string): void {
  if (warnedSettleFallback) return;
  warnedSettleFallback = true;
  console.warn(
    `[fjs-router] no navSettled for ${path} within ${SETTLE_FALLBACK_MS}ms — ` +
      'running onPageSettled callbacks anyway. The host should have sent ' +
      'FJS_EVENT_NAV_SETTLED when the route transition finished; if you see ' +
      'this, that is a bug, not a slow device.',
  );
}

/** Runs `cb` once this page's route transition has finished.
 *
 * Expensive first-paint work — building a chart, parsing a big payload —
 * costs frames, and during a push those are the frames the Navigator is
 * animating. Deferring it is the difference between a smooth transition and
 * a visible freeze (specs/027: three F2 charts cost ~210ms and dropped every
 * frame of the animation).
 *
 * Always asynchronous, even on a page that has already settled, so a caller
 * in setup() can finish its own initialisation first. Fires at most once,
 * and not at all once the page is unmounted.
 *
 * `<canvas>` already does this for its first `@resize`, so a charting page
 * usually needs nothing — this is for everything else. */
export function onPageSettled(cb: () => void): void {
  const router = active;
  if (!router) {
    queueMicrotask(cb);
    return;
  }
  const entry = injectOr<PageEntry | undefined>(PAGE_KEY, undefined) ?? router.topEntry();
  if (!entry) {
    queueMicrotask(cb);
    return;
  }
  router.subscribeSettled(entry, cb);
}

/** The route of the page the calling component belongs to. */
export function useRoute(): RouteLocation {
  const fallback = active?.currentRoute ?? blankLocation();
  return injectOr<RouteLocation>(ROUTE_KEY, fallback);
}

export type {
  RouteLocation,
  RouteLocationRaw,
  RouteName,
  RoutePath,
  Router,
  RouterOptions,
} from './types';
export type { RouteRecord, RouteMeta } from './types';
