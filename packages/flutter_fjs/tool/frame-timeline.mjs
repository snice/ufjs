#!/usr/bin/env node
// Records the Flutter timeline of a running profile/debug app through its VM
// service and prints where the time went, per thread and event (specs/154).
//
//   node tool/frame-timeline.mjs http://127.0.0.1:PORT/ [seconds=8] [--dump file.json]
//
// Start it, then do the thing on the device (e.g. tap "show 4050") within the
// window. Durations are summed over the window; `max` is the longest single
// occurrence. The raw trace can be dumped and opened in Perfetto.
import fs from 'node:fs';

const [, , rawUrl, secondsArg, ...rest] = process.argv;
if (!rawUrl) {
  console.error('usage: frame-timeline.mjs <VM service URL> [seconds] [--dump file.json]');
  process.exit(2);
}
const seconds = Number(secondsArg ?? 8);
const dumpAt = rest.indexOf('--dump');
const dumpFile = dumpAt >= 0 ? rest[dumpAt + 1] : null;

const u = new URL(rawUrl);
const wsUrl = `ws://${u.host}${u.pathname.replace(/\/?$/, '/')}ws`;
const ws = new WebSocket(wsUrl);
let nextId = 1;
const pending = new Map();
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = String(nextId++);
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error(`cannot connect to ${wsUrl}`));
});

await call('setVMTimelineFlags', { recordedStreams: ['Dart', 'Embedder', 'GC'] });
await call('clearVMTimeline');
console.log(`recording ${seconds}s — act on the device now`);
await new Promise((r) => setTimeout(r, seconds * 1000));
const { traceEvents } = await call('getVMTimeline');
ws.close();
if (dumpFile) fs.writeFileSync(dumpFile, JSON.stringify({ traceEvents }));

// thread names from metadata events
const threadName = new Map();
for (const e of traceEvents) {
  if (e.ph === 'M' && e.name === 'thread_name') threadName.set(e.tid, e.args?.name ?? String(e.tid));
}
const nameOf = (tid) => threadName.get(tid) ?? `tid ${tid}`;

// complete spans: 'X' directly, 'B'/'E' paired per thread
const spans = [];
const open = new Map();
for (const e of traceEvents) {
  if (e.ph === 'X') spans.push({ tid: e.tid, name: e.name, ts: e.ts, dur: e.dur ?? 0 });
  else if (e.ph === 'B') {
    let st = open.get(e.tid);
    if (!st) open.set(e.tid, (st = []));
    st.push(e);
  } else if (e.ph === 'E') {
    const b = open.get(e.tid)?.pop();
    if (b) spans.push({ tid: e.tid, name: b.name, ts: b.ts, dur: e.ts - b.ts });
  }
}

const byThread = new Map();
for (const s of spans) {
  const t = nameOf(s.tid);
  let m = byThread.get(t);
  if (!m) byThread.set(t, (m = new Map()));
  const a = m.get(s.name) ?? { total: 0, count: 0, max: 0 };
  a.total += s.dur;
  a.count++;
  a.max = Math.max(a.max, s.dur);
  m.set(s.name, a);
}
const ms = (us) => (us / 1000).toFixed(1).padStart(8);
for (const [t, m] of [...byThread].sort((a, b) => a[0].localeCompare(b[0]))) {
  const rows = [...m].sort((a, b) => b[1].max - a[1].max).slice(0, 25);
  if (!rows.length || rows[0][1].max < 1000) continue;
  console.log(`\n== ${t}`);
  console.log(`${'max ms'.padStart(8)} ${'total'.padStart(8)} ${'n'.padStart(5)}  event`);
  for (const [name, a] of rows) console.log(`${ms(a.max)} ${ms(a.total)} ${String(a.count).padStart(5)}  ${name}`);
}

// the longest frames, UI (Animator / Frame) vs raster, side by side
const longest = (pred) => spans.filter(pred).sort((a, b) => b.dur - a.dur).slice(0, 5);
const show = (label, xs) => console.log(`${label}: ${xs.map((s) => (s.dur / 1000).toFixed(1)).join(' / ') || '—'} ms`);
console.log('');
show('longest UI frames (Animator::BeginFrame / Frame)', longest((s) => s.name === 'Animator::BeginFrame' || s.name === 'Frame'));
show('longest raster (GPURasterizer::Draw / Rasterizer::DoDraw)', longest((s) => /Rasterizer::(Draw|DoDraw)$/.test(s.name)));
