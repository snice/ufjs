// `fjs/vapor` for web in enableVapor mode (specs/166): the DOM backend and
// the helper surface with the VDOM interop left out — no `createRenderer`,
// no adopt machinery, so runtime-core's renderer engine never enters the
// bundle. The CLI's webAliases point `fjs/vapor` here under enableVapor;
// `enableVapor` apps cannot mount VDOM components (documented in
// specs/166 §3) — the backend has no `mountVdomComponent`, and the runtime
// says so plainly if a page tries.
export * from './web-dom';
