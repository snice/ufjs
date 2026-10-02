// @vitest-environment happy-dom
// specs/181: what hello-fjs under enableVapor turned up — a `<slot/>`
// forwarded inside a component-backed tag, slot / template content that
// returns several roots of which some are multi-node blocks, and
// object-hook (VDOM) directives registered on the app (v-motion).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSfc } from './helpers/sfc';

vi.mock('vue', async () => await import('../src/vapor/vue-pure'));
let vue: typeof import('../src/vapor/web-pure');
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  vue = await import('../src/vapor/web-pure');
  for (const t of ['scroll-view', 'switch', 'divider', 'button', 'canvas', 'rich-text']) await import(`../src/vapor/tags/web/${t}.ts`);
});

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sfc = (source: string, imports: Record<string, unknown> = {}) =>
  compileSfc(source, { vapor: true, web: true, runtime: vue as never, imports }).component;

function mount(comp: unknown, appContext: Record<string, unknown> | null = null): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  vue.createVaporApp(comp as never, appContext as never).mount(root as never);
  return root;
}

const texts = (root: Element): string[] => [...root.querySelectorAll('text')].map((t) => t.textContent ?? '');

describe('enableVapor regressions from hello-fjs (specs/181)', () => {
  it('a <slot/> forwarded inside a component-backed tag renders the outer content once', async () => {
    const Shell = sfc(`<script setup></script>
<template><view class="shell"><scroll-view class="body"><slot /></scroll-view></view></template>`);
    const Page = sfc(`<script setup>
import Shell from './Shell.vue'
</script>
<template><Shell><text>page</text></Shell></template>`, { './Shell.vue': Shell });
    const root = mount(Page);
    await wait();
    expect(texts(root)).toEqual(['page']);
    expect(root.querySelector('.body text')).not.toBeNull();
  });

  it('several roots, some of them multi-node blocks, stay tracked through v-if flips and removal', async () => {
    const Panel = sfc(`<script setup></script>
<template><view class="card"><slot /></view></template>`);
    const Page = sfc(`<script setup>
import { ref } from 'vue'
import Panel from './Panel.vue'
const on = ref(false)
const show = ref(true)
globalThis.__on = on
globalThis.__show = show
</script>
<template>
  <view>
    <Panel v-if="show">
      <text>a</text>
      <divider />
      <text v-if="on">b</text>
      <switch />
      <text>c</text>
    </Panel>
  </view>
</template>`, { './Panel.vue': Panel });
    const root = mount(Page);
    await wait();
    expect(texts(root)).toEqual(['a', 'c']);
    expect(root.querySelector('divider')).not.toBeNull();
    (g.__on as { value: boolean }).value = true;
    await wait();
    expect(texts(root)).toEqual(['a', 'b', 'c']);
    // the panel goes: every host its slot content made goes with it,
    // including the `b` that arrived after the first render
    (g.__show as { value: boolean }).value = false;
    await wait();
    expect(texts(root)).toEqual([]);
    expect(root.querySelector('divider, switch, .card')).toBeNull();
  });

  it('a static v-for as the whole slot content (the batched repeatTemplate path) keeps its cells', async () => {
    const Panel = sfc(`<script setup></script>
<template><view class="card"><scroll-view class="sv"><slot /></scroll-view></view></template>`);
    const Page = sfc(`<script setup>
import { ref } from 'vue'
import Panel from './Panel.vue'
const k = ref(1)
globalThis.__k = k
</script>
<template>
  <view>
    <Panel><view v-for="n in 3" :key="n" class="tile"><text>{{ n }}</text></view></Panel>
    <Panel><view v-for="n in 2" :key="n" class="tile"><text>{{ n * k }}</text></view></Panel>
  </view>
</template>`, { './Panel.vue': Panel });
    const root = mount(Page);
    await wait();
    expect(texts(root)).toEqual(['1', '2', '3', '1', '2']);
    (g.__k as { value: number }).value = 10;
    await wait();
    expect(texts(root)).toEqual(['1', '2', '3', '10', '20']);
  });

  it("v-for's second / third alias is the index or property name, never the :key value", async () => {
    const Page = sfc(`<script setup>
import { ref } from 'vue'
const list = ref(['a', 'b', 'c'])
const obj = { x: 1, y: 2 }
const m = new Map([['k1', 'v1']])
globalThis.__list = list
</script>
<template>
  <view>
    <view class="arr"><text v-for="(s, i) in list" :key="s">{{ s }}{{ i }}</text></view>
    <view class="obj"><text v-for="(v, k, n) in obj" :key="k">{{ k }}={{ v }}@{{ n }}</text></view>
    <view class="map"><text v-for="(e, i) in m" :key="e[0]">{{ e[0] }}:{{ i }}</text></view>
    <view class="num"><text v-for="(n, i) in 2" :key="'n' + n">{{ n }}/{{ i }}</text></view>
  </view>
</template>`);
    const root = mount(Page);
    await wait();
    const at = (sel: string) => texts(root.querySelector(sel)!);
    expect(at('.arr')).toEqual(['a0', 'b1', 'c2']);
    expect(at('.obj')).toEqual(['x=1@0', 'y=2@1']);
    expect(at('.map')).toEqual(['k1:0']);
    expect(at('.num')).toEqual(['1/0', '2/1']);
    // keyed reorder: kept items get their new index
    (g.__list as { value: string[] }).value = ['c', 'a'];
    await wait();
    expect(at('.arr')).toEqual(['c0', 'a1']);
  });

  it('a v-if in a render-function component\'s slot stays switched off after that component re-renders', async () => {
    const Page = sfc(`<script setup>
import { ref } from 'vue'
const loading = ref(true)
const size = ref('default')
globalThis.__loading = loading
globalThis.__size = size
</script>
<template><view><button :size="size"><text v-if="loading" class="mask">wait</text><text>go</text></button></view></template>`);
    const root = mount(Page);
    await wait();
    expect(texts(root)).toEqual(['wait', 'go']);
    (g.__loading as { value: boolean }).value = false;
    await wait();
    expect(texts(root)).toEqual(['go']);
    // the button re-renders with its slot's CURRENT hosts
    (g.__size as { value: string }).value = 'mini';
    await wait();
    expect(texts(root)).toEqual(['go']);
    (g.__loading as { value: boolean }).value = true;
    await wait();
    expect(texts(root)).toEqual(['wait', 'go']);
  });

  it('slot content a render function hands on to another component keeps its effects (canvas overlay v-if)', async () => {
    const Page = sfc(`<script setup>
import { ref } from 'vue'
const loading = ref(true)
globalThis.__loadingCv = loading
</script>
<template><view><canvas class="gl"><view v-if="loading" class="mask"><text>wait</text></view></canvas></view></template>`);
    const root = mount(Page);
    await wait();
    expect(root.querySelector('.gl .mask')).not.toBeNull();
    (g.__loadingCv as { value: boolean }).value = false;
    await wait();
    expect(root.querySelector('.mask')).toBeNull();
  });

  it('rich-text paragraph runs render as spans on a plain <text> element', async () => {
    const Page = sfc(`<script setup>
const html = '<p>满 <b style="color: red">199</b> 减 30</p>'
</script>
<template><view><rich-text :nodes="html" /></view></template>`);
    const root = mount(Page);
    await wait();
    const text = root.querySelector('text')!;
    expect(text.textContent).toBe('满 199 减 30');
    expect(text.hasAttribute('richspans')).toBe(false);
    expect(text.querySelector('span')?.textContent).toBe('199');
  });

  it('a render-function component updates (onUpdated) when a prop its render never reads changes', async () => {
    const { h, onUpdated } = vue as unknown as typeof import('@vue/runtime-core');
    const seen: unknown[] = [];
    const Probe = {
      name: 'Probe',
      props: { target: { type: String, default: '' } },
      setup(props: { target: string }) {
        onUpdated(() => seen.push(props.target));
        return () => h('view', { class: 'probe' });
      },
    };
    const Page = sfc(`<script setup>
import { ref } from 'vue'
import Probe from './Probe'
const t = ref('')
globalThis.__target = t
</script>
<template><view><Probe :target="t" /></view></template>`, { './Probe': Probe });
    mount(Page);
    await wait();
    (g.__target as { value: string }).value = 'B';
    await wait();
    expect(seen).toEqual(['B']);
  });

  it('a component whose setup throws renders nothing; the rest of the page stays', async () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      const Bad = sfc(`<script setup>
throw new Error('boom')
</script>
<template><text>never</text></template>`);
      const Page = sfc(`<script setup>
import Bad from './Bad.vue'
</script>
<template><view><text>before</text><Bad /><text>after</text></view></template>`, { './Bad.vue': Bad });
      const root = mount(Page);
      await wait();
      expect(texts(root)).toEqual(['before', 'after']);
      expect(errors.length).toBe(1);
    } finally {
      console.error = orig;
    }
  });

  it('a multi-root component template with a live v-if root', async () => {
    const Two = sfc(`<script setup>
import { ref } from 'vue'
const on = ref(true)
globalThis.__two = on
</script>
<template><text>x</text><text v-if="on">y</text></template>`);
    const Page = sfc(`<script setup>
import { ref } from 'vue'
import Two from './Two.vue'
const show = ref(true)
globalThis.__showTwo = show
</script>
<template><view><Two v-if="show" /><text>z</text></view></template>`, { './Two.vue': Two });
    const root = mount(Page);
    await wait();
    expect(texts(root)).toEqual(['x', 'y', 'z']);
    (g.__two as { value: boolean }).value = false;
    await wait();
    (g.__two as { value: boolean }).value = true;
    await wait();
    expect(texts(root)).toEqual(['x', 'y', 'z']);
    (g.__showTwo as { value: boolean }).value = false;
    await wait();
    expect(texts(root)).toEqual(['z']);
  });

  it('an object-hook directive from the app runs created / mounted / updated / unmounted with the bound props', async () => {
    const log: string[] = [];
    const focus = {
      created: (el: Element, b: { value: unknown }, vnode: { props: Record<string, unknown> }) =>
        log.push(`created ${el.tagName.toLowerCase()} ${String(b.value)} ${JSON.stringify(vnode.props.initial)}`),
      mounted: (el: Element) => log.push(`mounted ${el.isConnected}`),
      updated: (_el: Element, b: { value: unknown; oldValue: unknown }) => log.push(`updated ${String(b.oldValue)}→${String(b.value)}`),
      unmounted: () => log.push('unmounted'),
    };
    const Page = sfc(`<script setup>
import { ref } from 'vue'
const n = ref(1)
const show = ref(true)
globalThis.__n = n
globalThis.__showDir = show
</script>
<template><view><view v-if="show" v-focus="n" :initial="{ opacity: 0 }" /></view></template>`);
    mount(Page, { components: {}, directives: { focus } });
    await wait();
    expect(log).toEqual(['created view 1 {"opacity":0}', 'mounted true']);
    (g.__n as { value: number }).value = 2;
    await wait();
    expect(log.at(-1)).toBe('updated 1→2');
    (g.__showDir as { value: boolean }).value = false;
    await wait();
    expect(log.at(-1)).toBe('unmounted');
  });
});
