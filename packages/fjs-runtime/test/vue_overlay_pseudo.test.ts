// End-to-end tests for specs/069's renderer-layer features, in Node (no
// native host): `position: fixed` hoisting into the overlay host, and
// ::before/::after decoration-box synthesis. Ops are captured via setSink
// and decoded just enough to assert tree facts (who is the parent of whom,
// what got removed) — pseudo style CONTENT is covered in css.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStaticVNode, h, nextTick, ref, withDirectives } from '@vue/runtime-core';
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

describe('position: fixed hoists into the overlay host', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  it('re-parents mask and popup to one viewport box under the page root', async () => {
    f = freshFrames();
    const show = ref(false);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          show.value ? h('view', { class: 'mask' }, '遮罩') : null,
          show.value ? h('view', { class: 'sheet' }, '弹层') : null,
        ]),
      `.page { flex-grow: 1 }
       .mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0 }
       .sheet { position: fixed; left: 0; right: 0; bottom: 0 }`,
    );
    await settle();
    const root = rootId();

    show.value = true;
    await settle();
    await settle();

    // string children cross as SetText on the element itself, so the text
    // id IS the mask/sheet element id
    const mask = textIdOf('遮罩');
    const sheet = textIdOf('弹层');
    const host = f.parentOf.get(mask);
    expect(host).toBeDefined();
    // both fixed siblings live under the SAME box, which itself hangs off
    // the page root — not inside the page subtree they were authored in
    expect(f.parentOf.get(sheet)).toBe(host);
    expect(f.parentOf.get(host!)).toBe(root);
    expect(f.tag.get(host!)).toBe('fjs-overlay-host');
    // the host preserves Vue's mount order (the native Stack paints later
    // children on top), so both are present as its direct children
    const hostKids = f.childrenOf.get(host!) ?? [];
    expect(hostKids).toContain(mask);
    expect(hostKids).toContain(sheet);

    show.value = false;
    await settle();
    await settle();
    expect(f.removed.has(mask)).toBe(true);
    expect(f.removed.has(sheet)).toBe(true);

    // and a re-opened popup lands on the host again (fresh elements)
    show.value = true;
    await settle();
    await settle();
    expect(f.parentOf.get(textIdOf('弹层'))).toBe(host);
    app.unmount();
  });

  // specs/129: vant's Sticky toggles its inner box between fixed and static
  // as the page scrolls; it used to stay in the overlay host for good
  it('moves an element back to its place when it stops being fixed', async () => {
    f = freshFrames();
    const fixed = ref(false);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          h('view', { class: 'root' }, [h('view', { class: fixed.value ? 'box on' : 'box' }, '吸顶')]),
          h('view', null, '之后'),
        ]),
      `.on { position: fixed; top: 0 }`,
    );
    await settle();
    await settle();
    const box = textIdOf('吸顶');
    const root = f.parentOf.get(box)!;

    fixed.value = true;
    await settle();
    await settle();
    expect(f.tag.get(f.parentOf.get(box)!)).toBe('fjs-overlay-host');

    fixed.value = false;
    await settle();
    await settle();
    expect(f.parentOf.get(box)).toBe(root);
    expect(f.childrenOf.get(root)).toEqual([box]);

    // and it hoists again on the next toggle
    fixed.value = true;
    await settle();
    await settle();
    expect(f.tag.get(f.parentOf.get(box)!)).toBe('fjs-overlay-host');
    app.unmount();
  });

  it('removes a hoisted element together with its v-if ancestor', async () => {
    // Vue names only the removed subtree's root; the hoisted popup lives in
    // the overlay host, outside that subtree, and used to stay on screen
    f = freshFrames();
    const block = ref(true);
    const { app } = mount(
      () => h('view', { class: 'page' }, [block.value ? h('view', { class: 'wrap' }, [h('view', { class: 'sheet' }, '内层弹层')]) : null]),
      `.sheet { position: fixed; left: 0; right: 0; bottom: 0 }`,
    );
    await settle();
    await settle();
    const sheet = textIdOf('内层弹层');
    expect(f.tag.get(f.parentOf.get(sheet)!)).toBe('fjs-overlay-host');
    block.value = false;
    await settle();
    await settle();
    expect(f.removed.has(sheet), 'hoisted sheet removed with its ancestor').toBe(true);
    app.unmount();
  });

  it("hoists into the element's own page, not the last page mounted", async () => {
    // pages share this module: page A stays alive under a pushed page B,
    // and A's popups used to land in B's (later disposed) overlay host
    f = freshFrames();
    const show = ref(false);
    const a = mount(
      () => h('view', { class: 'page' }, [show.value ? h('view', { class: 'sheet' }, 'A弹层') : null]),
      `.sheet { position: fixed; left: 0; right: 0; bottom: 0 }`,
    );
    await settle();
    const rootA = rootId();
    // page B pushed on top (a second flutterRoot while A stays alive)
    const b = mount(() => h('view', {}, 'B'), '');
    await settle();
    show.value = true;
    await settle();
    await settle();
    const sheet = textIdOf('A弹层');
    const host = f.parentOf.get(sheet)!;
    expect(f.parentOf.get(host), 'A popup host hangs off page A root').toBe(rootA);
    a.app.unmount();
    b.app.unmount();
  });

  it('re-creates the overlay host when a new page root mounts (hot swap)', async () => {
    // First page: its fixed element creates the overlay host under its root.
    f = freshFrames();
    const first = mount(
      () => h('view', { class: 'bar' }, '第一页'),
      '.bar { position: fixed; top: 0; left: 0 }',
    );
    await settle();
    const firstHost = f.parentOf.get(textIdOf('第一页'));
    expect(f.tag.get(firstHost!)).toBe('fjs-overlay-host');
    first.app.unmount();

    // Second page, SAME renderer module: the singletons (pageRoot,
    // overlayHost, hoisted) would carry the dead first host over, and the
    // host would drop every frame whose insert names it
    // ("op references unknown parent" — a blank page). The new page must
    // create a fresh host inside its own op stream, under its own root.
    f = freshFrames();
    const second = mount(
      () => h('view', { class: 'bar' }, '第二页'),
      '.bar { position: fixed; top: 0; left: 0 }',
    );
    await settle();
    const bar = textIdOf('第二页');
    const host = f.parentOf.get(bar);
    // created IN THIS stream — the Dart tree only knows nodes it saw built
    expect(f.tag.get(host!)).toBe('fjs-overlay-host');
    expect(f.parentOf.get(host!)).toBe(rootId());
    second.app.unmount();
  });
});

