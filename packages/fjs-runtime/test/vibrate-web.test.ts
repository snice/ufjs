// The web path of the built-in haptics: navigator.vibrate with
// conventional durations, and the no-vibrate environments (iOS Safari,
// desktop) warned about once instead of failing silently.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vibrate = vi.fn((): boolean => true);

// node ≥21 exposes a getter-only global navigator; swap it wholesale and
// put the original descriptor back afterwards
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}
setNavigator({ vibrate });

const { vibrateShort, vibrateLong, resetVibrateWarnings } = await import('../src/vibrate');

beforeEach(() => {
  // afterEach hands node's own getter-only navigator back; every test that
  // needs the mock gets a fresh one here
  setNavigator({ vibrate });
  vibrate.mockClear();
  resetVibrateWarnings();
});

afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
});

describe('vibrateShort / vibrateLong on the web', () => {
  it('maps intensities to conventional durations', () => {
    vibrateShort('light');
    vibrateShort('medium');
    vibrateShort('heavy');
    vibrateShort(); // default heavy, wx's default too
    vibrateLong();
    expect(vibrate.mock.calls).toEqual([[15], [30], [50], [50], [400]]);
  });

  it('warns once where navigator.vibrate does not exist (iOS Safari)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setNavigator({});
    vibrateShort('light');
    vibrateLong();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
