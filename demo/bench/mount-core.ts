// Offline mount benchmark for the vant pages (specs/118).
//
//   pnpm --filter demo run bench:mount
//
// Three entries share this module, one mode each, and each runs in a FRESH
// VM: mount.ts (pages as shipped, with <defer>), mount-eager.ts (<defer>
// renders its slot straight away — the page as it was before specs/118) and
// mount-prewarm.ts (as shipped, plus the build-time style snapshot of
// specs/119 imported before each page's first mount). A cold number is only
// cold in a VM that has never mounted the page, so modes cannot share one.
//
// The prewarm snapshots come from `fjs build` itself: it runs this bundle in
// Node with the capture hook set, and this module then mounts each page the
// same way it will under fjsrun and hands the caches back (captureForBuild).
//
// Runs under fjsrun — no Flutter — so it measures the JS half only: Vue,
// the fjs renderer / element API / op encoding, and the style engine. That
// is the whole of what `[nav] mounted` waits on after specs/086 moved the
// synchronous layout out of navMount; the Dart side is next-frame work.
//
// Why each column exists:
// - css / mark come from styleEngine.stats deltas, NOT from timing around
//   flushNow(): vant reads a rect while mounting (ui/geometry.ts flushes
//   synchronously), so the cascade runs INSIDE app.mount().
// - "rest" = sync − css − mark is Vue + the element layer. The null-renderer
//   column mounts the same page on a renderer that only builds plain JS
//   objects: that is Vue on its own, so rest − null ≈ the fjs element layer.
// - "sync" is the part of the mount a user waits on inside navMount. With
//   <defer> the below-the-fold content mounts after the page settles; here
//   no transition is running, so it lands on the next microtask and is
//   reported separately as "defer" (its own css share in brackets). css /
//   mark / rest describe the sync part only.
// - matchMiss is a regression sentinel: an optimization may change what a
//   miss costs, never how many there are (vant-mount-perf.md).
//
// Cold = the first mount of that page in this VM (the one a user sees on
// first open); warm = min of the following runs. Timings are single-VM and
// GC-sensitive: compare runs made back to back, alternating, on one machine.
import { createRenderer, defineComponent, type Component } from 'vue';
import { createApp, flutterRoot, styleEngine } from 'fjs/vue';
import { flushNow, nowMs, setOpSink } from 'fjs';
import { plugins } from 'fjs/plugins';
import { FjsDefer } from 'fjs/app';
import VantBasic from '../src/pages/vant/basic.vue';
import VantFeedback from '../src/pages/vant/feedback.vue';
import VantForm from '../src/pages/vant/form.vue';
import VantMore from '../src/pages/vant/more.vue';
import VantNav from '../src/pages/vant/nav.vue';

const PAGES: [string, Component][] = [
  ['vant-basic', VantBasic],
  ['vant-feedback', VantFeedback],
  ['vant-form', VantForm],
  ['vant-more', VantMore],
  ['vant-nav', VantNav],
];
const WARM_RUNS = 7;

/** `<defer>` that renders its slot straight away: the "no defer" column,
 * i.e. what the page cost before specs/118 split it. */
const EagerDefer = defineComponent({
  name: 'EagerDefer',
  setup: (_, { slots }) => () => slots.default?.(),
});

let frameBytes = 0;
const hostSink: (frame: Uint8Array) => void = setOpSink((frame: Uint8Array) => {
  frameBytes += frame.byteLength;
  hostSink(frame);
}) as never;

