// specs/171: the built-in components in a PURE vapor Flutter app (the
// enableVapor surface — flutter-pure, no VDOM renderer): list-view / form /
// picker / rich-text / textarea / canvas / defer run on the render host,
// registered through their `fjs/tag/<tag>` modules as the compiler imports
// them.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setOpSink } from '../src/host';
import { installEventDispatcher } from '../src/ui/element';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/flutter-pure');
type Host = typeof import('../src/vue/host-ops');
let vue: Vue;
let r: Host;
const g = globalThis as Record<string, unknown>;
const log: string[] = [];
g.__log = log;
let frames = '';

beforeAll(async () => {
  vue = await import('../src/vapor/flutter-pure');
  r = await import('../src/vue/host-ops');
  for (const tag of ['list-view', 'form', 'picker', 'rich-text', 'textarea', 'canvas', 'defer']) {
    await import(`../src/vapor/tags/flutter/${tag}.ts`);
  }
});

beforeEach(() => {
  log.length = 0;
  frames = '';
  installEventDispatcher();
  setOpSink((frame: Uint8Array) => {
    frames += new TextDecoder().decode(frame);
    const fjsText = (frame as Uint8Array & { fjsText?: string[] }).fjsText;
    if (fjsText) frames += fjsText.join('\u0000');
  });
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  (await import('../src/ui/element')).flush();
};
const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
const dispatch = (id: number, type: number, payload: string | null): void =>
  (g.__fjsDispatchEvent as (id: number, type: number, payload: string | null) => void)(id, type, payload);

function mount(source: string): { id: number } {
  const comp = compileSfc(source, { vapor: true, runtime: vue as unknown as Record<string, unknown> }).component;
  const root = r.flutterRoot();
  vue.createVaporApp(comp as never).mount(root);
  return root;
}

function findTag(id: number, tag: string): number[] {
  const out: number[] = [];
  const walk = (n: number): void => {
    if (r.elementTag(n) === tag) out.push(n);
    for (const k of r.childElementIds(n)) walk(k);
  };
  walk(id);
  return out;
}

describe('vapor templates on Flutter keep their static attributes (specs/171)', () => {
  it('src / placeholder / name / form-type reach the elements, cloned or not', async () => {
    mount(`
<script setup>
const a = 1
</script>
<template><view><image src="pic.png" mode="aspectFill" /><input name="who" placeholder="type here" /><button form-type="submit">go</button></view></template>`);
    await settle();
    for (const v of ['pic.png', 'aspectFill', 'type here', 'who', 'submit']) expect(frames).toContain(v);
  });
});

describe('built-in components on the Flutter render host (specs/171)', () => {
  it('list-view: a native list-view element, one row per item through the scoped slot', async () => {
    const root = mount(`
<script setup>
import { ref } from 'vue'
const items = ref(['a', 'b', 'c'])
globalThis.__items = items
</script>
<template>
  <list-view :items="items" :item-height="40">
    <template #default="{ item, index }"><view class="row"><text>{{ index }}-{{ item }}</text></view></template>
  </list-view>
</template>`);
    await settle();
    const lv = findTag(root.id, 'list-view');
    expect(lv.length).toBe(1);
    expect(r.childElementIds(lv[0]).length).toBe(3);
    frames = '';
    (g.__items as { value: string[] }).value = ['a', 'b', 'c', 'dd-new'];
    await settle();
    expect(r.childElementIds(lv[0]).length).toBe(4);
    expect(frames).toContain('dd-new');
  });

  it('textarea renders the multiline input element and maps its events', async () => {
    const root = mount(`
<script setup>
const push = (s) => globalThis.__log.push(s)
</script>
<template><textarea value="x" @input="(v) => push('input:' + v)" /></template>`);
    await settle();
    const input = findTag(root.id, 'input');
    expect(input.length).toBe(1);
    dispatch(input[0], 3 /* textChanged */, 'typed');
    await settle();
    expect(log).toEqual(['input:typed']);
  });

  it('canvas: the inner-canvas surface inside its box; defer mounts after the page settles', async () => {
    const root = mount(`
<script setup>
</script>
<template><view><canvas class="cv"><text>overlay</text></canvas><defer><text class="late">later</text></defer></view></template>`);
    await settle();
    expect(findTag(root.id, 'inner-canvas').length).toBe(1);
    // no router here: onPageSettled falls back to the next microtask, so
    // the deferred content is in by now (the overlay text + the late one)
    await wait(20);
    await settle();
    expect(findTag(root.id, 'text').length).toBe(2);
  });

  it('form collects named fields on submit; rich-text builds text nodes; picker renders its trigger', async () => {
    const root = mount(`
<script setup>
const push = (s) => globalThis.__log.push(s)
</script>
<template>
  <view>
    <form @submit="(v) => push('submit:' + v)">
      <input name="who" value="me" />
      <button form-type="submit" class="go">go</button>
    </form>
    <rich-text nodes="<b>bold</b> plain" />
    <picker mode="selector" :range="['x', 'y']"><text class="pick">pick</text></picker>
  </view>
</template>`);
    await settle();
    const button = findTag(root.id, 'button')[0];
    expect(button).toBeDefined();
    dispatch(button, 1 /* tap */, null);
    await settle();
    expect(log.some((l) => l.startsWith('submit:') && l.includes('who'))).toBe(true);
    expect(frames).toContain('bold');
    expect(frames).toContain('pick');
  });
});
