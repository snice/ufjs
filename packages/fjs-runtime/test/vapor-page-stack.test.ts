// @vitest-environment happy-dom
// specs/183: the enableVapor web shell keeps the pages on the history stack
// only — the VDOM shell's (and a Flutter Navigator's) rule. A popped or
// replaced page is destroyed; pushing its path again builds a fresh one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFjsApp } from '../src/app/web';
import '../src/vapor/web';
import { compileSfc } from './helpers/sfc';

const g = globalThis as Record<string, unknown>;
const log: string[] = [];
g.__stackLog = log;
let seq = 0;
g.__nextId = () => ++seq;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  log.length = 0;
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState(null, '', '#/');
});
afterEach(() => {
  vi.useRealTimers();
});

const tick = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

async function app(options: Record<string, unknown> = {}) {
  const vue = (await import('../src/vapor/web')) as unknown as Record<string, unknown>;
  // each instance gets its own id: the same id back means the same instance
  const page = (name: string, meta: Record<string, unknown> = {}) => ({
    path: name === 'home' ? '/' : `/${name}`,
    meta,
    component: compileSfc(
      `<script setup>
import { onUnmounted } from 'vue'
const id = globalThis.__nextId()
onUnmounted(() => globalThis.__stackLog.push('unmounted ${name}#' + id))
</script>
<template><text class="${name}">${name}#{{ id }}</text></template>`,
      { vapor: true, runtime: vue },
    ).component,
  });
  const a = createFjsApp({
    enableVapor: true,
    el: '#app',
    transition: false,
    routes: [page('home'), page('a'), page('b'), page('t0', { tab: 0 }), page('t1', { tab: 1 })],
    ...options,
  } as never);
  a.mount();
  await tick(20);
  return a;
}

const text = (cls: string): string | null => document.querySelector(`.${cls}`)?.textContent ?? null;
const back = async (a: { router: { back(): void } }): Promise<void> => {
  a.router.back();
  await tick(50);
};

describe('enableVapor web page stack (specs/183)', () => {
  it('a popped page is destroyed and comes back fresh; a page under the top keeps its instance', async () => {
    const a = await app();
    const home = text('home');
    await a.router.push('/a');
    await tick(10);
    const first = text('a');
    await a.router.push('/b');
    await tick(10);
    await back(a); // b popped
    expect(log.some((l) => l.startsWith('unmounted b#'))).toBe(true);
    expect(text('a')).toBe(first); // a stayed on the stack
    await back(a); // a popped
    expect(log.some((l) => l.startsWith('unmounted a#'))).toBe(true);
    expect(text('home')).toBe(home);
    await a.router.push('/a');
    await tick(10);
    expect(text('a')).not.toBe(first); // a fresh instance
  });

  it('replace destroys the page it stands in for; a tab switch parks the tab until the group is left', async () => {
    const a = await app();
    await a.router.push('/a');
    await tick(10);
    await a.router.replace('/b');
    await tick(10);
    expect(log.some((l) => l.startsWith('unmounted a#'))).toBe(true);

    log.length = 0;
    await a.router.replace('/t0');
    await tick(10);
    const t0 = text('t0');
    await a.router.replace('/t1');
    await tick(10);
    expect(log.some((l) => l.startsWith('unmounted t0#'))).toBe(false); // parked
    await a.router.replace('/t0');
    await tick(10);
    expect(text('t0')).toBe(t0); // the same instance back
    await a.router.replace('/a');
    await tick(10);
    expect(log.some((l) => l.startsWith('unmounted t0#'))).toBe(true);
    expect(log.some((l) => l.startsWith('unmounted t1#'))).toBe(true);
  });

  it('keepAlive: false keeps only the page on screen', async () => {
    const a = await app({ keepAlive: false });
    await a.router.push('/a');
    await tick(10);
    expect(log.some((l) => l.startsWith('unmounted home#'))).toBe(true);
  });

  it('with a transition, the popped page goes once its leave is over', async () => {
    const a = await app({ transition: 'fjs-fade' });
    await a.router.push('/a');
    await tick(500);
    const mine = `unmounted ${text('a')}`;
    a.router.back();
    // popstate arrives on the next task; the leave starts then (the earlier
    // cases' apps hear it too — only this app's instance is looked at)
    await tick(1);
    const host = document.querySelector('.a')?.closest('fjs-page-entry');
    expect(host?.getAttribute('class') ?? '').toContain('fjs-fade-leave');
    expect(log).not.toContain(mine);
    await tick(500);
    expect(log).toContain(mine);
  });
});
