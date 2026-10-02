// @vitest-environment happy-dom
// specs/174: <component :is>, <Transition> and <KeepAlive> in vapor
// components on the web backend.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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
});

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

function page(source: string, extra: Record<string, unknown> = {}): HTMLElement {
  const comp = compileSfc(source, { vapor: true, web: true, runtime: vue as unknown as Record<string, unknown> }).component;
  const root = document.createElement('div');
  document.body.appendChild(root);
  vue.createVaporApp(comp as never, { components: extra } as never).mount(root as never);
  return root;
}

/** A vapor child component compiled on its own. */
function child(name: string, source: string): unknown {
  const c = compileSfc(source, { vapor: true, web: true, runtime: vue as unknown as Record<string, unknown> }).component as Record<string, unknown>;
  c.name = name;
  return c;
}

const classOf = (root: HTMLElement, sel: string): string => root.querySelector(sel)?.getAttribute('class') ?? '';

describe('<component :is> switches (specs/174)', () => {
  it('rebuilds when `is` names another component, keeps it otherwise', async () => {
    g.__A = child('A', `<script setup>globalThis.__log.push('A setup')</script><template><text class="a">A</text></template>`);
    g.__B = child('B', `<script setup>globalThis.__log.push('B setup')</script><template><text class="b">B</text></template>`);
    const root = page(`
<script setup>
import { shallowRef } from 'vue'
const cur = shallowRef(globalThis.__A)
globalThis.__cur = cur
</script>
<template><view><component :is="cur" /></view></template>`);
    await wait();
    expect(root.querySelector('.a')).not.toBeNull();
    (g.__cur as { value: unknown }).value = g.__B;
    await wait();
    expect(root.querySelector('.a')).toBeNull();
    expect(root.querySelector('.b')?.textContent).toBe('B');
    expect(log).toEqual(['A setup', 'B setup']);
  });
});

describe('<Transition> (specs/174)', () => {
  it('v-if: enter classes, then leave classes; the node stays until the leave is over', async () => {
    const root = page(`
<script setup>
import { ref } from 'vue'
const ok = ref(false)
globalThis.__ok = ok
const push = (s) => globalThis.__log.push(s)
</script>
<template>
  <view>
    <Transition name="fade" :duration="60" @after-enter="push('after-enter')" @after-leave="push('after-leave')">
      <view v-if="ok" class="box">x</view>
    </Transition>
  </view>
</template>`);
    await wait();
    expect(root.querySelector('.box')).toBeNull();
    (g.__ok as { value: boolean }).value = true;
    await wait(1);
    expect(classOf(root, '.box')).toContain('fade-enter-from');
    expect(classOf(root, '.box')).toContain('fade-enter-active');
    await wait(45);
    expect(classOf(root, '.box')).toContain('fade-enter-to');
    expect(classOf(root, '.box')).not.toContain('fade-enter-from');
    await wait(80);
    expect(classOf(root, '.box').trim()).toBe('box');
    expect(log).toEqual(['after-enter']);

    (g.__ok as { value: boolean }).value = false;
    await wait(1);
    expect(classOf(root, '.box')).toContain('fade-leave-active');
    await wait(45);
    expect(classOf(root, '.box')).toContain('fade-leave-to');
    await wait(80);
    expect(root.querySelector('.box')).toBeNull();
    expect(log).toEqual(['after-enter', 'after-leave']);
  });

  it('a class re-render mid-transition keeps the transition classes', async () => {
    const root = page(`
<script setup>
import { ref } from 'vue'
const ok = ref(false)
const tone = ref('a')
globalThis.__s = { ok, tone }
</script>
<template>
  <view><Transition name="fade" :duration="80"><view v-if="ok" class="box" :class="tone">x</view></Transition></view>
</template>`);
    await wait();
    const s = g.__s as { ok: { value: boolean }; tone: { value: string } };
    s.ok.value = true;
    await wait(1);
    s.tone.value = 'b';
    await wait(5);
    expect(classOf(root, '.box')).toContain('b');
    expect(classOf(root, '.box')).toContain('fade-enter-active');
  });

  it('v-show: hidden only after the leave; showing again mid-leave cancels it', async () => {
    const root = page(`
<script setup>
import { ref } from 'vue'
const ok = ref(true)
globalThis.__ok = ok
const push = (s) => globalThis.__log.push(s)
</script>
<template>
  <view><Transition name="fade" :duration="80" @leave-cancelled="push('leave-cancelled')"><view v-show="ok" class="box">x</view></Transition></view>
</template>`);
    await wait();
    const box = root.querySelector('.box') as HTMLElement;
    (g.__ok as { value: boolean }).value = false;
    await wait(40);
    expect(box.style.display).not.toBe('none');
    expect(box.getAttribute('class')).toContain('fade-leave-active');
    (g.__ok as { value: boolean }).value = true;
    await wait(150);
    expect(box.style.display).not.toBe('none');
    expect(log).toEqual(['leave-cancelled']);
    (g.__ok as { value: boolean }).value = false;
    await wait(150);
    expect(box.style.display).toBe('none');
  });

  it('out-in: the new branch renders only after the old one has left', async () => {
    g.__A = child('A', `<script setup>\nconst _a = 0\n</script><template><text class="a">A</text></template>`);
    g.__B = child('B', `<script setup>\nconst _b = 0\n</script><template><text class="b">B</text></template>`);
    const root = page(`
<script setup>
import { shallowRef } from 'vue'
const cur = shallowRef(globalThis.__A)
globalThis.__cur = cur
</script>
<template><view><Transition name="s" mode="out-in" :duration="50"><component :is="cur" /></Transition></view></template>`);
    await wait();
    (g.__cur as { value: unknown }).value = g.__B;
    await wait(20);
    expect(root.querySelector('.a')).not.toBeNull();
    expect(root.querySelector('.b')).toBeNull();
    await wait(80);
    expect(root.querySelector('.a')).toBeNull();
    expect(root.querySelector('.b')).not.toBeNull();
    expect(classOf(root, '.b')).toContain('s-enter');
  });

  it('appear runs the enter on mount; css=false runs JS hooks only, done-driven', async () => {
    const root = page(`
<script setup>
import { ref } from 'vue'
const ok = ref(true)
globalThis.__ok = ok
const push = (s) => globalThis.__log.push(s)
const onLeave = (el, done) => { push('leave'); setTimeout(done, 30) }
</script>
<template>
  <view>
    <Transition name="ap" appear :duration="40"><view class="a1">a</view></Transition>
    <Transition :css="false" @leave="onLeave" @after-leave="push('gone')"><view v-if="ok" class="j">j</view></Transition>
  </view>
</template>`);
    await wait(1);
    expect(classOf(root, '.a1')).toContain('ap-enter-active');
    (g.__ok as { value: boolean }).value = false;
    await wait(5);
    expect(root.querySelector('.j')).not.toBeNull();
    expect(classOf(root, '.j')).not.toContain('leave');
    await wait(60);
    expect(root.querySelector('.j')).toBeNull();
    expect(log).toEqual(['leave', 'gone']);
  });
});

