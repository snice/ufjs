// @vitest-environment happy-dom
// specs/167: the own vapor runtime's correctness fixes and the Vue API it
// now serves to vapor components — lifecycle hooks, provide/inject and the
// app context — exercised over the DOM backend with real compiled SFCs.
import { EffectScope } from '@vue/reactivity';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/web');
let vue: Vue;
const log: string[] = [];

beforeAll(async () => {
  vue = await import('../src/vapor/web');
});

afterEach(() => {
  log.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const g = globalThis as Record<string, unknown>;
g.__log = log;

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function sfc(source: string, imports: Record<string, unknown> = {}): Record<string, unknown> {
  return compileSfc(source, { vapor: true, runtime: vue as unknown as Record<string, unknown>, imports }).component;
}

function mount(comp: Record<string, unknown>, ctx: Parameters<Vue['createVaporApp']>[1] = null): { root: HTMLElement; app: ReturnType<Vue['createVaporApp']> } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = vue.createVaporApp(comp as never, ctx);
  app.mount(root as never);
  return { root, app };
}

describe('runtime fixes', () => {
  it('#1 v-if keeps its branch while the condition stays truthy', async () => {
    const Child = sfc(`
<script setup>
const log = globalThis.__log
log.push('child setup')
</script>
<template><text class="child">child</text></template>`);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
import Child from './child'
const n = ref(6)
globalThis.__n = n
</script>
<template><view><Child v-if="n > 5" /><text v-else class="else">else</text></view></template>`, { './child': Child });
    const { root } = mount(Page);
    const n = g.__n as { value: number };
    expect(log).toEqual(['child setup']);
    n.value = 7;
    await tick();
    expect(log).toEqual(['child setup']);
    n.value = 3;
    await tick();
    expect(root.querySelector('.else')).not.toBeNull();
    expect(root.querySelector('.child')).toBeNull();
  });

  it('#2 an effect triggered several times before a flush runs once', async () => {
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const rows = ref([1, 2, 3])
globalThis.__rows = rows
const read = () => { globalThis.__log.push('for'); return rows.value }
</script>
<template><view><text v-for="r in read()" :key="r" class="r">{{ r }}</text></view></template>`);
    const { root } = mount(Page);
    log.length = 0;
    const rows = g.__rows as { value: number[] };
    for (let i = 0; i < 5; i++) rows.value.push(10 + i);
    await tick();
    expect(log).toEqual(['for']);
    expect(root.querySelectorAll('.r').length).toBe(8);
  });

  it('#3 a throwing effect does not drop the rest of its batch', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // separate components: compiler-vapor folds the dynamic parts of one
    // template into ONE effect, so a throw inside it (like in Vue) only
    // takes that template's writes with it
    const Thrower = sfc(`
<script setup>
import { ref } from 'vue'
const boom = ref(0)
globalThis.__boom = boom
const thrower = () => { if (boom.value === 1) throw new Error('boom'); return boom.value }
</script>
<template><text class="t">{{ thrower() }}</text></template>`);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
import Thrower from './thrower'
const n = ref(1)
globalThis.__n = n
</script>
<template><view><Thrower /><text class="n">{{ n }}</text></view></template>`, { './thrower': Thrower });
    const { root } = mount(Page);
    const boom = g.__boom as { value: number };
    const n = g.__n as { value: number };
    boom.value = 1;
    n.value = 42;
    await tick();
    expect(root.querySelector('.n')?.textContent).toBe('42');
    expect(err).toHaveBeenCalled();
    n.value = 43;
    await tick();
    expect(root.querySelector('.n')?.textContent).toBe('43');
  });

  it('routes effect errors to the app errorHandler when one is set', async () => {
    const { createVaporAppShell } = await import('../src/app/vapor-app');
    const ctx = { components: {} };
    const shell = createVaporAppShell(ctx);
    const seen: unknown[] = [];
    shell.config.errorHandler = (e, inst, info) => seen.push([String(e), inst, info]);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const boom = ref(0)
globalThis.__boom = boom
const t = () => { if (boom.value) throw new Error('x'); return 0 }
</script>
<template><text>{{ t() }}</text></template>`);
    mount(Page, ctx);
    (g.__boom as { value: number }).value = 1;
    await tick();
    expect(seen).toEqual([['Error: x', null, 'vapor effect']]);
    shell.config.errorHandler = undefined;
  });
});

const HOOKS = `
<script setup>
import { onBeforeMount, onMounted, onBeforeUnmount, onUnmounted } from 'vue'
const props = defineProps(['tag'])
const log = globalThis.__log
const el = () => document.querySelector('.' + props.tag)
onBeforeMount(() => log.push(props.tag + ' beforeMount ' + (el() ? 'in' : 'out')))
onMounted(() => log.push(props.tag + ' mounted ' + (el()?.isConnected ? 'in' : 'out')))
onBeforeUnmount(() => log.push(props.tag + ' beforeUnmount ' + (el() ? 'in' : 'out')))
onUnmounted(() => log.push(props.tag + ' unmounted ' + (el() ? 'in' : 'out')))
</script>
<template><view :class="tag"><text>{{ tag }}</text></view></template>`;

