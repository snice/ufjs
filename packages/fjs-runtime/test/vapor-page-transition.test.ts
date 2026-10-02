// @vitest-environment happy-dom
// specs/178: page transitions in the enableVapor web shell — the VDOM
// shell's class names, `data-nav`, overlap-then-hide and onPageSettled.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFjsApp } from '../src/app/web';
import '../src/vapor/web';
import { compileSfc } from './helpers/sfc';

const g = globalThis as Record<string, unknown>;
const log: string[] = [];
g.__log = log;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  log.length = 0;
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  vi.useRealTimers();
});

const tick = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

async function app(options: Record<string, unknown> = {}, routes?: Record<string, unknown>[]) {
  const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
  const fjsRouter = (await import('../src/router/web-vapor')) as unknown as Record<string, unknown>;
  const page = (name: string) =>
    compileSfc(
      `<script setup>
import { onPageSettled } from 'fjs/router'
onPageSettled(() => globalThis.__log.push('settled ${name}'))
</script>
<template><text class="${name}">${name}</text></template>`,
      { vapor: true, runtime: vue, modules: { 'fjs/router': fjsRouter } },
    ).component;
  const a = createFjsApp({
    enableVapor: true,
    el: '#app',
    routes: routes ?? [
      { path: '/', component: page('home') },
      { path: '/detail', component: page('detail') },
      { path: '/quiet', meta: { transition: false }, component: page('quiet') },
    ],
    ...options,
  } as never);
  a.mount();
  await tick(20);
  return a;
}

const host = () => document.querySelector('fjs-page-host') as HTMLElement;
const entry = (cls: string) => document.querySelector(`.${cls}`)?.closest('fjs-page-entry') as HTMLElement;
const classes = (el: HTMLElement) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();

describe('enableVapor web page transitions (specs/178)', () => {
  it('push: both pages overlap with the family classes; the old one hides after its leave; settled waits for the enter', async () => {
    const a = await app({ transition: 'fjs-slide' });
    log.length = 0;
    await a.router.push('/detail');
    await tick(0);
    expect(host().getAttribute('data-nav')).toBe('push');
    expect(classes(entry('detail'))).toEqual(['fjs-slide-enter-active', 'fjs-slide-enter-from']);
    expect(classes(entry('home'))).toEqual(['fjs-slide-leave-active', 'fjs-slide-leave-from']);
    expect(entry('home').style.display).toBe('');
    expect(log).toEqual([]);
    await tick(400);
    expect(classes(entry('detail'))).toEqual([]);
    expect(entry('home').style.display).toBe('none');
    expect(log).toEqual(['settled detail']);
  });

  it('pop plays the same family mirrored (data-nav="pop"), brings the page underneath back and drops the popped one', async () => {
    const a = await app({ transition: 'fjs-fade' });
    await a.router.push('/detail');
    await tick(400);
    a.router.back();
    // popstate arrives on the next task; the enter's two-frame hop is ~32ms
    // and happy-dom computes no CSS duration, so look before it ends
    await tick(5);
    expect(host().getAttribute('data-nav')).toBe('pop');
    expect(entry('home').style.display).toBe('');
    expect(classes(entry('home')).some((c) => c.startsWith('fjs-fade-enter'))).toBe(true);
    await tick(400);
    // popped off the history stack: destroyed once its leave is over (specs/183)
    expect(document.querySelector('.detail')).toBeNull();
    expect(classes(entry('home'))).toEqual([]);
  });

  it('`transition: false`, a page that turns it off, and the first page: no classes, settled at once', async () => {
    const off = await app({ transition: false });
    log.length = 0;
    await off.router.push('/detail');
    await tick(0);
    expect(host().getAttribute('data-nav')).toBe('none');
    expect(classes(entry('detail'))).toEqual([]);
    expect(entry('home').style.display).toBe('none');
    await tick(0);
    expect(log).toEqual(['settled detail']);

    document.body.innerHTML = '<div id="app"></div>';
    const on = await app();
    await on.router.push('/quiet');
    await tick(0);
    expect(host().getAttribute('data-nav')).toBe('none');
    expect(classes(entry('quiet'))).toEqual([]);
  });

  it('a tab switch has no animation', async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
    const tab = (name: string) => compileSfc(`<template><text class="${name}">${name}</text></template>`, { vapor: true, runtime: vue }).component;
    const a = await app({}, [
      { path: '/', meta: { tab: 0 }, component: tab('t0') },
      { path: '/t1', meta: { tab: 1 }, component: tab('t1') },
    ]);
    await a.router.replace('/t1');
    await tick(0);
    expect(host().getAttribute('data-nav')).toBe('none');
    expect(classes(entry('t1'))).toEqual([]);
  });

  it('a cached page is deactivated when left and activated when back — its VDOM components too (specs/181)', async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
    const { defineComponent, h, onActivated, onDeactivated } = await import('vue');
    const Layer = defineComponent({
      setup() {
        onDeactivated(() => log.push('vdom da'));
        onActivated(() => log.push('vdom a'));
        return () => h('i');
      },
    });
    const home = compileSfc(
      `<script setup>
import { onActivated, onDeactivated } from 'vue'
import Layer from './Layer'
onDeactivated(() => globalThis.__log.push('home da'))
onActivated(() => globalThis.__log.push('home a'))
</script>
<template><view><text class="home">home</text><Layer /></view></template>`,
      { vapor: true, runtime: vue, imports: { './Layer': Layer } },
    ).component;
    const detail = compileSfc(`<template><text class="detail">detail</text></template>`, { vapor: true, runtime: vue }).component;
    const a = await app({ transition: false }, [
      { path: '/', component: home },
      { path: '/detail', component: detail },
    ]);
    log.length = 0;
    await a.router.push('/detail');
    await tick(20);
    expect(log).toEqual(['vdom da', 'home da']);
    log.length = 0;
    a.router.back();
    await tick(50);
    // (the earlier cases' apps hear the popstate too)
    expect(log.filter((l) => !l.startsWith('settled'))).toEqual(['vdom a', 'home a']);
  });

  it("a page's onMounted already sees it in its enter state and the old page leaving (Vue's insert order)", async () => {
    const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
    const seen = compileSfc(
      `<script setup>
import { onMounted } from 'vue'
onMounted(() => {
  const hosts = [...document.querySelectorAll('fjs-page-entry')]
  globalThis.__log.push(hosts.map((h) => (h.getAttribute('class') || '-').split(' ').sort().join('+')).join(' | '))
})
</script>
<template><text class="seen">seen</text></template>`,
      { vapor: true, runtime: vue },
    ).component;
    const home = compileSfc(`<template><text class="home">home</text></template>`, { vapor: true, runtime: vue }).component;
    const a = await app({ transition: 'fjs-slide' }, [
      { path: '/', component: home },
      { path: '/seen', component: seen },
    ]);
    log.length = 0;
    await a.router.push('/seen');
    await tick(0);
    expect(log[0]).toBe('fjs-slide-leave-active+fjs-slide-leave-from | fjs-slide-enter-active+fjs-slide-enter-from');
  });
});

