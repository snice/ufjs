// @vitest-environment happy-dom
// specs/175: <Teleport> in vapor templates and <swiper circular> in a pure
// vapor web app (live pages, snapshot clones).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSfc } from './helpers/sfc';

vi.mock('vue', async () => await import('../src/vapor/vue-pure'));

type Vue = typeof import('../src/vapor/web-pure');
let vue: Vue;
const g = globalThis as Record<string, unknown>;
const log: string[] = [];
g.__log = log;

beforeAll(async () => {
  vue = await import('../src/vapor/web-pure');
  await import('../src/vapor/tags/web/swiper.ts');
});

afterEach(() => {
  log.length = 0;
  document.body.innerHTML = '';
});

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

function page(source: string): { root: HTMLElement; unmount: () => void } {
  const comp = compileSfc(source, { vapor: true, web: true, runtime: vue as unknown as Record<string, unknown> }).component;
  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  const app = vue.createVaporApp(comp as never);
  app.mount(root as never);
  return { root, unmount: () => app.unmount() };
}

describe('<Teleport> in a vapor template (specs/175)', () => {
  it('moves its content to the target, back while disabled (state kept), and removes it on unmount', async () => {
    const box = document.createElement('div');
    box.id = 'other';
    document.body.appendChild(box);
    const { root, unmount } = page(`
<script setup>
import { ref } from 'vue'
const off = ref(false)
const to = ref('body')
const n = ref(1)
const open = ref(true)
globalThis.__t = { off, to, n, open }
</script>
<template>
  <view class="wrap">
    <Teleport :to="to" :disabled="off"><text v-if="open" class="tp">{{ n }}</text></Teleport>
  </view>
</template>`);
    await wait();
    const t = g.__t as Record<string, { value: unknown }>;
    const tp = () => document.querySelector('.tp');
    expect(tp()?.parentElement).toBe(document.body);
    expect(root.querySelector('.tp')).toBeNull();
    t.off.value = true;
    await wait();
    expect(tp()?.parentElement).toBe(root.querySelector('.wrap'));
    t.n.value = 2;
    t.off.value = false;
    t.to.value = '#other';
    await wait();
    expect(tp()?.parentElement).toBe(box);
    expect(tp()?.textContent).toBe('2');
    // a v-if inside keeps landing in the target
    t.open.value = false;
    await wait();
    expect(tp()).toBeNull();
    t.open.value = true;
    await wait();
    expect(tp()?.parentElement).toBe(box);
    unmount();
    expect(tp()).toBeNull();
  });

  it('no target: warns once and renders in place', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root } = page(`
<script setup>
const x = 1
</script>
<template><view class="wrap"><Teleport to="#nowhere"><text class="tp">t</text></Teleport></view></template>`);
    await wait();
    expect(root.querySelector('.wrap .tp')).not.toBeNull();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('#nowhere'))).toBe(true);
    warn.mockRestore();
  });
});

describe('<swiper circular> with live vapor pages (specs/175)', () => {
  it('each real page once, in order; clone cells snapshot the last / first page', async () => {
    const { root } = page(`
<script setup>
import { ref } from 'vue'
const pages = ref(['p1', 'p2', 'p3'])
</script>
<template>
  <swiper circular>
    <swiper-item v-for="p in pages" :key="p"><text :class="p">{{ p }}</text></swiper-item>
  </swiper>
</template>`);
    await wait();
    const cells = [...root.querySelectorAll('swiper > swiper-item')];
    expect(cells.length).toBe(5);
    // the real pages sit in the middle, each exactly once, in order
    expect(cells.slice(1, 4).map((c) => c.textContent)).toEqual(['p1', 'p2', 'p3']);
    expect(cells.slice(1, 4).every((c) => c.getAttribute('aria-hidden') !== 'true')).toBe(true);
    // the clones are copies (not the live nodes) of the last and first page
    expect(cells[0].textContent).toBe('p3');
    expect(cells[4].textContent).toBe('p1');
    expect(cells[0].getAttribute('aria-hidden')).toBe('true');
    expect(cells[0].querySelector('.p3')).not.toBe(cells[3].querySelector('.p3'));
  });
});

describe('a v-for at a slot / component root (specs/175)', () => {
  it('its items reach the tree, later items too, and leave with the component', async () => {
    const { root, unmount } = page(`
<script setup>
import { ref } from 'vue'
const items = ref(['a', 'b'])
globalThis.__items = items
</script>
<template><text v-for="i in items" :key="i" class="it">{{ i }}</text></template>`);
    await wait();
    const texts = () => [...root.querySelectorAll('.it')].map((e) => e.textContent);
    expect(texts()).toEqual(['a', 'b']);
    (g.__items as { value: string[] }).value = ['a', 'b', 'c'];
    await wait();
    expect(texts()).toEqual(['a', 'b', 'c']);
    (g.__items as { value: string[] }).value = ['c', 'a'];
    await wait();
    expect(texts()).toEqual(['c', 'a']);
    unmount();
    expect(root.querySelectorAll('.it').length).toBe(0);
  });
});

