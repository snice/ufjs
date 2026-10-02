// Needs the TS style engine in the bundle: build with `fjs build --ts-style`
// (specs/172).
// specs/150: must run before the renderer module loads (import order)
(globalThis as { __fjsNativeStyle?: unknown }).__fjsNativeStyle = false;
