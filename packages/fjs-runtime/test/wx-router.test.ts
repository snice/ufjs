// wx router: navigation must use the page's real mini-program path —
// subpackaged pages live under their package root (specs/063) — and
// isTabPagePath matches that same shape exactly.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTabPagePath, registerRoutes, useRouter } from '../src/wx/router';

const wxCalls: Array<{ api: string; url: string }> = [];

const wxStub = {
  navigateTo: (opts: { url: string }) => {
    wxCalls.push({ api: 'navigateTo', url: opts.url });
    opts.success?.();
  },
  redirectTo: (opts: { url: string }) => {
    wxCalls.push({ api: 'redirectTo', url: opts.url });
    opts.success?.();
  },
  switchTab: (opts: { url: string }) => {
    wxCalls.push({ api: 'switchTab', url: opts.url });
    opts.success?.();
  },
  navigateBack: (_opts: { delta: number }) => {},
};
(globalThis as Record<string, unknown>).wx = wxStub;

const table = [
  { path: '/', name: 'index', meta: { tab: 0 }, mpPage: 'pages/index/index' },
  { path: '/example/canvas/f2', name: 'example-canvas-f2', meta: {}, mpPage: 'canvas/pages/example-canvas-f2/example-canvas-f2' },
  { path: '/comp/switch', name: 'comp-switch', meta: {} },
];

afterEach(() => {
  wxCalls.length = 0;
  vi.restoreAllMocks();
});

describe('wx router with subpackages', () => {
  it('navigates by mpPage when the record carries one', async () => {
    registerRoutes(table.slice());
    await useRouter().push('/example/canvas/f2');
    expect(wxCalls[0].url).toBe('/canvas/pages/example-canvas-f2/example-canvas-f2');
  });

  it('keeps the pages/<name>/<name> shape without mpPage', async () => {
    registerRoutes(table.slice());
    await useRouter().push('/comp/switch');
    expect(wxCalls[0].url).toBe('/pages/comp-switch/comp-switch');
  });

  it('carries the query string onto the mp url', async () => {
    registerRoutes(table.slice());
    await useRouter().push({ path: '/example/canvas/f2', query: { a: '1' } });
    expect(wxCalls[0].url).toBe('/canvas/pages/example-canvas-f2/example-canvas-f2?a=1');
  });

  it('isTabPagePath matches subpackage and main shapes exactly', () => {
    registerRoutes(table.slice());
    expect(isTabPagePath('pages/index/index')).toBe(true);
    expect(isTabPagePath('/pages/index/index')).toBe(true);
    expect(isTabPagePath('canvas/pages/example-canvas-f2/example-canvas-f2')).toBe(false);
    expect(isTabPagePath('pages/example-canvas-f2/example-canvas-f2')).toBe(false);
  });
});
