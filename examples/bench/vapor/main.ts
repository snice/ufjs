// specs/161: the flat-4050 tree through the fjs VDOM renderer and through
// the own Vapor runtime (createVaporApp over the element API) — same Vue
// runtime, same style engine, same passes as native/bench.ts. The official
// runtime-vapor comparison lives in build.mjs's separate bundle (the `vue36`
// devDependency), so this build runs on the workspace's plain vue.
//
//   mount / unmount   Flat4050.vue, static text (what the device page does)
//   update            FlatLive.vue: each cell's text reads its own slot of a
//                     reactive array; bump 1 / 200 / 2000 slots and flush
import { defineComponent, h, reactive, ref } from 'vue';
import { __profOn, __vaporMicro, createComponent, createVaporApp, defineVaporComponent } from 'fjs/vapor';
import { createApp, flutterRoot, styleEngine } from 'fjs/vue';
import { create, createRoot, flush, gc, insert, nowMs, remove, setOpSink } from 'fjs';
import FlatVdom from '../src/Flat4050.vue';
import FlatVapor from './Flat4050Vapor.vue';
import LiveVdom from './FlatLive.vue';
import LiveVapor from './FlatLiveVapor.vue';

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
// chained, not swallowed: the native style engine (specs/150) styles inside
// the host's uiOps, so frames must reach it (run under fjsrun --frames)
const hostSink = setOpSink((frame) => {
  bytes += frame.length;
  hostSink(frame);
});

// ---- mount / unmount --------------------------------------------------------

async function measureMount(label: string, show: { value: boolean }): Promise<void> {
  const rows: Record<string, number[]> = {};
  const push = (k: string, v: number) => (rows[k] ??= []).push(v);
  const frame: Record<string, number> = {};
  let elements = 0;
  for (let pass = 0; pass <= PASSES; pass++) {
    for (const phase of ['mount', 'unmount'] as const) {
      bytes = 0;
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
    }
  }
  console.log(`[vapor] ${label}: ${elements} styled elements`);
  for (const phase of ['mount', 'unmount'] as const) {
    console.log(`[vapor] ${label} ${phase}  (min/med/max ms, frame ${frame[phase]} B)`);
    for (const k of ['total', 'style.flush', 'rest']) {
      console.log(`[vapor]   ${k.padEnd(14)} ${stats(rows[`${phase}.${k}`])}`);
    }
  }
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

/** The bare create + insert encoding of the same tree: the shared floor
 * under both render paths. */
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
  })).mount(flutterRoot());
  await drain();

  // alternate so neither variant always runs on a warmer heap
  for (let round = 0; round < 2; round++) {
    await measureMount('vdom ', vdomShow);
    await measureMount('vapor', vaporShow);
  }
  // specs/161 mount analysis: one mount with exclusive zones, then the same
  // operations in tight loops. The loop above stays unprofiled.
  gc();
  const prof = (globalThis as { __fjsVaporProf?: Record<string, number> }).__fjsVaporProf;
  if (prof) for (const k of Object.keys(prof)) prof[k] = 0;
  styleEngine.resetStats();
  __profOn(true);
  const tSync = nowMs();
  vaporShow.value = true;
  const sync = nowMs() - tSync;
  await drain();
  const wall = nowMs() - tSync;
  __profOn(false);
  const flushMs = styleEngine.stats.flushMs;
  vaporShow.value = false;
  await drain();
  const micro = __vaporMicro();
  if (prof) {
    const inside = micro.calInside ?? 0;
    const pairs = Object.keys(prof)
      .filter((k) => !k.endsWith('N') && k !== 'cal' && prof[k + 'N'] != null)
      .reduce((n, k) => n + (prof[k + 'N'] ?? 0), 0);
    let zoned = 0;
    const parts: string[] = [];
    for (const k of Object.keys(prof).sort()) {
      if (k.endsWith('N') || k === 'cal') continue;
      const n = prof[k + 'N'] ?? 0;
      const net = prof[k] - n * inside;
      zoned += net;
      parts.push(`${k} ${net.toFixed(1)}/${n}`);
    }
    const clock = pairs * 2 * (micro.nowCall ?? 0);
    console.log(
      `[prof] sync ${sync.toFixed(1)} wall ${wall.toFixed(1)} flush ${flushMs.toFixed(1)} zoned ${zoned.toFixed(1)} clock~${clock.toFixed(1)} (mount is the microtask; compare wall to the unprofiled median)`,
    );
    console.log(`[prof] ${parts.join('  ')}`);
    console.log(
      `[prof] counts fast ${prof.fastN ?? 0} slow ${prof.slowN ?? 0} child ${prof.childN ?? 0}`,
    );
  }
  const ms = (k: string): string => (micro[k] ?? 0).toFixed(1);
  console.log(
    `[micro] N=2000  scope ${ms('scope')}  scopeRun ${ms('scopeRun')}  refs ${ms('refs')}  fxEmpty ${ms('fxEmpty')}  fxTrack ${ms('fxTrack')}  display ${ms('display')}  cellTpl ${ms('cellTpl')}  walk ${ms('walk')}  block ${ms('block')}  cursors ${ms('cursors')}  setText ${ms('setText')}  keyedGlue ${ms('keyedGlue')}  reorderScan ${ms('reorderScan')}  fastIns ${ms('fastIns')}  slowOnce ${ms('slowOnce')}  slowTwice ${ms('slowTwice')}`,
  );
  console.log(
    `[micro] once-cell layers  host ${ms('layerHost')}  +text ${ms('layerText')}  +effect ${ms('layerFx')}  +scope ${ms('layerFull')}   (50×40, create inside the timer)`,
  );
  console.log(`[micro] now() ${(micro.nowCall ?? 0) * 1000}µs  empty zone ${(micro.calPair ?? 0) * 1000}µs (inside ${(micro.calInside ?? 0) * 1000}µs)`);
  gc();

  console.log(`[vapor] element API create+insert, same tree  ${stats(elementFloor())} ms`);

  const vdomVals = reactive(Array.from({ length: CELLS }, (_, i) => i));
  createApp(defineComponent({
    setup: () => () => h(LiveVdom, { show: true, vals: vdomVals }),
  })).mount(flutterRoot());
  await drain();
  const vaporVals = reactive(Array.from({ length: CELLS }, (_, i) => i));
  createVaporApp(defineVaporComponent({
    setup: () => createComponent(LiveVapor, { show: () => true, vals: () => vaporVals }),
  })).mount(flutterRoot());
  await drain();
  for (let round = 0; round < 2; round++) {
    await measureUpdate('vdom ', vdomVals);
    await measureUpdate('vapor', vaporVals);
  }
}

main().catch((e) => console.log(`[vapor] failed: ${String(e)}\n${e?.stack}`));
