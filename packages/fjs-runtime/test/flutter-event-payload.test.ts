// The first argument a handler receives on the Flutter path (specs/103):
// the RAW payload for fjs tags — that is what web hands the same handler,
// because `webIsNativeTag` keeps those tags out of the native path and they
// compile to components that emit values — and a DOM-shaped event for
// everything else, where web's tag stays a native element and hands a real
// DOM event.
//
// The regression this pins: wrapping EVERY event turned
// `JSON.parse(payload)` in the image page into `JSON.parse({detail,…})`,
// whose SyntaxError left `errorPayload` an object and blanked the two panels
// that render it (Android, 2026-09-19 → 2026-09-23).
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, withModifiers } from 'vue';
import {
  childElementIds,
  createApp,
  elementTag,
  flutterRoot,
} from '../src/vue/renderer';
import { installEventDispatcher } from '../src/ui/element';
import { setOpSink } from '../src/host';

// No host behind it: op frames go nowhere, the renderer's bookkeeping is
// all the test needs (same setup as flutter-form.test.ts).
(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = {
  uiOpsVersion: 2,
};

type Dispatch = (id: number, type: number, payload: string | null) => void;
const dispatch = () =>
  (globalThis as { __fjsDispatchEvent?: Dispatch }).__fjsDispatchEvent!;

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

const LOAD = 26;
const TAP = 1;

describe('event first argument (specs/103)', () => {
  it('hands an fjs tag the raw payload string', async () => {
    const loads: unknown[] = [];
    const App = defineComponent(
      () => () =>
        h('image', {
          src: 'asset://photo.png',
          onLoad: (payload: unknown) => loads.push(payload),
        }),
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await nextTick();

    const [id] = idsByTag(root.id, 'image');
    expect(id).toBeTypeOf('number');
    dispatch()(id, LOAD, '{"width":600,"height":400}');

    expect(loads).toHaveLength(1);
    const payload = loads[0];
    // the shape docs/ui-api.md promises and every page handler parses
    expect(typeof payload).toBe('string');
    expect(JSON.parse(payload as string)).toEqual({ width: 600, height: 400 });
  });

  it('hands a non-fjs tag a DOM-shaped event (detail/target/clientX)', async () => {
    const taps: Record<string, unknown>[] = [];
    const App = defineComponent(
      () => () =>
        h('div', { onClick: (e: Record<string, unknown>) => taps.push(e) }, 'x'),
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await nextTick();

    const [id] = idsByTag(root.id, 'view'); // div maps onto view
    expect(id).toBeTypeOf('number');
    dispatch()(id, TAP, null);

    expect(taps).toHaveLength(1);
    const event = taps[0];
    expect(typeof event).toBe('object');
    expect(event).toHaveProperty('detail');
    expect(event).toHaveProperty('target');
    expect(typeof event.stopPropagation).toBe('function');
    // vant's Slider reads coordinates off the same object web's DOM event has
    expect('clientX' in event).toBe(true);
    expect('clientY' in event).toBe(true);
  });

  it('keeps .once to a single dispatch on an fjs tag', async () => {
    const seen: unknown[] = [];
    const App = defineComponent(
      () => () =>
        h('image', {
          src: 'asset://photo.png',
          onErrorOnce: (payload: unknown) => seen.push(payload),
        }),
    );
    const root = flutterRoot();
    createApp(App).mount(root);
    await nextTick();

    const [id] = idsByTag(root.id, 'image');
    dispatch()(id, 27, '{"errMsg":"image load failed"}');
    dispatch()(id, 27, '{"errMsg":"image load failed"}');

    expect(seen).toHaveLength(1);
    expect(typeof seen[0]).toBe('string');
    expect(JSON.parse(seen[0] as string)).toEqual({
      errMsg: 'image load failed',
    });
  });
});

// specs/104: the shape follows the EVENT, not just the tag. On web an fjs
// tag's `@click` is a fallthrough onto the root DOM element (only `tap`,
// `load`… are emitted), so the handler gets a DOM event there — and Vue's
// `.stop` / `.prevent` call methods on it. Under specs/103's tag-only rule
// `<view @click.stop>` threw on Flutter and never ran.
describe('event first argument by web emits (specs/104)', () => {
  function mountOne(tag: string, props: Record<string, unknown>): number {
    const App = defineComponent(() => () => h(tag, props, tag === 'image' ? undefined : 'x'));
    const root = flutterRoot();
    createApp(App).mount(root);
    const [id] = idsByTag(root.id, tag);
    expect(id).toBeTypeOf('number');
    return id;
  }

  it.each(['view', 'button', 'image'])('runs a @click.stop handler on %s', async (tag) => {
    let calls = 0;
    const id = mountOne(tag, { onClick: withModifiers(() => calls++, ['stop']) });
    await nextTick();
    expect(() => dispatch()(id, TAP, null)).not.toThrow();
    expect(calls).toBe(1);
  });

  it('hands @click on an fjs tag a DOM-shaped event', async () => {
    const seen: Record<string, unknown>[] = [];
    const id = mountOne('view', { onClick: (e: Record<string, unknown>) => seen.push(e) });
    await nextTick();
    dispatch()(id, TAP, null);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveProperty('target');
    expect(typeof seen[0].stopPropagation).toBe('function');
    expect('clientX' in seen[0]).toBe(true);
  });

  it('keeps @tap on an fjs tag payload-less, as web emit("tap") is', async () => {
    const seen: unknown[] = [];
    const id = mountOne('view', { onTap: (p: unknown) => seen.push(p) });
    await nextTick();
    dispatch()(id, TAP, null);
    expect(seen).toEqual([undefined]);
  });

  it('matches emitted names case-insensitively (onLongPress, onScrollToUpper)', async () => {
    const seen: unknown[] = [];
    const view = mountOne('view', { onLongPress: (p: unknown) => seen.push(p) });
    const scroller = mountOne('scroll-view', { onScrollToUpper: (p: unknown) => seen.push(p) });
    await nextTick();
    dispatch()(view, 2, null);
    dispatch()(scroller, 24, '{"direction":"top"}');
    expect(seen).toEqual([undefined, '{"direction":"top"}']);
  });
});
