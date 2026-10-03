// specs/170: the compiler-vapor helpers and component layer over the
// FLUTTER backend (the web twin: vapor-helpers-web.test.ts) — refs, v-show,
// v-model on the fjs input element, attrs fallthrough with stacked
// listeners, scoped slot props.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setOpSink } from '../src/host';
import { installEventDispatcher } from '../src/ui/element';
import { compileSfc } from './helpers/sfc';

type Vue = typeof import('../src/vapor/index');
type Renderer = typeof import('../src/vue/renderer');
let vue: Vue;
let r: Renderer;
const g = globalThis as Record<string, unknown>;
const log: string[] = [];
g.__log = log;

/** Every frame's bytes as text (prop JSON and text payloads ride in it),
 * plus SetText / fjsText writes by element id. */
let frames = '';
const texts = new Map<number, string>();
function record(): void {
  frames = '';
  setOpSink((frame: Uint8Array) => {
    frames += new TextDecoder().decode(frame);
    const fjsText = (frame as Uint8Array & { fjsText?: string[] }).fjsText;
    if (fjsText) frames += fjsText.join('\u0000');
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const dec = new TextDecoder();
    let i = 0;
    const u32 = (): number => ((i += 4), view.getUint32(i - 4, true));
    const u16 = (): number => ((i += 2), view.getUint16(i - 2, true));
    while (i < frame.length) {
      const op = frame[i++];
      if (op === 1) {
        u32();
        i += u16();
      } else if (op === 2) u32();
      else if (op === 3) i += 12;
      else if (op === 4) i += 8;
      else if (op === 5) {
        const id = u32();
        const n = u32();
        texts.set(id, dec.decode(frame.subarray(i, i + n)));
        i += n;
      } else if (op === 0x4c && fjsText) {
        const id = u32();
        texts.set(id, fjsText[u32()] ?? '');
      } else if (op === 6 || op === 7) {
        u32();
        i += u32();
      } else if (op === 8) i += 12;
      else break;
    }
  });
}

beforeAll(async () => {
  vue = await import('../src/vapor/index');
  r = await import('../src/vue/renderer');
});

beforeEach(() => {
  log.length = 0;
  installEventDispatcher();
  record();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  (await import('../src/ui/element')).flush();
};

const dispatch = (id: number, type: number, payload: string | null): void =>
  (g.__fjsDispatchEvent as (id: number, type: number, payload: string | null) => void)(id, type, payload);

function sfc(source: string, imports: Record<string, unknown> = {}): Record<string, unknown> {
  return compileSfc(source, { vapor: true, runtime: vue as unknown as Record<string, unknown>, imports }).component;
}

function mount(comp: Record<string, unknown>): { id: number } {
  const root = r.flutterRoot();
  vue.createVaporApp(comp as never).mount(root);
  return root;
}

const kids = (id: number): number[] => [...r.childElementIds(id)];
const findTag = (id: number, tag: string): number[] => {
  const out: number[] = [];
  const walk = (n: number): void => {
    if (r.elementTag(n) === tag) out.push(n);
    for (const k of kids(n)) walk(k);
  };
  walk(id);
  return out;
};

describe('vapor helpers on the Flutter backend (specs/170)', () => {
  it('element ref is the fjs element; v-show writes display through the style engine', async () => {
    const Page = sfc(`
<script setup>
import { ref, onMounted } from 'vue'
const el = ref(null)
const on = ref(true)
globalThis.__s = { el, on }
onMounted(() => globalThis.__log.push('tag=' + el.value.tag))
</script>
<template><view><view class="a" ref="el" v-show="on" /></view></template>`);
    mount(Page);
    await settle();
    const s = g.__s as { el: { value: { id: number } }; on: { value: boolean } };
    expect(log).toEqual(['tag=view']);
    s.on.value = false;
    await settle();
    expect(r.styleEngine.inlineRecord(s.el.value.id)?.display).toBe('none');
    s.on.value = true;
    await settle();
    expect(r.styleEngine.inlineRecord(s.el.value.id)?.display).toBeUndefined();
  });

  it(':style drops the keys its object no longer has, keeps v-show\'s display (specs/198)', async () => {
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const el = ref(null)
const lifted = ref(true)
const shown = ref(false)
globalThis.__s2 = { el, lifted, shown }
</script>
<template><view ref="el" :style="lifted ? { transform: 'scale(2)', opacity: 0.5 } : {}" v-show="shown" /></template>`);
    mount(Page);
    await settle();
    const s = g.__s2 as { el: { value: { id: number } }; lifted: { value: boolean } };
    const rec = () => r.styleEngine.inlineRecord(s.el.value.id) as Record<string, unknown> | undefined;
    expect(rec()?.transform).toBe('scale(2)');
    expect(rec()?.display).toBe('none');
    s.lifted.value = false;
    await settle();
    expect(rec()?.transform).toBeUndefined();
    expect(rec()?.opacity).toBeUndefined();
    expect(rec()?.display).toBe('none');
  });

  it('v-model on the input element: textChanged in, value prop out (.trim)', async () => {
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
const t = ref('start')
globalThis.__t = t
</script>
<template><view><input v-model.trim="t" /></view></template>`);
    const root = mount(Page);
    await settle();
    expect(frames).toContain('start');
    const input = findTag(root.id, 'input')[0];
    dispatch(input, 3 /* textChanged */, '  typed  ');
    await settle();
    const t = g.__t as { value: string };
    expect(t.value).toBe('typed');
    t.value = 'from model';
    await settle();
    expect(frames).toContain('from model');
  });

  it('attrs fall through onto the root and stack with its own @tap; scoped slots get props', async () => {
    const Child = sfc(`
<script setup>
const props = defineProps(['items'])
</script>
<template><view class="root" @tap="() => globalThis.__log.push('own')"><view v-for="(it, i) in props.items" :key="i"><slot :item="it" /></view></view></template>`);
    const Page = sfc(`
<script setup>
import { ref } from 'vue'
import Child from './child'
const items = ref(['a'])
globalThis.__items = items
</script>
<template><Child class="extra" :items="items" @tap="() => globalThis.__log.push('parent')"><template #default="{ item }"><text>{{ item }}</text></template></Child></template>`, { './child': Child });
    const root = mount(Page);
    await settle();
    const childRoot = kids(root.id).find((id) => r.elementTag(id) === 'view')!;
    expect(r.styleEngine.classesOf(childRoot)).toEqual(['root', 'extra']);
    dispatch(childRoot, 1 /* tap */, null);
    await settle();
    expect(log).toEqual(['own', 'parent']);
    // the slot's text: first write rides the (possibly native-cloned) mount
    // frame; the update is a plain text write carrying the new value
    expect(findTag(root.id, 'text').length).toBe(1);
    frames = '';
    (g.__items as { value: string[] }).value[0] = 'zz-updated';
    await settle();
    expect(frames).toContain('zz-updated');
  });
});
