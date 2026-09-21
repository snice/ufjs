// spec 088 device gate: breakpoint on REAL app code (hello-fjs main.ts
// debug-probe tick) running on the iOS simulator, through the real
// `fjs debug` relay. Mirrors what a DevTools user does: enable → pick the
// script → find the line in its source → setBreakpointByUrl → get paused
// with live locals → resume → the app keeps ticking.
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:38902/cdp');
let seq = 0;
const pending = new Map();
const consoleLines = [];
const events = [];
const waiters = [];

const send = (method, params = {}) => {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
};
const waitFor = (method, timeoutMs = 30000, pred = () => true) => {
  const hit = events.find((e) => e.method === method && pred(e) && !e.__used);
  if (hit) { hit.__used = true; return Promise.resolve(hit); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), timeoutMs);
    waiters.push({ method, pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
  });
};

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(text);
      if (text.includes('debug-probe')) console.log(`[console] ${text}`);
    } else {
      console.log(`[evt] ${msg.method} ${JSON.stringify(msg.params).slice(0, 110)}`);
    }
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.method === msg.method && w.pred(msg)) {
        waiters.splice(i, 1); msg.__used = true; w.resolve(msg);
      }
    }
  }
});

const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
};

ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await send('Debugger.enable');
    const parsed = await waitFor('Debugger.scriptParsed', 30000,
      (e) => e.params.url === 'bundle.js');
    ok('device app script parsed (bundle.js)', !!parsed.params.scriptId,
      `id=${parsed.params.scriptId}`);

    // find the probe line in the SOURCE the engine stored (0-based)
    const src = await send('Debugger.getScriptSource', { scriptId: parsed.params.scriptId });
    const lines = String(src.scriptSource).split('\n');
    const probeLine = lines.findIndex((l) => l.includes('debug-probe'));
    ok('getScriptSource carries app source', probeLine > 0, `probe at line ${probeLine}`);

    const bp = await send('Debugger.setBreakpointByUrl', {
      url: 'bundle.js', lineNumber: probeLine,
    });
    ok('breakpoint resolved', (bp.locations || []).length > 0 &&
      bp.locations[0].columnNumber !== -1, JSON.stringify(bp.locations));

    // the probe ticks every 2s — pause should arrive well within 15s
    const paused = await waitFor('Debugger.paused', 15000);
    const frame = paused.params.callFrames[0];
    ok('paused ON DEVICE at the probe line', frame.location.lineNumber === probeLine,
      `fn="${frame.functionName}" line=${frame.location.lineNumber}`);

    const propNames = [];
    for (const scope of frame.scopeChain) {
      if (!scope.object?.objectId) continue;
      const props = await send('Runtime.getProperties', { objectId: scope.object.objectId });
      propNames.push(...props.result.map((p) => p.name));
    }
    const names = [...new Set(propNames)].sort();
    ok('live locals visible (local + closure scopes)', names.includes('probeCount'),
      JSON.stringify(names));

    const ev = await send('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId, expression: 'probeCount + 1',
    });
    ok('evaluateOnCallFrame', ev.result && ev.result.value > 0,
      JSON.stringify(ev.result));

    // console evidence collected so far (engine synthesizes consoleAPICalled)
    ok('app console reaches DevTools (consoleAPICalled)',
      consoleLines.some((t) => t.includes('debug-probe')),
      `${consoleLines.filter((t) => t.includes('debug-probe')).length} probe lines`);

    await send('Debugger.removeBreakpoint', { breakpointId: bp.breakpointId });
    await send('Debugger.resume');

    // after resume the app keeps ticking — the next probe line proves the
    // program finished the paused statement and kept running
    const before = consoleLines.length;
    await new Promise((r) => setTimeout(r, 6000));
    const after = consoleLines.slice(before).filter((t) => t.includes('debug-probe'));
    ok('app keeps ticking after resume', after.length >= 1,
      `${after.length} new tick(s)`);

    console.log(process.exitCode ? '--- DEVICE GATE: FAIL ---' : '--- DEVICE GATE: PASS ---');
    process.exit(process.exitCode || 0);
  } catch (e) {
    console.log('FAIL  client error —', e.message);
    console.log('--- DEVICE GATE: FAIL ---');
    process.exit(1);
  }
});
ws.on('error', (e) => { console.log('ws error', e.message); process.exit(1); });
