// End-to-end test in Node (no native host): mount a real Vue app through
// the custom renderer with scoped styles registered, capture the binary UI
// op frames via setSink, decode SetProps, and assert the final merged style
// per element.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { h, defineComponent, ref, type VNode } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createApp, flutterRoot, registerStyles, useCssVars } from '../src/vue';
// the opcodes come from the writer itself: a private copy here is one more
// place the protocol can drift
import { UiOp as Op } from '../src/ui/ops';
import { FjsRichText } from '../src/components/rich-text';

// The runtime falls back to the pre-interning style encoding unless a host
// declares it can decode ops 7-9 (FjsEngine does this when it creates the
// VM; so does fjsrun). Without it these assertions would silently measure
// the legacy path.
(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

// ---- minimal decoder for the op stream --------------------------------------

interface Frame {
  tag: Map<number, string>;
  props: Map<number, Record<string, unknown>>;
}

function decodeFrame(bytes: Uint8Array): Frame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const frame: Frame = { tag: new Map(), props: new Map() };
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
    const v = dec.decode(bytes.subarray(i, i + len));
    i += len;
    return v;
  };
  while (i < bytes.length) {
    const op = bytes[i++];
    switch (op) {
      case Op.Create:
        frame.tag.set(u32(), str(u16()));
        break;
      case Op.Remove:
        u32();
        break;
      case Op.Insert:
        u32();
        u32();
        u32();
        break;
      case Op.RemoveChild:
        u32();
        u32();
        break;
      case Op.SetText: {
        // NOTE: `i += u32()` would clobber the cursor (compound assignment
        // reads the left side before evaluating the right)
        u32();
        const len = u32();
        i += len;
        break;
      }
      case Op.SetProps: {
        const id = u32();
        const json = str(u32());
        // merge so later ops override earlier ones, mirroring the native side
        frame.props.set(id, {
          ...(frame.props.get(id) ?? {}),
          ...JSON.parse(json),
        });
        break;
      }
      case Op.DefineStyle: {
        const styleId = u32();
        styles.set(styleId, JSON.parse(str(u32())));
        break;
      }
      case Op.SetStyle: {
        const id = u32();
        const styleId = u32();
        const activeId = u32();
        // replace semantics for both slots, as on the native side; the
        // assertions below read them out of `props` the way they used to
        // arrive, so a style id of 0 removes the key
        const next = { ...(frame.props.get(id) ?? {}) };
        if (styleId === 0) delete next.style;
        else next.style = styles.get(styleId);
        if (activeId === 0) delete next.activeStyle;
        else next.activeStyle = styles.get(activeId);
        frame.props.set(id, next);
        break;
      }
      case Op.ResetStyles:
        styles.clear();
        break;
      default:
        throw new Error(`unknown op ${op} at ${i - 1}`);
    }
  }
  return frame;
}

/** Interned style directory, shared across frames the way the native
 * decoder's is — a definition sent in one frame is referenced by later ones. */
const styles = new Map<number, Record<string, unknown>>();

const frames: Uint8Array[] = [];

// host.ts replaces globalThis.setTimeout with native-backed stubs that are
// no-ops outside the fjs runtime, so flushing must use microtasks only.
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeAll(() => {
  setOpSink((frame) => frames.push(frame));
});

afterEach(() => {
  frames.length = 0;
});

function finalProps(): Frame {
  const merged: Frame = { tag: new Map(), props: new Map() };
  for (const raw of frames) {
    const f = decodeFrame(raw);
    for (const [id, tag] of f.tag) merged.tag.set(id, tag);
    for (const [id, props] of f.props) {
      merged.props.set(id, { ...(merged.props.get(id) ?? {}), ...props });
    }
  }
  return merged;
}

/** Element id of the first node with the given tag (ids increment across
 * tests, so look them up instead of hardcoding). */
function idOfTag(frame: Frame, tag: string): number {
  for (const [id, t] of frame.tag) {
    if (t === tag) return id;
  }
  throw new Error(`no element with tag ${tag}`);
}

