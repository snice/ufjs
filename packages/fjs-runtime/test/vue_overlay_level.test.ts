// End-to-end tests for specs/069's renderer-layer features, in Node (no
// native host): `position: fixed` hoisting into the overlay host, and
// ::before/::after decoration-box synthesis. Ops are captured via setSink
// and decoded just enough to assert tree facts (who is the parent of whom,
// what got removed) — pseudo style CONTENT is covered in css.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCommentVNode,
  defineComponent,
  Fragment,
  h,
  ref,
  Teleport,
  withDirectives,
} from '@vue/runtime-core';
import { vShow } from '../src/vue/vue-shim';
import { setOpSink } from '../src/host';
import { createApp, createDetachedRoot, flutterRoot, registerStyles, releaseDetachedRoot } from '../src/vue';
import { UiOp as Op } from '../src/ui/ops';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

// ---- minimal decoder: live tree facts + resolved per-element styles ----------

interface Frames {
  tag: Map<number, string>;
  parentOf: Map<number, number | null>;
  /** Live child order per parent id, maintained across inserts. */
  childrenOf: Map<number, number[]>;
  removed: Set<number>;
  text: Map<number, string>;
  /** Element id → every plain prop written to it so far (merged). */
  props: Map<number, Record<string, unknown>>;
  /** Element id → its current base style (interned styles resolved). */
  styleOf: Map<number, Record<string, unknown>>;
}

function decode(bytes: Uint8Array, into: Frames): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let i = 0;
  const u32 = () => {
    const v = view.getUint32(i, true);
    i += 4;
    return v;
  };
  const u16 = () => {
    const v = view.getUint16(i, true);
    i += 2;
    return v;
  };
  const str = (len: number) => {
    const s = dec.decode(bytes.subarray(i, i + len));
    i += len;
    return s;
  };
  const styleById = new Map<number, Record<string, unknown>>();
  while (i < bytes.length) {
    const op = bytes[i++];
    switch (op) {
      case Op.Create:
        into.tag.set(u32(), str(u16()));
        break;
      case Op.Remove:
        into.removed.add(u32());
        break;
      case Op.Insert: {
        const parent = u32();
        const child = u32();
        const at = u32();
        const prevParent = into.parentOf.get(child);
        if (prevParent !== undefined && prevParent !== parent) {
          const prev = into.childrenOf.get(prevParent);
          const pi = prev ? prev.indexOf(child) : -1;
          if (pi >= 0) prev!.splice(pi, 1);
        }
        into.parentOf.set(child, parent);
        const list = into.childrenOf.get(parent) ?? [];
        into.childrenOf.set(parent, list);
        // the writer clamps appends (0x7fffffff) to the end
        const idx = at >= list.length ? list.length : at;
        list.splice(idx, 0, child);
        break;
      }
      case Op.RemoveChild:
        u32();
        into.removed.add(u32());
        break;
      case Op.SetText: {
        const id = u32();
        into.text.set(id, str(u32()));
        break;
      }
      case Op.DefineStyle: {
        const sid = u32();
        styleById.set(sid, JSON.parse(str(u32())) as Record<string, unknown>);
        break;
      }
      case Op.SetStyle: {
        const el = u32();
        const base = styleById.get(u32());
        if (base) into.styleOf.set(el, { ...base });
        i += 4; // active style id (no :active in these fixtures)
        break;
      }
      case Op.ResetStyles:
        styleById.clear();
        break;
      case Op.SetProps: {
        // anchor nodes carry their display:none as plain props.
        // NOTE: `i += u32()` would clobber the cursor (compound assignment
        // reads the left side before evaluating the right) — same trap the
        // vue_styles decoder documents for SetText.
        const id = u32();
        const len = u32();
        const props = JSON.parse(str(len)) as Record<string, unknown>;
        into.props.set(id, { ...into.props.get(id), ...props });
        break;
      }
      default:
        return; // canvas/webgl ops — not this test's business
    }
  }
}

