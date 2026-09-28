// specs/151: where the flat-4050 mount goes under the native style engine,
// layer by layer, without Vue — the same tree built three ways:
//   element   the bare element API (create / insert / setText + op encoding)
//   renderer  nodeOps + patchProp as Vue would drive them, style inputs off
//   styled    the same with the style inputs on (what a mount really does)
// Each total includes handing the frame to the host (uiOps: libfjs-style's
// parse and flush). The VDOM mount itself is `pnpm run native:on`; Vue's
// share is that minus `styled`.
//   fjs build native/floor.ts --out dist/floor && fjsrun --frames --pump 20000 dist/floor/app/bundle.js
import { create, createRoot, flush, insert, nowMs, remove, setText } from 'fjs';
import { flutterRoot, styleEngine } from 'fjs/vue';
import { nodeOps, patchProp, registerStyles, releaseRoot } from '../../../packages/fjs-runtime/src/vue/renderer';

const SCOPE = 'data-v-floor';
registerStyles(SCOPE, '.row{flex-direction:row}.cell{background-color:#85d8b4;margin:0.5px}.tiny{font-size:5px;line-height:5px}');
const RUNS = 15;
const WARM = 4;
const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1].toFixed(1);

function elementLayer(): number {
  const root = createRoot('view');
  const t0 = nowMs();
  const box = create('view');
  for (let r = 0; r < 50; r++) {
    const row = create('view');
    for (let i = 0; i < 40; i++) {
      const cell = create('view');
      const t = create('text');
      setText(t, String(i));
      insert(cell, t);
      insert(row, cell);
    }
    insert(box, row);
  }
  insert(root, box);
  flush();
  const dt = nowMs() - t0;
  remove(root);
  flush();
  return dt;
}

function rendererMount(styled: boolean, scope = styled, cls = styled): number {
  const el = (tag: string, c: string | null) => {
    const e = nodeOps.createElement(tag);
    if (scope) nodeOps.setScopeId!(e, SCOPE);
    if (cls && c) patchProp(e, 'class', null, c);
    return e;
  };
  const root = flutterRoot();
  const t0 = nowMs();
  const box = el('view', null);
  for (let r = 0; r < 50; r++) {
    const row = el('view', 'row');
    for (let i = 0; i < 40; i++) {
      const cell = el('view', 'cell');
      const t = el('text', 'tiny');
      nodeOps.setElementText(t, String(i));
      nodeOps.insert(t, cell, null);
      nodeOps.insert(cell, row, null);
    }
    nodeOps.insert(row, box, null);
  }
  nodeOps.insert(box, root, null);
  styleEngine.flushPending();
  flush();
  const dt = nowMs() - t0;
  releaseRoot(root);
  flush();
  return dt;
}

function series(label: string, fn: () => number): void {
  const xs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const dt = fn();
    if (i >= WARM) xs.push(dt);
  }
  console.log(`[floor] ${label.padEnd(10)} ${med(xs)} ms`);
}

console.log(`[floor] style engine: ${styleEngine.nativeAttached ? 'native' : 'ts'}`);
series('element', elementLayer);
series('renderer', () => rendererMount(false));
series('+scope', () => rendererMount(false, true, false));
series('+class', () => rendererMount(false, false, true));
series('styled', () => rendererMount(true));
// the renderer layer's two halves: create (no inserts, elements dropped) and
// insert
series('creates', () => {
  const t0 = nowMs();
  const made = [];
  for (let i = 0; i < 4051; i++) made.push(nodeOps.createElement(i % 2 ? 'text' : 'view'));
  const dt = nowMs() - t0;
  const root = flutterRoot();
  for (const e of made) nodeOps.insert(e, root, null);
  flush();
  releaseRoot(root);
  flush();
  return dt;
});
series('el-creates', () => {
  const t0 = nowMs();
  const made = [];
  for (let i = 0; i < 4051; i++) made.push(create(i % 2 ? 'text' : 'view'));
  const dt = nowMs() - t0;
  const root = createRoot('view');
  for (const e of made) insert(root, e);
  flush();
  remove(root);
  flush();
  return dt;
});
