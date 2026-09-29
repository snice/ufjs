// specs/150: these micro-benchmarks measure the TS style engine (their sinks
// swallow the frames, and some drive a StyleEngine directly); keep it on.
// Must run before the renderer module loads (import order).
(globalThis as { __fjsNativeStyle?: unknown }).__fjsNativeStyle = false;
