// @vitest-environment happy-dom
// specs/211: global components. createFjsApp({ globalComponents }) mounts each
// component ONCE into `fjs-global-host` (a layer over the page host), shows
// it on the routes its include / exclude allow, and hides — never unmounts —
// it elsewhere so its state survives a trip through an excluded page.
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createFjsApp } from '../src/app/web';
import { globalVisible, normalizeGlobalComponents } from '../src/app/global-components';

async function tick(): Promise<void> {
  await nextTick();
  await new Promise((r) => setTimeout(r, 50));
}

const page = (name: string) =>
  defineComponent({ name, setup: () => () => h('view', { class: name }, name) });

let mounted = 0;
const Ball = defineComponent({
  name: 'TestBall',
  setup() {
    mounted++;
    const n = ref(0);
    return () => h('view', { class: 'ball', onClick: () => n.value++ }, `n${n.value}`);
  },
});

const ROUTES = [
  { path: '/', component: page('home') },
  { path: '/detail', component: page('detail') },
  { path: '/game/a', component: page('game') },
];

describe('globalVisible', () => {
  it('defaults to every route', () => {
    expect(globalVisible('/anything', {})).toBe(true);
  });
  it('include: exact, prefix wildcard, regexp', () => {
    expect(globalVisible('/a', { include: ['/a'] })).toBe(true);
    expect(globalVisible('/a/b', { include: ['/a'] })).toBe(false);
    expect(globalVisible('/a/b', { include: ['/a/*'] })).toBe(true);
    expect(globalVisible('/a', { include: ['/a/*'] })).toBe(true);
    expect(globalVisible('/ab', { include: ['/a/*'] })).toBe(false);
    expect(globalVisible('/x/1', { include: [/^\/x\/\d+$/] })).toBe(true);
    expect(globalVisible('/y', { include: ['/a', /^\/x/] })).toBe(false);
  });
  it('exclude wins over include', () => {
    expect(globalVisible('/a/b', { include: ['/a/*'], exclude: ['/a/b'] })).toBe(false);
    expect(globalVisible('/a/c', { include: ['/a/*'], exclude: ['/a/b'] })).toBe(true);
  });
  it('a /g regexp does not alternate', () => {
    const re = /^\/x/g;
    expect([1, 2, 3].map(() => globalVisible('/x', { include: [re] }))).toEqual([true, true, true]);
  });
  it('normalizes a bare component and an options object', () => {
    const items = normalizeGlobalComponents([Ball, { component: Ball, exclude: ['/a'] }]);
    expect(items[0].component).toBe(Ball);
    expect(items[1].exclude).toEqual(['/a']);
  });
});

describe('global components on web (specs/211)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.getElementById('app')?.remove();
    history.replaceState(null, '', '#/');
  });

  async function boot(opts: Record<string, unknown>) {
    mounted = 0;
    const app = createFjsApp({ routes: ROUTES, el: '#app', ...opts });
    app.mount();
    await (
      app.router as unknown as { vueRouter: { isReady: () => Promise<void> } }
    ).vueRouter.isReady();
    await tick();
    return app;
  }
  const surface = () => document.querySelector('.fjs-global-surface') as HTMLElement;

  it('mounts one instance into fjs-global-host, after the page host', async () => {
    await boot({ globalComponents: [Ball] });
    const appRoot = document.getElementById('app')!;
    expect([...appRoot.children].map((e) => e.tagName.toLowerCase())).toEqual([
      'fjs-page-host',
      'fjs-global-host',
    ]);
    expect(document.querySelectorAll('.ball').length).toBe(1);
    expect(mounted).toBe(1);
  });

  it('hides on excluded routes without unmounting; state survives', async () => {
    const app = await boot({
      globalComponents: [{ component: Ball, exclude: ['/game/*'] }],
    });
    (document.querySelector('.ball') as HTMLElement).click();
    await tick();
    expect(document.querySelector('.ball')!.textContent).toBe('n1');

    await app.router.push('/game/a');
    await tick();
    expect(surface().style.display).toBe('none');

    await app.router.back();
    await tick();
    expect(surface().style.display).toBe('');
    expect(document.querySelector('.ball')!.textContent).toBe('n1');
    expect(mounted).toBe(1);
  });

  it('include limits the routes', async () => {
    const app = await boot({ globalComponents: [{ component: Ball, include: ['/detail'] }] });
    expect(surface().style.display).toBe('none');
    await app.router.push('/detail');
    await tick();
    expect(surface().style.display).toBe('');
  });

  it('mounts nothing without the option', async () => {
    await boot({});
    expect(document.querySelector('fjs-global-host')).toBeNull();
  });
});
