// specs/148: a Vue Vapor page using vant (VDOM components, through Vue's
// interop), mounted under fjsrun. Checks the vant parts are there and that
// taps on a vant button / cell / stepper reach the Vapor page's state.
//
//   fjs build bench/vapor-check.ts --out dist/vapor-check && \
//     ../packages/flutter_fjs/native/build-native/fjsrun --pump 200 dist/vapor-check/app/bundle.js
import { createApp, flutterRoot, styleEngine } from 'fjs/vue';
import { flushNow, setOpSink } from 'fjs';
import { plugins } from 'fjs/plugins';
import { childElementIds } from '../../packages/fjs-runtime/src/vue/renderer';
import VantVapor from '../src/pages/vant/vapor.vue';

const texts = new Map<number, string>();
const hostSink = setOpSink((frame: Uint8Array) => {
  // SetText only (op 5); everything else skipped by its encoded size
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let i = 0;
  const u32 = () => ((i += 4), view.getUint32(i - 4, true));
  const u16 = () => ((i += 2), view.getUint16(i - 2, true));
  while (i < frame.length) {
    const op = frame[i++];
    if (op === 1) { u32(); const n = u16(); i += n; }
    else if (op === 2) u32();
    else if (op === 3) i += 12;
    else if (op === 4) i += 8;
    else if (op === 5) { const id = u32(); const n = u32(); texts.set(id, decodeUtf8(frame.subarray(i, i + n))); i += n; }
    else if (op === 6 || op === 7) { u32(); const n = u32(); i += n; }
    else if (op === 8) i += 12;
    else if (op === 12) i += 8;
    else if (op === 9) {}
    else break;
  }
  hostSink(frame);
}) as (f: Uint8Array) => void;

function decodeUtf8(b: Uint8Array): string {
  return decodeURIComponent(Array.from(b, (c) => '%' + c.toString(16).padStart(2, '0')).join(''));
}

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flushNow();
};

function find(root: number, pred: (id: number) => boolean): number[] {
  const out: number[] = [];
  const visit = (id: number) => {
    if (pred(id)) out.push(id);
    for (const k of childElementIds(id)) visit(k);
  };
  visit(root);
  return out;
}
const hasClass = (c: string) => (id: number) => styleEngine.classesOf(id).includes(c);
const allTexts = (root: number) => find(root, (id) => texts.has(id)).map((id) => texts.get(id)!);
const tap = (id: number) =>
  (globalThis as unknown as { __fjsDispatchEvent(id: number, type: number, payload: string | null): void }).__fjsDispatchEvent(id, 1, null);

async function main(): Promise<void> {
  const root = flutterRoot('view');
  const app = createApp(VantVapor);
  for (const plugin of plugins) plugin(app as never);
  app.mount(root);
  await tick();
  const report = (label: string) => console.log(`[vapor-check] ${label}: ${allTexts(root.id).filter((t) => /次|Stepper|开关|大于/.test(t)).join(' | ')}`);
  const count = (c: string) => find(root.id, hasClass(c)).length;
  console.log(`[vapor-check] vant parts: button ${count('van-button')}, cell ${count('van-cell')}, switch ${count('van-switch')}, stepper ${count('van-stepper')}`);
  report('mounted');
  const [primary, plus10] = find(root.id, hasClass('van-button'));
  tap(primary);
  await tick();
  tap(plus10);
  await tick();
  tap(find(root.id, hasClass('van-cell--clickable'))[0]);
  await tick();
  const plus = find(root.id, hasClass('van-stepper__plus'))[0];
  for (let i = 0; i < 3; i++) {
    tap(plus);
    await tick();
  }
  tap(find(root.id, hasClass('van-switch'))[0]);
  await tick();
  report('after taps');
  app.unmount();
  await tick();
  console.log(`[vapor-check] unmounted, ${styleEngine.stats.elements} styled elements left`);
}

main().catch((e) => console.log(`[vapor-check] failed: ${String(e)}\n${e?.stack}`));
