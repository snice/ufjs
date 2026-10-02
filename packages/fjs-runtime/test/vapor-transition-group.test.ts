// @vitest-environment happy-dom
// specs/176: <TransitionGroup> in vapor components — item enter / leave and
// the FLIP move pass, on the web backend (Flutter: classes in the style
// engine, see the last case).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/web-pure');
let vue: Vue;
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  vue = await import('../src/vapor/web-pure');
});

// happy-dom lays nothing out: a row's box follows its place among its
// siblings, 10px apart — enough for the move pass to see who moved
let rectSpy: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const i = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
    return { x: 0, y: i * 10, left: 0, top: i * 10, right: 100, bottom: i * 10 + 10, width: 100, height: 10, toJSON() {} } as DOMRect;
  });
});
afterEach(() => {
  rectSpy?.mockRestore();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const wait = async (ms = 20): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

function page(source: string): HTMLElement {
  const comp = compileSfc(source, { vapor: true, web: true, runtime: vue as unknown as Record<string, unknown> }).component;
  const root = document.createElement('div');
  document.body.appendChild(root);
  vue.createVaporApp(comp as never).mount(root as never);
  return root;
}

const LIST = `
<script setup>
import { ref } from 'vue'
const items = ref(['a', 'b', 'c'])
globalThis.__items = items
</script>
<template>
  <TransitionGroup name="list" tag="view" class="list" :duration="60">
    <text v-for="i in items" :key="i" :class="'row r-' + i">{{ i }}</text>
  </TransitionGroup>
</template>`;

const row = (root: HTMLElement, k: string): Element | null => root.querySelector(`.r-${k}`);
const items = (): { value: string[] } => g.__items as { value: string[] };

describe('<TransitionGroup> (specs/176)', () => {
  it('renders its tag around the items, with the fallthrough class', async () => {
    const root = page(LIST);
    await wait();
    const list = root.querySelector('view.list');
    expect(list).not.toBeNull();
    expect([...list!.querySelectorAll('.row')].map((e) => e.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('a new item enters; a removed one leaves before it is gone', async () => {
    const root = page(LIST);
    await wait();
    items().value = ['a', 'b', 'c', 'd'];
    await wait(1);
    expect(row(root, 'd')?.getAttribute('class')).toContain('list-enter-from');
    await wait(150);
    expect(row(root, 'd')?.getAttribute('class')).not.toContain('list-enter');

    items().value = ['a', 'c', 'd'];
    await wait(1);
    expect(row(root, 'b')?.getAttribute('class')).toContain('list-leave-active');
    await wait(150);
    expect(row(root, 'b')).toBeNull();
    expect([...root.querySelectorAll('.row')].map((e) => e.textContent)).toEqual(['a', 'c', 'd']);
  });

  it('moved items are put back with a transform, then slide with the move class', async () => {
    const root = page(LIST);
    await wait();
    items().value = ['c', 'b', 'a'];
    await wait(0);
    const a = row(root, 'a') as HTMLElement;
    // a went from slot 0 to slot 2: put back 20px up, transitions off
    expect(a.style.transform).toBe('translate(0px, -20px)');
    expect(row(root, 'b')?.getAttribute('style') ?? '').not.toContain('translate');
    await wait(40);
    expect(a.getAttribute('class')).toContain('list-move');
    expect(a.style.transform).toBe('');
    await wait(200);
    expect(a.getAttribute('class')).not.toContain('list-move');
  });

  it('a content that is not a v-for renders as is, with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = page(`
<script setup>
const x = 1
</script>
<template><TransitionGroup tag="view"><text class="one">1</text></TransitionGroup></template>`);
    await wait();
    expect(root.querySelector('view .one')).not.toBeNull();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('<TransitionGroup>'))).toBe(true);
    warn.mockRestore();
  });
});
