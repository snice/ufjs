// specs/119 — the build-time capture driver in the Flutter router: every
// static route is mounted headless (replace() swaps it in place) and leaves
// a snapshot; a route with parameters cannot be mounted at build time and is
// left to compute its styles at runtime.
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { registerStyles } from '../src/vue/renderer';
import { createRouter, definePage } from '../src/router/flutter';
import type { StyleSnapshot } from '../src/css/style';

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
    expect(one.v).toBe(1);
    // page root view > .box > .label (plus the text run inside it)
    expect(one.chains.length).toBeGreaterThanOrEqual(2);
    expect(one.globals).toContain('capture0000a');
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
      expect(warn.mock.calls.some((c) => String(c[0]).includes('style snapshot skipped: version 999'))).toBe(true);
    } finally {
      warn.mockRestore();
      delete (globalThis as { __fjsStyleSnapshots?: unknown }).__fjsStyleSnapshots;
    }
  });
});
