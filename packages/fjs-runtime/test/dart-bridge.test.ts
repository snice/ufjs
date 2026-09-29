// dartModule() over the native objectCall channel (spec 159): the module
// proxy's constructor shape, the web stub path, and the loud failure when
// neither exists. Same mock-the-host-at-load technique as host-async.test.ts
// — host.ts reads __fjs at module load, so each scenario re-imports.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: unknown[][] = [];

function installHost(objectCall?: (...args: unknown[]) => unknown): void {
  (globalThis as Record<string, unknown>).__fjs = {
    fns: {
      setTimeout: (cb: () => void, ms: number) => Number(setTimeout(cb, ms)),
      clearTimeout: (id: number) => clearTimeout(id),
      uiOps: () => {},
      invokeHost: () => null,
      ...(objectCall ? { objectCall } : {}),
      nowMs: () => Date.now(),
      toast: () => {},
      engine: { engineId: 'test', abiVersion: objectCall ? 3 : 1 },
    },
    natives: {},
    engine: { engineId: 'test', abiVersion: objectCall ? 3 : 1 },
  } as unknown as Record<string, unknown>;
}

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dartModule with an object-ABI host', () => {
  it('routes member access to construct calls and returns what Dart built', async () => {
    installHost((...args: unknown[]) => {
      calls.push(args);
      return { __dartHandle: 1 };
    });
    const { dartModule, hasDartObjectSupport } = await import(
      '../src/dart-bridge'
    );
    expect(hasDartObjectSupport()).toBe(true);

    const m = dartModule<{ MMKV: () => unknown }>('mmkv');
    const c = m.MMKV();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['construct', 'mmkv', 'MMKV']);
    expect(c).toEqual({ __dartHandle: 1 });

    // constructors are cached per member: the same function object comes
    // back, and only one construct call runs per invocation
    expect(m.MMKV).toBe(m.MMKV);
  });

  it('reports no support when the host predates the rich channel', async () => {
    installHost(undefined);
    const { hasDartObjectSupport } = await import('../src/dart-bridge');
    expect(hasDartObjectSupport()).toBe(false);
  });
});

describe('dartModule without an object-ABI host', () => {
  it('serves the registered TS stub (the web stand-in path)', async () => {
    installHost(undefined);
    const mod = await import('../src/dart-bridge');
    const stub = { MMKV: () => ({ encode: true }) };
    mod.registerDartModuleStub('mmkv', stub);
    expect(mod.hasDartModuleStub('mmkv')).toBe(true);

    const m = mod.dartModule<typeof stub>('mmkv');
    expect(m.MMKV().encode).toBe(true);
  });

  it('warns once and throws when neither engine nor stub exists', async () => {
    installHost(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../src/dart-bridge');

    expect(() => mod.dartModule('nope')).toThrow(/unavailable/);
    expect(() => mod.dartModule('nope')).toThrow(/unavailable/);
    expect(warn).toHaveBeenCalledTimes(1);
    // a host IS present here, just an old one — the message says which
    // half is missing
    expect(String(warn.mock.calls[0][0])).toContain('object ABI (v3)');
  });

  it('warns the web build towards registerDartModuleStub', async () => {
    delete (globalThis as Record<string, unknown>).__fjs;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../src/dart-bridge');
    expect(mod.hasDartObjectSupport()).toBe(false);

    expect(() => mod.dartModule('nope')).toThrow(/unavailable/);
    expect(String(warn.mock.calls[0][0])).toContain('registerDartModuleStub');
  });

  it('prefers the engine over the stub when both exist', async () => {
    installHost(() => 'from-engine');
    const mod = await import('../src/dart-bridge');
    mod.registerDartModuleStub('mmkv', 'from-stub');
    const m = mod.dartModule<{ Counter: () => unknown }>('mmkv');
    expect(m.Counter()).toBe('from-engine');
  });
});