// Microtasks, not setTimeout: fjsrun only advances timers while pumping for
// a fixed wall-clock budget, and everything <defer> needs (onPageSettled's
// queueMicrotask, then Vue's scheduler job) is microtask work anyway.
async function tick(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

interface Run {
  deferCss: number;
  sync: number;
  deferred: number;
  css: number;
  mark: number;
  miss: number;
  unmount: number;
  bytes: number;
  elements: number;
}

async function fjsMount(page: Component, defer: Component): Promise<Run> {
  const s0 = styleEngine.stats;
  frameBytes = 0;
  const t0 = nowMs();
  const root = flutterRoot('view');
  const app = createApp(page);
  app.component('defer', defer);
  for (const plugin of plugins) plugin(app as never);
  app.mount(root);
  flushNow();
  const t1 = nowMs();
  const sMid = styleEngine.stats;
  // deferred content: onPageSettled fires on a microtask when no transition
  // is running, then its render needs one more flush
  await tick();
  flushNow();
  const t2 = nowMs();
  const s1 = styleEngine.stats;
  const t3 = nowMs();
  app.unmount();
  flushNow();
  const t4 = nowMs();
  const css = sMid.flushMs - s0.flushMs;
  const mark = sMid.markMs - s0.markMs;
  return {
    deferCss: s1.flushMs - sMid.flushMs,
    sync: t1 - t0,
    // everything after the first frame; the style engine's share of it is
    // folded in (css/mark cover both halves)
    deferred: t2 - t1,
    css,
    mark,
    miss: s1.matchMiss - s0.matchMiss,
    unmount: t4 - t3,
    bytes: frameBytes,
    elements: s1.elements,
  };
}

// ---- Vue on its own ----------------------------------------------------------

type N = {
  tag: string;
  kids: N[];
  parent: N | null;
  text?: string;
  style: Record<string, string>;
  addEventListener(): void;
  removeEventListener(): void;
};
const node = (tag: string, text?: string): N => ({
  tag,
  kids: [],
  parent: null,
  text,
  style: {}, // vant's v-show writes el.style.display
  addEventListener() {},
  removeEventListener() {},
});
const nullRenderer = createRenderer<N, N>({
  createElement: (tag) => node(tag),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (n, text) => { n.text = text; },
  setElementText: (n, text) => { n.text = text; },
  insert: (child, parent, anchor) => {
    child.parent = parent;
    const i = anchor ? parent.kids.indexOf(anchor) : -1;
    if (i < 0) parent.kids.push(child);
    else parent.kids.splice(i, 0, child);
  },
  remove: (child) => {
    const p = child.parent;
    if (p) p.kids.splice(p.kids.indexOf(child), 1);
  },
  patchProp: () => {},
  parentNode: (n) => n.parent,
  nextSibling: (n) => {
    const p = n.parent;
    return p ? p.kids[p.kids.indexOf(n) + 1] ?? null : null;
  },
});

function nullMount(page: Component): number {
  const t0 = nowMs();
  const app = nullRenderer.createApp(page);
  app.component('defer', EagerDefer);
  for (const plugin of plugins) plugin(app as never);
  app.mount(node('root'));
  const t1 = nowMs();
  app.unmount();
  return t1 - t0;
}

// ---- report -------------------------------------------------------------------

const ms = (x: number) => x.toFixed(1).padStart(6);
const fmt = (r: Run) =>
  `sync${ms(r.sync)} css${ms(r.css)} mark${ms(r.mark)} rest${ms(r.sync - r.css - r.mark)}` +
  ` defer${ms(r.deferred)} (css${ms(r.deferCss)}) unmount${ms(r.unmount)}`;
const best = (runs: Run[]) => runs.slice().sort((a, b) => a.sync - b.sync)[0];

async function suite(label: string, defer: Component, prewarm = false): Promise<void> {
  console.log(`== ${label}`);
  const snapshots = (globalThis as { __fjsStyleSnapshots?: Record<string, string> }).__fjsStyleSnapshots;
  if (prewarm && !snapshots) console.log('(no style snapshots in this bundle: build it with `fjs build`)');
  for (const [name, page] of PAGES) {
    let imported = '';
    if (prewarm && snapshots?.[name]) {
      const t = nowMs();
      const ok = styleEngine.importSnapshot(snapshots[name]);
      imported = ` import ${ok ? (nowMs() - t).toFixed(1) + 'ms' : 'REFUSED'}`;
    }
    const cold = await fjsMount(page, defer);
    const warm: Run[] = [];
    for (let i = 0; i < WARM_RUNS; i++) warm.push(await fjsMount(page, defer));
    const w = best(warm);
    const unmount = Math.min(...warm.map((r) => r.unmount));
    console.log(
      `${name.padEnd(13)} cold ${fmt(cold)} miss ${cold.miss} el ${cold.elements} ${(cold.bytes / 1024).toFixed(0)}KB${imported}` +
        ` | warm ${fmt({ ...w, unmount })}`,
    );
  }
}

type CaptureHook = ((r: unknown) => void) & { started?: boolean };

/** Under `fjs build`'s Node capture: mount each page as the suite will and
 * return its style caches, keyed by the page name the suite looks up. */
async function captureForBuild(hook: CaptureHook): Promise<void> {
  hook.started = true;
  const out: Record<string, unknown> = {};
  for (const [name, page] of PAGES) {
    const root = flutterRoot('view');
    const app = createApp(page);
    app.component('defer', FjsDefer);
    for (const plugin of plugins) plugin(app as never);
    app.mount(root);
    await tick();
    flushNow();
    out[name] = styleEngine.exportSnapshot();
    app.unmount();
    flushNow();
  }
  hook(out);
}

/** Runs the whole report for one mode. */
export async function runMountBench(mode: 'eager' | 'defer' | 'prewarm'): Promise<void> {
  const hook = (globalThis as { __fjsCaptureStyles?: CaptureHook }).__fjsCaptureStyles;
  if (typeof hook === 'function') {
    // running inside `fjs build`: only the prewarm entry has anything to give
    if (mode === 'prewarm') await captureForBuild(hook);
    return;
  }
  const deferred = mode !== 'eager';
  await suite(
    mode === 'prewarm'
      ? 'with <defer> + build-time style snapshot (import time on the cold line)'
      : deferred
        ? 'with <defer> (sync = first frame; the rest mounts after settle)'
        : 'eager (<defer> renders at once: the whole page in the first frame)',
    deferred ? FjsDefer : EagerDefer,
    mode === 'prewarm',
  );
  if (deferred) return;
  console.log('== Vue alone (null renderer, whole page), min of 8');
  for (const [name, page] of PAGES) {
    const runs: number[] = [];
    for (let i = 0; i < 8; i++) runs.push(nullMount(page));
    console.log(`${name.padEnd(13)} vue${ms(Math.min(...runs.slice(1)))} (cold${ms(runs[0])})`);
  }
}