describe('insertStaticContent fallback (specs/070)', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  it('fails loudly, naming the remedy, for hand-written static vnodes', () => {
    f = freshFrames();
    const root = flutterRoot();
    const app = createApp({
      // createStaticVNode(content, nodeCount): what hoisted SFC templates
      // used to emit. The app build now compiles with hoistStatic:false, so
      // only hand-written render functions can reach this path — and the
      // old behavior was "not a function" from deep inside vue's mount,
      // blanking the page with nothing anywhere to read.
      render: () => h('view', [createStaticVNode('<view>静态</view>', 1)]),
    });
    expect(() => app.mount(root)).toThrow(/createStaticVNode/);
  });
});

describe('pseudo-element decoration boxes', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  it('materializes ::after after the real children, ::before at index 0', async () => {
    f = freshFrames();
    const { app } = mount(
      () => h('view', { class: 'cell' }, [h('text', '单元格')]),
      `.cell { position: relative }
       .cell::before { content: '前'; width: 2px }
       .cell::after { content: '箭头'; position: absolute; right: 16px }`,
    );
    await settle();

    const cell = ownerOfText('单元格');
    const beforeBox = ownerOfText('前');
    const afterBox = ownerOfText('箭头');
    expect(f.parentOf.get(beforeBox)).toBe(cell);
    expect(f.parentOf.get(afterBox)).toBe(cell);
    expect(f.tag.get(beforeBox)).toBe('view');
    expect(f.tag.get(afterBox)).toBe('view');
    // before leads, after trails: real text sits between the two boxes
    const order = f.childrenOf.get(cell) ?? [];
    expect(order.indexOf(beforeBox)).toBe(0);
    const realText = [...f.parentOf.entries()].find(([child, p]) => p === cell && f.text.has(child))?.[0]!;
    expect(order.indexOf(realText)).toBe(1);
    expect(order.indexOf(afterBox)).toBe(2);
    // the content key is consumed by the synthesizer, never shipped to the
    // peer; the rest of the declarations land as the box's inline style
    const afterStyle = f.styleOf.get(afterBox);
    expect(afterStyle).toBeDefined();
    expect(afterStyle).toMatchObject({ position: 'absolute', right: 16 });
    expect(afterStyle?.content).toBeUndefined();
    app.unmount();
  });

  // specs/071: an icon glyph (private-use code point) only renders when the
  // box's font stack names a family some @font-face declared
  it('lets private-use glyphs through only for a declared font', async () => {
    f = freshFrames();
    const { app } = mount(
      () => h('view', {}, [h('view', { class: 'no-font' }), h('view', { class: 'with-font' })]),
      `@font-face { font-family: "pua-icons"; src: url(data:font/ttf;base64,AAEAAA==) format("truetype") }
       .no-font::before { font-family: "undeclared-icons"; content: "\\e601" }
       .with-font::before { font: normal normal normal 14px/1 var(--icon-font, "pua-icons"); content: "\\e602" }`,
    );
    await settle();
    const texts = [...f.text.values()];
    expect(texts).not.toContain('\ue601');
    expect(texts).toContain('\ue602');
    app.unmount();
  });

  // specs/071: the glyph's text node carries the box's text properties (the
  // peer's text reads only its own style), and follows content changes
  it('styles the decoration text and swaps it with the content', async () => {
    f = freshFrames();
    const on = ref(false);
    const { app } = mount(
      () => h('view', { class: on.value ? 'star on' : 'star' }),
      `@font-face { font-family: "star-icons"; src: url(data:font/ttf;base64,AAEAAA==) format("truetype") }
       .star { color: #c8c9cc; font-size: 20px }
       .star::before { font-family: "star-icons"; content: "\\e603" }
       .star.on::before { content: "\\e604" }`,
    );
    await settle();
    const glyph = textIdOf('\ue603');
    expect(f.styleOf.get(glyph)).toMatchObject({ fontFamily: '"star-icons"', fontSize: 20, color: '#c8c9cc' });
    on.value = true;
    await nextTick();
    await settle();
    expect(f.text.get(glyph)).toBe('\ue604');
    app.unmount();
  });

  it('drops the decoration box when the class stops matching', async () => {
    f = freshFrames();
    const on = ref(true);
    const { app } = mount(
      () => h('view', { class: on.value ? 'checked' : '' }, [h('text', 'x')]),
      `.checked::after { content: ''; width: 10px }`,
    );
    await settle();
    // content: '' means a box with no text child: find it as the childless
    // view under the element (the real text child is the other one)
    const element = ownerOfText('x');
    const box = (f.childrenOf.get(element) ?? []).find((child) => !f.text.has(child));
    expect(box, 'no decoration box under the element').toBeDefined();

    on.value = false;
    await settle();
    await settle();
    expect(f.removed.has(box!)).toBe(true);
    app.unmount();
  });

  // CSS: no `content` is `normal` — no box. vant's
  // `.van-sidebar-item:not(:last-child)::after { border-bottom-width: 1px }`
  // only tops up a hairline; boxed alone it underlined every title
  // (specs/073).
  it('generates no box for a pseudo rule without content', async () => {
    f = freshFrames();
    const { app } = mount(
      () => h('view', { class: 'item' }, [h('text', 'y')]),
      `.item::after { border-bottom-width: 1px }
       .item::before { content: none; width: 4px }`,
    );
    await settle();
    const element = ownerOfText('y');
    const kids = f.childrenOf.get(element) ?? [];
    expect(kids.filter((child) => !f.text.has(child))).toEqual([]);
    app.unmount();
  });

  // vant's picker column sets each option through the `textContent` DOM
  // property; Toast/Dialog use innerHTML (specs/073)
  it('turns textContent / innerHTML props into element text', async () => {
    f = freshFrames();
    const { app } = mount(
      () =>
        h('view', null, [
          h('view', { class: 'a', textContent: '杭州' }),
          h('view', { class: 'b', innerHTML: '第一行<br>第二行 &amp; <b>粗</b>' }),
        ]),
      '',
    );
    await settle();
    const texts = [...f.text.values()];
    expect(texts).toContain('杭州');
    expect(texts).toContain('第一行\n第二行 & 粗');
    app.unmount();
  });

  it('keeps real-child inserts correct past a ::before box', async () => {
    f = freshFrames();
    const items = ref<string[]>([]);
    const { app } = mount(
      () => h('view', { class: 'list' }, items.value.map((t) => h('text', t))),
      `.list::before { content: ''; width: 1px }`,
    );
    await settle();
    items.value = ['a', 'b'];
    await settle();
    await settle();
    const a = textIdOf('a');
    const b = textIdOf('b');
    // real children shift past the decoration box: a lands at position 1,
    // b at 2 — the box keeps position 0
    const order = f.childrenOf.get(f.parentOf.get(a)!) ?? [];
    expect(order.indexOf(a)).toBe(1);
    expect(order.indexOf(b)).toBe(2);
    app.unmount();
  });
});

