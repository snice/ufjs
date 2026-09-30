// The enableVapor acceptance harness (specs/166 §6.4): the app's own main
// (createFjsApp + enableVapor) mounted headless under fjsrun, with asserts
// on the element tree the vapor runtime produced.
//
//   fjs build check/main.ts --out dist/check && fjsrun --pump 200 dist/check/app/bundle.js
import './preload';
import { flushNow, setOpSink } from 'fjs';
import { createFjsApp } from 'fjs/app';
import { definePage } from 'fjs/router';
import Home from '../src/pages/home.vue';
import About from '../src/pages/about.vue';

/** QuickJS has no TextDecoder — ASCII/UTF-8 decode by hand (demo
 * bench/vapor-check.ts's helper). */
function decodeUtf8(b: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i] as number;
    if (c < 0x80) {
      out += String.fromCharCode(c);
      i += 1;
    } else if (c < 0xe0) {
      out += String.fromCharCode(((c & 0x1f) << 6) | ((b[i + 1] as number) & 0x3f));
      i += 2;
    } else {
      out += String.fromCharCode(
        ((c & 0x0f) << 12) | (((b[i + 1] as number) & 0x3f) << 6) | ((b[i + 2] as number) & 0x3f),
      );
      i += 3;
    }
  }
  return out;
}

// the texts the SetText/StyleText ops carried, by element id
const texts = new Map<number, string>();
const tags = new Map<number, string>();
const parentOf = new Map<number, number>();
const childrenOf = new Map<number, number[]>();
setOpSink((frame: Uint8Array) => {
  const fjsText = (frame as Uint8Array & { fjsText?: string[] }).fjsText;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let i = 0;
  const u32 = () => ((i += 4), view.getUint32(i - 4, true));
  const u16 = () => ((i += 2), view.getUint16(i - 2, true));
  while (i < frame.length) {
    const op = frame[i++];
    if (op === 1) {
      const id = u32();
      const n = u16();
      tags.set(id, decodeUtf8(frame.subarray(i, i + n)));
      i += n;
    } else if (op === 2) {
      u32();
    } else if (op === 3) {
      const parent = u32();
      const child = u32();
      u32();
      parentOf.set(child, parent);
      const kids = childrenOf.get(parent) ?? [];
      kids.push(child);
      childrenOf.set(parent, kids);
    } else if (op === 4) {
      i += 8;
    } else if (op === 5) {
      const id = u32();
      const n = u32();
      texts.set(id, decodeUtf8(frame.subarray(i, i + n)));
      i += n;
    } else if (op === 0x4c && fjsText) {
      const id = u32();
      const idx = u32();
      texts.set(id, fjsText[idx] ?? '');
    } else if (op === 6 || op === 7) {
      // not `i += u32()` — the compound assignment reads the stale i
      u32();
      const n = u32();
      i += n;
    } else if (op === 8) {
      i += 12;
    } else {
      break;
    }
  }
});

// the route table mounts through definePage on Flutter
definePage('/', Home as never);
definePage('/about', About as never);

async function main(): Promise<void> {
  const app = createFjsApp({
    enableVapor: true,
    routes: [
      { path: '/', meta: { title: 'Home' }, component: Home as never },
      { path: '/about', meta: { title: 'About' }, component: About as never },
    ],
    transition: false,
  });
  app.mount();
  flushNow();

  const kidsOf = (id: number): number[] => childrenOf.get(id) ?? [];
  const walk = (id: number, out: string[] = []): string[] => {
    const t = texts.get(id);
    if (t !== undefined && tags.get(id) === 'text') out.push(t);
    for (const kid of kidsOf(id)) walk(kid, out);
    return out;
  };
  // the base page's root: walk up from any element the page created — the
  // top of the parent chain is the app overlay host the page root hangs on
  let root = 0;
  for (const [id] of parentOf) {
    root = id;
    while (parentOf.has(root)) root = parentOf.get(root) as number;
    break;
  }
  const tree = walk(root);
  const fail = (why: string): never => {
    console.log(`[vapor-app] FAIL: ${why}`);
    console.log(`[vapor-app] tree: ${JSON.stringify(tree)}`);
    throw new Error(why);
  };
  console.log(`[vapor-app] tree: ${JSON.stringify(tree)}`);
  console.log(`[vapor-app] dbg: parents=${JSON.stringify([...parentOf])} texts=${JSON.stringify([...texts])} tags=${JSON.stringify([...tags])}`);
  if (!tree.includes('vapor home')) fail('home title missing');
  if (!tree.includes('3')) fail('count text missing');
  if (!tree.includes('a (0)') || !tree.includes('c (2)')) fail('v-for rows missing');
  if (!tree.includes('tap to hide')) fail('v-if branch missing');
  console.log('[vapor-app] PASS base page (title/count/v-for/v-if, native vapor mount)');

  // push/back are not exercised here: fjsrun has no navigator on the other
  // side of `fjs.nav.push`, so a push never swaps (the router's vapor mount
  // + navigation are covered by fjs-runtime's router/web tests, and the
  // about page is compiled into this very bundle — a vapor compile error
  // would have failed the build).
}

void main();