/** A macrotask: every microtask (Vue render, engine flush, op flush) has
 * drained by the time it runs, so assertions are deterministic. Bare
 * `await Promise.resolve()` pairs raced that pipeline. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

let f: Frames;

function sink(bytes: Uint8Array): void {
  decode(bytes, f);
}

function mount(template: () => ReturnType<typeof h>, css: string) {
  const root = flutterRoot();
  registerStyles(null, css);
  const app = createApp({ render: template });
  app.mount(root);
  return { app, root };
}

/** The page root: the one node createRoot placed under the host's implicit
 * container (parent id 0). */
function rootId(): number {
  const id = [...f.parentOf.entries()].find(([, p]) => p === 0)?.[0];
  expect(id, 'no page root in the op stream').toBeDefined();
  return id!;
}

/** The text node id with the given content. For a string-child element the
 * runtime crosses SetText on the ELEMENT id, so this is that element. */
function textIdOf(content: string): number {
  const entry = [...f.text.entries()].find(([, t]) => t.includes(content));
  expect(entry, `no text node with "${content}"`).toBeDefined();
  return entry![0];
}

/** The element carrying a text child with the given content. */
function ownerOfText(content: string): number {
  const owner = f.parentOf.get(textIdOf(content));
  expect(owner).toBeDefined();
  return owner!;
}

function freshFrames(): Frames {
  return {
    tag: new Map(),
    parentOf: new Map(),
    childrenOf: new Map(),
    removed: new Set(),
    props: new Map(),
    text: new Map(),
    styleOf: new Map(),
  };
}

