// specs/150: must run before the renderer module loads (import order)
(globalThis as { __fjsNativeStyle?: unknown }).__fjsNativeStyle = false;
