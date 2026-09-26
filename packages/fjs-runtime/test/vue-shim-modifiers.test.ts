// specs/139: the app build's 'vue' is vue-shim.ts, which lacked runtime-dom's
// withModifiers — NutUI's precompiled Tag imports it for its close icon
// (`withModifiers(onClose, ["stop"])`) and the whole app build failed. These
// pin the shim's twin against the app-side tap event (renderer asDomEvent).
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { childElementIds, createApp, elementTag, flutterRoot } from '../src/vue/renderer';
import { withModifiers } from '../src/vue/vue-shim';
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

function viewIds(rootId: number): number[] {
  const out: number[] = [];
  const visit = (id: number) => {
    if (elementTag(id) === 'view') out.push(id);
    for (const kid of childElementIds(id)) visit(kid);
  };
  visit(rootId);
  return out;
}

async function mountNested(outer: () => void, inner: (e: unknown) => unknown): Promise<[number, number]> {
  const App = defineComponent(
    () => () => h('view', { onClick: outer }, [h('view', { onClick: inner }, 'x')]),
  );
  const root = flutterRoot();
  createApp(App).mount(root);
  await nextTick();
  const [outerId, innerId] = viewIds(root.id);
  return [outerId!, innerId!];
}

describe('vue-shim withModifiers (specs/139)', () => {
  it('.stop runs the handler and keeps the tap from bubbling', async () => {
    const seen: string[] = [];
    const [, inner] = await mountNested(
      () => seen.push('outer'),
      withModifiers(() => seen.push('inner'), ['stop']),
    );
    dispatch()(inner, TAP, null);
    expect(seen).toEqual(['inner']);
  });

  it('.self only fires when the tap landed on the element itself', async () => {
    const seen: string[] = [];
    const [outer, inner] = await mountNested(withModifiers(() => seen.push('outer'), ['self']), () => seen.push('inner'));
    dispatch()(inner, TAP, null);
    expect(seen).toEqual(['inner']);
    dispatch()(outer, TAP, null);
    expect(seen).toEqual(['inner', 'outer']);
  });

  it('.prevent calls preventDefault and still runs the handler', () => {
    let prevented = 0;
    let ran = 0;
    withModifiers(() => ran++, ['prevent'])({ preventDefault: () => prevented++ });
    expect([prevented, ran]).toEqual([1, 1]);
  });

  it('system-key and mouse-button guards read absent fields as "not pressed"', () => {
    let ran = 0;
    withModifiers(() => ran++, ['ctrl'])({});
    withModifiers(() => ran++, ['right'])({});
    withModifiers(() => ran++, ['exact'])({});
    expect(ran).toBe(2); // ctrl skipped; right/exact pass (no button field, no keys)
  });

  it('returns the same wrapper for the same handler and modifiers', () => {
    const fn = () => {};
    expect(withModifiers(fn, ['stop'])).toBe(withModifiers(fn, ['stop']));
    expect(withModifiers(fn, ['stop'])).not.toBe(withModifiers(fn, ['prevent']));
  });
});
