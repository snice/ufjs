// The native path of the built-in haptics: vibrateShort/vibrateLong go
// through the fjs.vibrate host module (HapticFeedback in flutter_fjs —
// SDK-only, which is why vibration is built in while audio is a module).
import { beforeEach, describe, expect, it } from 'vitest';

interface Call {
  name: string;
  args: unknown[];
}

const calls: Call[] = [];

(globalThis as Record<string, unknown>).__fjs = {
  engine: { engineId: 'test-engine', abiVersion: 3 },
  fns: {
    invokeHost: (name: string, ...args: unknown[]) => {
      calls.push({ name, args });
      return 0;
    },
  },
};

const { vibrateShort, vibrateLong } = await import('../src/vibrate');

beforeEach(() => {
  calls.length = 0;
});

describe('vibrateShort / vibrateLong on the native host', () => {
  it('passes the type through, defaulting to heavy (wx default)', () => {
    vibrateShort('light');
    vibrateShort('medium');
    vibrateShort();
    vibrateLong();
    const vib = calls.filter((c) => c.name === 'fjs.vibrate').map((c) => c.args);
    expect(vib).toEqual([['light'], ['medium'], ['heavy'], ['long']]);
  });
});
