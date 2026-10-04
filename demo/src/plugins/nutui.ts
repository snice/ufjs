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
// specs/139 batch 1: basics
import Button from '@nutui/nutui/dist/packages/button/index.mjs';
import Cell from '@nutui/nutui/dist/packages/cell/index.mjs';
import CellGroup from '@nutui/nutui/dist/packages/cellgroup/index.mjs';
import Divider from '@nutui/nutui/dist/packages/divider/index.mjs';
import Tag from '@nutui/nutui/dist/packages/tag/index.mjs';
// specs/203 batch 2: form
import Input from '@nutui/nutui/dist/packages/input/index.mjs';
import Textarea from '@nutui/nutui/dist/packages/textarea/index.mjs';
import Switch from '@nutui/nutui/dist/packages/switch/index.mjs';
import Checkbox from '@nutui/nutui/dist/packages/checkbox/index.mjs';
import CheckboxGroup from '@nutui/nutui/dist/packages/checkboxgroup/index.mjs';
import Radio from '@nutui/nutui/dist/packages/radio/index.mjs';
import RadioGroup from '@nutui/nutui/dist/packages/radiogroup/index.mjs';
import Rate from '@nutui/nutui/dist/packages/rate/index.mjs';
import InputNumber from '@nutui/nutui/dist/packages/inputnumber/index.mjs';
import SearchBar from '@nutui/nutui/dist/packages/searchbar/index.mjs';
// display
import Badge from '@nutui/nutui/dist/packages/badge/index.mjs';
import Progress from '@nutui/nutui/dist/packages/progress/index.mjs';
import CircleProgress from '@nutui/nutui/dist/packages/circleprogress/index.mjs';
import Skeleton from '@nutui/nutui/dist/packages/skeleton/index.mjs';
import Empty from '@nutui/nutui/dist/packages/empty/index.mjs';
import Noticebar from '@nutui/nutui/dist/packages/noticebar/index.mjs';
import Image from '@nutui/nutui/dist/packages/image/index.mjs';
import CountDown from '@nutui/nutui/dist/packages/countdown/index.mjs';
// nav / layout
import Grid from '@nutui/nutui/dist/packages/grid/index.mjs';
import GridItem from '@nutui/nutui/dist/packages/griditem/index.mjs';
import Tabs from '@nutui/nutui/dist/packages/tabs/index.mjs';
import TabPane from '@nutui/nutui/dist/packages/tabpane/index.mjs';
import Steps from '@nutui/nutui/dist/packages/steps/index.mjs';
import Step from '@nutui/nutui/dist/packages/step/index.mjs';
import Pagination from '@nutui/nutui/dist/packages/pagination/index.mjs';
import Swiper from '@nutui/nutui/dist/packages/swiper/index.mjs';
import SwiperItem from '@nutui/nutui/dist/packages/swiperitem/index.mjs';
// float
import Popup from '@nutui/nutui/dist/packages/popup/index.mjs';
import Overlay from '@nutui/nutui/dist/packages/overlay/index.mjs';
import Dialog from '@nutui/nutui/dist/packages/dialog/index.mjs';
import Toast from '@nutui/nutui/dist/packages/toast/index.mjs';

// static style imports, same as the component imports above: the app build
// turns each `.css` in the chain into a registerStyles() call (vue-plugin.ts
// onLoad); a dynamic import() there would drop the styles with no error
import '@nutui/nutui/dist/packages/button/style/css.mjs';
import '@nutui/nutui/dist/packages/cell/style/css.mjs';
import '@nutui/nutui/dist/packages/cellgroup/style/css.mjs';
import '@nutui/nutui/dist/packages/divider/style/css.mjs';
import '@nutui/nutui/dist/packages/tag/style/css.mjs';
import '@nutui/nutui/dist/packages/input/style/css.mjs';
import '@nutui/nutui/dist/packages/textarea/style/css.mjs';
import '@nutui/nutui/dist/packages/switch/style/css.mjs';
import '@nutui/nutui/dist/packages/checkbox/style/css.mjs';
import '@nutui/nutui/dist/packages/checkboxgroup/style/css.mjs';
import '@nutui/nutui/dist/packages/radio/style/css.mjs';
import '@nutui/nutui/dist/packages/radiogroup/style/css.mjs';
import '@nutui/nutui/dist/packages/rate/style/css.mjs';
import '@nutui/nutui/dist/packages/inputnumber/style/css.mjs';
import '@nutui/nutui/dist/packages/searchbar/style/css.mjs';
import '@nutui/nutui/dist/packages/badge/style/css.mjs';
import '@nutui/nutui/dist/packages/progress/style/css.mjs';
import '@nutui/nutui/dist/packages/circleprogress/style/css.mjs';
import '@nutui/nutui/dist/packages/skeleton/style/css.mjs';
import '@nutui/nutui/dist/packages/empty/style/css.mjs';
import '@nutui/nutui/dist/packages/noticebar/style/css.mjs';
import '@nutui/nutui/dist/packages/image/style/css.mjs';
import '@nutui/nutui/dist/packages/countdown/style/css.mjs';
import '@nutui/nutui/dist/packages/grid/style/css.mjs';
import '@nutui/nutui/dist/packages/griditem/style/css.mjs';
import '@nutui/nutui/dist/packages/tabs/style/css.mjs';
import '@nutui/nutui/dist/packages/tabpane/style/css.mjs';
import '@nutui/nutui/dist/packages/steps/style/css.mjs';
import '@nutui/nutui/dist/packages/step/style/css.mjs';
import '@nutui/nutui/dist/packages/pagination/style/css.mjs';
import '@nutui/nutui/dist/packages/swiper/style/css.mjs';
import '@nutui/nutui/dist/packages/swiperitem/style/css.mjs';
import '@nutui/nutui/dist/packages/popup/style/css.mjs';
import '@nutui/nutui/dist/packages/overlay/style/css.mjs';
import '@nutui/nutui/dist/packages/dialog/style/css.mjs';
import '@nutui/nutui/dist/packages/toast/style/css.mjs';

export default (app: App) => {
  app.use(Button);
  app.use(Cell);
  app.use(CellGroup);
  app.use(Divider);
  app.use(Tag);
  app.use(Input);
  app.use(Textarea);
  app.use(Switch);
  app.use(Checkbox);
  app.use(CheckboxGroup);
  app.use(Radio);
  app.use(RadioGroup);
  app.use(Rate);
  app.use(InputNumber);
  app.use(SearchBar);
  app.use(Badge);
  app.use(Progress);
  app.use(CircleProgress);
  app.use(Skeleton);
  app.use(Empty);
  app.use(Noticebar);
  app.use(Image);
  app.use(CountDown);
  app.use(Grid);
  app.use(GridItem);
  app.use(Tabs);
  app.use(TabPane);
  app.use(Steps);
  app.use(Step);
  app.use(Pagination);
  app.use(Swiper);
  app.use(SwiperItem);
  app.use(Popup);
  app.use(Overlay);
  app.use(Dialog);
  app.use(Toast);
};
