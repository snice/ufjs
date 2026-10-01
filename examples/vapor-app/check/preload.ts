// Needs the TS style engine in the bundle: build with `fjs build --ts-style`
// (specs/172).
// The check harness decodes raw op frames by hand; the native style engine's
// input ops (0x40-0x4b) ride the same frames, so the harness runs the TS
// style engine — no style input ops, node ops only. Must set the flag
// before the runtime module inits (esbuild keeps this import first).
(globalThis as Record<string, unknown>).__fjsNativeStyle = false;
export {};