// specs/069 验证期：vant stepper 在 iOS 上点 + 后输入框和加号丢掉全部样式
describe('v-show writes only display', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  it('keeps the cascade when the component re-renders', async () => {
    f = freshFrames();
    const show = ref(true);
    const n = ref(1);
    const { app } = mount(
      () =>
        h('view', null, [
          withDirectives(h('view', { class: 'plus' }, [h('text', String(n.value))]), [[vShow, show.value]]),
        ]),
      `.plus { width: 28px; background: #f2f3f5 }`,
    );
    await settle();
    const plus = ownerOfText('1');
    expect(f.styleOf.get(plus)).toMatchObject({ width: 28, background: '#f2f3f5' });
    // an unrelated re-render runs the directive's `updated` hook
    n.value = 2;
    await nextTick();
    await settle();
    expect(f.styleOf.get(plus)).toMatchObject({ width: 28, background: '#f2f3f5' });
    expect(f.styleOf.get(plus)?.display).toBeUndefined();
    show.value = false;
    await nextTick();
    await settle();
    expect(f.styleOf.get(plus)).toMatchObject({ width: 28, display: 'none' });
    show.value = true;
    await nextTick();
    await settle();
    expect(f.styleOf.get(plus)).toMatchObject({ width: 28 });
    expect(f.styleOf.get(plus)?.display).toBeUndefined();
    app.unmount();
  });
});

