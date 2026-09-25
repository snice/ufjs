// End-to-end tests for specs/069's renderer-layer features, in Node (no
// native host): `position: fixed` hoisting into the overlay host, and
// ::before/::after decoration-box synthesis. Ops are captured via setSink
// and decoded just enough to assert tree facts (who is the parent of whom,
// what got removed) — pseudo style CONTENT is covered in css.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, ref, Teleport } from '@vue/runtime-core';
import { vShow } from '../src/vue/vue-shim';
import { setOpSink } from '../src/host';
import { createApp, flutterRoot, registerStyles } from '../src/vue';
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
});

