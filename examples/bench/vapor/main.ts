// specs/148 stage 0: the flat-4050 tree through the fjs VDOM renderer and
// through Vue Vapor (runtime-vapor on the DOM shell) — same Vue 3.6 runtime,
// same style engine, same passes as src/flat-bench.ts.
//
//   mount / unmount   Flat4050.vue, static text (what the device page does)
//   update            FlatLive.vue: each cell's text reads its own slot of a
//                     reactive array; bump 1 / 200 / 2000 slots and flush
//   clone floor       what a native "clone this template subtree" op could
//                     save: the shell's own clone cost (PROFILE=1 build) and
//                     the element API's per-element create / insert encoding
//
// Built by the CLI like any app (`fjs build vapor/main.ts --out dist/vapor`):
// the Vapor SFCs are `<script setup vapor>` copies of the VDOM ones.
import { defineComponent, h, reactive, ref } from 'vue';
import { createComponent, createVaporApp, defineVaporComponent, shellOf } from 'fjs/vapor';
import { createApp, flutterRoot, styleEngine } from 'fjs/vue';
import { create, createRoot, flush, insert, nowMs, remove, setOpSink } from 'fjs';
import { nodeOps } from '../../../packages/fjs-runtime/src/vue/renderer';
import FlatVdom from '../src/Flat4050.vue';
import FlatVapor from './Flat4050Vapor.vue';
import LiveVdom from './FlatLive.vue';
import LiveVapor from './FlatLiveVapor.vue';

/** Per-call timing of nodeOps and the shell (inflates the totals). */
const __VAPOR_PROFILE__ = false;

const PASSES = 7;
const CELLS = 2000;

const drain = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

function stats(xs: number[]): string {
  const s = xs.slice().sort((a, b) => a - b);
  return `${s[0].toFixed(1)}/${s[s.length >> 1].toFixed(1)}/${s[s.length - 1].toFixed(1)}`;
}

let bytes = 0;
setOpSink((frame) => {
  bytes += frame.length;
});

// ---- per-call timing (PROFILE=1 builds only) --------------------------------

const acc: Record<string, { ms: number; calls: number }> = {};
function timed<F extends (...a: any[]) => unknown>(name: string, fn: F): F {
  return function (this: unknown, ...a: unknown[]) {
    const t0 = nowMs();
    try {
      return fn.apply(this, a);
    } finally {
      const e = (acc[name] ??= { ms: 0, calls: 0 });
      e.ms += nowMs() - t0;
      e.calls++;
    }
  } as F;
}
let wrapUs = 0;
if (__VAPOR_PROFILE__) {
  // the shell calls nodeOps through the object; the VDOM renderer holds its
  // own copies, so this only sees the Vapor path
  for (const k of Object.keys(nodeOps) as (keyof typeof nodeOps)[]) {
    (nodeOps as Record<string, unknown>)[k] = timed(`nodeOps.${k}`, nodeOps[k] as never);
  }
  const proto = (globalThis as any).Element.prototype;
  for (const m of ['cloneNode', 'insertBefore', 'setAttribute']) proto[m] = timed(`shell.${m}`, proto[m]);
  const noop = timed('noop', () => undefined);
  const t0 = nowMs();
  for (let i = 0; i < 20000; i++) noop();
  wrapUs = ((nowMs() - t0) / 20000) * 1000;
}
const ms = (k: string) => acc[k]?.ms ?? 0;
const calls = (k: string) => acc[k]?.calls ?? 0;

// ---- mount / unmount --------------------------------------------------------

async function measureMount(label: string, show: { value: boolean }): Promise<void> {
  const rows: Record<string, number[]> = {};
  const push = (k: string, v: number) => (rows[k] ??= []).push(v);
  const frame: Record<string, number> = {};
  let elements = 0;
  for (let pass = 0; pass <= PASSES; pass++) {
    for (const phase of ['mount', 'unmount'] as const) {
      bytes = 0;
      for (const k of Object.keys(acc)) delete acc[k];
      styleEngine.resetStats();
      const t0 = nowMs();
      show.value = phase === 'mount';
      await drain();
      const total = nowMs() - t0;
      if (phase === 'mount') elements = styleEngine.stats.elements;
      frame[phase] = bytes;
      if (pass === 0) continue;
      push(`${phase}.total`, total);
      push(`${phase}.style.flush`, styleEngine.stats.flushMs);
      push(`${phase}.rest`, total - styleEngine.stats.flushMs);
      if (__VAPOR_PROFILE__ && label === 'vapor' && phase === 'mount') cloneBreakdown(push);
    }
  }
  console.log(`[vapor] ${label}: ${elements} styled elements`);
  for (const phase of ['mount', 'unmount'] as const) {
    console.log(`[vapor] ${label} ${phase}  (min/med/max ms, frame ${frame[phase]} B)`);
    for (const k of ['total', 'style.flush', 'rest']) {
      console.log(`[vapor]   ${k.padEnd(14)} ${stats(rows[`${phase}.${k}`])}`);
    }
  }
  if (rows['shell.net']) {
    for (const k of ['host.net', 'shell.net']) console.log(`[vapor]   ${k.padEnd(14)} ${stats(rows[k])}`);
  }
}

