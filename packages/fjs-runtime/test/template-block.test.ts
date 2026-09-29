// specs/153: the VDOM path's template blocks. runtime-core mounts a vnode
// whose type says `__isTeleport` through the type's process / move / remove
// (the `shapeFlag & 64` branches) — this pins that contract for the calls a
// keyed list makes: mount, text update, move, remove, unmount under a removed
// parent. Without libfjs-style (vitest) the block is built node by node; the
// native clone path is covered by examples/bench (native:verify, parity).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, ref } from '@vue/runtime-core';
import { createApp, flutterRoot } from '../src/vue';
import { childElementIds, elementById, elementTag, nodeOps } from '../src/vue/renderer';
import { fjsTemplate } from '../src/vue/template-block';

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

// view.cell > text.tiny{{ t }} — what the compiler emits for flat-4050's cell
const CELL = fjsTemplate([
  [-1, 'view', 'cell', ''],
  [0, 'text', 'tiny', null],
]);

afterEach(() => vi.restoreAllMocks());

describe('fjsTemplate blocks', () => {
  it('mounts, updates, moves and removes like the elements it stands for', async () => {
    const texts = new Map<number, string>();
    const write = nodeOps.setElementText;
    const spy = vi.spyOn(nodeOps, 'setElementText').mockImplementation((el, text) => {
      texts.set(el.id, text);
      write(el, text);
    });
    const items = ref([1, 2, 3]);
    const label = ref('x');
    const show = ref(true);
    const app = createApp({
      render: () =>
        h('view', null, show.value
          ? [h('view', null, items.value.map((n) => h(CELL as never, { key: n, t: `${label.value}${n}` })))]
          : []),
    });
    const root = flutterRoot('view');
    app.mount(root);
    await flush();

    const list = () => childElementIds(childElementIds(childElementIds(root.id)[0])[0]);
    const cellTexts = () => list().map((cell) => {
      const [text] = childElementIds(cell);
      expect(elementTag(cell)).toBe('view');
      expect(elementTag(text)).toBe('text');
      return texts.get(text);
    });
    expect(cellTexts()).toEqual(['x1', 'x2', 'x3']);

    // an update writes only the texts that changed
    spy.mockClear();
    items.value = [1, 2, 3];
    await flush();
    expect(spy).not.toHaveBeenCalled();
    label.value = 'y';
    await flush();
    expect(spy).toHaveBeenCalledTimes(3);
    expect(cellTexts()).toEqual(['y1', 'y2', 'y3']);

    // keyed move and removal keep the same elements
    const [first, second] = list();
    items.value = [2, 1];
    await flush();
    expect(list()).toEqual([second, first]);
    const removed = childElementIds(first);
    items.value = [2];
    await flush();
    expect(list()).toEqual([second]);
    expect(elementById(first)).toBeUndefined();
    expect(elementById(removed[0])).toBeUndefined();

    // under a removed parent the block leaves with it
    const [secondText] = childElementIds(second);
    show.value = false;
    await flush();
    expect(elementById(second)).toBeUndefined();
    expect(elementById(secondText)).toBeUndefined();
    app.unmount();
  });

  it('keeps static text and a multi-slot text list', async () => {
    const texts = new Map<number, string>();
    const write = nodeOps.setElementText;
    vi.spyOn(nodeOps, 'setElementText').mockImplementation((el, text) => {
      texts.set(el.id, text);
      write(el, text);
    });
    const ROW = fjsTemplate([
      [-1, 'view', null, ''],
      [0, 'text', null, null],
      [0, 'text', 'k', 'static'],
      [0, 'text', null, null],
    ]);
    const a = ref('a');
    const app = createApp({ render: () => h('view', null, [h(ROW as never, { t: [a.value, 'b'] })]) });
    const root = flutterRoot('view');
    app.mount(root);
    await flush();
    const row = childElementIds(childElementIds(root.id)[0])[0];
    const read = () => childElementIds(row).map((id) => texts.get(id));
    expect(read()).toEqual(['a', 'static', 'b']);
    a.value = 'c';
    await flush();
    expect(read()).toEqual(['c', 'static', 'b']);
    app.unmount();
  });
});
