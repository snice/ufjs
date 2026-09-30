// createFjsApp for web targets. Builds a normal Vue 3 DOM app: vue-router
// for navigation (so the browser's back button and the URL work), the fjs
// tag set registered as components, and the app shell wrapping
// <router-view> exactly like it wraps a page on Flutter.
import {
  KeepAlive,
  Transition,
  createApp as createVueApp,
  defineComponent,
  h,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  type App,
  type Component,
  type VNode,
} from 'vue';
import { RouterView, type Router as VueRouter } from 'vue-router';
import { createRouter, type WebRouterOptions } from '../router/web';
import { NO_TRANSITION, resolveTransition } from '../router/transition';
import {
  beginPageTransition,
  cancelPageTransition,
  markPageSettled,
} from '../router/settled';
import { installFjsWeb } from '../web/index';
import { applyPlugins, type FjsPlugin } from './plugin';
import type {
  NavKind,
  Navigation,
  RouteLocation,
  Router,
  TransitionOption,
} from '../router/types';

type ScrollShot = { top: number; left: number }[];

function pageScrollers(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('scroll-view, list-view')];
}

export interface FjsAppOptions extends WebRouterOptions {
  /** App plugins, applied in order before [setup]. Normally the generated
   * list: `import { plugins } from 'fjs/plugins'`. */
  plugins?: readonly FjsPlugin[];
  /** Called with the Vue app before it is mounted (plugins, error handler).
   * On Flutter it runs once per page app; on web once for the whole app. */
  setup?: (app: App) => void;
  /** Web only: mount target. Default '#app'. */
  el?: string | Element;
  /** Flutter only: root element tag. Ignored here. */
  rootTag?: string;
  /** Web only: keep the pages *on the history stack* alive (default true),
   * so going back restores a page's scroll position and local state. Each
   * history entry gets its own shell (and its own scroll-view).
   *
   * Only what is still on the stack is kept: popping a page destroys it, the
   * way popping a Flutter Navigator route disposes it, so pushing that path
   * again starts from a fresh component. Set a number to cap how many pages
   * stay cached, or false to always remount. */
  keepAlive?: boolean | number;
  /** Page transition. A CSS transition name (default 'fjs-page', the
   * stylesheet's slide-in), `false` to turn animation off for the whole
   * app, or a function called per navigation — see [Navigation].
   *
   * A single page opts out with `meta.transition: false` in its `<route>`
   * block; a tab switch has no animation either way, which is what the
   * Flutter side does (the base page is swapped in place, no native
   * route, no transition). */
  transition?: TransitionOption;
}

export interface FjsApp {
  readonly router: Router;
  /** Web only: the Vue app instance. */
  readonly vueApp: App;
  mount(): void;
}

/** A tab page: reachable from the tab bar, kept alive across a switch. */
function isTabRoute(route: { meta?: Record<string, unknown> }): boolean {
  return typeof route.meta?.tab === 'number';
}