describe('#4 lifecycle hooks', () => {
  it('mounted runs once the hosts are in the document, children first; unmount orders before/after removal', () => {
    const Hooks = sfc(HOOKS);
    const Page = sfc(`
<script setup>
import { onMounted, onBeforeUnmount, onUnmounted } from 'vue'
import Hooks from './hooks'
const log = globalThis.__log
onMounted(() => log.push('page mounted'))
onBeforeUnmount(() => log.push('page beforeUnmount'))
onUnmounted(() => log.push('page unmounted'))
</script>
<template><view><Hooks tag="a" /><Hooks tag="b" /></view></template>`, { './hooks': Hooks });
    const { app } = mount(Page);
    expect(log).toEqual([
      'a beforeMount out',
      'b beforeMount out',
      'a mounted in',
      'b mounted in',
      'page mounted',
    ]);
    log.length = 0;
    app.unmount();
    expect(log).toEqual([
      'page beforeUnmount',
      'a beforeUnmount in',
      'b beforeUnmount in',
      'b unmounted out',
      'a unmounted out',
      'page unmounted',
    ]);
  });

  it('fires for components a v-if flip or a v-for push creates and removes', async () => {
    const Hooks = sfc(HOOKS);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
import Hooks from './hooks'
const on = ref(false)
const items = ref([])
globalThis.__api = { on, items }
</script>
<template><view><Hooks v-if="on" tag="iff" /><Hooks v-for="t in items" :key="t" :tag="t" /></view></template>`, { './hooks': Hooks });
    mount(Page);
    const api = g.__api as { on: { value: boolean }; items: { value: string[] } };
    api.on.value = true;
    await tick();
    expect(log).toEqual(['iff beforeMount out', 'iff mounted in']);
    log.length = 0;
    api.on.value = false;
    await tick();
    expect(log).toEqual(['iff beforeUnmount in', 'iff unmounted out']);
    log.length = 0;
    api.items.value.push('x1');
    await tick();
    expect(log).toEqual(['x1 beforeMount out', 'x1 mounted in']);
    log.length = 0;
    api.items.value.splice(0, 1);
    await tick();
    expect(log).toEqual(['x1 beforeUnmount in', 'x1 unmounted out']);
  });

  it('#4b hooks registered by a composable importing from the enableVapor `vue` run too', async () => {
    const pureVue = await import('../src/vapor/vue-pure');
    g.__useTimer = () => {
      pureVue.onMounted(() => log.push('composable mounted'));
      pureVue.onUnmounted(() => log.push('composable unmounted'));
    };
    const Page = sfc(`
<script setup>
globalThis.__useTimer()
</script>
<template><text>x</text></template>`);
    const { app } = mount(Page);
    app.unmount();
    expect(log).toEqual(['composable mounted', 'composable unmounted']);
  });

  it('the adopt path runs mounted once the placeholder holds the nodes', async () => {
    const interop = await import('../src/vapor/web-interop');
    const Hooks = sfc(HOOKS);
    const { id } = interop.adoptVaporComponent(Hooks as never, { tag: () => 'ad' }, null);
    expect(log).toEqual(['ad beforeMount out']);
    const holder = document.createElement('fjs-vapor-root');
    document.body.appendChild(holder);
    interop.mountAdoptNodes(id, holder);
    interop.mountAdoptNodes(id, holder);
    expect(log).toEqual(['ad beforeMount out', 'ad mounted in']);
    log.length = 0;
    interop.releaseAdopt(id);
    expect(log).toEqual(['ad beforeUnmount in', 'ad unmounted in']);
  });

  it('warns once for hooks the vapor runtime does not run', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const Page = sfc(`
<script setup>
import { onUpdated } from 'vue'
onUpdated(() => {})
onUpdated(() => {})
</script>
<template><text>x</text></template>`);
    mount(Page);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('onUpdated')).length).toBeLessThanOrEqual(1);
  });

  it('EffectScope still carries the `scopes` field the unmount walk reads', () => {
    const outer = new EffectScope();
    outer.run(() => new EffectScope());
    expect(Array.isArray((outer as unknown as { scopes?: unknown[] }).scopes)).toBe(true);
  });
});

describe('#9 provide / inject', () => {
  it('parent provide → child inject; app provides at the end of the chain; defaults', () => {
    const Child = sfc(`
<script setup>
import { inject } from 'vue'
const theme = inject('theme')
const store = inject('store')
const missing = inject('nope', 'dflt')
</script>
<template><text class="c">{{ theme }}/{{ store }}/{{ missing }}</text></template>`);
    const Page = sfc(`
<script setup>
import { provide, inject } from 'vue'
import Child from './child'
provide('theme', 'dark')
// a component never sees its own provide
const own = inject('theme', 'none')
</script>
<template><view><text class="own">{{ own }}</text><Child /></view></template>`, { './child': Child });
    const { root } = mount(Page, { components: {}, provides: { store: 'app-store' } });
    expect(root.querySelector('.c')?.textContent).toBe('dark/app-store/dflt');
    expect(root.querySelector('.own')?.textContent).toBe('none');
  });

  it('the app shell: use / provide / runWithContext / component, pinia end to end', async () => {
    const { createVaporAppShell } = await import('../src/app/vapor-app');
    const pinia = await import('pinia');
    const ctx = { components: {} as Record<string, unknown> };
    const shell = createVaporAppShell(ctx);
    shell.use(pinia.createPinia() as never);
    shell.provide('k', 'v');
    expect(shell.runWithContext(() => vue.inject('k'))).toBe('v');
    const useCounter = pinia.defineStore('counter', { state: () => ({ n: 1 }), actions: { inc() { this.n++; } } });
    g.__useCounter = useCounter;
    const Page = sfc(`
<script setup>
const store = globalThis.__useCounter()
globalThis.__store = store
</script>
<template><text class="n" @click="store.inc()">{{ store.n }}</text></template>`);
    const { root } = mount(Page, ctx);
    expect(root.querySelector('.n')?.textContent).toBe('1');
    (g.__store as { inc(): void }).inc();
    await tick();
    expect(root.querySelector('.n')?.textContent).toBe('2');
    const Named = vue.defineVaporComponent({ setup: () => null });
    shell.component('named-thing', Named);
    expect(shell.component('named-thing')).toBe(Named);
  });
});
