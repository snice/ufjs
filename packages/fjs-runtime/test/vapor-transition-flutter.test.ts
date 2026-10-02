// specs/174: <Transition> / <KeepAlive> in vapor components on the Flutter
// backend — the transition classes go through the style engine (what the
// peer's styles follow), KeepAlive parks hosts without destroying them.
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

beforeAll(async () => {
  vue = await import('../src/vapor/flutter-pure');
  r = await import('../src/vue/host-ops');
});

beforeEach(() => {
  log.length = 0;
  installEventDispatcher();
  setOpSink(() => {});
});

const wait = (ms = 20): Promise<void> => new Promise((res) => setTimeout(res, ms));

function mount(source: string): { id: number } {
  const comp = compileSfc(source, { vapor: true, runtime: vue as unknown as Record<string, unknown> }).component;
  const root = r.flutterRoot();
  vue.createVaporApp(comp as never).mount(root);
  return root;
}

function child(name: string, source: string): unknown {
  const c = compileSfc(source, { vapor: true, runtime: vue as unknown as Record<string, unknown> }).component as Record<string, unknown>;
  c.name = name;
  return c;
}

/** Ids of the elements under `id` carrying class `cls`. */
function withClass(id: number, cls: string): number[] {
  const out: number[] = [];
  const walk = (n: number): void => {
    if (r.styleEngine.classesOf(n).includes(cls)) out.push(n);
    for (const k of r.childElementIds(n)) walk(k);
  };
  walk(id);
  return out;
}

describe('vapor <Transition> on Flutter (specs/174)', () => {
  it('v-if: enter / leave classes in the style engine; the element leaves after the leave', async () => {
    const root = mount(`
<script setup>
import { ref } from 'vue'
const ok = ref(false)
globalThis.__ok = ok
</script>
<template><view><Transition name="fade" :duration="60"><view v-if="ok" class="box">x</view></Transition></view></template>`);
    await wait();
    (g.__ok as { value: boolean }).value = true;
    await wait(1);
    const [box] = withClass(root.id, 'box');
    expect(r.styleEngine.classesOf(box)).toEqual(expect.arrayContaining(['fade-enter-from', 'fade-enter-active']));
    await wait(45);
    expect(r.styleEngine.classesOf(box)).toContain('fade-enter-to');
    await wait(80);
    expect(r.styleEngine.classesOf(box)).toEqual(['box']);
    (g.__ok as { value: boolean }).value = false;
    await wait(5);
    expect(withClass(root.id, 'fade-leave-active')).toEqual([box]);
    await wait(150);
    expect(withClass(root.id, 'box')).toEqual([]);
  });
});

describe('vapor <KeepAlive> on Flutter (specs/174)', () => {
  it('a switched-away component keeps its state and its element', async () => {
    g.__FA = child('FA', `
<script setup>
import { ref, onActivated } from 'vue'
const n = ref(0)
globalThis.__fn = n
onActivated(() => globalThis.__log.push('FA on'))
</script>
<template><text class="fa">{{ n }}</text></template>`);
    g.__FB = child('FB', `<script setup>\nconst _b = 0\n</script><template><text class="fb">b</text></template>`);
    const root = mount(`
<script setup>
import { shallowRef } from 'vue'
const cur = shallowRef(globalThis.__FA)
globalThis.__fcur = cur
</script>
<template><view><KeepAlive><component :is="cur" /></KeepAlive></view></template>`);
    await wait();
    const [fa] = withClass(root.id, 'fa');
    (g.__fn as { value: number }).value = 7;
    const cur = g.__fcur as { value: unknown };
    cur.value = g.__FB;
    await wait();
    expect(withClass(root.id, 'fa')).toEqual([]);
    cur.value = g.__FA;
    await wait();
    // the same element, back in the tree
    expect(withClass(root.id, 'fa')).toEqual([fa]);
    expect(log).toEqual(['FA on', 'FA on']);
  });
});
