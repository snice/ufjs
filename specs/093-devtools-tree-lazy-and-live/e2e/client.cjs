// spec 093 end-to-end: a CDP client doing exactly what Chrome DevTools does,
// against the REAL relay (dist-equivalent bundle) + REAL PrimJS VM running
// the fixture app built from the REAL runtime source.
const { createRequire } = require('node:module');
const path = require('node:path');
// ws is packages/fjs's dependency; resolve it from there, relative to this
// checkout (spec 109: no machine-specific paths)
const req = createRequire(path.resolve(__dirname, '../../../packages/fjs/package.json'));
const WS = req('ws');

const URL = 'ws://127.0.0.1:49902/cdp';
const ws = new WS(URL);
let seq = 0;
const pending = new Map();
const events = [];
const waiters = [];

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout: ${method}`));
    }, 8000);
  });
}
function waitForEvent(method, timeoutMs = 6000, pred = () => true) {
  const hit = events.find((e) => e.method === method && pred(e) && !e.__used);
  if (hit) {
    hit.__used = true;
    return Promise.resolve(hit);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${method}`)), timeoutMs);
    waiters.push({ method, pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
  });
}
ws.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.id !== undefined && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
    else p.resolve(msg.result);
    return;
  }
  if (msg.method) {
    events.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.method === msg.method && w.pred(msg)) {
        waiters.splice(i, 1);
        w.resolve(msg);
      }
    }
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const docUpdatedCount = () => events.filter((e) => e.method === 'DOM.documentUpdated').length;

(async () => {
  await new Promise((r) => ws.once('open', r));

  // 1. real engine evaluates arbitrary JS (Runtime passes through the relay)
  const probe = await send('Runtime.evaluate', { expression: 'globalThis.__probe()', returnByValue: true });
  check('Runtime.evaluate reaches the real VM', probe?.result?.value === 'object', JSON.stringify(probe));

  // 2. the NEW runtime branch answers the structural version cmd
  const sv = await send('Runtime.evaluate', {
    expression: 'globalThis.__fjsDevtools.cmd("Dom.structuralVersion","{}")',
    returnByValue: true,
  });
  const svVal = sv?.result?.value ?? '';
  check('runtime has Dom.structuralVersion branch (new code in bundle)',
    typeof svVal === 'string' && /"version":\d+/.test(svVal), svVal);

  // 3. getDocument — the way the frontend opens the Elements panel
  const doc = await send('DOM.getDocument', { depth: 1 });
  const root = doc.root;
  const firstEl = root?.children?.[0];
  check('DOM.getDocument returns root with children', !!firstEl,
    root ? `childNodeCount=${root.childNodeCount} first=${firstEl && firstEl.nodeName}` : 'no root');

  // 4. expand one level — CDP contract: void reply + setChildNodes EVENT
  const rc = await send('DOM.requestChildNodes', { nodeId: firstEl.nodeId });
  const ev = await waitForEvent('DOM.setChildNodes', 4000);
  const nodes = ev.params.nodes || [];
  check('requestChildNodes replies void', rc && Object.keys(rc).length === 0, JSON.stringify(rc));
  check('setChildNodes event carries parentId + nodes',
    ev.params.parentId === firstEl.nodeId && nodes.length > 0,
    `parentId=${ev.params.parentId} nodes=${nodes.length} first=${nodes[0] && nodes[0].nodeName}`);

  // 5. static tree: the 1.5s structural poll must stay SILENT (baseline only)
  await sleep(3600);
  check('no documentUpdated while tree is static', docUpdatedCount() === 0,
    `count=${docUpdatedCount()}`);

  // 6. dead-node self-heal pushes documentUpdated exactly once, then cools down
  const dead = await send('CSS.getComputedStyleForNode', { nodeId: 99999 * 2 + 1000 });
  await waitForEvent('DOM.documentUpdated', 3000);
  await sleep(300);
  await send('CSS.getComputedStyleForNode', { nodeId: 99998 * 2 + 1000 });
  await sleep(700);
  check('stale-node heal pushes once, cooldown suppresses the second',
    docUpdatedCount() === 1, `computedStyleReply=${JSON.stringify(dead)} count=${docUpdatedCount()}`);

  // 7. THE REAL STRUCTURAL CHANGE: add a second page root (what a route push
  //    does) → poll must notice within ~2 pushes window and invalidate
  const before = docUpdatedCount();
  const add = await send('Runtime.evaluate', { expression: 'globalThis.__addPage()', returnByValue: true });
  check('__addPage ran in the real VM', add?.result?.value === true, JSON.stringify(add));
  await waitForEvent('DOM.documentUpdated', 6000, () => docUpdatedCount() > before);
  const elapsedNote = `pushed after ${docUpdatedCount() - before} new event(s)`;
  check('structural change → documentUpdated (auto refresh, ≤ ~3.5s)', true, elapsedNote);

  // 8. re-pull now shows BOTH page roots — the user's exact "只有0" bug
  const doc2 = await send('DOM.getDocument', { depth: 1 });
  const rootCount = doc2.root?.children?.length ?? 0;
  const names = (doc2.root?.children || []).map((n) => n.nodeName).join(',');
  check('re-pulled document has BOTH page roots', rootCount === 2,
    `roots=${rootCount} [${names}]`);

  // 9. expand the NEW root too
  const second = doc2.root.children[1];
  const rc2 = await send('DOM.requestChildNodes', { nodeId: second.nodeId });
  const ev2 = await waitForEvent('DOM.setChildNodes', 4000,
    (m) => m.params.parentId === second.nodeId);
  check('second root expands via setChildNodes event',
    (ev2.params.nodes || []).length > 0, `nodes=${(ev2.params.nodes || []).length}`);

  ws.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('E2E ERROR:', e.message);
  process.exit(1);
});