describe('overlay host levels (specs/136)', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  /** The app overlay root: the parentless node carrying the marker. The
   * root is a module-level singleton — created once per VM, so its ops only
   * flow in the first test that triggers it; later tests latch the id. */
  let latchedAppRoot: number | undefined;
  function appRootId(): number {
    const entry = [...f.props.entries()].find(
      ([, props]) => props.__appOverlay === true,
    );
    if (entry) {
      latchedAppRoot = entry[0];
      return entry[0];
    }
    expect(latchedAppRoot, 'no app overlay root in the op stream').toBeDefined();
    return latchedAppRoot!;
  }

  it('keeps the default fixed element at the page level', async () => {
    f = freshFrames();
    const { app } = mount(
      () => h('view', { class: 'page' }, [h('view', { class: 'box' }, '页面级')]),
      `.page { flex-grow: 1 }
       .box { position: fixed; left: 0; top: 0 }`,
    );
    await settle();
    await settle();
    const root = rootId();
    const box = textIdOf('页面级');
    const host = f.parentOf.get(box);
    expect(f.tag.get(host!)).toBe('fjs-overlay-host');
    expect(f.parentOf.get(host!)).toBe(root);
    app.unmount();
  });

  it('hoists an overlay="app" element into the app root', async () => {
    f = freshFrames();
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          h('view', { class: 'mark', overlay: 'app' }, '跨页'),
        ]),
      `.page { flex-grow: 1 }
       .mark { position: fixed; left: 0; top: 0 }`,
    );
    await settle();
    await settle();
    const appRoot = appRootId();
    expect(f.tag.get(appRoot)).toBe('fjs-app-overlay-host');
    expect(f.parentOf.get(appRoot)).toBe(0);

    const mark = textIdOf('跨页');
    expect(f.parentOf.get(mark)).toBe(appRoot);
    // the page-level host was never created for this page
    expect([...f.tag.values()].some((t) => t === 'fjs-overlay-host')).toBe(false);
    app.unmount();
  });

  it('migrates an element when the overlay prop flips', async () => {
    f = freshFrames();
    const level = ref<'page' | 'app'>('page');
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          h('view', { class: 'mark', overlay: level.value }, '浮层'),
        ]),
      `.page { flex-grow: 1 }
       .mark { position: fixed; left: 0; top: 0 }`,
    );
    await settle();
    await settle();
    const mark = textIdOf('浮层');
    const pageHost = f.parentOf.get(mark);
    expect(f.tag.get(pageHost!)).toBe('fjs-overlay-host');

    level.value = 'app';
    await settle();
    await settle();
    expect(f.parentOf.get(mark)).toBe(appRootId());

    level.value = 'page';
    await settle();
    await settle();
    expect(f.tag.get(f.parentOf.get(mark)!)).toBe('fjs-overlay-host');
    app.unmount();
  });

  it('sends <Teleport to="body"> to the app root', async () => {
    f = freshFrames();
    const show = ref(false);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          show.value
            ? h(Teleport, { to: 'body' }, [h('view', { class: 'pop' }, '悬浮')])
            : null,
        ]),
      `.page { flex-grow: 1 }`,
    );
    await settle();
    show.value = true;
    await settle();
    await settle();
    const pop = textIdOf('悬浮');
    expect(f.parentOf.get(pop)).toBe(appRootId());
    app.unmount();
  });

  it('drops the element when its page unmounts', async () => {
    f = freshFrames();
    const alive = ref(true);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          alive.value
            ? h('view', { class: 'mark', overlay: 'app' }, '跨页')
            : null,
        ]),
      `.page { flex-grow: 1 }
       .mark { position: fixed; left: 0; top: 0 }`,
    );
    await settle();
    await settle();
    const appRoot = appRootId();
    const mark = textIdOf('跨页');
    expect(f.parentOf.get(mark)).toBe(appRoot);

    alive.value = false;
    await settle();
    await settle();
    // the Remove op is the native-facing truth; the harness decoder does not
    // scrub childrenOf on Remove (same as the specs/069 harness)
    expect(f.removed.has(mark)).toBe(true);
    app.unmount();
  });

  // vant's full-page Watermark is mask-shaped (fixed, 0/0, 100%×100%) but
  // pointer-events: none — the page stays usable, so back must not be held;
  // a real mask that migrates to the app host releases its page's back press
  const pageHostModal = () => {
    const host = [...f.tag].find(([, tag]) => tag === 'fjs-overlay-host')?.[0];
    return host == null ? undefined : f.props.get(host)?.modal;
  };

  it('does not count a pointer-events: none cover as a modal mask', async () => {
    f = freshFrames();
    const { app } = mount(
      () => h('view', { class: 'page' }, [h('view', { class: 'mark' }, '水印')]),
      `.page { flex-grow: 1 }
       .mark { position: fixed; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none }`,
    );
    await settle();
    await settle();
    expect(pageHostModal() ?? false).toBe(false);
    app.unmount();
  });

  it('re-derives the page host modal flag when a mask changes level', async () => {
    f = freshFrames();
    const level = ref<'page' | 'app'>('page');
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          h('view', { class: 'mask', ...(level.value === 'app' ? { overlay: 'app' } : {}) }, '遮罩'),
        ]),
      `.page { flex-grow: 1 }
       .mask { position: fixed; left: 0; top: 0; width: 100%; height: 100% }`,
    );
    await settle();
    await settle();
    expect(pageHostModal()).toBe(true);

    level.value = 'app';
    await settle();
    await settle();
    expect(f.parentOf.get(textIdOf('遮罩'))).toBe(appRootId());
    expect(pageHostModal()).toBe(false);

    level.value = 'page';
    await settle();
    await settle();
    expect(pageHostModal()).toBe(true);
    app.unmount();
  });

  it('drops an app-level element when the whole page app unmounts', async () => {
    for (const startApp of [true, false]) {
      f = freshFrames();
      const level = ref<'page' | 'app'>(startApp ? 'app' : 'page');
      const { app } = mount(
        () =>
          h('view', { class: 'page' }, [
            h('view', { class: 'wrap' }, [
              h('view', { class: 'mark', ...(level.value === 'app' ? { overlay: 'app' } : {}) }, '整页卸载'),
            ]),
          ]),
        `.page { flex-grow: 1 }
         .mark { position: fixed; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none }`,
      );
      await settle();
      await settle();
      if (!startApp) {
        level.value = 'app';
        await settle();
        await settle();
      }
      const mark = textIdOf('整页卸载');
      expect(f.parentOf.get(mark)).toBe(appRootId());
      app.unmount();
      await settle();
      expect(f.removed.has(mark), `startApp=${startApp}`).toBe(true);
    }
  });

  it('leaves nothing in the app root after level flips, v-if and a page unmount', async () => {
    f = freshFrames();
    const level = ref<'page' | 'app'>('page');
    const show = ref(true);
    const img = ref(false);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          show.value
            ? h('view', { class: 'mark', ...(level.value === 'app' ? { overlay: 'app' } : {}) }, [
                h('view', { class: 'tile' }, img.value ? '图' : '字'),
              ])
            : null,
        ]),
      `.page { flex-grow: 1 }
       .mark { position: fixed; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none }`,
    );
    const step = async () => { await settle(); await settle(); };
    await step();
    level.value = 'app'; await step();
    level.value = 'page'; await step();
    level.value = 'app'; await step();
    show.value = false; await step();
    show.value = true; await step();
    img.value = true; await step();
    level.value = 'page'; await step();
    level.value = 'app'; await step();
    const root = appRootId();
    app.unmount();
    await step();
    const live = [...f.parentOf].filter(([id, p]) => p === root && !f.removed.has(id));
    expect(live).toEqual([]);
  });

  // specs/137: a component library's imperative overlay (vant showToast)
  // mounts a SECOND app into a detached root — a <div> on <body> on web.
  // What it renders must reach the app host, never the page on top: the
  // page-host lookup falls back to the last page root when the parent chain
  // has none, which would let that page cover and take down the overlay.
  it('routes a detached second app into the app host', async () => {
    f = freshFrames();
    const { app: page } = mount(
      () => h('view', { class: 'page' }, [h('text', null, '页面')]),
      `.page { flex-grow: 1 }
       .notify { position: fixed; left: 0; top: 0; right: 0 }
       .toast { position: fixed; top: 50%; left: 0 }`,
    );
    await settle();
    const container = createDetachedRoot();
    const second = createApp({
      render: () => [
        h(Teleport, { to: 'body' }, [h('view', { class: 'toast' }, '命令式提示')]),
        h('view', { class: 'notify' }, '命令式通知'),
      ],
    });
    second.mount(container);
    await settle();
    await settle();

    const appRoot = appRootId();
    const toast = textIdOf('命令式提示');
    const notify = textIdOf('命令式通知');
    expect(f.parentOf.get(toast)).toBe(appRoot);
    expect(f.parentOf.get(notify)).toBe(appRoot);
    // no page host was created for either of them
    expect([...f.tag.values()].includes('fjs-overlay-host')).toBe(false);
    // the detached root itself never reaches the tree
    expect(f.parentOf.has(container.id)).toBe(false);

    second.unmount();
    releaseDetachedRoot(container);
    await settle();
    expect(f.removed.has(toast)).toBe(true);
    expect(f.removed.has(notify)).toBe(true);
    expect(f.removed.has(container.id)).toBe(true);
    page.unmount();
  });

  it('reports elements in the app host as connected', async () => {
    f = freshFrames();
    const container = createDetachedRoot();
    let el: { isConnected: boolean } | null = null;
    const second = createApp({
      render: () =>
        h(Teleport, { to: 'body' }, [
          h('view', { ref: (r: unknown) => (el = r as { isConnected: boolean } | null) }, '连接'),
        ]),
    });
    second.mount(container);
    await settle();
    expect(el).not.toBeNull();
    expect(el!.isConnected).toBe(true);
    second.unmount();
    releaseDetachedRoot(container);
  });
});