export function createFjsApp(options: FjsAppOptions): FjsApp {
  const router = createRouter(options);
  const shell = options.shell as Component | undefined;

  const keepAlive = options.keepAlive ?? true;
  const transition = options.transition;
  // The name this navigation runs under. Set in afterEach, which is still
  // before the router-view re-renders, so the leaving and arriving pages
  // both see it.
  const transitionName = ref(NO_TRANSITION);
  // Which way this navigation plays, as DOM state on the page host. The
  // CSS mirrors the animation for a pop and cancels it for a tab switch
  // off this — see base-css.ts for why it is not just the name.
  const navAttr = ref<NavKind>('initial');
  /** The leave transition finished: the page it belonged to can go. */
  const doneLeaving = (): void => {
    if (!leaving.size) return;
    for (const path of leaving) cancelPageTransition(path);
    leaving.clear();
    syncAlive();
  };
  /** The arriving page's enter transition is over: release whatever
   * onPageSettled() work it was holding back (specs/027). */
  const doneEntering = (): void => {
    markPageSettled(String(router.currentRoute.fullPath));
  };
  const nameFor = (nav: Navigation): string => {
    const resolved = resolveTransition(transition, nav);
    return resolved === false ? NO_TRANSITION : resolved;
  };

  // One instance per route path: its own shell / scroll-view. Offsets are
  // saved against this instance's path at setup. A pop deletes the leaving
  // page's shot — and its cached instance, see [syncAlive] — so the next
  // push of that path starts at 0, 0 with fresh state.
  const shots = new Map<string, ScrollShot>();
  const stack: string[] = [];
  // Tab pages (`meta.tab` is a number) survive a switch to another tab even
  // though the replace took them off the history stack, so coming back to a
  // tab finds it as it was left — same as the Flutter router parking them.
  // Leaving the tab group for any other page drops them.
  const tabs: string[] = [];
  const isTabPath = (fullPath: string) => isTabRoute(router.resolve(fullPath));
  // Pages that left the stack but are still on screen, playing their leave
  // transition. KeepAlive unmounts a cached page the moment it drops out of
  // `include`, which would cut the animation off at the first frame — so
  // they stay alive until <Transition> says the leave is done.
  const leaving = new Set<string>();
  // Mirror of `stack` for KeepAlive's `include`, which is the only public way
  // to drop one cached page. It matches on component name, so each path gets
  // its own entry component whose name IS the path — see [entryTypeFor].
  const alive = ref<string[]>([]);
  const FjsPageEntry = defineComponent({
    name: 'FjsPageEntry',
    inheritAttrs: false,
    props: { route: { type: Object, required: true } },
    setup(props, { slots }) {
      const host = ref<HTMLElement | null>(null);
      const id = String((props.route as { fullPath: string }).fullPath);

      const save = () => {
        // Pop already dropped this path from the stack — don't write the
        // shot back after afterEach deleted it. A parked tab is still ours.
        if (!stack.includes(id) && !tabs.includes(id)) return;
        shots.set(
          id,
          pageScrollers(host.value).map((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
        );
      };
      const restore = () => {
        const els = pageScrollers(host.value);
        const shot = shots.get(id);
        if (!shot) {
          for (const el of els) {
            el.scrollTop = 0;
            el.scrollLeft = 0;
          }
          return;
        }
        els.forEach((el, i) => {
          const pos = shot[i];
          if (!pos) return;
          el.scrollTop = pos.top;
          el.scrollLeft = pos.left;
        });
      };

      onMounted(() => nextTick(restore));
      onActivated(() => nextTick(restore));
      onDeactivated(save);
      onBeforeUnmount(save);

      return () =>
        h('fjs-page-entry', { ref: host }, [
          shell
            ? h(shell, { route: props.route }, { default: () => slots.default?.() })
            : slots.default?.(),
        ]);
    },
  });

  // One component type per path, named after the path. KeepAlive keys its
  // cache by vnode key but prunes by component *name*, so this is what lets
  // a single page be evicted while the rest of the stack stays cached.
  const entryTypes = new Map<string, Component>();
  const entryTypeFor = (fullPath: string): Component => {
    let type = entryTypes.get(fullPath);
    if (!type) {
      type = { ...(FjsPageEntry as object), name: fullPath } as Component;
      entryTypes.set(fullPath, type);
    }
    return type;
  };

  // A page that is no longer on the history stack is gone, the way popping a
  // Flutter Navigator route disposes it: drop it from `include` and KeepAlive
  // unmounts the cached instance, so the next push builds it from scratch
  // instead of showing the counter the user left behind.
  const syncAlive = () => {
    const live = [...new Set([...stack, ...tabs, ...leaving])];
    alive.value = live;
    for (const path of entryTypes.keys()) {
      if (!live.includes(path)) entryTypes.delete(path);
    }
  };

  const root = {
    name: 'FjsRoot',
    render: () =>
      h(RouterView, null, {
        default: ({
          Component: page,
          route,
        }: {
          Component?: VNode;
          route: { fullPath: string };
        }) => {
          // One shell instance per history entry — same as Flutter, where
          // each Navigator route remounts the shell. A shared shell would
          // leak its <scroll-view> offset onto every push.
          // h(vnode) clones the slot vnode; handing it straight back would
          // reuse one object across renders and wedge the transition.
          const entry = page
            ? h(
                entryTypeFor(route.fullPath),
                { key: route.fullPath, route },
                { default: () => [h(page as never)] },
              )
            : null;
          // children as an array, not a slot object: <Transition> resolves
          // the vnode it hands the enter hooks to with getInnerChild(), and
          // for a KeepAlive whose children are slots that call lands on the
          // *outgoing* subtree — the arriving page then never runs its half
          // of the animation (it just appears while the old one slides off).
          const cached =
            entry && keepAlive !== false
              ? h(
                  KeepAlive,
                  typeof keepAlive === 'number'
                    ? { include: alive.value, max: keepAlive }
                    : { include: alive.value },
                  [entry],
                )
              : entry;
          // No `mode: 'out-in'`: with <KeepAlive> inside, the deferred
          // update it needs never arrives and the route change wedges
          // half-applied. The two pages overlap instead — hence the
          // positioned host element (see .fjs-page-leave-active).
          const staged =
            transition === false
              ? cached
              : h(
                  Transition,
                  {
                    name: transitionName.value,
                    onAfterLeave: doneLeaving,
                    onAfterEnter: doneEntering,
                  },
                  { default: () => (cached ? [cached] : []) },
                );
          return h(
            'fjs-page-host',
            { 'data-nav': transitionName.value === NO_TRANSITION ? 'none' : navAttr.value },
            staged ? [staged] : [],
          );
        },
      }),
  };

  const vueRouter = (router as unknown as { vueRouter: VueRouter }).vueRouter;
  // Drop the popped page's shot so a later push of the same path is 0, 0.
  // Kind is recorded on the navigation call — history.state.position is
  // missing or stale in some environments (hash + happy-dom).
  type NavAction = 'push' | 'replace' | 'pop';
  let pending: NavAction | null = null;
  const { push, replace, back, go } = vueRouter;
  vueRouter.push = ((to, ...rest) => {
    pending = 'push';
    return push(to, ...rest);
  }) as typeof push;
  vueRouter.replace = ((to, ...rest) => {
    pending = 'replace';
    return replace(to, ...rest);
  }) as typeof replace;
  vueRouter.back = () => {
    pending = 'pop';
    return back();
  };
  vueRouter.go = (delta) => {
    pending = delta < 0 ? 'pop' : 'push';
    return go(delta);
  };
  // Capture phase: the system back button / browser back fire popstate
  // (they never call router.back()). vue-router also listens, so we must
  // mark the kind *before* its handler runs afterEach.
  if (typeof window !== 'undefined') {
    window.addEventListener(
      'popstate',
      () => {
        pending = 'pop';
      },
      true,
    );
  }

  stack.push(vueRouter.currentRoute.value.fullPath);
  syncAlive();
  vueRouter.afterEach((to, from) => {
    const kind = pending;
    pending = null;
    const toIdx = stack.lastIndexOf(to.fullPath);
    const isPop =
      kind === 'pop' ||
      (kind !== 'push' && kind !== 'replace' && toIdx >= 0 && toIdx < stack.length - 1);
    if (isPop) {
      while (stack.length && stack[stack.length - 1] !== to.fullPath) {
        const popped = stack.pop();
        if (!popped) continue;
        // the shot goes now — a later push of that path starts at 0,0 —
        // but the instance sticks around for the animation
        shots.delete(popped);
        if (transition !== false) leaving.add(popped);
      }
    } else if (kind === 'replace') {
      // The replaced entry is gone from history, so it is gone here too —
      // Flutter's pushReplacement disposes the route it stands in for. The
      // exception is a tab switch: park the leaving tab instead.
      const gone = stack.length ? stack[stack.length - 1] : null;
      const parkGone =
        keepAlive !== false &&
        gone !== null &&
        gone !== to.fullPath &&
        isTabPath(gone) &&
        isTabRoute(to);
      if (parkGone) {
        if (!tabs.includes(gone)) tabs.push(gone);
      } else if (gone !== null && gone !== to.fullPath) {
        shots.delete(gone);
      }
      if (!isTabRoute(to)) {
        // the base page left the tab group: the parked tabs go with it
        for (const path of tabs) shots.delete(path);
        tabs.length = 0;
      }
      if (stack.length) stack[stack.length - 1] = to.fullPath;
      else stack.push(to.fullPath);
    } else if (to.fullPath !== stack[stack.length - 1]) {
      stack.push(to.fullPath);
    }
    // The page that just arrived is on the stack again, not parked. A push
    // or a pop leaves the parked tabs alone: they sit under the pushed page
    // the way the Flutter navigator keeps the base page under it.
    const parkedIdx = tabs.indexOf(to.fullPath);
    if (parkedIdx >= 0) tabs.splice(parkedIdx, 1);
    syncAlive();

    let navKind: NavKind;
    if (!from.matched.length) navKind = 'initial';
    else if (isPop) navKind = 'pop';
    else if (kind === 'replace') {
      navKind = isTabRoute(from) && isTabRoute(to) ? 'tab' : 'replace';
    } else navKind = 'push';
    navAttr.value = navKind;
    const name = nameFor({
      to: to as unknown as RouteLocation,
      from: from as unknown as RouteLocation,
      kind: navKind,
    });
    transitionName.value = name;
    // A page whose transition has no duration — `transition: false`, a tab
    // swap, the initial page — never gets an afterEnter to wait for, so it
    // is settled the moment it arrives. Registering it as pending first and
    // settling it here (rather than not registering at all) keeps one code
    // path: the callbacks always drain through markPageSettled.
    beginPageTransition(to.fullPath);
    if (transition === false || name === NO_TRANSITION) markPageSettled(to.fullPath);
  });

  const vueApp = createVueApp(root);
  installFjsWeb(vueApp);
  vueApp.use(vueRouter);
  applyPlugins(vueApp, options.plugins);
  options.setup?.(vueApp);

  return {
    router,
    vueApp,
    mount() {
      const el = options.el ?? '#app';
      if (typeof el === 'string' && !document.querySelector(el)) {
        const host = document.createElement('div');
        host.id = el.replace(/^#/, '');
        document.body.appendChild(host);
      }
      vueApp.mount(el as never);
    },
  };
}

/** `<defer>` on the web (web/components/defer.ts) — the same export name
 * the Flutter entry has, for code that builds its own app. */
export { FjsDefer } from '../web/components/defer';
export { useRouter, useRoute, definePage } from '../router/web';
export type { FjsPlugin } from './plugin';
export type { Router, RouteLocation, RouteRecord, RouteMeta } from '../router/types';
