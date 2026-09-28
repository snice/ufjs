// Where the JS time of the uni-app x 4050-element mount goes (specs/145).
//
// On an iPhone the page's tap → nextTick window is ~190 ms for the mount and
// ~130 ms for the unmount. That window is Vue + renderer glue + style engine
// + element API (op encoding) in one lump. This splits it by subtraction:
//
//   style     StyleEngine methods the renderer calls during patch (ensure,
//             addScope, recomputeSubtree, noteStructureChange, forget, …),
//             timed by wrapping the live instance, plus the recompute pass
//             (stats.flushMs)
//   element   the same tree built through the bare element API — create /
//             insert / setText, no Vue, no style engine
//   vue       what is left: runtime-core (vnode creation, mountChildren,
//             component setup) and the renderer's own bookkeeping
//
// Frames are dropped, not forwarded (fjsrun would printf every op); the
// device page's `bridge` is measured there. Passes report min/med/max, see
// docs/performance.md on why single readings lie.
import { defineComponent, h, ref } from 'vue';
import { createApp, flutterRoot, styleEngine } from 'fjs/vue';
import { create, createRoot, flush, insert, nowMs, remove, setOpSink, setText } from 'fjs';
import Flat4050 from './Flat4050.vue';

const PASSES = 7;

const drain = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Acc = Record<string, { ms: number; calls: number }>;
let acc: Acc = {};

/** Wraps a StyleEngine method with a clock pair. Nested calls (a method
 * calling another wrapped one) would double count, so the depth guard only
 * times the outermost. */
let depth = 0;
function wrap(name: string): void {
  const eng = styleEngine as unknown as Record<string, (...a: unknown[]) => unknown>;
  const orig = eng[name].bind(styleEngine);
  eng[name] = (...args: unknown[]) => {
    if (depth++ > 0) {
      try { return orig(...args); } finally { depth--; }
    }
    const t0 = nowMs();
    try {
      return orig(...args);
    } finally {
      depth--;
      const a = (acc[name] ??= { ms: 0, calls: 0 });
      a.ms += nowMs() - t0;
      a.calls++;
    }
  };
}

function stats(xs: number[]): string {
  const s = xs.slice().sort((a, b) => a - b);
  return `${s[0].toFixed(1)}/${s[s.length >> 1].toFixed(1)}/${s[s.length - 1].toFixed(1)}`;
}

/** The bare element API cost of the same tree: 1 + 50 rows + 2000 cells +
 * 2000 texts. */
function elementOnly(): { mount: number; unmount: number } {
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
      const t = create('text');
      setText(t, String(i));
      insert(cell, t);
    }
  }
  flush();
  const mount = nowMs() - t0;
  const t1 = nowMs();
  remove(box);
  flush();
  return { mount, unmount: nowMs() - t1 };
}

export async function runFlatBench(): Promise<void> {
  let bytes = 0;
  setOpSink((frame) => {
    bytes += frame.length;
  });

  // clock cost, to read the wrapped totals against: ~16k wrapped calls
  let c = 0;
  const tc = nowMs();
  for (let i = 0; i < 10000; i++) c += nowMs();
  const clockUs = ((nowMs() - tc) / 10000) * 1000;
  void c;

  const show = ref(false);
  const app = createApp(defineComponent({
    setup: () => () => h(Flat4050, { show: show.value }),
  }));
  app.mount(flutterRoot());
  await drain();

  for (const m of ['ensure', 'addScope', 'setClasses', 'patchInlineStyle',
    'recomputeSubtree', 'noteStructureChange', 'forget']) wrap(m);

  const rows: Record<string, number[]> = {};
  const push = (k: string, v: number) => (rows[k] ??= []).push(v);
  let lastAcc: Record<string, Acc> = {};
  let lastBytes: Record<string, number> = {};
  let elements = 0;

  for (let pass = 0; pass <= PASSES; pass++) {
    for (const phase of ['mount', 'unmount'] as const) {
      acc = {};
      bytes = 0;
      styleEngine.resetStats();
      const t0 = nowMs();
      show.value = phase === 'mount';
      await drain();
      const total = nowMs() - t0;
      const st = styleEngine.stats;
      if (phase === 'mount') elements = st.elements;
      if (pass === 0) continue; // warm-up
      const patchStyle = Object.values(acc).reduce((s, a) => s + a.ms, 0);
      push(`${phase}.total`, total);
      push(`${phase}.style.patch`, patchStyle);
      push(`${phase}.style.flush`, st.flushMs);
      push(`${phase}.rest`, total - patchStyle - st.flushMs);
      lastAcc[phase] = acc;
      lastBytes[phase] = bytes;
    }
    const e = elementOnly();
    if (pass > 0) {
      push('mount.element', e.mount);
      push('unmount.element', e.unmount);
    }
  }

  console.log(`[flat] clock pair ≈ ${(clockUs * 2).toFixed(2)}µs, ${elements} elements`);
  for (const phase of ['mount', 'unmount'] as const) {
    console.log(`[flat] ${phase}  (min/med/max ms, frame ${lastBytes[phase]} B)`);
    for (const k of ['total', 'style.patch', 'style.flush', 'element', 'rest']) {
      console.log(`[flat]   ${k.padEnd(12)} ${stats(rows[`${phase}.${k}`])}`);
    }
    for (const [name, a] of Object.entries(lastAcc[phase])) {
      console.log(`[flat]     ${name.padEnd(20)} ${a.ms.toFixed(1)}ms × ${a.calls}`);
    }
  }

  app.unmount();
  await drain();
}
