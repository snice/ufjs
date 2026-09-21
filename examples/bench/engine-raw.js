// Engine-only micro benchmarks, run in fjsrun source mode: no fjs runtime,
// no bundle, no UI pipeline — whatever differs between the two engine
// flavors shows up here undiluted. Companion to docs/engine-perf.md.
//
//   native/build-native/fjsrun         engine-raw.js   # primjs
//   native/build-native-quickjs/fjsrun engine-raw.js   # quickjs-ng
//
// Methodology follows src/style.ts: warm up once, repeat N times, report min
// (the run that did not get hit by a collection), plus med/max so GC noise
// stays visible. Run each flavor in a few separate processes and take
// min-of-mins before comparing.
//
// Promise section budget: the pump drains at most 10000 pending jobs per
// call (native/src/vm.cpp), and source mode pumps exactly once after eval.
// Every await continuation and every .then on a resolved promise is one
// job, so everything that must complete before the numbers print has to fit
// under that cap — keep case sizes and reps small, and keep any
// queue-flooding case last (its callbacks are left half-drained on exit).
'use strict';

function bench(name, fn, reps = 5) {
  fn(); // untimed warm-up
  const times = [];
  for (let i = 0; i < reps; i++) {
    const t0 = Date.now();
    fn();
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log('[raw]', JSON.stringify({
    bench: name,
    minMs: times[0],
    medMs: times[reps >> 1],
    maxMs: times[reps - 1],
  }));
}

// ---- interpreter: calls + arithmetic ---------------------------------------
bench('fib(27) recursive', () => {
  const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));
  return fib(27);
});

bench('int-loop 20M', () => {
  let s = 0;
  for (let i = 0; i < 20000000; i++) s += i & 0xff;
  return s;
});

bench('float-math 10M', () => {
  let x = 1.5;
  for (let i = 0; i < 10000000; i++) x = x * 1.0000001 + 0.5;
  return x;
});

// ---- strings (CSS engine: chain keys, class splitting, serialization) ------
bench('string-concat 100k', () => {
  let s = '';
  for (let i = 0; i < 100000; i++) s += 'x';
  return s.length;
});

bench('template-literal 200k', () => {
  let len = 0;
  for (let i = 0; i < 200000; i++) len += (`row-${i}:title`).length;
  return len;
});

bench('split-join classlist 50k', () => {
  let n = 0;
  const cls = 'row card title meta badge active';
  for (let i = 0; i < 50000; i++) {
    const parts = cls.split(' ');
    parts.push('x' + i);
    n += parts.join(' ').length;
  }
  return n;
});

// ---- JSON ------------------------------------------------------------------
const sampleObjs = [];
for (let i = 0; i < 5000; i++) {
  sampleObjs.push({ id: i, name: 'item' + i, tags: ['a', 'b'], v: i * 1.5 });
}
bench('json-stringify 5k objects', () => {
  let len = 0;
  for (const o of sampleObjs) len += JSON.stringify(o).length;
  return len;
});

bench('json-parse 5MB-ish', () => {
  let total = 0;
  const s = JSON.stringify(sampleObjs); // ~250KB, parse 20x ~= 5MB
  for (let i = 0; i < 20; i++) total += JSON.parse(s).length;
  return total;
});

// ---- arrays ----------------------------------------------------------------
bench('array-sort 10k numbers', () => {
  const arr = [];
  for (let i = 0; i < 10000; i++) arr.push((i * 2654435761) % 100000 / 7);
  arr.sort((a, b) => a - b);
  return arr.length;
});

bench('map-filter-reduce 200k', () => {
  const arr = new Array(200000);
  for (let i = 0; i < arr.length; i++) arr[i] = i;
  return arr.map((x) => x * 2).filter((x) => x % 3 === 0).reduce((a, x) => a + x, 0);
});

// ---- objects & GC pressure -------------------------------------------------
bench('object-churn 1M throwaway', () => {
  let sink = 0;
  for (let i = 0; i < 1000000; i++) {
    const o = { id: i, v: i * 2 };
    sink += o.id + o.v;
  }
  return sink;
});

bench('prop-access hot 5M', () => {
  const o = { x: 1, y: 2, z: 3 };
  let s = 0;
  for (let i = 0; i < 5000000; i++) {
    o.x = o.y + i;
    s += o.x;
  }
  return s;
});

// retained graph — the heap a real app keeps alive; shows mark cost
bench('build+walk 200k-object graph', () => {
  const map = new Map();
  for (let i = 0; i < 200000; i++) map.set(i, { id: i, next: (i + 1) % 200000, tag: 't' + (i % 97) });
  let visited = 0;
  for (const [k, v] of map) visited += v.id;
  return visited;
});

bench('for-of Map+Set 20 laps', () => {
  const m = new Map();
  const s = new Set();
  for (let i = 0; i < 100000; i++) { m.set(i, i); s.add(i); }
  let n = 0;
  for (let lap = 0; lap < 20; lap++) {
    for (const [k, v] of m) n += v;
    for (const v of s) n -= v;
  }
  return n;
});

// ---- closures (Vue: fresh handlers per vnode) ------------------------------
bench('closure-alloc 1M', () => {
  let out = 0;
  for (let i = 0; i < 1000000; i++) {
    const f = () => i;
    out += f();
  }
  return out;
});

// ---- regexp (style engine matcher helpers) ---------------------------------
bench('regexp-match 200k', () => {
  const re = /^row-(\d+):(.+)$/;
  let n = 0;
  for (let i = 0; i < 200000; i++) {
    const m = re.exec('row-' + (i % 1000) + ':title');
    if (m) n += m[1].length;
  }
  return n;
});

// ---- promises (Vue scheduler + style engine batching live here) ------------
async function runChain(n) {
  let x = 0;
  for (let i = 0; i < n; i++) x += await Promise.resolve(i);
  return x;
}
async function runAll(n) {
  const ps = new Array(n);
  for (let i = 0; i < n; i++) ps[i] = Promise.resolve(i);
  let sum = 0;
  for (const v of await Promise.all(ps)) sum += v;
  return sum;
}
async function timeAsync(name, fn, reps) {
  await fn(); // warm-up
  const times = [];
  for (let i = 0; i < reps; i++) {
    const t0 = Date.now();
    await fn();
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log('[raw]', JSON.stringify({
    bench: name,
    minMs: times[0],
    medMs: times[reps >> 1],
    maxMs: times[reps - 1],
  }));
}

(async () => {
  // sizes × reps stay inside the pump's 10000-job budget (see file header)
  await timeAsync('promise-chain 1200 awaits', () => runChain(1200), 2);
  await timeAsync('promise-all 1200', () => runAll(1200), 2);

  // allocation + .then registration only; left half-drained on exit, so it
  // must stay last
  bench('promise-alloc+then 200k', () => {
    let sink = 0;
    const add = (v) => { sink += v; };
    for (let i = 0; i < 200000; i++) Promise.resolve(i).then(add);
    return sink;
  });
})();