/** Splits the Vapor mount's node work into what the fjs host does (nodeOps
 * and the class write inside setAttribute) and what the shell itself costs,
 * each net of the wrapper clocks nested inside it. */
function cloneBreakdown(push: (k: string, v: number) => void): void {
  const w = wrapUs / 1000;
  const hostOps = ['createElement', 'setScopeId', 'insert', 'setElementText', 'setText', 'createText', 'createComment', 'remove'];
  const hostIncl = hostOps.reduce((s, k) => s + ms(`nodeOps.${k}`), 0);
  const hostCalls = hostOps.reduce((s, k) => s + calls(`nodeOps.${k}`), 0);
  // setAttribute = scope id (nodeOps, counted above) or a class write (host
  // work the shell only forwards): all of it but its own clock is host
  const attrHost = ms('shell.setAttribute') - ms('nodeOps.setScopeId') - calls('nodeOps.setScopeId') * w;
  const host = hostIncl - hostCalls * w + attrHost - calls('shell.setAttribute') * w;
  // clone and insertBefore minus everything wrapped inside them
  const cloneNet = ms('shell.cloneNode') - ms('nodeOps.createElement') - ms('shell.setAttribute')
    - (calls('nodeOps.createElement') + calls('shell.setAttribute')) * w - calls('shell.cloneNode') * w;
  const insertNet = ms('shell.insertBefore') - ms('nodeOps.insert') - ms('nodeOps.createText') - ms('nodeOps.createComment')
    - (calls('nodeOps.insert') + calls('nodeOps.createText') + calls('nodeOps.createComment')) * w - calls('shell.insertBefore') * w;
  push('host.net', host);
  push('shell.net', cloneNet + insertNet);
}

// ---- update -----------------------------------------------------------------

async function measureUpdate(label: string, vals: number[]): Promise<void> {
  for (const n of [1, 200, CELLS]) {
    const xs: number[] = [];
    let frame = 0;
    const stride = CELLS / n;
    for (let pass = 0; pass <= PASSES; pass++) {
      bytes = 0;
      styleEngine.resetStats();
      const t0 = nowMs();
      for (let k = 0; k < CELLS; k += stride) vals[k]++;
      await drain();
      const total = nowMs() - t0;
      frame = bytes;
      if (pass > 0) xs.push(total);
    }
    console.log(`[vapor] ${label} update ${String(n).padStart(4)} cells  ${stats(xs)} ms  (frame ${frame} B)`);
  }
}

// ---- element API floor ------------------------------------------------------

/** The bare create + insert encoding of the same tree: what cloning the
 * cell template natively (one op per subtree) could take off the JS side.
 * Text is left out — the binding writes it either way. */
function elementFloor(): number[] {
  const xs: number[] = [];
  for (let pass = 0; pass <= PASSES; pass++) {
    const root = createRoot('view');
    const t0 = nowMs();
    const box = create('view');
    insert(root, box);
    for (let r = 0; r < 50; r++) {
      const row = create('view');
      insert(box, row);
      for (let i = 0; i < 40; i++) {
        const cell = create('view');
        insert(row, cell);
        insert(cell, create('text'));
      }
    }
    flush();
    if (pass > 0) xs.push(nowMs() - t0);
    remove(root);
    flush();
  }
  return xs;
}

async function main(): Promise<void> {
  const vdomShow = ref(false);
  createApp(defineComponent({
    setup: () => () => h(FlatVdom, { show: vdomShow.value }),
  })).mount(flutterRoot());
  const vaporShow = ref(false);
  createVaporApp(defineVaporComponent({
    setup: () => createComponent(FlatVapor, { show: () => vaporShow.value }),
  })).mount(shellOf(flutterRoot()) as never);
  await drain();

  // alternate so neither variant always runs on a warmer heap
  for (let round = 0; round < 2; round++) {
    await measureMount('vdom ', vdomShow);
    await measureMount('vapor', vaporShow);
  }
  if (__VAPOR_PROFILE__) return;

  console.log(`[vapor] element API create+insert, same tree  ${stats(elementFloor())} ms`);

  const vdomVals = reactive(Array.from({ length: CELLS }, (_, i) => i));
  createApp(defineComponent({
    setup: () => () => h(LiveVdom, { show: true, vals: vdomVals }),
  })).mount(flutterRoot());
  await drain();
  const vaporVals = reactive(Array.from({ length: CELLS }, (_, i) => i));
  createVaporApp(defineVaporComponent({
    setup: () => createComponent(LiveVapor, { show: () => true, vals: () => vaporVals }),
  })).mount(shellOf(flutterRoot()) as never);
  await drain();
  for (let round = 0; round < 2; round++) {
    await measureUpdate('vdom ', vdomVals);
    await measureUpdate('vapor', vaporVals);
  }
}

main().catch((e) => console.log(`[vapor] failed: ${String(e)}\n${e?.stack}`));
