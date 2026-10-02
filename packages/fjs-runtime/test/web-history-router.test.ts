// @vitest-environment happy-dom
// specs/173: the enableVapor web router over the browser history directly
// (router/web-history.ts) — the behaviours the vue-router version had for
// these apps: both address modes, popstate, deep links, the two redirects,
// lazy page modules, history.state.position.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHistoryRouter, type HistoryRouter } from '../src/router/web-history';
import { historyEntryKey } from '../src/router/web';
import type { RouteRecord } from '../src/router/types';

const Home = { name: 'Home' };
const About = { name: 'About' };
const User = { name: 'User' };
let loads = 0;
const lazyAbout = async () => {
  loads++;
  return { default: About };
};

const routes = (): RouteRecord[] => [
  { path: '/', name: 'home', component: Home },
  { path: '/about', name: 'about', component: lazyAbout as never, meta: { title: 'About' } },
  { path: '/user/:id', name: 'user', component: User },
];

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
let router: HistoryRouter | null = null;

function at(url: string): void {
  history.replaceState(null, '', url);
}

beforeEach(() => {
  loads = 0;
  at('/');
});

afterEach(() => {
  router = null;
});

describe('hash mode (default)', () => {
  it('opens the address it was loaded at, with params and query', async () => {
    at('/#/user/7?tab=posts');
    router = createHistoryRouter({ routes: routes(), preload: false });
    await router.start();
    const cur = router.current.value!;
    expect(cur.component).toBe(User);
    expect(cur.location.params).toEqual({ id: '7' });
    expect(cur.location.query).toEqual({ tab: 'posts' });
    expect(router.currentRoute.fullPath).toBe('/user/7?tab=posts');
    expect((history.state as { position?: number }).position).toBe(0);
  });

  it('push loads a lazy page before switching, writes the hash, and counts positions', async () => {
    router = createHistoryRouter({ routes: routes(), preload: false });
    await router.start();
    const pending = router.push({ name: 'about', query: { from: 'home' } });
    // not switched until the module is in
    expect(router.current.value!.location.path).toBe('/');
    await pending;
    expect(router.current.value!.component).toBe(About);
    expect(router.currentRoute.meta.title).toBe('About');
    expect(location.hash).toBe('#/about?from=home');
    expect(historyEntryKey(router.currentRoute)).toBe('1:/about?from=home');
    // the module is loaded once
    await router.push('/');
    await router.push('/about');
    expect(loads).toBe(1);
  });

  it('back follows popstate to the previous entry', async () => {
    router = createHistoryRouter({ routes: routes(), preload: false });
    await router.start();
    await router.push('/user/1');
    await router.push('/user/2');
    router.back();
    await tick(30);
    expect(router.currentRoute.fullPath).toBe('/user/1');
    expect(router.current.value!.position).toBe(1);
  });

  it('pushing the current location does nothing; replace keeps the position', async () => {
    router = createHistoryRouter({ routes: routes(), preload: false });
    await router.start();
    const before = history.length;
    await router.push('/');
    expect(history.length).toBe(before);
    await router.replace('/user/3');
    expect(router.current.value!.position).toBe(0);
    expect(location.hash).toBe('#/user/3');
  });

  it('a later navigation wins over one still loading its module', async () => {
    router = createHistoryRouter({ routes: routes(), preload: false });
    await router.start();
    const slow = router.push('/about');
    const fast = router.push('/user/9');
    await Promise.all([slow, fast]);
    expect(router.currentRoute.fullPath).toBe('/user/9');
  });

  it('redirects an unknown path to initial, and / to initial when the table has no /', async () => {
    at('/#/nope');
    router = createHistoryRouter({ routes: routes(), preload: false });
    await router.start();
    expect(router.currentRoute.path).toBe('/');
    expect(location.hash).toBe('#/');

    at('/');
    const noRoot: RouteRecord[] = [{ path: '/start', component: Home }, { path: '/*', component: User }];
    router = createHistoryRouter({ routes: noRoot, initial: '/start', preload: false });
    await router.start();
    expect(router.currentRoute.path).toBe('/start');
    // the app's own catch-all page renders instead of a redirect
    await router.push('/whatever/deep');
    expect(router.current.value!.component).toBe(User);
    expect(router.currentRoute.params.pathMatch).toBe('whatever/deep');
  });
});

describe('history mode', () => {
  it('reads and writes the path under the base', async () => {
    at('/app/user/5');
    router = createHistoryRouter({ routes: routes(), history: 'history', base: '/app/', preload: false });
    await router.start();
    expect(router.currentRoute.fullPath).toBe('/user/5');
    await router.push('/about');
    expect(location.pathname).toBe('/app/about');
    router.back();
    await tick(30);
    expect(router.currentRoute.fullPath).toBe('/user/5');
  });
});
