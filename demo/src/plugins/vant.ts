// Vant, registered globally per component. One plugin for BOTH platforms —
// no suffix: `.app.ts`/`.web.ts` would silently skip the other side and
// pages would hit "Failed to resolve component: van-*" there.
//
// The style imports feed both ends: the browser loads them as CSS, the fjs
// app build turns each one into a registerStyles() call (vue-plugin.ts), so
// they live here next to the registration — one list to keep in sync.
// The template names are typed by src/vant-components.d.ts, which must list
// the same components (specs/068-demo-vant, specs/069-vant-compat-gaps).
import type { App } from 'vue';
import {
  ActionSheet,
  Badge,
  Button,
  Card,
  Cell,
  CellGroup,
  Checkbox,
  CheckboxGroup,
  Circle,
  Collapse,
  CollapseItem,
  CountDown,
  Dialog,
  Divider,
  Empty,
  Field,
  Grid,
  GridItem,
  NavBar,
  NoticeBar,
  NumberKeyboard,
  Picker,
  Popup,
  Progress,
  Radio,
  RadioGroup,
  Rate,
  Search,
  Sidebar,
  SidebarItem,
  Skeleton,
  Slider,
  Step,
  Stepper,
  Steps,
  Swipe,
  SwipeItem,
  Switch,
  Tab,
  Tabbar,
  TabbarItem,
  Tabs,
  Tag,
  TextEllipsis,
} from 'vant';
import 'vant/es/action-sheet/style/index.mjs';
import 'vant/es/badge/style/index.mjs';
import 'vant/es/button/style/index.mjs';
import 'vant/es/card/style/index.mjs';
import 'vant/es/cell-group/style/index.mjs';
import 'vant/es/cell/style/index.mjs';
import 'vant/es/checkbox-group/style/index.mjs';
import 'vant/es/checkbox/style/index.mjs';
import 'vant/es/circle/style/index.mjs';
import 'vant/es/collapse-item/style/index.mjs';
import 'vant/es/collapse/style/index.mjs';
import 'vant/es/count-down/style/index.mjs';
import 'vant/es/dialog/style/index.mjs';
import 'vant/es/divider/style/index.mjs';
import 'vant/es/empty/style/index.mjs';
import 'vant/es/field/style/index.mjs';
import 'vant/es/grid-item/style/index.mjs';
import 'vant/es/grid/style/index.mjs';
import 'vant/es/nav-bar/style/index.mjs';
import 'vant/es/notice-bar/style/index.mjs';
import 'vant/es/number-keyboard/style/index.mjs';
import 'vant/es/picker/style/index.mjs';
import 'vant/es/popup/style/index.mjs';
import 'vant/es/progress/style/index.mjs';
import 'vant/es/radio-group/style/index.mjs';
import 'vant/es/radio/style/index.mjs';
import 'vant/es/rate/style/index.mjs';
import 'vant/es/search/style/index.mjs';
import 'vant/es/sidebar-item/style/index.mjs';
import 'vant/es/sidebar/style/index.mjs';
import 'vant/es/skeleton/style/index.mjs';
import 'vant/es/slider/style/index.mjs';
import 'vant/es/step/style/index.mjs';
import 'vant/es/stepper/style/index.mjs';
import 'vant/es/steps/style/index.mjs';
import 'vant/es/swipe-item/style/index.mjs';
import 'vant/es/swipe/style/index.mjs';
import 'vant/es/switch/style/index.mjs';
import 'vant/es/tab/style/index.mjs';
import 'vant/es/tabbar-item/style/index.mjs';
import 'vant/es/tabbar/style/index.mjs';
import 'vant/es/tabs/style/index.mjs';
import 'vant/es/tag/style/index.mjs';
import 'vant/es/text-ellipsis/style/index.mjs';
import 'vant/es/toast/style/index.mjs';

export default (app: App) => {
  app.use(ActionSheet);
  app.use(Badge);
  app.use(Button);
  app.use(Card);
  app.use(Cell);
  app.use(CellGroup);
  app.use(Checkbox);
  app.use(CheckboxGroup);
  app.use(Circle);
  app.use(Collapse);
  app.use(CollapseItem);
  app.use(CountDown);
  app.use(Dialog);
  app.use(Divider);
  app.use(Empty);
  app.use(Field);
  app.use(Grid);
  app.use(GridItem);
  app.use(NavBar);
  app.use(NoticeBar);
  app.use(NumberKeyboard);
  app.use(Picker);
  app.use(Popup);
  app.use(Progress);
  app.use(Radio);
  app.use(RadioGroup);
  app.use(Rate);
  app.use(Search);
  app.use(Sidebar);
  app.use(SidebarItem);
  app.use(Skeleton);
  app.use(Slider);
  app.use(Step);
  app.use(Stepper);
  app.use(Steps);
  app.use(Swipe);
  app.use(SwipeItem);
  app.use(Switch);
  app.use(Tab);
  app.use(Tabbar);
  app.use(TabbarItem);
  app.use(Tabs);
  app.use(Tag);
  app.use(TextEllipsis);
};
