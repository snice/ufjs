// @vitest-environment happy-dom
// The enableVapor web shell (specs/166): the whole app mounts through the
// vapor runtime's DOM backend — no Vue app, no runtime-dom. vue-router
// drives navigation; its currentRoute ref is the reactive source the
// shell's effect tracks. Pages keep state across navigation (the LRU cache
// hides hosts instead of unmounting them) and scroll positions ride along.
import { afterEach, describe, expect, it } from 'vitest';
import { createFjsApp } from '../src/app/web';
// the DOM backend: the shell's helpers run through it (in an app build the
// compiled pages import fjs/vapor, which registers it — here it is explicit)
import '../src/vapor/web';
import { compileSfc } from './helpers/sfc';

const COUNT_PAGE = `
<script setup>
import { ref } from 'vue'
const n = ref(0)
const inc = () => { n.value++ }
</script>
<template>
  <view class="page">
    <text class="count" @tap="inc">{{ n }}</text>
  </view>
</template>
`;

const OTHER_PAGE = `
<script setup>
import { ref } from 'vue'
const n = ref(7)
</script>
<template>
  <view class="page">
    <text class="other">{{ n }}</text>
  </view>
</template>
`;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('enableVapor: the pure-vapor web shell', () => {
  it('mounts pages through the DOM backend and navigates without a Vue app', async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
    const home = compileSfc(COUNT_PAGE, { vapor: true, runtime: vue });
    const other = compileSfc(OTHER_PAGE, { vapor: true, runtime: vue });

    const app = createFjsApp({
      enableVapor: true,
      routes: [
        { path: '/', component: home.component as never },
        { path: '/other', component: other.component as never },
      ],
      el: '#app',
      // navigation and caching here; page transitions: vapor-page-transition.test.ts
      transition: false,
    } as never);
    document.body.innerHTML = '<div id="app"></div>';
    app.mount();
    // the first page mounts once the initial navigation resolves (specs/167:
    // START_LOCATION would have built it from the lazy loader)
    await new Promise((r) => setTimeout(r, 0));

    const text = (sel: string): string | undefined =>
      document.querySelector(sel)?.textContent ?? undefined;
    expect(text('.count')).toBe('0');

    await app.router.push('/other');
    expect(text('.other')).toBe('7');
    // the visited page is cached hidden, not unmounted
    expect(text('.count')).toBe('0');
    expect((document.querySelector('.count') as HTMLElement).closest('fjs-page-entry')?.style.display).toBe('none');

    // state rides the hidden host: taps while hidden survive the round trip
    (document.querySelector('.count') as HTMLElement).click();
    (document.querySelector('.count') as HTMLElement).click();
    await app.router.back();
    expect(text('.count')).toBe('2');
  });
});

// specs/167: the shell provides each page its own reactive route, runs
// plugins / setup(app) once against the app shell (pinia), mounts pages
// with their hosts already in the document, and an LRU eviction runs the
// evicted page's unmount hooks.
const HOOKED_PAGE = `
<script setup>
import { onMounted, onUnmounted, isReactive } from 'vue'
import { useRoute } from 'fjs/router'
const log = globalThis.__log
const route = useRoute()
const store = globalThis.__useStore()
globalThis.__routes.push(route)
log.push('route ' + route.fullPath + ' reactive=' + isReactive(route))
onMounted(() => log.push('mounted ' + route.fullPath + ' ' + (document.querySelector('.p')?.isConnected ? 'in' : 'out')))
onUnmounted(() => log.push('unmounted ' + route.fullPath))
</script>
<template>
  <view class="page">
    <text class="p">{{ store.n }}</text>
  </view>
</template>
`;

describe('enableVapor (web): app shell, per-page route, lifecycle', () => {
  it('pinia via setup(app), own route per page, mounted in the document, unmounted on eviction', async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
    const fjsRouter = (await import('../src/router/web-vapor')) as unknown as Record<string, unknown>;
    const pinia = await import('pinia');
    const log: string[] = [];
    const routes: { fullPath: string }[] = [];
    const g = globalThis as Record<string, unknown>;
    g.__log = log;
    g.__routes = routes;
    g.__useStore = pinia.defineStore('web-counter', { state: () => ({ n: 9 }) });
    const page = compileSfc(HOOKED_PAGE, { vapor: true, runtime: vue, modules: { 'fjs/router': fjsRouter } });
    let setupRuns = 0;
    document.body.innerHTML = '<div id="app"></div>';
    const app = createFjsApp({
      enableVapor: true,
      keepAlive: 1,
      setup(a) {
        setupRuns++;
        a.use(pinia.createPinia());
      },
      routes: [
        { path: '/', component: page.component as never },
        { path: '/b', component: page.component as never },
      ],
      el: '#app',
    } as never);
    app.mount();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.p')?.textContent).toBe('9');
    await app.router.push('/b');
    await new Promise((r) => setTimeout(r, 0));
    expect(setupRuns).toBe(1);
    expect(log).toEqual([
      'route / reactive=true',
      'mounted / in',
      'route /b reactive=true',
      'mounted /b in',
      // keepAlive: 1 — showing /b evicts /
      'unmounted /',
    ]);
    expect(routes.map((r) => r.fullPath)).toEqual(['/', '/b']);
  });
});

// specs/167 §8: the shell is where the nav bar / back button lives
const VAPOR_SHELL = `
<script setup>
import { useRouter } from 'fjs/router'
const props = defineProps(['route'])
const router = useRouter()
</script>
<template>
  <view class="shell">
    <text class="title">{{ props.route.meta.title }}</text>
    <text v-if="props.route.path !== '/'" class="back" @tap="router.back()">back</text>
    <slot />
  </view>
</template>
`;

describe('enableVapor (web): the vapor shell', () => {
  it('wraps every page with its own route; the back button returns', async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
    const fjsRouter = (await import('../src/router/web-vapor')) as unknown as Record<string, unknown>;
    const shell = compileSfc(VAPOR_SHELL, { vapor: true, runtime: vue, modules: { 'fjs/router': fjsRouter } });
    const home = compileSfc(COUNT_PAGE, { vapor: true, runtime: vue });
    const other = compileSfc(OTHER_PAGE, { vapor: true, runtime: vue });
    document.body.innerHTML = '<div id="app"></div>';
    const app = createFjsApp({
      enableVapor: true,
      shell: shell.component as never,
      routes: [
        { path: '/', meta: { title: 'Home' }, component: home.component as never },
        { path: '/other', meta: { title: 'Other' }, component: other.component as never },
      ],
      el: '#app',
      transition: false,
    } as never);
    app.mount();
    await new Promise((r) => setTimeout(r, 0));
    const visible = (): HTMLElement =>
      [...document.querySelectorAll<HTMLElement>('fjs-page-entry')].find((p) => p.style.display !== 'none') as HTMLElement;
    expect(visible().querySelector('.title')?.textContent).toBe('Home');
    expect(visible().querySelector('.back')).toBeNull();
    await app.router.push('/other');
    await new Promise((r) => setTimeout(r, 0));
    expect(visible().querySelector('.title')?.textContent).toBe('Other');
    // the hidden home page's shell keeps ITS title
    expect(document.querySelector('fjs-page-entry .title')?.textContent).toBe('Home');
    (visible().querySelector('.back') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 30));
    expect(visible().querySelector('.title')?.textContent).toBe('Home');
    expect(visible().querySelector('.count')).not.toBeNull();
  });
});
