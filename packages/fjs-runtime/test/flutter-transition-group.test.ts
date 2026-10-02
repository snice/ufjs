// specs/179: <TransitionGroup> for VDOM components on the Flutter renderer
// (vue-shim.ts) — item enter / leave through the style engine, the FLIP
// move pass over ui/geometry's synchronous rect reads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, nextTick, ref } from '@vue/runtime-core';
import { setOpSink } from '../src/host';

// no host to lay anything out: a test decides each element's box
vi.mock('../src/ui/geometry', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    boundingRectOf: (id: number) => {
      const fn = (globalThis as { __rectOf?: (id: number) => { left: number; top: number } }).__rectOf;
      const r = fn ? fn(id) : { left: 0, top: 0 };
      return { x: r.left, y: r.top, left: r.left, top: r.top, right: r.left + 100, bottom: r.top + 10, width: 100, height: 10 };
    },
  };
});

const { TransitionGroup } = await import('../src/vue/vue-shim');
const { createApp, flutterRoot, registerStyles, styleEngine } = await import('../src/vue');
const { childElementIds } = await import('../src/vue/host-ops');

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = { uiOpsVersion: 2 };

const CSS = `
  .list-enter-active, .list-leave-active { transition: opacity .1s }
  .list-enter-from, .list-leave-to { opacity: 0 }
  .list-move { transition: transform .1s }
`;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const g = globalThis as { __rectOf?: (id: number) => { left: number; top: number } };

let unmount: (() => void) | undefined;

/** Ids of the elements carrying `cls` (newest test's last). */
function idsWith(cls: string): number[] {
  const out: number[] = [];
  for (let id = 1; id < 8192; id++) if (styleEngine.classesOf(id).includes(cls)) out.push(id);
  return out;
}

function mountList(items: { value: string[] }): { listId: () => number; rowId: (k: string) => number | undefined } {
  const root = flutterRoot();
  registerStyles(null, CSS);
  const app = createApp({
    render: () =>
      h(TransitionGroup, { name: 'list', tag: 'view', class: 'tg-list' }, {
        default: () => items.value.map((k) => h('view', { key: k, class: `row r-${k}` }, k)),
      }),
  });
  app.mount(root);
  unmount = () => app.unmount();
  const listId = () => idsWith('tg-list').pop()!;
  const rowId = (k: string) => idsWith(`r-${k}`).pop();
  // a row's box follows its place under the list container
  g.__rectOf = (id) => ({ left: 0, top: childElementIds(listId()).indexOf(id) * 10 });
  return { listId, rowId };
}

describe('<TransitionGroup> on the Flutter renderer (specs/179)', () => {
  beforeEach(() => setOpSink(() => {}));
  afterEach(async () => {
    unmount?.();
    unmount = undefined;
    g.__rectOf = undefined;
    await sleep(0);
    setOpSink(null);
  });

  it('renders its tag around the keyed items', async () => {
    const items = ref(['a', 'b']);
    const { listId } = mountList(items);
    await nextTick();
    expect(childElementIds(listId()).length).toBe(2);
  });

  it('a new item enters; a removed one stays until its leave is over', async () => {
    const items = ref(['a', 'b']);
    const { rowId } = mountList(items);
    await nextTick();
    items.value = ['a', 'b', 'c'];
    await nextTick();
    await nextTick();
    expect(styleEngine.classesOf(rowId('c')!)).toEqual(expect.arrayContaining(['list-enter-from', 'list-enter-active']));
    await sleep(300);
    expect(styleEngine.classesOf(rowId('c')!)).not.toContain('list-enter-active');

    const b = rowId('b')!;
    items.value = ['a', 'c'];
    await nextTick();
    await nextTick();
    expect(styleEngine.classesOf(b)).toContain('list-leave-active');
    await sleep(300);
    expect(rowId('b')).toBeUndefined();
  });

  it('moved items get the inverse transform, then the move class, which comes off at the end', async () => {
    const items = ref(['a', 'b', 'c']);
    const { rowId } = mountList(items);
    await nextTick();
    const a = rowId('a')!;
    items.value = ['c', 'b', 'a'];
    await nextTick();
    // a went from slot 0 to slot 2: put back 20px up, transitions off
    expect(styleEngine.inlineRecord(a)).toMatchObject({ transform: 'translate(0px,-20px)', transitionDuration: '0s' });
    await sleep(40);
    expect(styleEngine.classesOf(a)).toContain('list-move');
    expect(styleEngine.inlineRecord(a)?.transform).toBeUndefined();
    await sleep(300);
    expect(styleEngine.classesOf(a)).not.toContain('list-move');
  });
});
