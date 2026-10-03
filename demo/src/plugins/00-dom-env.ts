// The window/document shim must be evaluated before every library plugin:
// the 'fjs/plugins' barrel imports plugin files alphabetically, and NutUI's
// raf module reads `window` at top level (raf-c01wDYCo.js: `const _window =
// window`), so nutui.ts's component imports used to run before vant.ts got
// to install the shim. The plugin body is a no-op — the import IS the
// setup; vant.ts keeps its own import, which is a no-op afterwards.
// (specs/203)
import './vant/dom-env';

export default () => {};