describe('<KeepAlive> (specs/174)', () => {
  it('keeps state across switches, fires activated / deactivated (children too), honours max', async () => {
    const counter = (name: string) =>
      child(name, `
<script setup>
import { ref, onActivated, onDeactivated, onUnmounted } from 'vue'
const n = ref(0)
globalThis.__n_${name} = n
onActivated(() => globalThis.__log.push('${name} on'))
onDeactivated(() => globalThis.__log.push('${name} off'))
onUnmounted(() => globalThis.__log.push('${name} gone'))
</script>
<template><text class="${name}">${name}{{ n }}</text></template>`);
    g.__A = counter('A');
    g.__B = counter('B');
    g.__C = counter('C');
    const root = page(`
<script setup>
import { shallowRef } from 'vue'
const cur = shallowRef(globalThis.__A)
globalThis.__cur = cur
</script>
<template><view><KeepAlive :max="2"><component :is="cur" /></KeepAlive></view></template>`);
    await wait();
    const cur = g.__cur as { value: unknown };
    expect(log).toEqual(['A on']);
    (g.__n_A as { value: number }).value = 5;
    await wait();
    cur.value = g.__B;
    await wait();
    expect(root.querySelector('.A')).toBeNull();
    cur.value = g.__A;
    await wait();
    expect(root.querySelector('.A')?.textContent).toBe('A5');
    expect(log).toEqual(['A on', 'A off', 'B on', 'B off', 'A on']);
    log.length = 0;
    // max 2: A is live; B kept; C pushes the oldest kept (B) out
    cur.value = g.__C;
    await wait();
    cur.value = g.__A;
    await wait();
    expect(log).toEqual(['A off', 'C on', 'B gone', 'C off', 'A on']);
  });

  it('include: an excluded component is destroyed on leave', async () => {
    g.__X = child('X', `<script setup>import { ref } from 'vue'\nconst n = ref(0)\nglobalThis.__n_X = n</script><template><text class="X">X{{ n }}</text></template>`);
    g.__Y = child('Y', `<script setup>\nconst _y = 0\n</script><template><text class="Y">Y</text></template>`);
    const root = page(`
<script setup>
import { shallowRef } from 'vue'
const cur = shallowRef(globalThis.__X)
globalThis.__cur = cur
</script>
<template><view><KeepAlive include="Y"><component :is="cur" /></KeepAlive></view></template>`);
    await wait();
    (g.__n_X as { value: number }).value = 3;
    const cur = g.__cur as { value: unknown };
    cur.value = g.__Y;
    await wait();
    cur.value = g.__X;
    await wait();
    expect(root.querySelector('.X')?.textContent).toBe('X0');
  });
});
