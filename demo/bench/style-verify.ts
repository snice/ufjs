// Needs the TS style engine in the bundle: build with `fjs build --ts-style`
// (specs/172).
// specs/150: both style engines, every element compared after every frame.
// Must run before the renderer module loads (import order).
(globalThis as { __fjsNativeStyle?: unknown }).__fjsNativeStyle = 'verify';
