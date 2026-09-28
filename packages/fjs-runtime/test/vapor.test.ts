// Vue Vapor on fjs (specs/148): runtime-vapor runs on the DOM shell
// (src/vapor/dom.ts), which routes every node operation through the same
// nodeOps / patchProp as the VDOM renderer. The contract is parity: the same
// SFC mounted both ways gives the same element tree, text and computed
// styles, and stays the same through updates — only the render path differs.
//
// Wiring as in an app build: '@vue/runtime-dom' is the fjs shim for
// runtime-vapor. The build injects the shell classes into the runtime-vapor
// module alone; a test file has its own globals, so they are set here.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dom from '../src/vapor/dom';

// the namespace itself, not a copy: runtime-core's currentInstance is a live
// binding that runtime-vapor reads through this module
vi.mock('@vue/runtime-dom', () => import('../src/vue/runtime-dom-shim'));
Object.assign(globalThis, {
  document: dom.document,
  Node: dom.Node,
  Element: dom.Element,
  Text: dom.Text,
  Comment: dom.Comment,
  HTMLElement: dom.HTMLElement,
  SVGElement: dom.SVGElement,
  DocumentFragment: dom.DocumentFragment,
});
(globalThis as { __fjsHost?: { uiOpsVersion: number } }).__fjsHost = { uiOpsVersion: 2 };

import { setOpSink } from '../src/host';
import { installEventDispatcher } from '../src/ui/element';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/index');
type Renderer = typeof import('../src/vue/renderer');
let vue: Vue;
let r: Renderer;
let enableVapor: () => void;

beforeAll(async () => {
  // what a compiled SFC imports: the CLI points a Vapor module's 'vue' at
  // fjs/vapor, a superset of the 'vue' shim, so both variants can use it
  vue = await import('../src/vapor/index');
  r = await import('../src/vue/renderer');
  ({ enableVapor } = await import('../src/vapor/index'));
  enableVapor();
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
  const el = r.elementById(id) as unknown as { props?: unknown } | undefined;
  const style = r.styleEngine.computedOf(id);
  const kids = r.childElementIds(id).map(snapshot).filter((k) => k !== null);
  if (style === undefined && kids.length === 0) return null; // an anchor
  const text = textOf(id);
  if (tag === 'text' && !text && kids.length === 0 && isRawText(id)) return null; // empty raw text anchor
  void el;
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

/** Mounts [source] twice — VDOM and Vapor — each under its own root, with
 * the same reactive state object passed as props. */
async function both(source: string, state: Record<string, unknown>, imports: Record<string, unknown> = {}) {
  await recordTexts();
  const roots: { vdom: number; vapor: number } = { vdom: 0, vapor: 0 };
  for (const vapor of [false, true]) {
    const sfc = compileSfc(source, { vapor, runtime: vue as unknown as Record<string, unknown>, imports });
    for (const c of sfc.css) r.registerStyles(c.scoped ? sfc.scopeId : null, c.text);
    const root = r.flutterRoot();
    const props = vue.reactive(state);
    const app = r.createApp(vue.defineComponent({ setup: () => () => vue.h(sfc.component as never, props) }));
    app.mount(root);
    roots[vapor ? 'vapor' : 'vdom'] = root.id;
  }
  await settle();
  const check = () => expect(snapshot(roots.vapor)).toEqual(snapshot(roots.vdom));
  return { check, roots };
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
    const { check } = await both(LIST, state);
    check();
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
      r.createApp(vue.defineComponent({ setup: () => () => vue.h(sfc.component as never, s) })).mount(root);
      roots.push(root.id);
    }
    const step = async (mutate: (s: any) => void) => {
      for (const s of states) mutate(s);
      await settle();
      expect(snapshot(roots[1])).toEqual(snapshot(roots[0]));
    };
    await settle();
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
      r.createApp(vue.defineComponent({ setup: () => () => vue.h(sfc.component as never, { sink }) })).mount(root);
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

  it('mounts a VDOM component inside a Vapor component, and back', async () => {
    const vdomChild = vue.defineComponent({
      props: ['label'],
      setup: (p: { label: string }) => () => vue.h('view', { class: 'vdom' }, [vue.h('text', null, `vdom ${p.label}`)]),
    });
    const vaporChildSrc = `
<script setup>
defineProps(['label'])
</script>
<template><view class="vapor-child"><text>vapor {{ label }}</text></view></template>`;
    const vaporChild = compileSfc(vaporChildSrc, { vapor: true, runtime: vue as unknown as Record<string, unknown> }).component;
    const parentSrc = `
<script setup>
import VdomChild from 'vdom-child'
import VaporChild from 'vapor-child'
defineProps(['label'])
</script>
<template>
  <view class="parent">
    <VdomChild :label="label" />
    <VaporChild :label="label" />
  </view>
</template>`;
    await recordTexts();
    const parent = compileSfc(parentSrc, {
      vapor: true,
      runtime: vue as unknown as Record<string, unknown>,
      imports: { 'vdom-child': vdomChild, 'vapor-child': vaporChild },
    }).component;
    const root = r.flutterRoot();
    const props = vue.reactive({ label: 'one' });
    // a VDOM app root → Vapor parent → VDOM child and Vapor child
    r.createApp(vue.defineComponent({ setup: () => () => vue.h(parent as never, props) })).mount(root);
    await settle();
    const textsUnder = (id: number): string[] =>
      [texts.get(id) ?? '', ...r.childElementIds(id).flatMap(textsUnder)].filter(Boolean);
    expect(textsUnder(root.id)).toEqual(['vdom one', 'vapor one']);
    props.label = 'two';
    await settle();
    expect(textsUnder(root.id)).toEqual(['vdom two', 'vapor two']);
  });
});
