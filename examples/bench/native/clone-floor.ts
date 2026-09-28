// specs/152: one Vapor template instantiated 2000 times through the DOM
// shell — native clone (libfjs-style attached) vs node by node — the
// instantiation alone, attached under one root and flushed.
//   fjs build native/clone-floor.ts --out dist/clone-floor && fjsrun --frames --pump 20000 dist/clone-floor/app/bundle.js
import { flush, nowMs } from 'fjs';
import { flutterRoot, registerStyles, styleEngine } from 'fjs/vue';
import { document, shellOf } from '../../../packages/fjs-runtime/src/vapor/dom';
import { releaseRoot } from '../../../packages/fjs-runtime/src/vue/renderer';

const SCOPE = 'data-v-floor';
registerStyles(SCOPE, '.cell{background-color:#85d8b4;margin:0.5px}.tiny{font-size:5px;line-height:5px}');
const med = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1].toFixed(2);

function series(label: string, native: boolean): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<view class="cell" ${SCOPE}><text class="tiny" ${SCOPE}> </text></view>`;
  const cell = tpl.content.firstChild as ReturnType<typeof document.createElement>;
  if (!native) cell.clonePlan = null;
  const clone: number[] = [];
  const attach: number[] = [];
  for (let run = 0; run < 12; run++) {
    const root = shellOf(flutterRoot());
    const made = [];
    const t0 = nowMs();
    for (let i = 0; i < 2000; i++) made.push(cell.cloneNode(true));
    const t1 = nowMs();
    for (const c of made) root.appendChild(c);
    flush();
    const t2 = nowMs();
    if (run >= 3) {
      clone.push(t1 - t0);
      attach.push(t2 - t1);
    }
    releaseRoot(root.host!);
    flush();
  }
  console.log(`[clone] ${label.padEnd(12)} clone ${med(clone)} ms   attach+flush ${med(attach)} ms`);
}

console.log(`[clone] style engine: ${styleEngine.nativeAttached ? 'native' : 'ts'}`);
series('node-by-node', false);
series('native', true);
{
  const time = (label: string, fn: (i: number) => unknown) => {
    const xs: number[] = [];
    for (let run = 0; run < 10; run++) {
      const t0 = nowMs();
      for (let i = 0; i < 2000; i++) fn(i);
      if (run >= 3) xs.push(nowMs() - t0);
    }
    console.log(`[clone]   ${label.padEnd(22)} ${med(xs)} ms / 2000`);
  };
  const tpl = document.createElement('template');
  tpl.innerHTML = `<view class="cell" ${SCOPE}><text class="tiny" ${SCOPE}> </text></view>`;
  const cell = tpl.content.firstChild as any;
  cell.cloneNode(true);
  const plan = cell.clonePlan;
  const R = require('../../../packages/fjs-runtime/src/vue/renderer');
  const D = require('../../../packages/fjs-runtime/src/vapor/dom');
  time('new Element', () => new D.Element('view'));
  time('new Text', () => new D.Text(' '));
  time('cloneTemplate', () => R.cloneTemplate(plan));
  time('cloneReady', () => R.cloneReady());
}