describe('payload-less events', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  // specs/103 split the shapes by tag: a NON-fjs tag (`div`, where vant's
  // stepper/checker bind their handlers) keeps the DOM-shaped event, the
  // same shape web's native element hands the same handler.
  it('hand a non-fjs tag handler a DOM-shaped event object', async () => {
    f = freshFrames();
    let got: unknown = 'not called';
    const { app } = mount(
      () => h('div', { onClick: (e: unknown) => (got = e) }, [h('text', 'tap me')]),
      '',
    );
    await settle();
    const target = ownerOfText('tap me');
    (globalThis as { __fjsDispatchEvent?: (id: number, t: number, p: string | null) => void })
      .__fjsDispatchEvent!(target, 1, null);
    // vant's stepper: `preventDefault(event)` reads event.cancelable first
    expect(got).toMatchObject({ preventDefault: expect.any(Function), stopPropagation: expect.any(Function) });
    app.unmount();
  });
});

describe('text-control events', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  // specs/103: fjs's input compiles to a component on web and emits the
  // value, so the first argument IS that value on both ends — vant's Field
  // reads it directly through demo/vite/vant.ts's payload patch. Model ->
  // view still goes through `inputRef.value.value = text`.
  it('hand the handler the value and keep el.value live', async () => {
    f = freshFrames();
    let typed: unknown;
    let input: { value: string; setSelectionRange(): void } | undefined;
    const { app } = mount(
      () =>
        h('input', {
          ref: (el: unknown) => (input = el as typeof input),
          onInput: (e: unknown) => {
            typed = e;
          },
        }),
      '',
    );
    await settle();
    const id = [...f.tag].find(([, tag]) => tag === 'input')![0];
    (globalThis as { __fjsDispatchEvent?: (id: number, t: number, p: string | null) => void })
      .__fjsDispatchEvent!(id, 3, 'abc');
    expect(typed).toBe('abc');
    expect(input!.value).toBe('abc');
    // the typed text is already on screen: no echo back to native
    expect(f.props.get(id)?.value).toBeUndefined();
    input!.value = 'xy';
    input!.setSelectionRange();
    await settle();
    expect(f.props.get(id)?.value).toBe('xy');
    app.unmount();
  });
});


