// Native-host polyfill for Anime.js (spec 031), installed only on the
// QuickJS host. Import this module BEFORE `animejs` — ESM hoists imports,
// so declaration order in the page file decides module execution order.
//
// Anime.js picks its main loop at module evaluation time:
// `isBrowser ? requestAnimationFrame : setImmediate`, where isBrowser is
// `typeof window !== 'undefined'`. The QuickJS host has no `window`, so it
// takes the Node branch and reads the bare `setImmediate` global — which
// does not exist there, and the import would throw.
//
// The mini program has the same gap but not the same fix: there Anime.js is
// inside the npm vendor bundle, whose top level evaluates the moment ANY page
// requires it — before this module could run. `setImmediate` is one of the
// build's injected globals there (SHADOWED_GLOBALS in fjs/src/mp/script.ts),
// so nothing is needed from the page side.
//
// Why map it onto requestAnimationFrame instead of a macrotask: JS runs on
// the UI thread here (docs/threading-model.md). A Node-style "as soon as
// possible" loop re-arms itself forever and starves frame production; the
// engine reads `Date.now()` on every tick anyway, so ticking once per host
// vsync is exactly the cadence an animation wants.
//
// On web none of this installs: `window` exists, Anime.js takes the browser
// branch, and the same page source hits the natives untouched
// (constitution I).
import { hasNativeHost } from 'fjs';

type Globals = Record<string, unknown> & {
  setImmediate?: unknown;
  clearImmediate?: unknown;
};

if (hasNativeHost) {
  const g = globalThis as unknown as Globals;

  if (typeof g.setImmediate !== 'function') {
    // Resolved per call: the runtime installs requestAnimationFrame while
    // it loads, and nothing here should depend on which module ran first.
    g.setImmediate = (cb: () => void) => requestAnimationFrame(() => cb());
  }
  if (typeof g.clearImmediate !== 'function') {
    g.clearImmediate = (id: number) => cancelAnimationFrame(id);
  }
}
