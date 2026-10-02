#!/usr/bin/env node
// CPU samples for the LAST N seconds of a running profile app, aggregated per
// function (specs/189: where does the mount frame's BUILD go?). Complements
// frame-timeline.mjs, which only sees phase spans.
//
//   node tool/cpu-profile.mjs http://127.0.0.1:PORT/ [seconds=15] [--dump file.json]
//
// Start it, do the thing on the device within the window. The VM keeps a ring
// of samples with microsecond timestamps; this reads the buffer at the end and
// aggregates only the samples inside the window (the VM's own per-function
// tick tables cover the whole buffer, so the aggregation here walks the stacks
// itself — leaf frame = self, any frame = inclusive).
import fs from 'node:fs';

const [, , rawUrl, secondsArg, ...rest] = process.argv;
if (!rawUrl) {
  console.error('usage: cpu-profile.mjs <VM service URL> [seconds] [--dump file.json]');
  process.exit(2);
}
const seconds = Number(secondsArg ?? 15);
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

const vm = await call('getVM');
const mainIsolate = vm.isolates.find((i) => i.name === 'main') ?? vm.isolates[0];
console.log(`isolate ${mainIsolate.id}, sampling ${seconds}s — act on the device now`);
await new Promise((r) => setTimeout(r, seconds * 1000));
const s = await call('getCpuSamples', { isolateId: mainIsolate.id });
ws.close();
if (dumpFile) fs.writeFileSync(dumpFile, JSON.stringify(s));

const fns = s.functions;
const nameOf = (idx) => {
  const f = fns[idx];
  if (!f) return `?${idx}`;
  const fn = f.function ?? {};
  const own = fn.owner?.name;
  const cls = own && own !== fn.name && fn._kind !== 'Native' ? `${own}.` : '';
  return `${cls}${fn.name ?? '<native>'}`;
};
const stamps = s.samples.map((x) => x.timestamp);
const cutoff = Math.max(...stamps) - seconds * 1e6;
// FILTER=<substring>: only samples with a frame whose name contains it
// (FILTER=drawFrame isolates the frame pipeline from JS and messages)
const only = process.env.FILTER;
const win = s.samples.filter(
  (x) => x.timestamp >= cutoff && (!only || (x.stack ?? []).some((fr) => nameOf(fr).includes(only))),
);
const period = s.samplePeriod || 1000; // µs per tick

const self = new Map();
const total = new Map();
for (const sm of win) {
  if (!sm.stack || sm.stack.length === 0) continue;
  // getCpuSamples stacks are leaf-first: stack[0] is the running frame
  const leaf = sm.stack[0];
  self.set(leaf, (self.get(leaf) ?? 0) + 1);
  const seen = new Set();
  for (const fr of sm.stack) {
    if (seen.has(fr)) continue;
    seen.add(fr);
    total.set(fr, (total.get(fr) ?? 0) + 1);
  }
}
const ms = (ticks) => ((ticks * period) / 1000).toFixed(1);
const top = (m) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Number(process.env.TOP ?? 28))
    .map(([idx, c]) => `${ms(c).padStart(8)} ms  ${nameOf(idx)}`);
console.log(
  `samplePeriod ${period}µs, window ${seconds}s → ${win.length}/${s.samples.length} samples\n` +
    `== exclusive (self) ==\n${top(self).join('\n')}\n` +
    `== inclusive ==\n${top(total).join('\n')}`,
);
