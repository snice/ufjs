// Needs the TS style engine in the bundle: build with `fjs build --ts-style`
// (specs/172).
// specs/150: both engines, compared after every frame
(globalThis as { __fjsNativeStyle?: unknown }).__fjsNativeStyle = 'verify';
