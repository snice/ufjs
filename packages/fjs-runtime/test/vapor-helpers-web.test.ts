// @vitest-environment happy-dom
// specs/170: compiler-vapor helpers and the component layer, over the DOM
// backend with real compiled SFCs. (The Flutter twin: vapor-helpers-flutter.)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/web-pure');
let vue: Vue;
const g = globalThis as Record<string, unknown>;
const log: string[] = [];
g.__log = log;

beforeAll(async () => {
  vue = await import('../src/vapor/web-pure');
});

afterEach(() => {
  log.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function sfc(source: string, imports: Record<string, unknown> = {}): Record<string, unknown> {
  return compileSfc(source, { vapor: true, runtime: vue as unknown as Record<string, unknown>, imports }).component;
}

function mount(comp: Record<string, unknown>): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  vue.createVaporApp(comp as never).mount(root as never);
  return root;
}

describe('template refs', () => {
  it('element ref, component ref (expose), v-for ref array, cleared on unmount', async () => {
    const Child = sfc(`
<script setup>
defineExpose({ hello: () => 'hi' })
</script>
<template><text class="child">c</text></template>`);
    const Page = sfc(`
<script setup>
import { ref, onMounted } from 'vue'
import Child from './child'
const el = ref(null)
const ch = ref(null)
const items = ref([1, 2, 3])
const list = ref([])
const show = ref(true)
globalThis.__refs = { el, ch, list, items, show }
onMounted(() => globalThis.__log.push('mounted el=' + el.value.className + ' ch=' + ch.value.hello() + ' list=' + list.value.length))
</script>
<template>
  <view class="box" ref="el">
    <Child ref="ch" />
    <view v-if="show"><text v-for="i in items" :key="i" ref="list">{{ i }}</text></view>
  </view>
</template>`, { './child': Child });
    mount(Page);
    expect(log).toEqual(['mounted el=box ch=hi list=3']);
    const refs = g.__refs as { list: { value: unknown[] }; items: { value: number[] }; show: { value: boolean } };
    refs.items.value.pop();
    await tick();
    expect(refs.list.value.length).toBe(2);
    refs.show.value = false;
    await tick();
    expect(refs.list.value.length).toBe(0);
  });
});

describe('directives', () => {
  it('v-show toggles display on an element and on a component root', async () => {
    const Child = sfc(`<script setup>
</script>
<template><text class="kid">k</text></template>`);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
import Child from './child'
const on = ref(true)
globalThis.__on = on
</script>
<template><view><view class="a" v-show="on" /><Child v-show="on" /></view></template>`, { './child': Child });
    const root = mount(Page);
    const a = root.querySelector('.a') as HTMLElement;
    const kid = root.querySelector('.kid') as HTMLElement;
    expect(a.style.display).toBe('');
    (g.__on as { value: boolean }).value = false;
    await tick();
    expect(a.style.display).toBe('none');
    expect(kid.style.display).toBe('none');
    (g.__on as { value: boolean }).value = true;
    await tick();
    expect(a.style.display).toBe('');
  });

  it('v-model: text with .trim / .number / .lazy, checkbox (boolean and array), radio', async () => {
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const t = ref('a'); const n = ref(1); const l = ref('x'); const b = ref(false); const arr = ref([]); const r = ref('one')
globalThis.__m = { t, n, l, b, arr, r }
</script>
<template>
  <view>
    <input class="t" v-model.trim="t" />
    <input class="n" v-model.number="n" />
    <input class="l" v-model.lazy="l" />
    <input class="b" type="checkbox" v-model="b" />
    <input class="c1" type="checkbox" value="p" v-model="arr" />
    <input class="c2" type="checkbox" value="q" v-model="arr" />
    <input class="r1" type="radio" value="one" v-model="r" />
    <input class="r2" type="radio" value="two" v-model="r" />
  </view>
</template>`);
    const root = mount(Page);
    const m = g.__m as Record<string, { value: unknown }>;
    const q = (c: string) => root.querySelector(c) as HTMLInputElement;
    expect(q('.t').value).toBe('a');
    q('.t').value = '  hi  ';
    q('.t').dispatchEvent(new Event('input'));
    expect(m.t.value).toBe('hi');
    q('.n').value = '42';
    q('.n').dispatchEvent(new Event('input'));
    expect(m.n.value).toBe(42);
    q('.l').value = 'y';
    q('.l').dispatchEvent(new Event('input'));
    expect(m.l.value).toBe('x');
    q('.l').dispatchEvent(new Event('change'));
    expect(m.l.value).toBe('y');
    m.t.value = 'from model';
    await tick();
    expect(q('.t').value).toBe('from model');
    q('.b').checked = true;
    q('.b').dispatchEvent(new Event('change'));
    expect(m.b.value).toBe(true);
    q('.c2').checked = true;
    q('.c2').dispatchEvent(new Event('change'));
    expect(m.arr.value).toEqual(['q']);
    m.arr.value = ['p'];
    await tick();
    expect([q('.c1').checked, q('.c2').checked]).toEqual([true, false]);
    expect([q('.r1').checked, q('.r2').checked]).toEqual([true, false]);
    q('.r2').checked = true;
    q('.r2').dispatchEvent(new Event('change'));
    expect(m.r.value).toBe('two');
  });

  it('v-bind="obj" / v-on="obj", with keys appearing and disappearing', async () => {
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const attrs = ref({ title: 'a', class: 'x', style: { color: 'red' } })
const evs = { tap: () => globalThis.__log.push('tap') }
globalThis.__attrs = attrs
</script>
<template><view class="own" v-bind="attrs" v-on="evs" @tap="() => globalThis.__log.push('own')" /></template>`);
    const root = mount(Page);
    const el = root.querySelector('view') as HTMLElement;
    expect(el.getAttribute('title')).toBe('a');
    expect(el.style.color).toBe('red');
    el.click();
    expect(log.sort()).toEqual(['own', 'tap']);
    (g.__attrs as { value: unknown }).value = { 'data-k': '1' };
    await tick();
    expect(el.getAttribute('title')).toBeNull();
    expect(el.getAttribute('data-k')).toBe('1');
    expect(el.style.color).toBe('');
  });

  it('event modifiers: .stop / .self / key filters', () => {
    const Page = sfc(`
<script setup>
const push = (s) => globalThis.__log.push(s)
</script>
<template>
  <view class="outer" @click="push('outer')">
    <view class="stop" @click.stop="push('stop')" />
    <view class="self" @click.self="push('self')"><text class="inner">i</text></view>
    <input class="k" @keyup.enter="push('enter')" />
  </view>
</template>`);
    const root = mount(Page);
    (root.querySelector('.stop') as HTMLElement).click();
    (root.querySelector('.inner') as HTMLElement).click();
    const k = root.querySelector('.k') as HTMLElement;
    k.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    k.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    expect(log).toEqual(['stop', 'outer', 'enter']);
  });

  it('v-html, v-once, a keyed block rebuilt on key change, <component :is="tag">', async () => {
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const html = ref('<b>bold</b>')
const k = ref(1)
const n = ref(1)
const built = () => { globalThis.__log.push('built'); return k.value }
globalThis.__s = { html, k, n }
</script>
<template>
  <view>
    <view class="h" v-html="html" />
    <text class="once" v-once>{{ n }}</text>
    <view class="keyed" :key="k"><text>{{ built() }}</text></view>
    <component :is="'view'" class="dyn"><text>dyn</text></component>
  </view>
</template>`);
    const root = mount(Page);
    const s = g.__s as Record<string, { value: unknown }>;
    expect(root.querySelector('.h')!.innerHTML).toBe('<b>bold</b>');
    expect(root.querySelector('.dyn')!.textContent).toBe('dyn');
    s.n.value = 2;
    s.k.value = 2;
    await tick();
    expect(root.querySelector('.once')!.textContent).toBe('1');
    expect(log).toEqual(['built', 'built']);
    expect(root.querySelector('.keyed')!.textContent).toBe('2');
  });

  it('a v-for selector (:class on the active item) follows the source', async () => {
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const sel = ref(1)
const items = ref([1, 2, 3])
globalThis.__sel = sel
</script>
<template><view><text v-for="i in items" :key="i" :class="{ on: sel === i }">{{ i }}</text></view></template>`);
    const root = mount(Page);
    const on = () => [...root.querySelectorAll('text.on')].map((e) => e.textContent).join();
    expect(on()).toBe('1');
    (g.__sel as { value: number }).value = 3;
    await tick();
    expect(on()).toBe('3');
  });
});

describe('component layer', () => {
  const CHILD = `
<script setup>
const props = defineProps(['label'])
defineEmits(['pick'])
</script>
<template><view class="root" :style="{ padding: '1px' }" @click="() => globalThis.__log.push('child-own')"><text>{{ props.label }}</text></view></template>`;

  it('attrs fall through: class and style merge, listeners stack, declared props / emits stay out', async () => {
    const Child = sfc(CHILD);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
import Child from './child'
const cls = ref('a')
globalThis.__cls = cls
const onPick = () => {}
</script>
<template><Child label="L" :class="cls" :style="{ color: 'red' }" title="t" @click="() => globalThis.__log.push('parent')" @pick="onPick" /></template>`, { './child': Child });
    const root = mount(Page);
    const el = root.querySelector('view') as HTMLElement;
    expect(el.className).toBe('root a');
    expect(el.style.padding).toBe('1px');
    expect(el.style.color).toBe('red');
    expect(el.getAttribute('title')).toBe('t');
    expect(el.getAttribute('label')).toBeNull();
    expect(el.getAttribute('onPick')).toBeNull();
    el.click();
    expect(log).toEqual(['child-own', 'parent']);
    (g.__cls as { value: string }).value = 'b';
    await tick();
    expect(el.className).toBe('root b');
  });

  it('inheritAttrs: false and multi-root components do not fall through; useAttrs sees them', () => {
    const NoInherit = sfc(`
<script setup>
import { useAttrs } from 'vue'
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
globalThis.__log.push('attrs:' + attrs.title)
</script>
<template><view class="ni" /></template>`);
    const Multi = sfc(`<script setup>
</script>
<template><view class="m1" /><view class="m2" /></template>`);
    const Page = sfc(`
<script setup>
import NoInherit from './ni'
import Multi from './multi'
</script>
<template><view><NoInherit title="x" /><Multi title="y" /></view></template>`, { './ni': NoInherit, './multi': Multi });
    const root = mount(Page);
    expect(log).toEqual(['attrs:x']);
    expect(root.querySelector('.ni')!.getAttribute('title')).toBeNull();
    expect(root.querySelector('.m1')!.getAttribute('title')).toBeNull();
  });

  it('scoped slots get their props, and they stay reactive', async () => {
    const List = sfc(`
<script setup>
const props = defineProps(['items'])
</script>
<template><view><view v-for="(it, i) in props.items" :key="i"><slot :item="it" :index="i" /></view></view></template>`);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
import List from './list'
const items = ref(['a', 'b'])
globalThis.__items = items
</script>
<template><List :items="items"><template #default="{ item, index }"><text class="cell">{{ index }}:{{ item }}</text></template></List></template>`, { './list': List });
    const root = mount(Page);
    const cells = () => [...root.querySelectorAll('.cell')].map((e) => e.textContent).join(',');
    expect(cells()).toBe('0:a,1:b');
    (g.__items as { value: string[] }).value[0] = 'z';
    await tick();
    expect(cells()).toBe('0:z,1:b');
  });

  it('Transition / KeepAlive / Teleport render their content (specs/174, specs/175: Teleport moves it to its target)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const on = ref(true)
</script>
<template>
  <view>
    <Transition name="fade"><text v-if="on" class="tr">t</text></Transition>
    <Transition><text class="tr2">t2</text></Transition>
    <KeepAlive><text class="ka">k</text></KeepAlive>
    <Teleport to="body"><text class="tp">p</text></Teleport>
  </view>
</template>`);
    const root = mount(Page);
    expect(['.tr', '.tr2', '.ka'].map((c) => !!root.querySelector(c))).toEqual([true, true, true]);
    // teleported to <body>, out of the page
    expect(root.querySelector('.tp')).toBeNull();
    expect(document.querySelector('body > .tp')).not.toBeNull();
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes('<Transition>'))).toBe(false);
    // a KeepAlive around a plain element has nothing to keep — said once
    expect(msgs.some((m) => m.includes('<KeepAlive>'))).toBe(true);
    expect(msgs.some((m) => m.includes('<Teleport'))).toBe(false);
  });
});
