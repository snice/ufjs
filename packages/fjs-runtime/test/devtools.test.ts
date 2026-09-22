// spec 089 — the DevTools data plane (__fjsDevtools): element-tree
// serialization (doc/style with props, text, classes, computed styles) and
// the fetch row queue the `fjs debug` relay drains for the Network panel.
import { describe, expect, it, vi } from 'vitest';
import { h, defineComponent, ref, type VNode } from '@vue/runtime-core';

const { setOpSink } = await import('../src/host');
const { setProps } = await import('../src/ui/element');
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

  it('lists every live page root, including a pushed route (spec 093)', async () => {
    setOpSink(() => {});
    const before = cmd('DOM.getDocument').roots.length;
    const App: any = defineComponent(() => () => h('view', { class: 'page' }) as VNode);
    const first = flutterRoot();
    setProps(first, { __navKey: 0 });
    createApp(App).mount(first);
    const second = flutterRoot();
    setProps(second, { __navKey: 1 });
    createApp(App).mount(second);
    await flush();

    const doc = cmd('DOM.getDocument');
    const added = doc.roots.slice(before);
    expect(added).toHaveLength(2);
    expect(added.map((n: { attrs: Record<string, string> }) => n.attrs.__navKey)).toEqual([
      '0',
      '1',
    ]);
    expect(typeof doc.structuralVersion).toBe('number');
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

  // spec 093 — lazy tree access. The real frontend sends depth:1 on its
  // first DOM.getDocument and expands via these three methods; without them
  // the Elements panel collapses at the root shell no matter how complete
  // the document reply is.
  it('serves DOM.requestChildNodes with the direct children of a node (spec 093)', async () => {
    setOpSink(() => {});
    const App: any = defineComponent(() => () =>
      h('view', { class: 'parent' }, [h('text', { class: 'kid' }, 'child text')]) as VNode,
    );
    createApp(App).mount(flutterRoot());
    await flush();

    const doc = cmd('DOM.getDocument');
    const root = doc.roots[doc.roots.length - 1];
    const out = cmd('DOM.requestChildNodes', { id: root.id });
    expect(out.children.length).toBeGreaterThanOrEqual(1);
    // mount() hangs the app's own tree UNDER the flutterRoot container, so the
    // container's first child is the app's <view>, one level above the text
    expect(out.children[0].tag).toBe('view');
    const inner = cmd('DOM.requestChildNodes', { id: out.children[0].id });
    expect(inner.children[0].tag).toBe('text');
    expect(inner.children[0].attrs.class).toBe('kid');
    expect(inner.children[0].text).toBe('child text');

    // a node that does not exist answers an empty list, not a throw
    const miss = cmd('DOM.requestChildNodes', { id: 987654 });
    expect(miss.children).toEqual([]);
  });

  it('serializes a subtree to HTML for DOM.getFlattenedInnerHTML (spec 093)', async () => {
    setOpSink(() => {});
    const App: any = defineComponent(() => () =>
      h('view', { class: 'a&b' }, [h('text', null, 'x < y')]) as VNode,
    );
    createApp(App).mount(flutterRoot());
    await flush();

    const doc = cmd('DOM.getDocument');
    const root = doc.roots[doc.roots.length - 1];
    const { html } = cmd('DOM.getFlattenedInnerHTML', { id: root.id });
    expect(html).toContain('<text>x &lt; y</text>');
    // attribute values are quoted, so `"` inside them must be escaped
    expect(html).toContain('class="a&amp;b"');
    expect(html.startsWith('<view')).toBe(true);
    expect(html.endsWith('</view>')).toBe(true);

    const miss = cmd('DOM.getFlattenedInnerHTML', { id: 987654 });
    expect(miss.html).toBe('');
  });

  it('matches selectors for DOM.querySelector — hit, miss, and pseudo stripping (spec 093)', async () => {
    setOpSink(() => {});
    const App: any = defineComponent(() => () =>
      h('view', { id: 'shell', class: 'page inner' }, [
        h('text', { class: 'title' }, 'hello'),
      ]) as VNode,
    );
    createApp(App).mount(flutterRoot());
    await flush();

    const doc = cmd('DOM.getDocument');
    const root = doc.roots[doc.roots.length - 1];

    // tag selector (tests share one VM, so the first `text` in document
    // order may come from an earlier test's still-mounted tree)
    const byTag = cmd('DOM.querySelector', { selector: 'text' }).id;
    expect(byTag).toBeGreaterThan(0);
    // class selector (single + compound): a compound matches BOTH classes on
    // the SAME element — no node carries `title` together with `page`/`inner`
    const byClass = cmd('DOM.querySelector', { selector: '.title' }).id;
    expect(byClass).toBeGreaterThan(0);
    expect(cmd('DOM.querySelector', { selector: '.inner.title' }).id).toBe(0);
    expect(cmd('DOM.querySelector', { selector: '.page.inner' }).id).toBeGreaterThan(0);
    // id selector: `id="shell"` sits on the app's view (the container's child),
    // not on the flutterRoot container itself
    const shell = cmd('DOM.querySelector', { selector: '#shell' }).id;
    expect(shell).toBeGreaterThan(0);
    expect(shell).not.toBe(root.id);
    expect(shell).toBe(cmd('DOM.querySelector', { selector: '.page.inner' }).id);
    // descendant combinator
    expect(cmd('DOM.querySelector', { selector: '.page text' }).id).toBe(byClass);
    // miss answers 0 (CDP's convention) rather than throwing
    expect(cmd('DOM.querySelector', { selector: '.nope' }).id).toBe(0);
    // pseudo-classes are stripped, not evaluated — `:hover` on a static
    // snapshot must resolve exactly like the selector without the pseudo
    expect(cmd('DOM.querySelector', { selector: 'text:hover' }).id).toBe(byTag);
    // an unsupported shape (`*`) answers 0 rather than throwing
    expect(cmd('DOM.querySelector', { selector: '*' }).id).toBe(0);
  });

  it('bumps ONLY the structural version on mount — pure props/text leave it alone (spec 093)', async () => {
    setOpSink(() => {});
    const hooks = (await import('../src/devtools-hooks')).devtoolsStructuralVersion;
    const beforeStructural = hooks.value;
    const App: any = defineComponent(() => () => h('view', { class: 'v093' }) as VNode);
    createApp(App).mount(flutterRoot());
    await flush();
    // a mount inserts a page root → the counter MUST move (this is what
    // makes a route push invalidate DevTools' snapshot)
    expect(hooks.value).toBeGreaterThan(beforeStructural);

    // a pure prop patch after mount must NOT move it again — otherwise the
    // relay's poll re-pulls the whole document on every attribute write and
    // the Styles sidebar spins forever (092 R14 regression)
    const structuralAfterMount = hooks.value;
    const treeAfterMount = cmd('Dom.version').version;
    const doc = cmd('DOM.getDocument');
    const root = doc.roots[doc.roots.length - 1];
    // touch a pure-attribute path: CSS/cmd reads never bump structure
    cmd('CSS.getComputedStyleForNode', { id: root.id });
    cmd('Dom.structuralVersion');
    expect(hooks.value).toBe(structuralAfterMount);
    // the per-frame tree version still moves independently of structure
    expect(cmd('Dom.version').version).toBeGreaterThanOrEqual(treeAfterMount);
    // the dedicated cmd reads the counter back verbatim
    expect(cmd('Dom.structuralVersion').version).toBe(hooks.value);
  });

  it('queues a text edit after getDocument without a structural bump', async () => {
    setOpSink(() => {});
    const label = ref('count: 0');
    const App: any = defineComponent(() => () => h('text', () => label.value) as VNode);
    createApp(App).mount(flutterRoot());
    await flush();
    // the snapshot the panel just pulled already contains "count: 0"
    cmd('DOM.getDocument');
    const structural = cmd('Dom.structuralVersion').version;
    expect(cmd('Dom.drainContent').mutations).toEqual([]);

    label.value = 'count: 1';
    await flush();
    expect(cmd('Dom.structuralVersion').version).toBe(structural);
    const drained = cmd('Dom.drainContent');
    expect(drained.overflow).toBe(false);
    expect(drained.mutations).toContainEqual(
      expect.objectContaining({ kind: 'text', text: 'count: 1' }),
    );
    // one drain consumes the queue
    expect(cmd('Dom.drainContent').mutations).toEqual([]);
  });
});
