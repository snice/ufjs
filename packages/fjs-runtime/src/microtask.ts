// Engine globals the native host may lack. PrimJS (the default engine since
// spec 088) provides no queueMicrotask — quickjs-ng does, and so do browsers.
// The engine drains the Promise job queue after every eval and host callback
// (all of Vue already runs on it), so a Promise tick is a faithful stand-in.
//
// Imported from host.ts, which every native-facing entry reaches: after that
// import, runtime / framework / user code can call queueMicrotask unguarded
// (specs/091: the router's settle callbacks crashed on PrimJS without this).
const g = globalThis as Record<string, unknown>;
if (typeof g.queueMicrotask !== 'function') {
  g.queueMicrotask = (cb: () => void): void => {
    Promise.resolve().then(cb);
  };
}
