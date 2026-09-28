// @vitest-environment happy-dom
// specs/143 — router.preload() and the idle-time queue. Here there is no
// native host, so the Flutter router exercises its single-bundle path (the
// page loader runs in JS; a split build's chunk is the host's job and is
// covered by the Dart side's tests and the device run).
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { styleEngine } from '../src/vue/renderer';
import { createRouter, definePage, definePageLoader } from '../src/router/flutter';
import { createRouter as createWebRouter } from '../src/router/web';

const view = () => defineComponent({ setup: () => () => h('view') });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Flutter router.preload', () => {
  it('runs a single bundle\'s page module ahead of the open, once', async () => {
    let runs = 0;
    const comp = view();
    definePageLoader('/p143-a', () => {
      runs++;
      return comp;
    });
    const router = createRouter({ routes: [{ path: '/p143-a' }] });
    await router.preload('/p143-a');
    expect(runs).toBe(1);
    await router.preload('/p143-a');
    expect(runs).toBe(1);
  });

  it('resolves for a path no route matches', async () => {
    const router = createRouter({ routes: [{ path: '/p143-only' }] });
    await expect(router.preload('/p143-missing')).resolves.toBeUndefined();
  });

  it('leaves the style snapshot to the open (specs/143 plan §3.5)', async () => {
    setOpSink(() => {});
    definePage('/p143-snap', view());
    (globalThis as { __fjsStyleSnapshots?: Record<string, string> }).__fjsStyleSnapshots = {
      '/p143-snap': JSON.stringify({ v: 999 }), // refused, but still counted
    };
    const imports = vi.spyOn(styleEngine, 'importSnapshot');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const router = createRouter({ routes: [{ path: '/p143-snap' }] });
      await router.preload('/p143-snap');
      expect(imports).not.toHaveBeenCalled();
      await router.replace('/p143-snap');
      expect(imports).toHaveBeenCalledTimes(1);
    } finally {
      imports.mockRestore();
      warn.mockRestore();
      delete (globalThis as { __fjsStyleSnapshots?: unknown }).__fjsStyleSnapshots;
    }
  });

  it('loads every static page once the first page has settled', async () => {
    setOpSink(() => {});
    const runs: string[] = [];
    definePage('/p143-home', view());
    for (const p of ['/p143-x', '/p143-y']) {
      definePageLoader(p, () => {
        runs.push(p);
        return view();
      });
    }
    const router = createRouter({
      initial: '/p143-home',
      routes: [{ path: '/p143-home' }, { path: '/p143-x' }, { path: '/p143-y' }, { path: '/p143-u/:id' }],
    });
    router.start();
    await settle();
    expect(runs).toEqual(['/p143-x', '/p143-y']);
  });

  it('preload: false leaves the pages alone', async () => {
    setOpSink(() => {});
    const runs: string[] = [];
    definePage('/p143-home2', view());
    definePageLoader('/p143-z', () => {
      runs.push('/p143-z');
      return view();
    });
    const router = createRouter({
      initial: '/p143-home2',
      preload: false,
      routes: [{ path: '/p143-home2' }, { path: '/p143-z' }],
    });
    router.start();
    await settle();
    expect(runs).toEqual([]);
  });
});

describe('web router.preload', () => {
  it('runs the route\'s lazy import, and leaves sync components alone', async () => {
    const lazy = vi.fn(async () => ({ default: view() }));
    const router = createWebRouter({
      preload: false,
      routes: [
        { path: '/', component: view() },
        { path: '/lazy', component: lazy },
      ],
    });
    await router.preload('/lazy');
    expect(lazy).toHaveBeenCalledTimes(1);
    await router.preload('/');
    await router.preload('/nowhere');
    expect(lazy).toHaveBeenCalledTimes(1);
  });
});
