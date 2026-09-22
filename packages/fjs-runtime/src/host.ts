// Native host access layer. `__fjs` is installed by the C++ core
// (natives.cpp) and typed in native-global.d.ts; everything user-facing
// goes through this module.
import './microtask';
import { OpWriter } from './ui/ops';
import { devtoolsTreeVersion } from './devtools-hooks';

export const hasNativeHost = typeof globalThis !== 'undefined' && '__fjs' in globalThis;

export const host: FjsNativeFns | null = globalThis.__fjs?.fns ?? null;

export const engineInfo: FjsEngineInfo = globalThis.__fjs?.engine ?? {
  engineId: 'none',
  abiVersion: 0,
};

// ---- timers (native-backed) ------------------------------------------------

export const setTimeout: typeof globalThis.setTimeout = ((cb: TimerHandler, ms = 0, ..._a: unknown[]) => {
  if (!host) return 0;
  return host.setTimeout(wrapHandler(cb), Number(ms) || 0);
}) as typeof globalThis.setTimeout;

export const clearTimeout: typeof globalThis.clearTimeout = ((id?: number) => {
  host?.clearTimeout(Number(id) || 0);
}) as typeof globalThis.clearTimeout;

export const setInterval: typeof globalThis.setInterval = ((cb: TimerHandler, ms = 0, ..._a: unknown[]) => {
  if (!host) return 0;
  return host.setInterval(wrapHandler(cb), Math.max(1, Number(ms) || 1));
}) as typeof globalThis.setInterval;

export const clearInterval: typeof globalThis.clearInterval = ((id?: number) => {
  host?.clearInterval(Number(id) || 0);
}) as typeof globalThis.clearInterval;

function wrapHandler(cb: TimerHandler): () => void {
  if (typeof cb === 'function') return cb as () => void;
  console.warn('[fjs] timer callbacks must be functions (string form unsupported)');
  return () => {};
}

// ---- host modules (JSI) ------------------------------------------------------

export function invokeHost<T = unknown>(name: string, ...args: FjsHostValue[]): T {
  if (!host) {
    throw new Error('invokeHost: no native host (running outside fjs runtime)');
  }
  return host.invokeHost(name, ...args) as T;
}

export function nowMs(): number {
  return host ? host.nowMs() : Date.now();
}

/** Runs a garbage collection now, returning heap sizes either side of it.
 * Null where there is no engine (the web build).
 *
 * A DEBUGGING tool only: add it while investigating (to take a collection
 * out of a timed window, see docs/performance.md on why GC dominates a
 * device's numbers) and remove it afterwards. Pages, examples and app code
 * must not call it — a full-heap mark-and-sweep on demand is a jank of its
 * own. The heap size without collecting is the perf overlay's `heap` row. */
export function gc(): { before: number; after: number; objects: number } | null {
  return host?.gc ? host.gc() : null;
}

let toastHandler: ((message: string) => void) | null = null;

/** Routes toast() somewhere other than the native overlay. The web adapter
 * installs a DOM implementation here so `toast()` works in the browser. */
export function setToastHandler(handler: ((message: string) => void) | null): void {
  toastHandler = handler;
}

/** Shows a transient toast on the native layer (FjsView's toast overlay). */
export function toast(message: string): void {
  if (host) {
    host.toast(message);
  } else if (toastHandler) {
    toastHandler(message);
  } else {
    console.log('[toast]', message);
  }
}

// ---- UI frame batching --------------------------------------------------------

// ---- globals ----------------------------------------------------------------
// QuickJS installs console/timers under __fjs only; expose the conventional
// globals so app code can use setTimeout/setInterval directly.

// Only where there is a native host: these wrappers do nothing without one
// (`if (!host) return 0`), so installing them in a browser would silently
// disable every timer the app — and this runtime's own toast — schedules.
if (hasNativeHost) {
  const g = globalThis as Record<string, unknown>;
  g.setTimeout = setTimeout;
  g.clearTimeout = clearTimeout;
  g.setInterval = setInterval;
  g.clearInterval = clearInterval;
}

// ---- UI frame batching --------------------------------------------------------

const writer = new OpWriter();
let flushScheduled = false;

export interface OpSink {
  (frame: Uint8Array): void;
}

let sink: OpSink = (frame) => {
  if (host) host.uiOps(frame);
};

/** Overrides where frames go (tests / custom hosts). Returns the sink it
 * replaced, so a wrapper (a byte counter, a recorder) can chain to it
 * instead of swallowing the frame. */
export function setOpSink(s: OpSink): OpSink {
  const previous = sink;
  sink = s;
  return previous;
}

export function getWriter(): OpWriter {
  return writer;
}

// The host calls this before it starts recording UI frames. Interned style
// ids are only meaningful relative to the definitions that preceded them, so
// a log that starts mid-session would replay SetStyle ops naming styles the
// replaying tree never saw. Forgetting the directory makes the next frame
// re-send every definition it uses, which is what makes the log replayable.
if (hasNativeHost) {
  (globalThis as Record<string, unknown>).__fjsForgetStyles = () => {
    writer.forgetStyles();
    flushNow();
  };
}

/** Callbacks that get to add ops to the frame that is about to go out.
 * The canvas layer uses this: its drawing commands have to ride the SAME
 * frame as the node ops, or a resize and the redraw that answers it reach
 * the host one frame apart. */
const preFlush: Array<() => void> = [];

export function registerPreFlush(fn: () => void): void {
  preFlush.push(fn);
}

/** Queued ops flush once per microtask — one native call per JS tick. */
export function flushNow(): void {
  flushScheduled = false;
  for (let i = 0; i < preFlush.length; i++) preFlush[i]();
  if (writer.isEmpty) return;
  const frame = writer.toUint8Array();
  writer.reset();
  sink(frame);
  // spec 092: the DevTools relay polls this to notice "the tree changed" —
  // per frame batch, not per op, so it stays free
  devtoolsTreeVersion.value++;
}

export function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flushNow);
  } else {
    Promise.resolve().then(flushNow);
  }
}
