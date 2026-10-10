// The 'fjs' module on wx: the slice of the element-API surface that pages
// in scope actually import. Bigger items degrade loudly instead of silently
// — a canvas/Worker API that no-ops would leave a page permanently blank,
// which is harder to diagnose than an immediate error.
import { installFetchPolyfill } from './fetch';

export function toast(message: string): void {
  wx.showToast({ title: String(message), icon: 'none' });
}

/** App / web hand the pending UI frame to the host synchronously here. The
 * mini program has no frame of ours to hand over — setData batches on its
 * own queue — so this is a no-op kept for pages that time a mount. */
export function flushNow(): void {}

export function nowMs(): number {
  return Date.now();
}

// same shape and values as a host-less web page (host.ts): there is no
// fjs engine underneath the mini-program runtime
export const engineInfo = {
  engineId: 'none',
  abiVersion: 0,
};

export function hasNativeHost(): boolean {
  return false;
}

export function invokeHostAsync(_name: string, ..._args: unknown[]): Promise<never> {
  return Promise.reject(new Error('[fjs/wx] invokeHostAsync is not available on the mini-program target'));
}

export function setOpSink(): void {
  // no op sink on wx — nothing consumes UI ops here
}

export { fetch, AbortController } from './fetch-bridge';
export { Worker } from './worker';
export { loadCanvasImage } from './canvas';

// ---- haptics (specs/215) ----------------------------------------------------
// Built into the runtime on the other two targets; wx is the most complete
// end, so the bridge forwards to the real thing.

export function vibrateShort(type: 'heavy' | 'medium' | 'light' = 'heavy'): void {
  wx.vibrateShort({ type });
}

export function vibrateLong(): void {
  wx.vibrateLong();
}

// Audio lives in the @ufjs/audio module (it carries the audioplayers pub
// dependency, and third-party deps stay out of the core); its entry maps
// onto wx.createInnerAudioContext itself, so mp pages importing the module
// keep working with no core involvement.

installFetchPolyfill();

