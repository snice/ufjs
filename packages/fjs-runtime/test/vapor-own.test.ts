// The fjs Vapor runtime (specs/161): the own helpers run over the same
// nodeOps / patchProp as the VDOM renderer, so the contract is parity — the
// same SFC mounted through the VDOM renderer and through createVaporApp
// gives the same element tree, text and styles, and stays the same through
// updates. The VDOM⇄Vapor crossings are covered both ways: a VDOM component
// inside a Vapor block (interop mounts through our own renderer) and a
// Vapor component inside a VDOM page (the compile-time wrapper's adoption,
// replicated here the way vaporWrapperModule generates it).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setOpSink } from '../src/host';
import { installEventDispatcher } from '../src/ui/element';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/index');
type Renderer = typeof import('../src/vue/renderer');
let vue: Vue;
let r: Renderer;

beforeAll(async () => {
  vue = await import('../src/vapor/index');
  r = await import('../src/vue/renderer');
});

beforeEach(() => {
  setOpSink(() => {});
  installEventDispatcher();
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  (await import('../src/ui/element')).flush();
};

/** The tree under [id] as the page sees it: tag, text, computed style.
 * Anchors (v-if / v-for / fragment placeholders) are skipped: the two paths
 * place them differently and nothing renders them. */
function snapshot(id: number): unknown {
  const tag = r.elementTag(id);
  const style = r.styleEngine.computedOf(id);
  const kids = r.childElementIds(id).map(snapshot).filter((k) => k !== null);
  if (style === undefined && kids.length === 0) return null; // an anchor
  const text = textOf(id);
  if (tag === 'text' && !text && kids.length === 0 && isRawText(id)) return null; // empty raw text anchor
  return { tag, text, style, kids };
}

const texts = new Map<number, string>();
function textOf(id: number): string | undefined {
  return texts.get(id);
}
function isRawText(id: number): boolean {
  return r.styleEngine.classesOf(id).length === 0;
}

/** Records SetText ops by element id (the renderer keeps no text itself). */
async function recordTexts(): Promise<void> {
  const { UiOp } = await import('../src/ui/ops');
  setOpSink((bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder();
    let i = 0;
    const u32 = () => ((i += 4), view.getUint32(i - 4, true));
    const u16 = () => ((i += 2), view.getUint16(i - 2, true));
    while (i < bytes.length) {
      const op = bytes[i++];
      switch (op) {
        case UiOp.Create: { u32(); const n = u16(); i += n; break; }
        case UiOp.Remove: u32(); break;
        case UiOp.Insert: i += 12; break;
        case UiOp.RemoveChild: i += 8; break;
        case UiOp.SetText: { const id = u32(); const n = u32(); texts.set(id, dec.decode(bytes.subarray(i, i + n))); i += n; break; }
        case UiOp.SetProps:
        case UiOp.DefineStyle: { u32(); const n = u32(); i += n; break; }
        case UiOp.SetStyle: i += 12; break;
        case UiOp.ResetStyles: break;
        default: throw new Error(`unknown op ${op}`);
      }
    }
  });
}

/** Mounts a vapor SFC under a fresh flutter root with [state] as props,
 * through a hand component whose getters keep the state reactive — the same
 * shape an app entry uses (createVaporApp's root component gets no props). */
function vaporMount(comp: unknown, state: Record<string, unknown>): { app: ReturnType<typeof vue.createVaporApp>; root: ReturnType<typeof r.flutterRoot> } {
  const getters: Record<string, unknown> = {};
  for (const k in state) getters[k] = () => (state as Record<string, unknown>)[k];
  const app = vue.createVaporApp(
    vue.defineVaporComponent({ setup: () => vue.createComponent(comp as never, getters) }),
  );
  const root = r.flutterRoot();
  app.mount(root);
  return { app, root };
}

const LIST = `
<script setup>
defineProps(['items', 'show', 'label', 'on', 'w'])
</script>
<template>
  <view class="page">
    <text class="title" :class="{ on }" :style="{ width: w + 'px' }">{{ label }}</text>
    <view v-if="show" class="list">
      <view v-for="it in items" :key="it.id" class="row">
        <text class="cell">{{ it.name }}</text>
        <text class="cell dim">#{{ it.id }}</text>
      </view>
    </view>
    <text v-else class="empty">none</text>
  </view>
</template>
<style scoped>
.page { padding: 4px; }
.title { font-size: 20px; }
.title.on { color: #ff0000; }
.row { flex-direction: row; }
.row:first-child { background-color: #eeeeee; }
.row + .row { margin-top: 2px; }
.cell { color: #333333; }
.dim { opacity: 0.5; }
.empty { color: #999999; }
</style>
`;

describe('Vapor on fjs: parity with the VDOM renderer', () => {
  it('mounts the same tree, text and styles', async () => {
    const state = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }], show: true, label: 'hi', on: false, w: 10 };
    await recordTexts();
    const roots: { vdom: number; vapor: number } = { vdom: 0, vapor: 0 };
    for (const vapor of [false, true]) {
      const sfc = compileSfc(LIST, { vapor, runtime: vue as unknown as Record<string, unknown> });
      for (const c of sfc.css) r.registerStyles(c.scoped ? sfc.scopeId : null, c.text);
      const root = r.flutterRoot();
      const props = vue.reactive(state);
      if (vapor) {
        vue.createVaporApp(
          vue.defineVaporComponent({ setup: () => vue.createComponent(sfc.component as never, { items: () => props.items, show: () => props.show, label: () => props.label, on: () => props.on, w: () => props.w }) }),
        ).mount(root);
      } else {
        r.createApp(vue.defineComponent({ setup: () => () => vue.h(sfc.component as never, props) })).mount(root);
      }
      roots[vapor ? 'vapor' : 'vdom'] = root.id;
    }
    await settle();
    expect(snapshot(roots.vapor)).toEqual(snapshot(roots.vdom));
  });

  it('stays equal through v-if, keyed v-for and binding updates', async () => {
    const shared = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }], show: true, label: 'hi', on: false, w: 10 };
    await recordTexts();
    const roots: number[] = [];
    const states: Record<string, unknown>[] = [];
    for (const vapor of [false, true]) {
      const sfc = compileSfc(LIST, { vapor, runtime: vue as unknown as Record<string, unknown> });
      for (const c of sfc.css) r.registerStyles(c.scoped ? sfc.scopeId : null, c.text);
      const root = r.flutterRoot();
      const s = vue.reactive(structuredClone(shared));
      states.push(s);
      if (vapor) {
        vue.createVaporApp(
          vue.defineVaporComponent({ setup: () => vue.createComponent(sfc.component as never, { items: () => s.items, show: () => s.show, label: () => s.label, on: () => s.on, w: () => s.w }) }),
        ).mount(root);
      } else {
        r.createApp(vue.defineComponent({ setup: () => () => vue.h(sfc.component as never, s) })).mount(root);
      }
      roots.push(root.id);
    }
    const step = async (mutate: (s: any) => void) => {
      for (const s of states) mutate(s);
      await settle();
      expect(snapshot(roots[1])).toEqual(snapshot(roots[0]));
    };
    await settle();
    console.log('PROBE t2 vapor kids:', r.childElementIds(roots[1]).length, 'vdom kids:', r.childElementIds(roots[0]).length);
    expect(snapshot(roots[1])).toEqual(snapshot(roots[0]));
    await step((s) => { s.label = 'changed'; s.on = true; s.w = 30; });
    await step((s) => s.items.push({ id: 4, name: 'd' }));
    await step((s) => s.items.splice(1, 1));
    await step((s) => s.items.reverse());
    await step((s) => s.items.unshift({ id: 9, name: 'z' }));
    await step((s) => { s.items[0].name = 'renamed'; });
    await step((s) => { s.show = false; });
    await step((s) => { s.show = true; s.items = [{ id: 7, name: 'x' }]; });
  });

  it('runs event handlers as the VDOM renderer does', async () => {
    // @click is an alias of the tap event on fjs (HTML_EVENT_ALIASES), and
    // .stop has to hold across the bubbling tap either way
    const source = `
<script setup>
import { ref } from 'vue'
const n = ref(0)
const props = defineProps(['sink'])
</script>
<template>
  <view class="outer" @tap="props.sink.push('outer')">
    <view class="box" @tap="n++; props.sink.push('tap')">
      <text>{{ n }}</text>
    </view>
    <view class="stop" @click.stop="props.sink.push('stop')" />
  </view>
</template>`;
    const run = async (vapor: boolean) => {
      const sink: string[] = [];
      await recordTexts();
      const sfc = compileSfc(source, { vapor, runtime: vue as unknown as Record<string, unknown> });
      const root = r.flutterRoot();
      if (vapor) {
        vue.createVaporApp(
          vue.defineVaporComponent({ setup: () => vue.createComponent(sfc.component as never, { sink: () => sink }) }),
        ).mount(root);
      } else {
        r.createApp(vue.defineComponent({ setup: () => () => vue.h(sfc.component as never, { sink }) })).mount(root);
      }
      await settle();
      const outer = r.childElementIds(root.id).find((id) => r.elementTag(id) === 'view')!;
      const [box, stop] = r.childElementIds(outer).filter((id) => r.elementTag(id) === 'view');
      const dispatch = (globalThis as unknown as { __fjsDispatchEvent: (id: number, type: number, payload: string | null) => void }).__fjsDispatchEvent;
      dispatch(box, 1 /* tap */, null);
      dispatch(stop, 1, null);
      await settle();
      return { sink, text: texts.get(r.childElementIds(box)[0]) };
    };
    const vdom = await run(false);
    const vapor = await run(true);
    expect(vapor).toEqual(vdom);
    // the tap bubbles to the outer view; the stopped one does not
    expect(vapor.sink).toEqual(['tap', 'outer', 'stop']);
    expect(vapor.text).toBe('1');
  });

  it('mounts a VDOM component inside a Vapor block (interop)', async () => {
    const vdomChild = vue.defineComponent({
      props: ['label'],
      setup: (p: { label: string }) => () => vue.h('view', { class: 'vdom' }, [vue.h('text', null, `vdom ${p.label}`)]),
    });
    const parentSrc = `
<script setup>
import VdomChild from 'vdom-child'
defineProps(['label'])
</script>
<template>
  <view class="parent">
    <text class="own">own</text>
    <VdomChild :label="label" />
  </view>
</template>`;
    await recordTexts();
    const parent = compileSfc(parentSrc, {
      vapor: true,
      runtime: vue as unknown as Record<string, unknown>,
      imports: { 'vdom-child': vdomChild },
    }).component;
    const root = r.flutterRoot();
    const props = vue.reactive({ label: 'one' });
    vue.createVaporApp(
      vue.defineVaporComponent({ setup: () => vue.createComponent(parent as never, { label: () => props.label }) }),
    ).mount(root);
    await settle();
    const textsUnder = (id: number): string[] =>
      [texts.get(id) ?? '', ...r.childElementIds(id).flatMap(textsUnder)].filter(Boolean);
    expect(textsUnder(root.id)).toEqual(['own', 'vdom one']);
    // the prop change reaches the VDOM child through the interop effect
    props.label = 'two';
    await settle();
    expect(textsUnder(root.id)).toEqual(['own', 'vdom two']);
  });

  it('mounts a Vapor component inside a VDOM page through the compile-time wrapper', async () => {
    const vaporChildSrc = `
<script setup>
defineProps(['label'])
</script>
<template><view class="vapor-child"><text>vapor {{ label }}</text></view></template>`;
    const vaporChild = compileSfc(vaporChildSrc, { vapor: true, runtime: vue as unknown as Record<string, unknown> }).component;

    // the wrapper, exactly as vaporWrapperModule generates it: props and
    // attrs flow through as getters, the placeholder is adopted by the
    // renderer, the block dies with the wrapper
    const wrapper = vue.defineComponent({
      props: vaporChild.props,
      setup(props, { attrs }) {
        const getters: Record<string, unknown> = {};
        for (const k of new Set([...Object.keys(props), ...Object.keys(attrs)])) {
          getters[k] = () => (props as Record<string, unknown>)[k] ?? (attrs as Record<string, unknown>)[k];
        }
        const adopt = vue.adoptVaporComponent(vaporChild as never, getters, null);
        vue.onMounted(() => vue.mountAdoptNodes(adopt.id, vue.getCurrentInstance()));
        vue.onBeforeUnmount(() => vue.releaseAdopt(adopt.id));
        return () => vue.h('fjs-vapor-root', { 'data-fjs-vapor': String(adopt.id), style: { display: 'contents' } });
      },
    });

    await recordTexts();
    const root = r.flutterRoot();
    const props = vue.reactive({ label: 'one' });
    r.createApp(vue.defineComponent({ setup: () => () => vue.h('view', { class: 'page' }, [
      vue.h('text', null, 'static'),
      vue.h(wrapper as never, { label: props.label }),
    ]) })).mount(root);
    await settle();
    const textsUnder = (id: number): string[] =>
      [texts.get(id) ?? '', ...r.childElementIds(id).flatMap(textsUnder)].filter(Boolean);
    expect(textsUnder(root.id)).toEqual(['static', 'vapor one']);
    props.label = 'two';
    await settle();
    expect(textsUnder(root.id)).toEqual(['static', 'vapor two']);
  });

  it('resolves global components on the app context (vant-style registration)', async () => {
    // <van-child> in a vapor template compiles to
    // createComponentWithFallback(resolveComponent('van-child')); the app
    // context reaches the runtime through the mounting app's registration
    const vdomChild = vue.defineComponent({
      props: ['label'],
      setup: (p: { label: string }) => () => vue.h('view', { class: 'vdom' }, [vue.h('text', null, `global ${p.label}`)]),
    });
    const src = `
<script setup>
defineProps(['label'])
</script>
<template><view class="p"><van-child :label="label" /></view></template>`;
    const sfc = compileSfc(src, { vapor: true, runtime: vue as unknown as Record<string, unknown> });
    await recordTexts();
    const root = r.flutterRoot();
    const props = vue.reactive({ label: 'one' });
    const app = vue.createVaporApp(
      vue.defineVaporComponent({ setup: () => vue.createComponent(sfc.component as never, { label: () => props.label }) }),
      { components: { 'van-child': vdomChild } },
    );
    app.mount(root);
    console.log('PROBE setup:', ((sfc.component as { setup?: () => unknown }).setup as (() => unknown)).toString());
    console.log('PROBE tree:', (() => {
      const dump = (id: number, depth = 0): string => {
        const tag = r.elementTag(id) ?? '?';
        const kids = r.childElementIds(id);
        return '  '.repeat(depth) + `${tag}#${id}` + (kids.length ? '\n' + kids.map((k) => dump(k, depth + 1)).join('\n') : '');
      };
      return dump(root.id);
    })());
    await settle();
    const textsUnder = (id: number): string[] =>
      [texts.get(id) ?? '', ...r.childElementIds(id).flatMap(textsUnder)].filter(Boolean);
    expect(textsUnder(root.id)).toEqual(['global one']);
    // a prop change re-renders the VDOM child through the interop effect
    props.label = 'two';
    await settle();
    console.log('PROBE after update:', textsUnder(root.id));
    expect(textsUnder(root.id)).toEqual(['global two']);
    app.unmount();
    await settle();
    expect(textsUnder(root.id)).toEqual([]);
  });

  it('unmounting a vapor app leaves no elements behind', async () => {
    const sfc = compileSfc(LIST, { vapor: true, runtime: vue as unknown as Record<string, unknown> });
    await recordTexts();
    for (const c of sfc.css) r.registerStyles(c.scoped ? sfc.scopeId : null, c.text);
    const root = r.flutterRoot();
    const app = vue.createVaporApp(
      vue.defineVaporComponent({ setup: () => vue.createComponent(sfc.component as never, { items: () => [{ id: 1, name: 'a' }], show: () => true, label: () => 'hi', on: () => false, w: () => 10 }) }),
    );
    app.mount(root);
    await settle();
    expect(r.childElementIds(root.id).length).toBeGreaterThan(0);
    app.unmount();
    await settle();
    expect(r.childElementIds(root.id)).toEqual([]);
  });
});
