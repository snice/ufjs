// specs/119 — the build-time capture driver in the Flutter router: every
// static route is mounted headless (replace() swaps it in place) and leaves
// a snapshot; a route with parameters cannot be mounted at build time and is
// left to compute its styles at runtime.
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { registerStyles } from '../src/vue/renderer';
import { createRouter, definePage, definePageLoader, pageComponent } from '../src/router/flutter';
// VDOM pages mount through the injected mounter (specs/169); app/flutter.ts
// registers it in an app — a bare router needs it imported
import '../src/router/flutter-vdom';
import { STYLE_SNAPSHOT_VERSION, type StyleSnapshot } from '../src/css/style';

describe('router.captureStyles', () => {
  it('snapshots each static route and skips parameterized ones', async () => {
    setOpSink(() => {});
    registerStyles(null, '.box { padding: 8px } .box .label { color: #333 }', 'capture0000a');
    const page = (label: string) =>
      defineComponent({ setup: () => () => h('view', { class: 'box' }, [h('text', { class: 'label' }, label)]) });
    definePage('/one', page('one'));
    definePage('/two', page('two'));
    definePage('/user/:id', page('user'));
    const router = createRouter({ routes: [{ path: '/one' }, { path: '/user/:id' }, { path: '/two' }] });
    const out = await router.captureStyles();
    expect(Object.keys(out)).toEqual(['/one', '/two']);
    const one = out['/one'] as StyleSnapshot;
    expect(one.v).toBe(STYLE_SNAPSHOT_VERSION);
    // page root view > .box > .label (plus the text run inside it)
    expect(one.chains.length).toBeGreaterThanOrEqual(2);
    expect(one.globals).toContain('capture0000a');
  });

  it('captures only the routes asked for, loading a chunked page first (specs/121)', async () => {
    setOpSink(() => {});
    const loaded: string[] = [];
    const router = createRouter({
      preload: false, // the pre-specs/143 shape: only the captured page's chunk
      routes: [{ path: '/four', chunk: 'four' }, { path: '/five', chunk: 'five' }],
    });
    const out = await router.captureStyles({
      routes: ['/five'],
      loadChunk: (chunk) => {
        loaded.push(chunk);
        // what the page chunk's generated entry does when it runs
        definePage('/five', defineComponent({ setup: () => () => h('view', { class: 'box' }) }));
      },
    });
    expect(loaded).toEqual(['five']);
    expect(Object.keys(out)).toEqual(['/five']);
    expect((out['/five'] as StyleSnapshot).v).toBe(STYLE_SNAPSHOT_VERSION);
  });

  it('loads every page first when the app preloads, so its globals match the device (specs/143)', async () => {
    setOpSink(() => {});
    const loaded: string[] = [];
    const router = createRouter({
      routes: [
        { path: '/g143-a', chunk: 'g143-a' },
        { path: '/g143-b', chunk: 'g143-b' },
        { path: '/g143-u/:id', chunk: 'g143-u' },
      ],
    });
    const page = defineComponent({ setup: () => () => h('view', { class: 'box' }) });
    const out = await router.captureStyles({
      routes: ['/g143-b'],
      loadChunk: (chunk) => {
        loaded.push(chunk);
        if (chunk === 'g143-a') {
          // a page with its own unscoped <style>: a global sheet
          registerStyles(null, '.g143-global { color: red }', 'g143global00');
          definePage('/g143-a', page);
        }
        if (chunk === 'g143-b') definePage('/g143-b', page);
      },
    });
    expect(loaded).toEqual(['g143-a', 'g143-b']); // table order, pattern skipped
    expect((out['/g143-b'] as StyleSnapshot).globals).toContain('g143global00');
  });

  it('runs a single bundle\'s page loader once, on first open (specs/121)', () => {
    let runs = 0;
    const comp = defineComponent({ setup: () => () => h('view') });
    definePageLoader('/lazy', () => {
      runs++;
      return comp;
    });
    expect(runs).toBe(0);
    expect(pageComponent('/lazy')).toBe(comp);
    expect(pageComponent('/lazy')).toBe(comp);
    expect(runs).toBe(1);
  });

  it('imports a page\'s snapshot right before mounting it (a refused one says why)', async () => {
    setOpSink(() => {});
    definePage('/three', defineComponent({ setup: () => () => h('view', { class: 'box' }) }));
    (globalThis as { __fjsStyleSnapshots?: Record<string, string> }).__fjsStyleSnapshots = {
      '/three': JSON.stringify({ v: 999 }),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const router = createRouter({ routes: [{ path: '/three' }] });
      await router.replace('/three');
      expect(warn.mock.calls.some((c) => String(c[0]).includes('style snapshot for /three skipped: version 999'))).toBe(true);
    } finally {
      warn.mockRestore();
      delete (globalThis as { __fjsStyleSnapshots?: unknown }).__fjsStyleSnapshots;
    }
  });
});
