// Engine globals the native host may lack. PrimJS (the default engine since
// spec 088) provides no queueMicrotask — quickjs-ng does, and so do browsers.
// The engine drains the Promise job queue after every eval and host callback
// (all of Vue already runs on it), so a Promise tick is a faithful stand-in.
//
// Imported from host.ts, which every native-facing entry reaches: after that
// import, runtime / framework / user code can call queueMicrotask unguarded
// (specs/091: the router's settle callbacks crashed on PrimJS without this).
//
// Errors (specs/108). A native queueMicrotask enqueues the callback itself
// as the job, so a throw makes the job fail and native/src/vm.cpp logs it.
// Here the job is a `.then` reaction: a throw only rejects the derived
// promise, the job itself "succeeds", and with no rejection tracker on the
// native side the error vanished without a trace — on the DEFAULT engine.
// So the callback runs inside a try/catch and the error is reported from
// the same job, not from a later `.catch` tick; the derived promise then
// settles fulfilled and there is no second, unhandled rejection.
//
// The report reuses vm.cpp's exact prefix and its format_exception shape
// (message, newline, stack) so both engine flavors log the same line. The
// wording says "rejection" for what is a plain throw here — it is quickjs-ng's
// line, kept verbatim so one search finds both. console.error is the native
// log_line(ERROR) channel vm.cpp writes to; native console.* prints only
// String(value), hence the stack is appended by hand.
const PREFIX = '[fjs] unhandled rejection in a microtask job: ';

function formatError(error: unknown): string {
  let text: string;
  try {
    text = String(error);
  } catch {
    text = '<unprintable exception>';
  }
  if (error instanceof Error && typeof error.stack === 'string' && error.stack) {
    text += `\n${error.stack}`;
  }
  return text;
}

function report(error: unknown): void {
  try {
    (globalThis as { console?: { error?: (line: string) => void } }).console?.error?.(
      PREFIX + formatError(error),
    );
  } catch {
    // a replaced or broken console must not take the queue down with it
  }
}

/** Installs the Promise-based queueMicrotask on [target] when it has none. */
export function installQueueMicrotask(target: Record<string, unknown>): void {
  if (typeof target.queueMicrotask === 'function') return;
  target.queueMicrotask = (callback: () => void): void => {
    // the standard throws synchronously for a non-callable argument; the
    // deferred call below would have thrown inside the job and been lost
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to execute 'queueMicrotask': parameter 1 is not of type 'Function'.");
    }
    Promise.resolve().then(() => {
      try {
        callback();
      } catch (error) {
        report(error);
      }
    });
  };
}

installQueueMicrotask(globalThis as Record<string, unknown>);
