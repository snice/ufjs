// specs/150 stage 0: the flat-4050 VDOM mount under the TS style engine and
// under libfjs-style, same bundle otherwise (entry-ts.ts / entry-native.ts
// only flip `__fjsNativeStyle` before the renderer loads; entry-verify.ts runs
// both engines and compares every element after every frame).
//
//   parity  every element's computed style after the first mount, hashed in
//           id order — the two modes must print the same line
//   timing  mount / unmount, page rules and then with structural + sibling
//           rules registered (flat-bench's second pass)
//
// Frames go to the host (fjsrun --frames) in both modes: libfjs-style works
// inside uiOps, so a swallowing sink would measure nothing.
import { defineComponent, h, ref } from 'vue';
import { createApp, flutterRoot, registerStyles, styleEngine } from 'fjs/vue';
import { create, flush, nowMs, setOpSink } from 'fjs';
import Flat from '../src/Flat4050.vue';
import FlatVapor from '../vapor/Flat4050Vapor.vue';
import { createComponent, createVaporApp, defineVaporComponent } from 'fjs/vapor';

/** Time inside uiOps: the host's frame handling, plus libfjs-style's parse
 * and flush (and its callbacks into JS) in native mode. */
let sinkMs = 0;
const hostSink = setOpSink((frame) => {
  const t0 = nowMs();
  hostSink(frame);
  sinkMs += nowMs() - t0;
});

const PASSES = 7;
const native = styleEngine.nativeAttached;
const verify = (globalThis as { __fjsNativeStyle?: unknown }).__fjsNativeStyle === 'verify';
const mode = verify ? 'verify' : native ? 'native' : 'ts';
// hostile.ts set this before this module evaluated (import order): a fixed
// element (hoisted → hoistedFrom) and a fired `.once` handler (onceFired)
// stay alive beside the v-if through every run, so the unmount walk meets
// both tables non-empty (specs/158)
const hostile = (globalThis as { __fjsBenchHostile?: unknown }).__fjsBenchHostile === true;

const drain = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

function stats(xs: number[]): string {
  const s = xs.slice().sort((a, b) => a - b);
  return `${s[0].toFixed(1)}/${s[s.length >> 1].toFixed(1)}/${s[s.length - 1].toFixed(1)}`;
}

/** FNV-1a over the computed style JSON of every id in (from, to). */
function digest(from: number, to: number): { hash: string; styled: number; sample: string } {
  let h1 = 0x811c9dc5;
  let styled = 0;
  let sample = '';
  for (let id = from + 1; id < to; id++) {
    const style = styleEngine.computedOf(id);
    const line = style === undefined ? '-' : JSON.stringify(style);
    if (style !== undefined) styled++;
    if (id - from <= 4) sample += ` #${id - from}=${line}`;
    for (let i = 0; i < line.length; i++) {
      h1 ^= line.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    h1 ^= 10;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return { hash: h1.toString(16), styled, sample };
}

async function run(label: string, show: { value: boolean }): Promise<void> {
  const rows: Record<string, number[]> = {};
  const push = (k: string, v: number) => (rows[k] ??= []).push(v);
  for (let pass = 0; pass <= PASSES; pass++) {
    for (const phase of ['mount', 'unmount'] as const) {
      styleEngine.resetStats();
      globalThis.__fjs?.fns.styleStats?.(true);
      sinkMs = 0;
      sinkMs = 0;
      const before = create('view').id;
      const t0 = nowMs();
      show.value = phase === 'mount';
      await drain();
      const total = nowMs() - t0;
      const after = create('view').id;
      if (pass === 0 && phase === 'mount') {
        const d = digest(before, after);
        console.log(`[native] parity ${label} ${mode}: ${d.styled} styled, hash ${d.hash}`);
        console.log(`[native] parity ${label} ${mode} sample:${d.sample}`);
        const st = styleEngine.stats;
        console.log(
          `[native] ${label} ${mode} stats: recompute ${st.recompute} match ${st.matchHit}/${st.matchMiss} ` +
            `compute ${st.computeHit}/${st.computeMiss} applied ${st.applied}`,
        );
      }
      if (pass === 0) continue;
      const flushMs = styleEngine.stats.flushMs;
      push(`${phase}.total`, total);
      push(`${phase}.style.flush`, flushMs);
      push(`${phase}.uiOps`, sinkMs);
      push(`${phase}.uiOps`, sinkMs);
      push(`${phase}.rest`, total - flushMs);
    }
  }
  for (const phase of ['mount', 'unmount'] as const) {
    console.log(`[native] ${label} ${mode} ${phase}  (min/med/max ms)`);
    for (const k of ['total', 'style.flush', 'uiOps', 'rest']) {
      console.log(`[native]   ${k.padEnd(14)} ${stats(rows[`${phase}.${k}`])}`);
    }
  }
}

async function main(): Promise<void> {
  const show = ref(false);
  const onceEl = ref<{ id: number } | null>(null);
  const App = defineComponent({
    setup: () =>
      hostile
        ? () =>
            h('view', [
              h(Flat, { show: show.value }),
              // 2×2: hoists, but is no modal mask — only hoistedFrom fills
              h('view', { style: { position: 'fixed', left: 0, top: 0, width: 2, height: 2 } }),
              h('view', { ref: onceEl, onTapOnce: () => {} }),
            ])
        : () => h(Flat, { show: show.value }),
  });
  createApp(App).mount(flutterRoot());
  await drain();
  if (hostile) {
    // fire the `.once` once so onceFired holds an entry for the walk to skip
    const fire = (globalThis as { __fjsDispatchEvent?: (id: number, type: number, payload: string | null) => void })
      .__fjsDispatchEvent;
    fire?.(onceEl.value?.id ?? 0, 1, null);
    await drain();
    if (!onceEl.value) console.log('[native] hostile: ref missing, onceFired not planted');
  }
  await run('page', show);
  // flat-bench's second pass: structural + sibling rules exist (matching
  // nothing here), so position and the `+` neighbour join every key
  // Vapor: its templates go through native clones when libfjs-style is
  // attached (specs/152) — same tree, same ids, so the same hash
  const vaporShow = ref(false);
  createVaporApp(defineVaporComponent({
    setup: () => createComponent(FlatVapor, { show: () => vaporShow.value }),
  })).mount(flutterRoot());
  await drain();
  await run('vapor', vaporShow);
  registerStyles(null, '.bench-none:first-child { color: red } .bench-none + .bench-none { color: red }');
  await drain();
  await run('structural', show);
  await run('vapor-structural', vaporShow);
  // every run ends unmounted: what is still registered is the two app roots'
  // scaffolding, or a leak — plus the three hostile fixtures (fixed view,
  // once view, their overlay host) which outlive every run on purpose
  console.log(
    `[native] ${mode} elements after all runs: ${styleEngine.stats.elements}${hostile ? ' (hostile: 3 fixtures expected on top)' : ''}`,
  );
  if (verify) console.log(`[native] verify ${JSON.stringify(styleEngine.verifyStats)}`);
}

void main();
