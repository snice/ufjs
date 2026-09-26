// NutUI 4, registered globally per component — the same shape as ./vant.ts,
// and for the same reason no platform suffix: both ends must register.
//
// Per-component entries (`dist/packages/<comp>/index.mjs`), NOT the
// `@nutui/nutui` barrel: the barrel statically imports all ~80 components,
// so the app would evaluate every one of them at startup (any top-level DOM
// access in one breaks the whole app) and carry them all in the bundle.
// For the same reason @nutui/nutui is not listed in `fjs.shared` — that
// imports the package by name, i.e. the barrel (specs/139 plan §3.1).
//
// `style/css.mjs` is NutUI's own per-component style entry: its reset.css
// (one `html {}` rule — nothing matches it on the app) plus the component's
// index.css. The app build turns each CSS import into registerStyles().
// Theme values are `var(--nut-x, fallback)` inline, no `:root` needed.
//
// Icons are inline-SVG components from @nutui/icons-vue, imported by the
// pages that use them (NutUI's documented usage); style_icon.css sizes them.
// Template names are typed by src/nutui-components.d.ts — keep it in sync.
import type { App } from 'vue';
import Button from '@nutui/nutui/dist/packages/button/index.mjs';
import Cell from '@nutui/nutui/dist/packages/cell/index.mjs';
import CellGroup from '@nutui/nutui/dist/packages/cellgroup/index.mjs';
import Divider from '@nutui/nutui/dist/packages/divider/index.mjs';
import Tag from '@nutui/nutui/dist/packages/tag/index.mjs';
import '@nutui/icons-vue/dist/style_icon.css';
import '@nutui/nutui/dist/packages/button/style/css.mjs';
import '@nutui/nutui/dist/packages/cell/style/css.mjs';
import '@nutui/nutui/dist/packages/cellgroup/style/css.mjs';
import '@nutui/nutui/dist/packages/divider/style/css.mjs';
import '@nutui/nutui/dist/packages/tag/style/css.mjs';

export default (app: App) => {
  app.use(Button);
  app.use(Cell);
  app.use(CellGroup);
  app.use(Divider);
  app.use(Tag);
};
