// The polyfill installs only when the global is missing, so each case
// manipulates the real globalThis and re-evaluates the module (vitest's
// module registry is reset between imports).
import { afterEach, describe, expect, it, vi } from 'vitest';

const realQueueMicrotask = globalThis.queueMicrotask;

afterEach(() => {
  globalThis.queueMicrotask = realQueueMicrotask;
  vi.resetModules();
});

describe('microtask polyfill', () => {
  it('installs a Promise-backed queueMicrotask when the engine lacks one', async () => {
    // PrimJS: the global is simply absent
    Reflect.deleteProperty(globalThis, 'queueMicrotask');
    await import('../src/microtask');

    expect(typeof globalThis.queueMicrotask).toBe('function');
    const ran = vi.fn();
    globalThis.queueMicrotask(ran);
    expect(ran).not.toHaveBeenCalled(); // async, like the native one
    await new Promise<void>((resolve) => globalThis.queueMicrotask(resolve));
    expect(ran).toHaveBeenCalled();
  });

  it('leaves a native queueMicrotask untouched', async () => {
    const native = vi.fn();
    globalThis.queueMicrotask = native as unknown as typeof queueMicrotask;
    await import('../src/microtask');

    expect(globalThis.queueMicrotask).toBe(native);
    expect(native).not.toHaveBeenCalled();
  });
});
