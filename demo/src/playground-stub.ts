// Web twin of the `playground` Dart package in dart/playground (specs/159
// §11, 201): typed against the GENERATED PlaygroundModule, so a Dart-side
// signature change fails this file's typecheck. The same members with the same integer-only results, so the page's
// "run all" text is identical on both ends. Callbacks are called directly,
// Futures are Promises on setTimeout — there is no engine on the web.
import type { Counter, PlaygroundModule } from './fjs-objects';

export function createPlaygroundStub(): PlaygroundModule {
  let live = 0;

  function counter(initial: number): Counter {
    let value = initial;
    let step = 1;
    let released = false;
    let listener: ((v: number) => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const alive = (): void => {
      if (released) throw new Error('Counter is released');
    };
    const self: Counter = {
      get value() {
        alive();
        return value;
      },
      // a plain Dart field has no released check
      get step() {
        return step;
      },
      set step(v: number) {
        step = v;
      },
      add(n) {
        alive();
        return (value += n * step);
      },
      onTick(fn) {
        alive();
        listener = fn;
      },
      fire() {
        alive();
        listener?.(value);
        return value;
      },
      startTimer(times) {
        alive();
        let left = times;
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
          if (--left <= 0 || released) clearInterval(timer);
          value += step;
          listener?.(value);
        }, 40);
      },
      clone() {
        alive();
        live++;
        const c = counter(value);
        c.step = step;
        return c;
      },
      merge(other) {
        alive();
        return (value += other.value);
      },
      release() {
        alive();
        released = true;
        if (timer) clearInterval(timer);
        live--;
      },
    };
    return self;
  }

  return {
    Counter(initial = 0) {
      live++;
      return counter(initial);
    },
    waitFor: (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms)),
    failAfter: (ms) =>
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('boom')), ms)),
    makeAdder: (n) => (x) => n + x,
    liveCount: () => live,
  };
}