describe('Vue renderer + scoped styles', () => {
  it('applies scoped rules, tag defaults and inheritance end to end', async () => {
    registerStyles(
      'data-v-t1',
      `.card { color: #ff0000; font-size: 16px; }
       .card .title { font-weight: bold; }`,
    );
    const App: any = defineComponent(() => {
      return () =>
        h('div', { class: 'card' }, [h('span', { class: 'title' }, 'hi')]) as VNode;
    });
    // the SFC plugin adds this line to compiled components with scoped styles
    App.__scopeId = 'data-v-t1';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();

    const props = finalProps().props;
    // div.card: scoped rule applied
    const card = props.get(root.id + 1) as { style: Record<string, unknown> };
    expect(card.style).toMatchObject({ color: '#ff0000', fontSize: 16 });
    // span.title inherits color/fontSize, adds its own rule
    const title = props.get(root.id + 2) as { style: Record<string, unknown> };
    expect(title.style).toMatchObject({
      color: '#ff0000',
      fontSize: 16,
      fontWeight: 'bold',
    });
    // class attribute itself never crosses the bridge
    expect(props.get(2)?.class).toBeUndefined();
  });

  it('leaves the button hairline to the host, and lets a rule win', async () => {
    registerStyles(
      'data-v-btn',
      `.ghost { border-color: #007aff; }
       .bare { border: none; }`,
    );
    const App: any = defineComponent(() => {
      return () =>
        h('view', null, [
          h('button', null, 'plain'),
          h('button', { class: 'ghost' }, 'ghost'),
          h('button', { class: 'bare' }, 'bare'),
        ]) as VNode;
    });
    App.__scopeId = 'data-v-btn';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();

    const props = finalProps().props;
    // The hairline is the HOST's default now (fjsButtonDefaultBorder in
    // widgets/button.dart, `.fjs-button--default` on web): a filled variant
    // must not have one, and a border injected from here would reach Dart
    // indistinguishable from one the page wrote.
    const plain = props.get(root.id + 2) as { style: Record<string, unknown> };
    expect(plain.style.border).toBeUndefined();
    // A rule still wins over that default: border-color alone recolors the
    // hairline (render/style.dart), and the shorthand replaces it outright.
    const ghost = props.get(root.id + 3) as { style: Record<string, unknown> };
    expect(ghost.style).toMatchObject({ borderColor: '#007aff' });
    const bare = props.get(root.id + 4) as { style: Record<string, unknown> };
    expect(bare.style).toMatchObject({ border: 'none' });
  });

  it('updates styles when a dynamic class binding flips', async () => {
    registerStyles(
      'data-v-t2',
      `.up { color: #2e7d32; }
       .down { color: #c62828; }`,
    );
    const up = ref(true);
    const App: any = defineComponent(() => {
      return () => h('span', { class: up.value ? 'up' : 'down' }, 'x');
    });
    App.__scopeId = 'data-v-t2';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    const frame = finalProps();
    const spanId = idOfTag(frame, 'text');
    expect(frame.props.get(spanId)).toMatchObject({ style: { color: '#2e7d32' } });

    up.value = false;
    await flush();
    expect(finalProps().props.get(spanId)).toMatchObject({ style: { color: '#c62828' } });
  });

  it('matches :disabled on a form control while its disabled prop is set', async () => {
    // vant greys a disabled field's text through `.van-field__control:disabled`
    registerStyles(
      'data-v-dis',
      `.ctl { color: #111111; }
       .ctl:disabled { color: #c8c9cc; }
       .box:disabled { color: #ff0000; }
       [class*=disabled] { font-weight: bold; }`,
    );
    const off = ref(true);
    const App: any = defineComponent(() => {
      return () =>
        h('view', null, [
          h('input', { class: 'ctl', disabled: off.value ? '' : false }),
          h('div', { class: 'box', disabled: true }, 'x'),
        ]) as VNode;
    });
    App.__scopeId = 'data-v-dis';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    const input = root.id + 2;
    const box = root.id + 3;
    let props = finalProps().props;
    expect((props.get(input) as { style: Record<string, unknown> }).style).toMatchObject({ color: '#c8c9cc' });
    // the state is not part of the class attribute
    expect((props.get(input) as { style: Record<string, unknown> }).style.fontWeight).toBeUndefined();
    // only form controls can be :disabled
    expect((props.get(box) as { style: Record<string, unknown> }).style.color).not.toBe('#ff0000');

    off.value = false;
    await flush();
    props = finalProps().props;
    expect((props.get(input) as { style: Record<string, unknown> }).style).toMatchObject({ color: '#111111' });
  });

  it('maps the textarea element to a multiline input and marks HTML blocks', async () => {
    // render functions ask for the ELEMENT (vant's Field: h('textarea')); the
    // Dart side has no `textarea` tag and used to render nothing
    const App: any = defineComponent(() => {
      return () =>
        h('view', null, [
          h('textarea', { rows: 2 }),
          h('div', null, [h('span', null, '0'), '/50']),
          h('p', null, 'para'),
        ]) as VNode;
    });
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    const frame = finalProps();
    const area = root.id + 2;
    expect(frame.tag.get(area)).toBe('input');
    expect(frame.props.get(area)).toMatchObject({ multiline: true });
    const div = root.id + 3;
    expect(frame.tag.get(div)).toBe('view');
    expect(frame.props.get(div)).toMatchObject({ htmlBlock: true });
    // the span inside is an inline run: no marker
    expect(frame.props.get(div + 1)?.htmlBlock).toBeUndefined();
    // the outer fjs view is not an HTML block
    expect(frame.props.get(root.id + 1)?.htmlBlock).toBeUndefined();
  });

  it('resolves CSS variables defined in scoped styles down the tree', async () => {
    registerStyles(
      'data-v-var1',
      `.card { --brand: #ff0000; --pad: 8px; padding: var(--pad); }
       .card .title { color: var(--brand); }
       .chip { color: var(--brand, #00ff00); }`,
    );
    const App: any = defineComponent(() => {
      return () =>
        h('div', { class: 'card' }, [
          h('span', { class: 'title' }, 'hi'),
          h('span', { class: 'chip' }, 'chip'),
        ]) as VNode;
    });
    App.__scopeId = 'data-v-var1';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();

    const props = finalProps().props;
    // card: padding resolved from --pad to a number
    const card = props.get(root.id + 1) as { style: Record<string, unknown> };
    expect(card.style).toMatchObject({ padding: 8 });
    // title: color resolved through the inherited --brand
    const title = props.get(root.id + 2) as { style: Record<string, unknown> };
    expect(title.style).toMatchObject({ color: '#ff0000' });
    // chip: same inherited variable
    const chip = props.get(root.id + 3) as { style: Record<string, unknown> };
    expect(chip.style).toMatchObject({ color: '#ff0000' });
    // custom property definitions never cross the bridge
    expect(Object.keys(card.style).some((k) => k.startsWith('--'))).toBe(false);
  });

  it('updates var()-driven styles when a bound variable flips', async () => {
    registerStyles(
      'data-v-var2',
      `.up { --c: #2e7d32; color: var(--c); }
       .down { --c: #c62828; color: var(--c); }`,
    );
    const up = ref(true);
    const App: any = defineComponent(() => {
      return () => h('span', { class: up.value ? 'up' : 'down' }, 'x');
    });
    App.__scopeId = 'data-v-var2';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    const frame = finalProps();
    const spanId = idOfTag(frame, 'text');
    expect(frame.props.get(spanId)).toMatchObject({ style: { color: '#2e7d32' } });

    up.value = false;
    await flush();
    expect(finalProps().props.get(spanId)).toMatchObject({ style: { color: '#c62828' } });
  });

  it('supports v-bind() CSS: useCssVars drives vars reactively', async () => {
    // simulates the compiled SFC output: the plugin rewrites v-bind(accent)
    // to var(--data-v-vb1-accent) and compileScript injects the useCssVars
    // call whose keys are the same var names
    registerStyles(
      'data-v-vb1',
      `.badge { color: var(--data-v-vb1-accent); font-size: 14px; }`,
    );
    const accent = ref('#ff0000');
    const App: any = defineComponent(() => {
      useCssVars(() => ({ 'data-v-vb1-accent': accent.value }));
      return () => h('span', { class: 'badge' }, 'x');
    });
    App.__scopeId = 'data-v-vb1';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    const frame = finalProps();
    const spanId = idOfTag(frame, 'text');
    expect(frame.props.get(spanId)).toMatchObject({ style: { color: '#ff0000' } });

    accent.value = '#00ff00';
    await flush();
    expect(finalProps().props.get(spanId)).toMatchObject({ style: { color: '#00ff00' } });
  });

  it('supports v-bind("obj.prop") with deep ref mutation (compiled form)', async () => {
    // mirrors the user pattern v-bind('theme.color'): compileScript
    // generates the getter key RAW (no CSS escaping) and transforms the
    // expression to theme.value.color; deep mutations must propagate
    registerStyles(
      'data-v-vb2',
      `p { color: var(--data-v-vb2-theme\\.color); font-size: 18px; }`,
    );
    const theme = ref({ color: 'red' });
    const App: any = defineComponent(() => {
      useCssVars(() => ({ 'data-v-vb2-theme.color': theme.value.color }));
      return () => h('p', 'hello');
    });
    App.__scopeId = 'data-v-vb2';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    const frame = finalProps();
    const pId = idOfTag(frame, 'text');
    expect(frame.props.get(pId)).toMatchObject({ style: { color: 'red', fontSize: 18 } });

    theme.value.color = 'blue';
    await flush();
    expect(finalProps().props.get(pId)).toMatchObject({ style: { color: 'blue' } });
  });

  it('keeps non-scoped styles global and inline styles on top', async () => {
    registerStyles(null, `p { color: blue; margin: 8px }`);
    const App = defineComponent(() => {
      return () => h('p', { style: { color: 'green' } }, 'x');
    });
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();
    const p = finalProps().props.get(root.id + 1) as { style: Record<string, unknown> };
    // p default style (margin 8) < global rule < inline
    expect(p.style).toMatchObject({ margin: 8, color: 'green' });
  });

  it("gives rich-text's inner nodes the page's scope (specs/034 §3.6)", async () => {
    // The inner nodes are rendered by the rich-text component, which has no
    // scope of its own; without the copied scopeId the page's `.hl` rule
    // would match nothing inside it.
    registerStyles('data-v-rt', `.hl { color: #07c160; }`);
    const App: any = defineComponent(() => {
      return () =>
        h(FjsRichText, { nodes: '<p>a <b><span class="hl">x</span></b></p>' }) as VNode;
    });
    App.__scopeId = 'data-v-rt';
    const root = flutterRoot();
    createApp(App).mount(root);
    await flush();

    const frame = finalProps();
    const styled = [...frame.props.entries()].filter(
      ([id, p]) => frame.tag.get(id) === 'text' && (p.style as Record<string, unknown> | undefined)?.color === '#07c160',
    );
    // the span, and the bare "x" under it inheriting the colour
    expect(styled.length).toBeGreaterThanOrEqual(1);
    const [, span] = styled[0];
    // bold inherits from the <b> span above it, the scoped rule adds the colour
    expect(span.style).toMatchObject({ color: '#07c160', fontWeight: 'bold' });
    // the paragraph itself is not coloured: the rule matched the span only
    const paragraphs = [...frame.props.entries()].filter(
      ([id, p]) => frame.tag.get(id) === 'text' && (p.style as Record<string, unknown> | undefined)?.color === undefined,
    );
    expect(paragraphs.length).toBeGreaterThan(0);
  });
});
