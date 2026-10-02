// @vitest-environment happy-dom
// specs/171: fjs's render-function components in a PURE vapor web app (the
// enableVapor surface: web-pure, no VDOM renderer) — the web adapter's tags
// and the built-in components run on vapor/render-host.ts, registered
// through their `fjs/tag/<tag>` modules exactly as the compiler imports them.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSfc } from './helpers/sfc';

// what an enableVapor web build pins 'vue' to (specs/167/171): runtime-core
// plus the vapor-aware lifecycle / provide-inject the web components import
vi.mock('vue', async () => await import('../src/vapor/vue-pure'));

type Vue = typeof import('../src/vapor/web-pure');
let vue: Vue;
const g = globalThis as Record<string, unknown>;
const log: string[] = [];
g.__log = log;

beforeAll(async () => {
  vue = await import('../src/vapor/web-pure');
  for (const tag of ['input', 'image', 'scroll-view', 'switch', 'checkbox', 'checkbox-group', 'list-view', 'textarea', 'canvas', 'defer', 'swiper', 'modal', 'form', 'button', 'picker-view', 'picker-view-column', 'progress']) {
    await import(`../src/vapor/tags/web/${tag}.ts`);
  }
});

afterEach(() => {
  log.length = 0;
  document.body.innerHTML = '';
});

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

function page(source: string): HTMLElement {
  const comp = compileSfc(source, { vapor: true, web: true, runtime: vue as unknown as Record<string, unknown> }).component;
  const root = document.createElement('div');
  document.body.appendChild(root);
  vue.createVaporApp(comp as never).mount(root as never);
  return root;
}

describe('web tags on the render host', () => {
  it('input: text-changed in, :value out; image renders an <img>; scroll payload is a string; switch toggles', async () => {
    const root = page(`
<script setup>
import { ref } from 'vue'
const t = ref('init')
const on = ref(false)
globalThis.__s = { t, on }
const push = (s) => globalThis.__log.push(s)
</script>
<template>
  <view>
    <input class="in" :value="t" @text-changed="(v) => { t = v; push('text:' + v) }" />
    <image class="im" src="https://x/a.png" mode="aspectFill" />
    <scroll-view class="sv" scroll-y @scroll="(p) => push('scroll:' + typeof p)"><text>a</text></scroll-view>
    <switch class="sw" :checked="on" @change="(v) => { on = !on; push('switch:' + v) }" />
  </view>
</template>`);
    await wait();
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('init');
    input.value = 'typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    expect((g.__s as { t: { value: string } }).t.value).toBe('typed');
    (g.__s as { t: { value: string } }).t.value = 'from model';
    await wait();
    expect(input.value).toBe('from model');
    expect(root.querySelector('img')?.getAttribute('src')).toContain('a.png');
    expect(getComputedStyle(root.querySelector('img')!).objectFit).toBe('cover');
    root.querySelector('scroll-view')!.dispatchEvent(new Event('scroll'));
    (root.querySelector('.sw') as HTMLElement).click();
    await wait(50);
    expect(log).toContain('text:typed');
    expect(log).toContain('scroll:string');
    expect(log.some((l) => l.startsWith('switch:'))).toBe(true);
    await wait();
    expect((root.querySelector('.sw') as HTMLElement).getAttribute('aria-checked')).toBe('true');
  });

  it('list-view with items and a scoped slot; the slot content updates in place', async () => {
    const root = page(`
<script setup>
import { ref } from 'vue'
const items = ref([{ n: 'a' }, { n: 'b' }])
globalThis.__items = items
</script>
<template>
  <list-view class="lv" :items="items" :item-height="40">
    <template #default="{ item, index }"><text class="cell">{{ index }}:{{ item.n }}</text></template>
  </list-view>
</template>`);
    await wait();
    const cells = (): string => [...root.querySelectorAll('.cell')].map((e) => e.textContent).join(',');
    expect(cells()).toBe('0:a,1:b');
    const first = root.querySelector('.cell');
    (g.__items as { value: { n: string }[] }).value = [{ n: 'z' }, { n: 'b' }, { n: 'c' }];
    await wait();
    expect(cells()).toBe('0:z,1:b,2:c');
    // the first cell's block was reused, its slot props updated in place
    expect(root.querySelector('.cell')).toBe(first);
  });

  it('textarea, canvas (ref → getContext), defer, swiper pages, progress', async () => {
    const root = page(`
<script setup>
import { ref, onMounted } from 'vue'
const cv = ref(null)
onMounted(() => globalThis.__log.push('canvas:' + typeof cv.value?.getContext))
const push = (s) => globalThis.__log.push(s)
</script>
<template>
  <view>
    <textarea class="ta" value="x" @input="(v) => push('ta:' + v)" />
    <canvas ref="cv" class="cv" />
    <defer><text class="deferred">later</text></defer>
    <swiper class="sw"><swiper-item><text class="p1">p1</text></swiper-item><swiper-item><text class="p2">p2</text></swiper-item></swiper>
    <progress :percent="40" />
  </view>
</template>`);
    await wait();
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    ta.value = 'more';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await wait();
    expect(log).toContain('ta:more');
    expect(log).toContain('canvas:function');
    expect(root.querySelector('canvas')).not.toBeNull();
    expect(root.querySelector('.p1')?.textContent).toBe('p1');
    expect(root.querySelector('.p2')?.textContent).toBe('p2');
    await wait(400);
    expect(root.querySelector('.deferred')?.textContent).toBe('later');
  });

  it('checkbox-group collects checked values; modal teleports to body', async () => {
    const root = page(`
<script setup>
import { ref } from 'vue'
const show = ref(true)
const push = (s) => globalThis.__log.push(s)
</script>
<template>
  <view>
    <checkbox-group @change="(v) => push('group:' + v)">
      <checkbox class="c1" name="a" />
      <checkbox class="c2" name="b" />
    </checkbox-group>
    <modal :visible="show"><text class="in-modal">m</text></modal>
  </view>
</template>`);
    await wait();
    (root.querySelector('.c2') as HTMLElement).click();
    await wait();
    expect(log).toContain('group:["b"]');
    const inModal = document.querySelector('.in-modal');
    expect(inModal).not.toBeNull();
    expect(root.contains(inModal)).toBe(false);
  });
});

