// fjs spec 088 spike — automated CDP gate check.
// Drives the whole Debugger flow a Chrome DevTools would drive:
// enable -> wait scriptParsed -> setBreakpointByUrl -> expect paused on
// work() -> read locals via Runtime.getProperties -> evaluateOnCallFrame ->
// stepOver -> resume -> expect trailing consoleAPICalled.
import WebSocket from 'ws';

const URL = 'ws://127.0.0.1:39801/cdp';
const ws = new WebSocket(URL);
let seq = 0;
const pending = new Map();
const events = [];
const waiters = [];

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function waitFor(method, timeoutMs = 20000, pred = () => true) {
  const hit = events.find((e) => e.method === method && pred(e) && !e.__used);
  if (hit) {
    hit.__used = true;
    return Promise.resolve(hit);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${method}`)),
      timeoutMs,
    );
    waiters.push({ method, pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
  });
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
    console.log(`[evt] ${msg.method} ${JSON.stringify(msg.params).slice(0, 220)}`);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.method === msg.method && w.pred(msg)) {
        waiters.splice(i, 1);
        msg.__used = true;
        w.resolve(msg);
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
    const parsed = await waitFor('Debugger.scriptParsed', 20000);
    ok('scriptParsed', !!parsed.params.scriptId,
       `id=${parsed.params.scriptId} url=${parsed.params.url}`);

    const bp = await send('Debugger.setBreakpointByUrl', {
      url: parsed.params.url,
      lineNumber: 3, // `s += i * 2;`
    });
    ok('setBreakpointByUrl resolved', (bp.locations || []).length > 0,
       JSON.stringify(bp.locations));

    const paused = await waitFor('Debugger.paused');
    const frame = paused.params.callFrames[0];
    ok('paused in work()', frame.functionName === 'work',
       `fn=${frame.functionName} line=${frame.location.lineNumber}`);

    const localScope = frame.scopeChain.find((s) => s.type === 'local');
    const props = await send('Runtime.getProperties', {
      objectId: localScope.object.objectId,
    });
    const names = props.result.map((p) => p.name).sort();
    ok('locals visible', names.includes('s') && names.includes('i'),
       JSON.stringify(names));

    const ev = await send('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId,
      expression: 's + i',
    });
    ok('evaluateOnCallFrame', ev.result && typeof ev.result.value === 'number',
       JSON.stringify(ev.result));

    await send('Debugger.stepOver');
    const paused2 = await waitFor('Debugger.paused');
    ok('stepOver -> paused again', paused2.params.callFrames.length > 0,
       `frames=${paused2.params.callFrames.length}`);

    // remove the breakpoint before the final resume, or the loop's next
    // iteration re-hits it and "main done" never runs while we watch
    await send('Debugger.removeBreakpoint', { breakpointId: bp.breakpointId });
    await send('Debugger.resume');
    const done = await waitFor('Runtime.consoleAPICalled', 30000,
      (e) => JSON.stringify(e.params).includes('main done'));
    ok('resume + trailing console', true);

    console.log(process.exitCode ? '--- GATE: FAIL ---' : '--- GATE: PASS ---');
    process.exit(process.exitCode || 0);
  } catch (e) {
    console.log('FAIL  client error —', e.message);
    console.log('--- GATE: FAIL ---');
    process.exit(1);
  }
});
ws.on('error', (e) => { console.log('ws error', e.message); process.exit(1); });