// specs/220: a component whose root is a full-screen `position: fixed` layer,
// hidden with v-show before the owner drops it with v-if (a story / sheet that
// closes itself, then is unmounted). The layer — and everything under it —
// must leave the overlay host; a leftover mask-shaped box there swallows every
// touch on the page below.
describe('unmounting a hidden fixed layer (specs/220)', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  const Layer = defineComponent({
    props: { shown: { type: Boolean, default: true } },
    setup(props) {
      return () =>
        withDirectives(
          h('view', { class: 'layer' }, [h('view', { class: 'inner' }, '层内')]),
          [[vShow, props.shown]],
        );
    },
  });

  const css = `.page { flex-grow: 1 }
       .layer { position: fixed; left: 0; top: 0; right: 0; bottom: 0 }`;

  /** `.inner` carries the text, so its parent is the layer; the layer's parent
   * is the overlay host it was hoisted into. */
  const layerAndHost = () => {
    const layer = ownerOfText('层内');
    return { layer, host: f.parentOf.get(layer)! };
  };

  it('removes the layer from the host after v-show false then v-if false', async () => {
    f = freshFrames();
    const mounted = ref(true);
    const shown = ref(true);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [mounted.value ? h(Layer, { shown: shown.value }) : null]),
      css,
    );
    await settle();
    await settle();
    const { layer, host } = layerAndHost();
    expect(f.tag.get(host)).toBe('fjs-overlay-host');

    shown.value = false;
    await settle();
    await settle();
    expect(f.removed.has(layer)).toBe(false);

    mounted.value = false;
    await settle();
    await settle();
    expect(f.removed.has(layer), 'the layer is still in the overlay host').toBe(true);
    app.unmount();
  });

  it('removes it when it was never hidden first (the plain v-if case)', async () => {
    f = freshFrames();
    const mounted = ref(true);
    const { app } = mount(
      () => h('view', { class: 'page' }, [mounted.value ? h(Layer) : null]),
      css,
    );
    await settle();
    await settle();
    const { layer } = layerAndHost();
    mounted.value = false;
    await settle();
    await settle();
    expect(f.removed.has(layer)).toBe(true);
    app.unmount();
  });

  // The root of a component with a leading template comment (dev builds keep
  // it) is a Fragment. Vue removes a Fragment by walking nextSibling from its
  // start anchor to its end anchor and removing each node it meets; a fixed
  // element in that range had been hoisted out of the parent's child list, so
  // the walk never met it and the layer stayed in the overlay host forever.
  describe('inside a Fragment (a root with a leading comment)', () => {
    const fragmentRoot = (position: 'first' | 'middle' | 'last') =>
      defineComponent({
        setup: () => () => {
          const layer = h('view', { class: 'layer' }, [h('view', { class: 'inner' }, '层内')]);
          const other = h('view', { class: 'other' }, '同级');
          const kids =
            position === 'first'
              ? [layer, other]
              : position === 'middle'
                ? [createCommentVNode('c'), layer, other]
                : [other, layer];
          return h(Fragment, null, kids);
        },
      });

    for (const position of ['first', 'middle', 'last'] as const) {
      it(`drops a hoisted layer that is the ${position} node of the fragment`, async () => {
        f = freshFrames();
        const Root = fragmentRoot(position);
        const mounted = ref(true);
        const { app } = mount(
          () => h('view', { class: 'page' }, [mounted.value ? h(Root) : null]),
          css,
        );
        await settle();
        await settle();
        const { layer, host } = layerAndHost();
        expect(f.tag.get(host)).toBe('fjs-overlay-host');
        const other = textIdOf('同级');

        mounted.value = false;
        await settle();
        await settle();
        expect(f.removed.has(other), 'the plain sibling goes').toBe(true);
        expect(f.removed.has(layer), 'the hoisted layer must go with its fragment').toBe(true);
        app.unmount();
      });
    }

    it('does not drop a fixed element that merely sits next to a v-if anchor', async () => {
      f = freshFrames();
      const on = ref(false);
      const { app } = mount(
        () =>
          h('view', { class: 'page' }, [
            h('view', { class: 'layer' }, [h('view', { class: 'inner' }, '层内')]),
            on.value ? h('view', { class: 'x' }, 'X') : null,
          ]),
        css,
      );
      await settle();
      await settle();
      const { layer } = layerAndHost();
      on.value = true; // the v-if comment anchor is replaced by a real node
      await settle();
      await settle();
      on.value = false;
      await settle();
      await settle();
      expect(f.removed.has(layer), 'a sibling coming and going must not take the layer').toBe(false);
      app.unmount();
    });
  });
});
