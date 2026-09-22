// spec 089 — the DevTools data plane (__fjsDevtools): element-tree
// serialization (doc/style with props, text, classes, computed styles) and
// the fetch row queue the `fjs debug` relay drains for the Network panel.
import { describe, expect, it, vi } from 'vitest';
import { h, defineComponent, ref, type VNode } from '@vue/runtime-core';

const { setOpSink } = await import('../src/host');
const { createApp, flutterRoot } = await import('../src/vue');
const { devtoolsBoot } = await import('../src/devtools');
devtoolsBoot();
const g = globalThis as Record<string, any>;

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Evaluates through the SAME surface the relay uses (the stringly cmd), so
 * a broken contract fails here rather than in Chrome. */
function cmd(method: string, params: Record<string, unknown> = {}): any {
  return JSON.parse(g.__fjsDevtools.cmd(method, JSON.stringify(params)));
}

describe('__fjsDevtools', () => {
  it('serializes the element tree with props, text, class and style', async () => {
    setOpSink(() => {});
    const child = ref<any>(null);
    const App: any = defineComponent(() => () =>
      h('view', { class: 'card', style: { padding: '8px' } }, [
        h('text', { ref: child }, 'hello devtools'),
      ]) as VNode,
    );
    createApp(App).mount(flutterRoot());
    await flush();

    const doc = cmd('DOM.getDocument');
    expect(doc.live).toBe(true);
    expect(doc.roots.length).toBeGreaterThanOrEqual(1);

    // walk down to the styled text node
    const find = (n: any, pred: (x: any) => boolean): any => {
      if (pred(n)) return n;
      for (const c of n.children) {
        const hit = find(c, pred);
        if (hit) return hit;
      }
      return null;
    };
    const root = doc.roots[doc.roots.length - 1];
    const text = find(root, (n) => n.tag === 'text' && !!n.text);
    expect(text).not.toBeNull();
    expect(text.text).toBe('hello devtools');
    // the class prop the Vue renderer set lands as an attribute
    const styled = find(root, (n) => n.attrs.class?.includes('card'));
    expect(styled).not.toBeNull();
    expect(styled.attrs.style).toContain('padding');
  });

  it('serves computed + inline styles for a node id', async () => {
    setOpSink(() => {});
    const el = ref<any>(null);
    const App: any = defineComponent(() => () =>
      h('view', { ref: el, style: { backgroundColor: 'red' } }) as VNode,
    );
    createApp(App).mount(flutterRoot());
    await flush();

    const doc = cmd('DOM.getDocument');
    const node = (function find(n: any): any {
      if (n.attrs.style?.includes('background')) return n;
      for (const c of n.children) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    })(doc.roots[doc.roots.length - 1]);
    expect(node).toBeTruthy();

    const style = cmd('CSS.getComputedStyleForNode', { id: node.id });
    expect(style.computed).toBeTruthy();
    // Vue's style binding lands in the inline layer
    expect(JSON.stringify(style.inline)).toContain('background');
    // matched rules ride along (spec 092); this synthetic tree registers no
    // stylesheet, so the list is empty but present
    expect(style.matched).toEqual([]);
  });

  it('net rows: drain arms recording; body captured on materialize', async () => {
    // Direct hooks test: call netRequest/netResponse/netBodyMaterialized
    // via the slots (devtoolsBoot already installed them globally).
    const hooks = (await import('../src/devtools-hooks')).devtoolsSlots;

    // Not armed yet: netRequest is a no-op
    hooks.netRequest({ id: 1, url: 'https://x/1', method: 'GET', headers: {} });
    let rows = JSON.parse(g.__fjsDevtools.cmd('Network.drain', '{}')).rows;
    expect(rows.find((r: any) => r.id === 1)).toBeUndefined();

    // Drain arms recording
    JSON.parse(g.__fjsDevtools.cmd('Network.drain', '{}'));

    // Now netRequest + netResponse are tracked
    hooks.netRequest({ id: 2, url: 'https://x/2', method: 'GET', headers: {} });
    hooks.netResponse({ id: 2, url: 'https://x/2', status: 200, statusText: 'OK',
      headers: { 'content-type': 'application/json' }, bodyBase64: btoa('{"ok":1}'), handle: null });

    rows = JSON.parse(g.__fjsDevtools.cmd('Network.drain', '{}')).rows;
    const row = rows.find((r: any) => r.id === 2);
    expect(row).toBeTruthy();
    expect(row.state).toBe('done');
    expect(row.response.status).toBe(200);
    expect(row.body.base64).toBe(btoa('{"ok":1}'));

    // Body materialization via handle path
    hooks.netRequest({ id: 3, url: 'https://x/3', method: 'GET', headers: {} });
    hooks.netResponse({ id: 3, url: 'https://x/3', status: 200, statusText: 'OK',
      headers: {}, bodyBase64: undefined, handle: 42 });
    hooks.netBodyMaterialized(42, new Uint8Array([104, 105])); // "hi"
    rows = JSON.parse(g.__fjsDevtools.cmd('Network.drain', '{}')).rows;
    const row3 = rows.find((r: any) => r.id === 3);
    expect(row3.body.base64).toBe(btoa('hi'));
  });

  it('answers unknown cmds with a thrown error (relay turns it into a CDP error)', () => {
    expect(() => cmd('DOM.setInnerWidth')).toThrow();
  });

  it('bumps the tree version on flush and reports exists on styleCmd (spec 092)', async () => {
    setOpSink(() => {});
    const before = cmd('Dom.version').version;
    const App: any = defineComponent(() => () => h('view', { class: 'v092' }) as VNode);
    createApp(App).mount(flutterRoot());
    await flush();
    const after = cmd('Dom.version').version;
    expect(after).toBeGreaterThan(before);

    // a live id answers exists:true; an id that left the tree answers
    // exists:false with empty styles — the relay's stale-selection signal
    const doc = cmd('DOM.getDocument');
    const root = doc.roots[doc.roots.length - 1];
    const live = cmd('CSS.getComputedStyleForNode', { id: root.id });
    expect(live.exists).toBe(true);
    const dead = cmd('CSS.getComputedStyleForNode', { id: 987654 });
    expect(dead.exists).toBe(false);
    expect(dead.computed).toEqual({});
  });
});
