// specs/197: what does a per-cell binding cost, and can any cheaper shape
// keep the same semantics? One 50×40 tree on the bare element API, the cell
// text reading its own slot of a reactive array (the flat-4050 live grid),
// bound five ways. Every strategy that can update is checked for correctness
// after each bump — a variant that misses an update is not a result.
//
//   host      no text                         floor
//   eval      write once, untracked           NOT viable (misses updates), mount floor only
//   fxBare    effect() with a no-op scheduler  mount only (cannot update)
//   fxReal    effect shaped like renderEffect  (closures + queue + alive flag)
//   fxLite    ReactiveEffect, shared scheduler one object per cell, no closures but fn
//   rowFx     one effect per row               update: re-writes the whole row
//   listFx    one effect for the list          update: re-writes every cell
import { EffectScope, ReactiveEffect, effect, reactive, stop } from 'vue';
import { create, createRoot, flush, insert, nowMs, remove, setText } from 'fjs';

const ROWS = 50;
const COLS = 40;
const CELLS = ROWS * COLS;
const PASSES = 7;

type Strategy = 'host' | 'eval' | 'fxBare' | 'fxReal' | 'fxLite' | 'rowFx' | 'listFx';
const UPDATABLE: Strategy[] = ['fxReal', 'fxLite', 'rowFx', 'listFx'];

const drain = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

// ---- a renderEffect-shaped queue (host.ts: pending flag, alive flag, one job per flush)
const queue: (() => void)[] = [];
let queued = false;
function enqueue(job: () => void): void {
  queue.push(job);
  if (queued) return;
  queued = true;
  Promise.resolve().then(() => {
    queued = false;
    const jobs = queue.splice(0);
    for (const j of jobs) j();
  });
}

const NOOP = { scheduler: () => {}, onStop: () => {} };

/** renderEffect's shape, minus the Vue-scope / zone bookkeeping. */
function fxReal(fn: () => unknown, scope: EffectScope): void {
  let alive = true;
  let pending = false;
  let runner: () => unknown = () => {};
  const job = (): void => {
    pending = false;
    scope.run(() => runner());
  };
  const opts = {
    scheduler: () => {
      if (pending) return;
      pending = true;
      enqueue(() => {
        if (alive) job();
      });
    },
    onStop: () => {
      alive = false;
    },
  };
  runner = effect(fn, opts) as typeof runner;
}

/** One object per binding: scheduler is a shared function, the dedupe flag
 * lives on the effect itself. `fn` is still a per-cell closure. */
class LiteFx extends ReactiveEffect {
  queued = false;
  constructor(fn: () => unknown) {
    super(fn);
    this.scheduler = liteSchedule;
  }
}
function liteSchedule(this: LiteFx): void {
  if (this.queued) return;
  this.queued = true;
  enqueue(() => {
    this.queued = false;
    if (this.flags & 1) this.run(); // 3.5 has no `active`; bit 1 is ACTIVE
  });
}

interface Built {
  root: ReturnType<typeof createRoot>;
  scope: EffectScope;
  stops: (() => void)[];
  shown: string[];
}

function build(mode: Strategy, vals: number[]): Built {
  const root = createRoot('view');
  const scope = new EffectScope();
  const stops: (() => void)[] = [];
  const shown: string[] = new Array(CELLS);
  const texts: ReturnType<typeof create>[] = new Array(CELLS);
  const write = (k: number): void => {
    const s = String(vals[k]);
    shown[k] = s;
    setText(texts[k], s);
  };
  const box = create('view');
  insert(root, box);
  for (let r = 0; r < ROWS; r++) {
    const row = create('view');
    insert(box, row);
    for (let i = 0; i < COLS; i++) {
      const k = r * COLS + i;
      const cell = create('view');
      insert(row, cell);
      const t = create('text');
      insert(cell, t);
      texts[k] = t;
      if (mode === 'host') continue;
      if (mode === 'eval') write(k);
      else if (mode === 'fxBare') {
        const runner = effect(() => write(k), NOOP);
        stops.push(() => stop(runner));
      }
      else if (mode === 'fxReal') scope.run(() => fxReal(() => write(k), scope));
      else if (mode === 'fxLite') {
        const e = new LiteFx(() => write(k));
        e.run();
        stops.push(() => e.stop());
      }
    }
    if (mode === 'rowFx') {
      const base = r * COLS;
      const e = new LiteFx(() => {
        for (let i = 0; i < COLS; i++) write(base + i);
      });
      e.run();
      stops.push(() => e.stop());
    }
  }
  if (mode === 'listFx') {
    const e = new LiteFx(() => {
      for (let k = 0; k < CELLS; k++) write(k);
    });
    e.run();
    stops.push(() => e.stop());
  }
  return { root, scope, stops, shown };
}

function teardown(b: Built): void {
  for (const s of b.stops) s();
  b.scope.stop();
  remove(b.root);
  flush();
}

function med(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

function mount(mode: Strategy): number {
  const vals = reactive(Array.from({ length: CELLS }, (_, i) => i));
  const xs: number[] = [];
  for (let pass = 0; pass <= PASSES; pass++) {
    const t0 = nowMs();
    const b = build(mode, vals);
    flush();
    if (pass > 0) xs.push(nowMs() - t0);
    teardown(b);
  }
  return med(xs);
}

async function update(mode: Strategy): Promise<{ n: number; ms: number; ok: boolean }[]> {
  const vals = reactive(Array.from({ length: CELLS }, (_, i) => i));
  const b = build(mode, vals);
  flush();
  await drain();
  const out: { n: number; ms: number; ok: boolean }[] = [];
  for (const n of [1, 200, CELLS]) {
    const xs: number[] = [];
    let ok = true;
    const stride = CELLS / n;
    for (let pass = 0; pass <= PASSES; pass++) {
      const t0 = nowMs();
      for (let k = 0; k < CELLS; k += stride) vals[k] += 1000;
      await drain();
      if (pass > 0) xs.push(nowMs() - t0);
      for (let k = 0; k < CELLS; k++) {
        if (b.shown[k] !== String(vals[k])) {
          ok = false;
          break;
        }
      }
    }
    out.push({ n, ms: med(xs), ok });
  }
  teardown(b);
  return out;
}

async function main(): Promise<void> {
  const modes: Strategy[] = ['host', 'eval', 'fxBare', 'fxReal', 'fxLite', 'rowFx', 'listFx'];
  // two rounds, interleaved, so no strategy always meets the warmer / colder heap
  for (let round = 0; round < 2; round++) {
    const line: string[] = [];
    for (const m of modes) line.push(`${m} ${mount(m).toFixed(1)}`);
    console.log(`[proto] mount ms  ${line.join('  ')}`);
  }
  for (const m of UPDATABLE) {
    const u = await update(m);
    console.log(
      `[proto] update ${m.padEnd(7)} ${u.map((x) => `${x.n}: ${x.ms.toFixed(1)}${x.ok ? '' : ' WRONG'}`).join('   ')}`,
    );
  }
}

main().catch((e) => console.log(`[proto] failed: ${String(e)}\n${e?.stack}`));
