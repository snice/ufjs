// Fragment unmount through the custom renderer: vue's removeFragment walks
// siblings until `cur === end`, comparing the host nodes BY IDENTITY against
// the anchor it stored at mount — so nextSibling/parentNode must return the
// real element, never a fresh wrapper. Regression: with wrapper handles the
// walk ran off the child list and handed null back to nextSibling, and a
// button whose slot content switched shape (a click-to-loading button: text
// → spinner + text) took the whole patch down. A keyed Fragment swap is the
// smallest render that unmounts a fragment; ops are decoded into live tree
// facts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fragment, defineComponent, h, nextTick, ref } from '@vue/runtime-core';
import { setOpSink } from '../src/host';
import { createApp, flutterRoot } from '../src/vue';
import { UiOp as Op } from '../src/ui/ops';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

interface Tree {
  tag: Map<number, string>;
  parentOf: Map<number, number | null>;
  childrenOf: Map<number, number[]>;
  text: Map<number, string>;
  removed: Set<number>;
}

function decode(bytes: Uint8Array, t: Tree): void {
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
  const str = (len: number) => dec.decode(bytes.subarray(i, (i += len)));
  while (i < bytes.length) {
    const op = bytes[i++];
    switch (op) {
      case Op.Create:
        t.tag.set(u32(), str(u16()));
        break;
      case Op.Remove:
        t.removed.add(u32());
        break;
      case Op.Insert: {
        const parent = u32();
        const child = u32();
        u32();
        const prev = t.parentOf.get(child);
        if (prev !== undefined && prev !== parent) {
          t.childrenOf.get(prev)?.splice(t.childrenOf.get(prev)!.indexOf(child), 1);
        }
        t.parentOf.set(child, parent);
        const list = t.childrenOf.get(parent) ?? [];
        t.childrenOf.set(parent, list);
        if (!list.includes(child)) list.push(child);
        break;
      }
      case Op.RemoveChild: {
        const parent = u32();
        const child = u32();
        t.childrenOf.get(parent)?.splice(t.childrenOf.get(parent)!.indexOf(child), 1);
        t.parentOf.set(child, null);
        break;
      }
      case Op.SetText: {
        const id = u32();
        t.text.set(id, str(u32()));
        break;
      }
      // not needed for tree facts, but their payloads must be skipped or
      // the rest of the frame decodes as garbage
      case Op.SetProps:
      case Op.DefineStyle:
      case Op.Canvas:
      case Op.Webgl: {
        u32();
        // not `i += u32()`: the compound assignment reads `i` before u32()
        // advances it
        const len = u32();
        i += len;
        break;
      }
      case Op.SetStyle:
        i += 12;
        break;
      case Op.SetHoverStyle:
        i += 8;
        break;
      case Op.ResetStyles:
        break;
      default:
        throw new Error(`unknown op ${op} at ${i - 1}`);
    }
  }
}

describe('fragment unmount', () => {
  beforeEach(() => setOpSink(() => {}));
  afterEach(() => setOpSink(null));

  it('swaps a keyed fragment between sibling anchors without losing the patch', async () => {
    const loading = ref(false);
    const root = flutterRoot();
    const app = createApp(
      defineComponent({
        render: () =>
          h('view', { class: 'button' }, [
            h('view', { class: 'lead' }),
            // the fragment sits BETWEEN siblings, so its end anchor has a
            // next sibling the walk must stop before
            loading.value
              ? h(Fragment, { key: 'loading' }, [h('svg', [h('circle')]), h('text', '提交中')])
              : h(Fragment, { key: 'idle' }, [h('text', '点击提交')]),
            h('view', { class: 'trail' }),
          ]),
      }),
    );
    app.mount(root);
    await nextTick();

    const tree: Tree = { tag: new Map(), parentOf: new Map(), childrenOf: new Map(), text: new Map(), removed: new Set() };
    setOpSink((bytes) => decode(bytes, tree));
    loading.value = true;
    await nextTick();
    await nextTick();

    const svgId = [...tree.tag.entries()].find(([, tg]) => tg === 'svg')?.[0];
    const circleId = [...tree.tag.entries()].find(([, tg]) => tg === 'circle')?.[0];
    expect(svgId, 'svg spinner should be created').toBeDefined();
    expect(circleId, 'circle should be created').toBeDefined();
    expect([...tree.text.values()].join('|')).toContain('提交中');
    // the idle fragment's text went: removed, not left dangling
    expect(tree.removed.size).toBeGreaterThan(0);
    app.unmount();
    // unmount queued a flush; drain it while a sink is still set
    await new Promise((r) => setTimeout(r, 0));
  });
});
