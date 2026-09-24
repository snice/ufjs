// The queueMicrotask stand-in for engines without one (PrimJS).
//
// Module-load install (specs/091): the polyfill installs only when the
// global is missing, so those cases manipulate the real globalThis and
// re-evaluate the module (vitest's module registry is reset between
// imports).
//
// Error reporting (specs/108): Node has a native queueMicrotask, so those
// cases install the stand-in on a fake global; the global console is
// swapped for a recorder.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installQueueMicrotask } from '../src/microtask';

const realQueueMicrotask = globalThis.queueMicrotask;

describe('microtask polyfill', () => {
  // the static import above already evaluated the module once
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    globalThis.queueMicrotask = realQueueMicrotask;
    vi.resetModules();
  });

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

type Queue = (cb: unknown) => void;
const flush = () => new Promise<void>((done) => setTimeout(done, 0));

describe('queueMicrotask stand-in (specs/108)', () => {
  let queue: Queue;
  let errors: string[];

  beforeEach(() => {
    const target: Record<string, unknown> = {};
    installQueueMicrotask(target);
    queue = target.queueMicrotask as Queue;
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      errors.push(String(line));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('reports a throwing callback like the native engine does', async () => {
    queue(() => {
      throw new Error('boom');
    });
    await flush();
    expect(errors).toHaveLength(1);
    // vm.cpp's prefix, then message, newline, stack (format_exception)
    expect(errors[0].startsWith('[fjs] unhandled rejection in a microtask job: Error: boom\n')).toBe(true);
    expect(errors[0]).toMatch(/microtask\.test\.ts/);
  });

  it('reports a thrown non-Error value too', async () => {
    queue(() => {
      throw 'plain string';
    });
    await flush();
    expect(errors).toEqual(['[fjs] unhandled rejection in a microtask job: plain string']);
  });

  it('keeps draining after a throw, in FIFO order', async () => {
    const order: string[] = [];
    queue(() => order.push('a'));
    queue(() => {
      order.push('b');
      throw new Error('in the middle');
    });
    queue(() => order.push('c'));
    await flush();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(errors).toHaveLength(1);
  });

  it('runs after the current synchronous code', async () => {
    const order: string[] = [];
    queue(() => order.push('micro'));
    order.push('sync');
    await flush();
    expect(order).toEqual(['sync', 'micro']);
  });

  it('throws a TypeError synchronously for a non-function', () => {
    expect(() => queue(123)).toThrow(TypeError);
    expect(() => queue(undefined)).toThrow(TypeError);
  });

  it('survives a broken console', async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console is gone');
    });
    const order: string[] = [];
    queue(() => {
      throw new Error('first');
    });
    queue(() => order.push('after'));
    await flush();
    expect(order).toEqual(['after']);
  });

  it('leaves a native queueMicrotask alone', () => {
    const native = () => {};
    const target: Record<string, unknown> = { queueMicrotask: native };
    installQueueMicrotask(target);
    expect(target.queueMicrotask).toBe(native);
  });
});
