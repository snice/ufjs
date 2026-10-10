// ufjs's built-in haptics (specs/215): wx's vibrateShort/vibrateLong pair,
// minus the wx name. Native goes through the fjs.vibrate host module
// (HapticFeedback in flutter_fjs); the web falls to navigator.vibrate, with
// its real-world limits stated rather than hidden: iOS Safari does not
// implement it at all, and desktop browsers mostly ignore short pulses.
import { hasNativeHost, invokeHost } from './host';

export type FjsVibrateType = 'heavy' | 'medium' | 'light';

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[fjs] ${message}`);
}

/** Test hook. */
export function resetVibrateWarnings(): void {
  warned.clear();
}

// wx publishes intensity names, not durations; these are the conventional
// web values — light taps stay short enough to layer (a hit + a vibration
// in the same frame must not turn into one long buzz).
const SHORT_MS: Record<FjsVibrateType, number> = { light: 15, medium: 30, heavy: 50 };
const LONG_MS = 400;

function webVibrate(ms: number): void {
  // `as unknown as` rather than an intersection: lib.dom's own
  // Navigator.vibrate overloads poison the call site's resolution
  const vibrate = (navigator as unknown as {
    vibrate?: (pattern: number | number[]) => boolean;
  }).vibrate;
  if (typeof vibrate === 'function') {
    vibrate.call(navigator, ms);
    return;
  }
  warnOnce(
    'no-vibrate',
    'vibrate: navigator.vibrate is unavailable here (iOS Safari, desktop) — vibration is a no-op',
  );
}

/** Short vibration. `type` defaults to 'heavy', wx's default. */
export function vibrateShort(type: FjsVibrateType = 'heavy'): void {
  if (hasNativeHost) {
    try {
      invokeHost('fjs.vibrate', type);
    } catch {
      warnOnce(
        'no-vibrate-module',
        'vibrate: this host has no fjs.vibrate module — vibration is a no-op here',
      );
    }
    return;
  }
  if (typeof navigator === 'undefined') return; // worker / node-ish env
  webVibrate(SHORT_MS[type]);
}

/** Long vibration (~400 ms). */
export function vibrateLong(): void {
  if (hasNativeHost) {
    try {
      invokeHost('fjs.vibrate', 'long');
    } catch {
      warnOnce(
        'no-vibrate-module',
        'vibrate: this host has no fjs.vibrate module — vibration is a no-op here',
      );
    }
    return;
  }
  if (typeof navigator === 'undefined') return;
  webVibrate(LONG_MS);
}
