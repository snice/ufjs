// spec 089 panels gate: Elements tree + Network rows on the real app.
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:38902/cdp');
let seq = 0;
const pending = new Map();
const netEvents = [];

const send = (method, params = {}) => {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
  } else if (msg.method?.startsWith('Network.')) {
    netEvents.push(msg);
  }
});

const ok = (name, cond, detail = "") => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
};

const countNodes = (n) =>
  1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);

ws.on('open', async () => {
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    await send('DOM.enable');
    await send('Network.enable');
    await wait(900); // let the first poll arm recording (netDrain flips netActive)

    const doc = await send('DOM.getDocument');
    const root = doc.root;
    const nodes = countNodes(root);
    ok('Elements: tree served', nodes > 5, `${nodes} nodes`);
    // find a text node to prove props/text/class serialization
    const stack = [root];
    let sawTag = null;
    let sawAttr = false;
    while (stack.length) {
      const n = stack.pop();
      if ((n.nodeName === 'text' || n.nodeName === 'button') && sawTag === null) sawTag = n.nodeName;
      if ((n.attributes || []).length >= 2) sawAttr = true;
      for (const c of n.children || []) stack.push(c);
    }
    ok('Elements: app tags present', sawTag !== null, `first=${sawTag}`);
    ok('Elements: attributes serialized', sawAttr);

    // computed style: walk until a node actually has styles (a bare page
    // root legitimately computes to nothing)
    let computedProps = 0;
    let computedNode = null;
    const elemStack = [root];
    while (elemStack.length && computedProps === 0) {
      const n = elemStack.shift();
      for (const ch of n.children || []) elemStack.push(ch);
      if (n.nodeType !== 1) continue;
      const c = await send('CSS.getComputedStyleForNode', { nodeId: n.nodeId });
      computedProps = (c.computedStyle || []).length;
      if (computedProps > 0) computedNode = n.nodeName;
    }
    ok('Elements: computed style served', computedProps > 0,
      `${computedProps} props on ${computedNode}`);

    // trigger a real fetch inside the app against the dev server
    await send('Runtime.evaluate', {
      expression: `fetch('http://127.0.0.1:38900/manifest.json?units=1').then(r => r.text())`,
      awaitPromise: true,
      returnByValue: true,
    });
    await wait(3000); // two net polls
    const reqs = netEvents.filter((e) => e.method === 'Network.requestWillBeSent');
    ok('Network: request row emitted', reqs.length >= 1,
      JSON.stringify(reqs[0]?.params?.request?.url ?? ''));
    const dones = netEvents.filter((e) => e.method === 'Network.loadingFinished');
    ok('Network: response finished', dones.length >= 1);

    const requestId = reqs[0]?.params?.requestId;
    if (requestId) {
      const body = await send('Network.getResponseBody', { requestId });
      const text = Buffer.from(body.body, 'base64').toString('utf8');
      ok('Network: response body readable', text.includes('pages') || text.length > 10,
        `${text.length} bytes`);
    }

    console.log(process.exitCode ? '--- PANELS GATE: FAIL ---' : '--- PANELS GATE: PASS ---');
    process.exit(process.exitCode || 0);
  } catch (e) {
    console.log('FAIL  client error —', e.message);
    console.log('--- PANELS GATE: FAIL ---');
    process.exit(1);
  }
});
ws.on('error', (e) => { console.log('ws error', e.message); process.exit(1); });
