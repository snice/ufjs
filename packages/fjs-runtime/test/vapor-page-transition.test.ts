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

  it('pop plays the same family mirrored (data-nav="pop") and brings the cached page back', async () => {
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
    expect(entry('detail').style.display).toBe('none');
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
});
