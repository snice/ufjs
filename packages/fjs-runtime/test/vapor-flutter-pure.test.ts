// specs/169: the enableVapor surfaces on Flutter carry no VDOM machinery.
// This file imports ONLY the pure surface (vitest isolates modules per
// file), so the backend never gets the interop's mountVdomComponent.
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { installEventDispatcher } from '../src/ui/element';

beforeEach(() => {
  setOpSink(() => {});
  installEventDispatcher();
});

describe('Flutter pure vapor surface (specs/169)', () => {
  it('a VDOM component inside a vapor template fails with the same error as web', async () => {
    const vapor = await import('../src/vapor/flutter-pure');
    const Vdom = defineComponent({ render: () => h('view') });
    const Page = vapor.defineVaporComponent({
      setup() {
        return vapor.createComponent(Vdom);
      },
    });
    expect(() => vapor.createVaporApp(Page)).toThrow(/a VDOM component reached a pure-vapor app/);
  });

  it('the router without the VDOM page mounter says the page must be vapor', async () => {
    const { createRouter, definePage } = await import('../src/router/flutter');
    const Vdom = defineComponent({ render: () => h('view') });
    definePage('/pure-vdom', Vdom);
    const router = createRouter({ routes: [{ path: '/pure-vdom' }], enableVapor: true });
    await expect(router.replace('/pure-vdom')).rejects.toThrow(/not a vapor page, and this enableVapor build carries no VDOM renderer/);
  });

  it('nothing in the pure graph imports the Vue renderer module', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = path.join(__dirname, '../src');
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = fs.readFileSync(file, 'utf8');
      for (const m of code.matchAll(/^\s*(?:import|export)\s[^'"]*?['"](\.[^'"]+)['"]/gm)) {
        if (/^\s*import\s+type\b/.test(m[0]) || /^\s*export\s+type\b/.test(m[0])) continue;
        let next = path.resolve(path.dirname(file), m[1]);
        if (!next.endsWith('.ts')) next = fs.existsSync(next + '.ts') ? next + '.ts' : path.join(next, 'index.ts');
        if (fs.existsSync(next)) walk(next);
      }
    };
    for (const entry of ['vapor/flutter-pure.ts', 'app/flutter-vapor.ts', 'vue/index-vapor.ts']) walk(path.join(src, entry));
    const rel = [...seen].map((f) => path.relative(src, f));
    expect(rel).not.toContain('vue/renderer.ts');
    expect(rel).not.toContain('vapor/backend-flutter-interop.ts');
    expect(rel).not.toContain('router/flutter-vdom.ts');
    expect(rel).not.toContain('app/flutter.ts');
  });
});