// specs/133: the host tells Dart whether a modal mask is up, so the back
// gesture / Android back button can be held while a popup blocks the page
describe('overlay host modal flag', () => {
  beforeEach(() => setOpSink((bytes) => sink(bytes)));
  afterEach(() => setOpSink(null));

  const hostId = () => [...f.tag].find(([, tag]) => tag === 'fjs-overlay-host')?.[0];
  const modalOf = () => {
    const host = hostId();
    return host == null ? undefined : f.props.get(host)?.modal;
  };

  it('is set by a full-viewport mask and cleared by v-show and unmount', async () => {
    f = freshFrames();
    const open = ref(false);
    const mounted = ref(true);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          mounted.value
            ? withDirectives(h('view', { class: 'van-overlay' }, '遮罩'), [[vShow, open.value]])
            : null,
          h('view', { class: 'toast' }, '提示'),
        ]),
      `.van-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2000 }
       .toast { position: fixed; top: 50%; left: 0; width: 88px }`,
    );
    await settle();
    await settle();
    // the Toast alone hoists but is not modal
    expect(hostId()).toBeDefined();
    expect(modalOf() ?? false).toBe(false);

    open.value = true;
    await settle();
    await settle();
    expect(modalOf()).toBe(true);

    // vant hides a closed overlay with v-show
    open.value = false;
    await settle();
    await settle();
    expect(modalOf()).toBe(false);

    open.value = true;
    await settle();
    await settle();
    expect(modalOf()).toBe(true);
    mounted.value = false;
    await settle();
    await settle();
    expect(modalOf()).toBe(false);
    app.unmount();
  });

  it('treats a stuck Sticky and a fixed NavBar as non-modal, inset 0 as modal', async () => {
    f = freshFrames();
    const mask = ref(false);
    const { app } = mount(
      () =>
        h('view', { class: 'page' }, [
          h('view', { class: 'sticky' }, '吸顶'),
          h('view', { class: 'nav' }, '顶栏'),
          mask.value ? h('view', { class: 'mask' }, '手写遮罩') : null,
        ]),
      `.sticky { position: fixed; top: 0; left: 28px; width: 100px }
       .nav { position: fixed; top: 0; left: 0; width: 100%; height: 46px }
       .mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0 }`,
    );
    await settle();
    await settle();
    expect(modalOf() ?? false).toBe(false);
    mask.value = true;
    await settle();
    await settle();
    expect(modalOf()).toBe(true);
    app.unmount();
  });
});
