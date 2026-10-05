// @vitest-environment happy-dom
// specs/210: the global tab bar. createFjsApp({ tabBar }) mounts the
// component ONCE into a childless `fjs-tabbar-host` element FjsRoot renders
// UNDER the page host (the TabGroup — pages area above, bar below, one flex
// column; the bar's own Vue app fills the slot), shows it on the tab group's
// pages only (meta.tab; a push is covered by the pushed page, never hidden) and feeds it the
// current tab index. Pages opt out harder with meta.tabBar: false. Without
// the option nothing mounts.
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { createFjsApp } from '../src/app/web';
import { FjsTabBarSurface } from '../src/app/tabbar';

async function tick(): Promise<void> {
  await nextTick();
  await new Promise((r) => setTimeout(r, 50));
}

function page(name: string) {
  return defineComponent({
    name,
    setup() {
      const n = ref(0);
      return () =>
        h('view', { class: name }, [
          h('text', { class: 'count', onClick: () => n.value++ }, String(n.value)),
        ]);
    },
  });
}

/** Renders what the framework hands it, so the tests can read it back. */
const Bar = defineComponent({
  name: 'TestBar',
  props: {
    tabs: { type: Array as () => { path: string; title: string; tab: number }[], required: true },
    active: { type: Number as () => number | null, default: null },
  },
  setup: (props) => () =>
    h('view', { class: 'bar' }, [
      h('text', { class: 'bar-active' }, String(props.active)),
      h('text', { class: 'bar-tabs' }, props.tabs.map((t) => t.path).join(',')),
    ]),
});

const ROUTES = [
  { path: '/', meta: { tab: 0, title: 'Home' }, component: page('home') },
  { path: '/api', meta: { tab: 1, title: 'Api' }, component: page('api') },
  { path: '/detail', component: page('detail') },
  { path: '/game', meta: { tabBar: false }, component: page('game') },
];

function mountApp(withBar: boolean) {
  const app = createFjsApp({
    routes: ROUTES,
    el: '#app',
    ...(withBar ? { tabBar: { component: Bar } } : {}),
  });
  app.mount();
  return app;
}

async function ready(app: ReturnType<typeof mountApp>): Promise<void> {
  await (
    app.router as unknown as { vueRouter: { isReady: () => Promise<void> } }
  ).vueRouter.isReady();
  await tick();
}

function surface(): HTMLElement {
  const el = document.querySelector('.fjs-tabbar-surface');
  if (!el) throw new Error('missing tab bar surface');
  return el as HTMLElement;
}

function barText(cls: string): string {
  return document.querySelector(`.bar .${cls}`)?.textContent ?? '';
}

describe('global tab bar (specs/210)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.getElementById('app')?.remove();
    history.replaceState(null, '', '#/');
  });

  it('mounts once under the page host, inside #app', async () => {
    const app = mountApp(true);
    await ready(app);

    const host = document.querySelector('fjs-tabbar-host');
    expect(host).not.toBeNull();
    // the TabGroup: a sibling of the page host, below it — page swaps happen
    // inside fjs-page-host and never rebuild the bar
    const appRoot = document.getElementById('app')!;
    expect(host!.parentElement).toBe(appRoot);
    const children = [...appRoot.children].map((el) => el.tagName.toLowerCase());
    expect(children).toEqual(['fjs-page-host', 'fjs-tabbar-host']);
    // one bar, rendering the route table's tab pages in meta.tab order
    expect(document.querySelectorAll('fjs-tabbar-host').length).toBe(1);
    expect(barText('bar-tabs')).toBe('/,/api');
    // the initial page is a tab page: it starts highlighted
    expect(barText('bar-active')).toBe('0');
  });

  it('stays put under a push — the pushed page covers it, nothing hides or restores', async () => {
    const app = mountApp(true);
    await ready(app);
    expect(surface().style.display).toBe('');
    expect(barText('bar-active')).toBe('0');

    await app.router.push('/detail');
    await tick();
    // same as Flutter: the bar stays mounted and shown under the pushed
    // page, which is marked so the stylesheet paints it above the bar
    expect(surface().style.display).toBe('');
    const entries = [...document.querySelectorAll('fjs-page-entry')];
    expect(entries.some((e) => e.hasAttribute('data-covers-bar'))).toBe(true);

    await app.router.back();
    await tick();
    expect(surface().style.display).toBe('');
    expect(barText('bar-active')).toBe('0');
    expect(document.querySelector('fjs-page-entry[data-covers-bar]')).toBeNull();

    await app.router.replace('/api');
    await tick();
    expect(surface().style.display).toBe('');
    expect(barText('bar-active')).toBe('1');
  });

  it('hides on meta.tabBar:false pages', async () => {
    const app = mountApp(true);
    await ready(app);
    expect(surface().style.display).toBe('');

    await app.router.push('/game');
    await tick();
    expect(surface().style.display).toBe('none');

    await app.router.back();
    await tick();
    expect(surface().style.display).toBe('');
  });

  it('coveredOnPush decides the pushed-page visibility', async () => {
    // Flutter: the pushed route covers the whole TabGroup, and currentRoute
    // lags the pop animation (navPop arrives after the exit animation,
    // specs/003) — hiding on "not a tab page" stripped the bar mid-reveal.
    // The surface therefore defers to coveredOnPush while the top route is
    // a pushed page; web passes stack.length > 1 and covers too.
    // the real routers expose a reactive currentRoute; the surface tracks it
    const route = reactive({
      path: '/x',
      fullPath: '/x',
      params: {},
      query: {},
      meta: {} as Record<string, unknown>,
    });
    const router = { currentRoute: route, routes: [] };
    const mount = async (covered: boolean): Promise<{ el: HTMLElement; surface: HTMLElement }> => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      createApp(
        defineComponent({
          setup: () => () =>
            h(FjsTabBarSurface, {
              router: router as never,
              component: Bar,
              tabs: [{ path: '/', title: 'Home', tab: 0 }],
              coveredOnPush: () => covered,
            }),
        }),
      ).mount(el);
      await nextTick();
      const surface = el.querySelector('.fjs-tabbar-surface') as HTMLElement;
      if (!surface) throw new Error('no surface');
      return { el, surface };
    };

    // pushed non-tab page, covering platform: the bar stays mounted under
    // the pushed route
    const covered = await mount(true);
    expect(covered.surface.style.display).toBe('');

    // same state, web (nothing covers): hidden
    const bare = await mount(false);
    expect(bare.surface.style.display).toBe('none');

    // the pop settles on a tab page: visible on both —
    route.meta.tab = 0;
    await nextTick();
    expect(covered.surface.style.display).toBe('');
    expect(bare.surface.style.display).toBe('');

    // a tab page opted out: hidden regardless of covering
    route.meta.tabBar = false;
    await nextTick();
    expect(covered.surface.style.display).toBe('none');
    expect(bare.surface.style.display).toBe('none');

    covered.el.remove();
    bare.el.remove();
  });

  it('stays mounted and visible while pages transition', async () => {
    const app = mountApp(true);
    await ready(app);

    // push + back again: the host survives every navigation untouched
    await app.router.push('/detail');
    await tick();
    await app.router.back();
    await tick();
    expect(document.querySelectorAll('fjs-tabbar-host').length).toBe(1);
    expect(barText('bar-active')).toBe('0');
  });

  it('mounts nothing without the option', async () => {
    const app = mountApp(false);
    await ready(app);
    expect(document.querySelector('fjs-tabbar-host')).toBeNull();
  });
});
