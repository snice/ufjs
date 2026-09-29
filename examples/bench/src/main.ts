// fjs bench — JS engine + UI pipeline micro-benchmarks.
// Run: fjs build && fjsrun --pump 8000 dist/bundle.js
// Results print as JSON lines prefixed with [bench].
import './ts-engine';
import { h, createRoot, setText, nowMs, flush } from 'fjs';
import { runStyleBenches } from './style';
import { runVueBenches } from './vue-bench';
import { runFlatBench } from './flat-bench';

function bench(name: string, fn: () => number, ops: number): void {
  const t0 = nowMs();
  fn();
  const dt = nowMs() - t0;
  const line = JSON.stringify({
    bench: name,
    ops,
    totalMs: +dt.toFixed(2),
    opsPerMs: +(ops / Math.max(dt, 0.01)).toFixed(1),
  });
  console.log('[bench]', line);
}

// ---- pure JS ----------------------------------------------------------------
bench('fib(27) recursive', () => {
  const fib = (n: number): number => (n < 2 ? n : fib(n - 1) + fib(n - 2));
  return fib(27);
}, 1);

bench('string-concat 100k', () => {
  let s = '';
  for (let i = 0; i < 100000; i++) s += 'x';
  return s.length;
}, 100000);

bench('json-stringify 5k objects', () => {
  let len = 0;
  for (let i = 0; i < 5000; i++) {
    len += JSON.stringify({ id: i, name: 'item' + i, tags: ['a', 'b'], v: i * 1.5 }).length;
  }
  return len;
}, 5000);

bench('array-sort 10k', () => {
  const arr: number[] = [];
  for (let i = 0; i < 10000; i++) arr.push(Math.random());
  arr.sort((a, b) => a - b);
  return arr.length;
}, 10000);

// ---- UI pipeline (op encode + frame commit through native) -------------------
const root = createRoot('view');

bench('ui-create-1000-nodes', () => {
  const parent = h('view', { style: { flexDirection: 'column' } });
  root.appendChild(parent);
  for (let i = 0; i < 1000; i++) {
    parent.appendChild(h('text', { style: { fontSize: 12 } }, 'row ' + i));
  }
  flush();
  return 1000;
}, 1000);

// update throughput: flip text on 1000 nodes
const nodes: ReturnType<typeof h>[] = [];
{
  const parent = h('view');
  root.appendChild(parent);
  for (let i = 0; i < 1000; i++) {
    const t = h('text', {}, 'v0');
    parent.appendChild(t);
    nodes.push(t);
  }
  flush();
}
bench('ui-update-1000-texts', () => {
  for (let i = 0; i < 1000; i++) nodes[i].setText('v' + i);
  flush();
  return 1000;
}, 1000);

// Style-engine benches run last: they are async (the engine batches its
// recomputes into a microtask), so `done` has to wait for them.
runStyleBenches().then(() => runVueBenches()).then(() => runFlatBench()).then(() => {
  console.log('[bench] done');
});
