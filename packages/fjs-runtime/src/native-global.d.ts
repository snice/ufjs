// The globals the native core installs into the QuickJS context.
//
// Authoritative source: packages/flutter_fjs/native/src/natives.cpp (the
// `__fjs` object) and native/src/vm.cpp (which calls __fjsDispatchEvent).
// Keep this file in step with those two — it is the only description of
// that boundary the type system gets.
//
// Nothing here exists in a browser: the web build has no engine, so `__fjs`
// is typed as possibly undefined and every use has to prove it is there.
// The runtime funnels all of it through host.ts (`hasNativeHost`, `host`,
// `invokeHost`, `nowMs`, `toast`); prefer those over touching `__fjs`.
//
// A script, not a module — no top-level import/export — so these land in
// the global scope. `var` rather than `const` because that is what makes
// them properties of globalThis in TypeScript's model, which is how they
// are really reached (and, for __fjsDispatchEvent, assigned).

interface FjsEngineInfo {
  engineId: string;
  abiVersion: number;
}

/** Values that survive the sync C ABI in v1 — see
 * docs/jsi-and-native-modules.md. */
type FjsHostValue = string | number | boolean | null;

interface FjsNativeFns {
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(id: number): void;
  /** Submits one encoded UI frame. */
  uiOps(buffer: Uint8Array): void;
  /** Calls a Dart-side host module. Synchronous: the Dart handler runs to
   * completion before this returns. */
  invokeHost(name: string, ...args: FjsHostValue[]): unknown;
  /** Binary handles (FJS_ABI_VERSION 2, spec 038): copies the bytes into
   * the VM's table and returns an int id that any host module accepts as a
   * plain scalar. */
  handleBytes(data: ArrayBuffer | ArrayBufferView): number;
  /** Copies a handle's bytes out as a fresh ArrayBuffer. Throws on an
   * unknown or already-released id — a stale id must be loud. */
  readHandleBytes(id: number): ArrayBuffer;
  /** Frees the handle's storage. Reading it afterwards throws. */
  releaseHandle(id: number): void;
  nowMs(): number;
  /** Collects now, returning the heap size on either side and the surviving
   * object count. QuickJS otherwise collects wherever an allocation happens
   * to cross its threshold, which on a busy frame is in the middle of the
   * work the user is watching. */
  gc(): { before: number; after: number; objects: number };
  toast(message: string): void;
  engine: FjsEngineInfo;
  /** libfjs-style (specs/150): routes every later uiOps frame through the
   * native style engine, which consumes the style input ops and appends the
   * styles its flush wrote. `defineMatch` gets the hits of a new match set
   * as an ArrayBuffer of int32 quadruples (rule, plain, active, hover — see
   * fjs_style.h) and returns a nonzero match id; `compute` returns the
   * result for one fjs_style_subject (parent result id 0 = root; flags bit0
   * = raw text); `styled` fires for elements taking a result flagged NOTIFY.
   * A callback must not call uiOps. Absent on hosts built before specs/150. */
  styleAttach?(
    defineMatch: (hits: ArrayBuffer) => number,
    compute: (
      element: number,
      match: number,
      parentResult: number,
      tag: number,
      defaultsId: number,
      inlineKey: number,
      flags: number,
      /** nonzero: describe this seeded result, compute nothing */
      seeded: number,
    ) => FjsNativeStyleResult,
    styled: (element: number, result: number) => void,
  ): boolean;
  styleDetach?(): void;
  /** The result id the element's style came from (0: none yet), or -1 when
   * no instance is attached — a rejected frame detaches it. */
  styleResult?(element: number): number;
  /** The element's class atoms (uint32, ascending), null when not attached. */
  styleClasses?(element: number): ArrayBuffer | null;
  /** The hits of the element's current match (int32 quadruples, as
   * defineMatch gets them), null when not attached. DevTools only. */
  styleMatchedRules?(element: number): ArrayBuffer | null;
  /** Counters since the last reset (`reset` resets after reading); null when
   * not attached. */
  styleStats?(reset?: boolean): FjsNativeStyleStats | null;
}

interface FjsNativeStyleResult {
  result: number;
  /** 1 = NOTIFY: call `styled` for every element taking this result. */
  flags?: number;
  /** JSON of the computed style, and of its :active / :hover variants. */
  style: string;
  active?: string | null;
  hover?: string | null;
}

interface FjsNativeStyleStats {
  elements: number;
  rules: number;
  recompute: number;
  matchHit: number;
  matchMiss: number;
  computeHit: number;
  computeMiss: number;
  applied: number;
  flushMs: number;
}

interface FjsNative {
  fns: FjsNativeFns;
  /** Demo natives exposed for discoverability (fibonacci). */
  natives: Record<string, (...args: unknown[]) => unknown>;
  engine: FjsEngineInfo;
}

/** Event types the native layer dispatches; 9 is a worker message, the
 * rest are node events (see FjsEvent on the Dart side). */
type FjsEventDispatcher = (
  nodeId: number,
  eventType: number,
  payload: string | null,
) => void;

declare var __fjs: FjsNative | undefined;

/** Installed by the runtime (ui/element.ts), called by the native core. */
declare var __fjsDispatchEvent: FjsEventDispatcher | undefined;

declare function requestAnimationFrame(
  callback: (time: number) => void,
): number;
declare function cancelAnimationFrame(id: number): void;
