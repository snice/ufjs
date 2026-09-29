// specs/150: the TS style engine, for comparison with the default (native).
// Must run before the renderer module loads (import order).
(globalThis as { __fjsNativeStyle?: unknown }).__fjsNativeStyle = false;