describe('fjs/tag imports the compiler injects (specs/171)', () => {
  it('a vapor SFC using component-backed tags imports exactly those tag modules', async () => {
    const { compileVaporSfc } = await import('../src/vapor/sfc-compiler');
    const src = `<script setup vapor>
const a = 1
</script>
<template><view><input /><switch /><text>t</text><list-view /></view></template>`;
    const web = compileVaporSfc(src, { file: 'p.vue', id: 'data-v-1', web: true, moduleTags: new Set() }) as { code: string };
    expect(web.code.match(/import "fjs\/tag\/[^"]+";/g)).toEqual(['import "fjs/tag/input";', 'import "fjs/tag/list-view";', 'import "fjs/tag/switch";']);
    // Flutter: input / switch are Dart widgets; only the built-ins are components
    const app = compileVaporSfc(src, { file: 'p.vue', id: 'data-v-1', web: false, moduleTags: new Set() }) as { code: string };
    expect(app.code.match(/import "fjs\/tag\/[^"]+";/g)).toEqual(['import "fjs/tag/list-view";']);
  });
});

describe('scoped styles reach a child component root (specs/171)', () => {
  it("the page's data-v id lands on <list-view>'s root and on a vapor child's root", async () => {
    const comp = compileSfc(`
<script setup>
const items = ['a']
</script>
<template><view><list-view class="lv" :items="items"><template #default="{ item }"><text>{{ item }}</text></template></list-view></view></template>
<style scoped>.lv { height: 10px; }</style>`, { vapor: true, web: true, runtime: vue as unknown as Record<string, unknown> });
    const root = document.createElement('div');
    document.body.appendChild(root);
    vue.createVaporApp(comp.component as never).mount(root as never);
    await wait();
    expect(root.querySelector('list-view')?.hasAttribute(comp.scopeId)).toBe(true);
  });
});
