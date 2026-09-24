// specs/129: a tap bubbles to every listening ancestor on the Flutter path,
// as a DOM click does on web. The host reports only the innermost detector
// (the arena's winner); vant's Popover listens on a <span> around a
// van-button that has a click handler of its own, and never opened.
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref, withModifiers } from 'vue';
import { childElementIds, createApp, elementTag, flutterRoot } from '../src/vue/renderer';
import { installEventDispatcher } from '../src/ui/element';
import { setOpSink } from '../src/host';

(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

type Dispatch = (id: number, type: number, payload: string | null) => void;
const dispatch = () => (globalThis as { __fjsDispatchEvent?: Dispatch }).__fjsDispatchEvent!;
const TAP = 1;

beforeEach(() => {
  setOpSink(() => {});
  installEventDispatcher();
});

function idsByTag(rootId: number, tag: string): number[] {
  const out: number[] = [];
  const visit = (id: number) => {
    if (elementTag(id) === tag) out.push(id);
    for (const kid of childElementIds(id)) visit(kid);
  };
  visit(rootId);
  return out;
}

describe('tap bubbling (specs/129)', () => {
  it('reaches every listening ancestor, innermost first', async () => {
    const seen: string[] = [];
    const targets: unknown[] = [];
    const inner = ref<any>(null);
    const outer = ref<any>(null);
    const App = defineComponent(
      () => () =>
        h('span', { ref: outer, onClick: (e: { target: unknown; currentTarget: unknown }) => {
          seen.push('span');
          targets.push(e.target, e.currentTarget);
        } }, [
          h('view', null, [h('button', { ref: inner, onClick: () => seen.push('button') }, 'b')]),
        ]),
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await nextTick();

    const [button] = idsByTag(root.id, 'button');
    dispatch()(button, TAP, null);
    expect(seen).toEqual(['button', 'span']);
    // target is where the tap landed, currentTarget the listener's node
    expect(targets.map((t) => (t as { id: number }).id)).toEqual([inner.value.id, outer.value.id]);
  });

  it('stops at a handler that calls stopPropagation (@click.stop)', async () => {
    const seen: string[] = [];
    const App = defineComponent(
      () => () =>
        h('view', { onClick: () => seen.push('outer') }, [
          h('view', { onClick: withModifiers(() => seen.push('inner'), ['stop']) }, 'x'),
        ]),
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await nextTick();

    const inner = idsByTag(root.id, 'view').at(-1)!;
    dispatch()(inner, TAP, null);
    expect(seen).toEqual(['inner']);
  });

  it('bubbles to addEventListener listeners and honours their stop', async () => {
    const seen: string[] = [];
    const outer = ref<any>(null);
    const middle = ref<any>(null);
    const App = defineComponent(
      () => () =>
        h('view', { ref: outer }, [h('view', { ref: middle }, [h('view', { onTap: () => seen.push('tap') }, 'x')])]),
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await nextTick();
    outer.value.addEventListener('click', () => seen.push('outer'));
    middle.value.addEventListener('click', (e: { stopPropagation(): void }) => {
      seen.push('middle');
      e.stopPropagation();
    });

    const leaf = idsByTag(root.id, 'view').at(-1)!;
    dispatch()(leaf, TAP, null);
    expect(seen).toEqual(['tap', 'middle']);
  });
});

describe('node-walk members (specs/129)', () => {
  it('parentNode follows the mounted tree; nodeType and tagName are the DOM ones', async () => {
    const show = ref(true);
    const parent = ref<any>(null);
    const child = ref<any>(null);
    const App = defineComponent(
      () => () => h('view', { ref: parent }, show.value ? [h('scroll-view', { ref: child })] : []),
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await nextTick();

    const el = child.value;
    // ids, not the elements: pretty-format takes an object with nodeType 1
    // for a DOM node and cannot print it
    expect(el.parentNode?.id).toBe(parent.value.id);
    expect(el.parentElement?.id).toBe(parent.value.id);
    expect(el.nodeType).toBe(1);
    expect(el.tagName).toBe('SCROLL-VIEW');
    // the chain ends at the page root, which has no parent
    expect(parent.value.parentNode?.id).toBe(root.id);
    expect(root.parentNode ?? null).toBe(null);

    show.value = false;
    await nextTick();
    expect(el.parentNode ?? null).toBe(null);
  });
});
