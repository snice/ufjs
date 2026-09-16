// Web implementations of the fjs built-in tags.
//
// The contract these mirror is flutter_fjs's widget layer (widgets.dart):
// same tag names, same props, and — importantly — the same event payloads.
// Every fjs event crosses the JSI boundary as a string, so `@change` hands
// a page `"1"` / `"0"` on Flutter; the web components emit exactly that,
// which is what lets one page component run unchanged on both platforms.
//
// One file per group, with `gestures.ts` holding what they share:
//
//   basic.ts    view / text / stack / safe-area / scroll-view / image /
//               button / divider
//   form.ts     input / switch / checkbox / radio / the two groups /
//               label / form / slider / progress
//   scope.ts    the registry the groups, label and form share (its Dart
//               twin is widgets/control_scope.dart)
//   picker-view  picker-view.ts — the web wheel; `picker` itself has no web
//               file, it is ../../components/picker.ts on both platforms
//   swiper.ts   swiper
//   overlay.ts  refresh / modal
//   list-view   list-view.ts — the web one is a windowed virtual list; the
//               Flutter renderer mounts ../../components/list-view.ts, which
//               leaves the windowing to ListView.builder.
import { FjsCanvasSurface } from './canvas';
import { FjsListView } from './list-view';
import {
  FjsButton,
  FjsDivider,
  FjsImage,
  FjsSafeArea,
  FjsScrollView,
  FjsSwiperItem,
  FjsText,
  FjsView,
} from './basic';
import {
  FjsCheckbox,
  FjsCheckboxGroup,
  FjsForm,
  FjsInput,
  FjsLabel,
  FjsProgress,
  FjsRadio,
  FjsRadioGroup,
  FjsSlider,
  FjsSwitch,
} from './form';
import { FjsModal, FjsRefresh } from './overlay';
import { FjsPageContainer } from './page-container';
import { FjsPickerView, FjsPickerViewColumn } from './picker-view';
import { FjsStickyHeader, FjsStickySection } from './sticky';
import { createFjsCanvas } from '../../components/canvas';
import { FjsPicker } from '../../components/picker';
import { FjsRichText } from '../../components/rich-text';
import { createFjsTextarea } from '../../components/textarea';
import { FjsSwiper } from './swiper';
import { normalizeStyleValues } from '../style';

/** Tags handled here. The SFC compiler is told these are components, not
 * native elements — several of them (`text`, `image`, `switch`) would
 * otherwise compile as SVG/HTML elements. */
export { FJS_TAGS } from '../../tags';

/** Same component as the Flutter path, pointed at the web adapter's input:
 * the defaults, the prop normalization and the `@linechange` gate all come
 * from one file (components/textarea.ts), only the render target differs. */
const FjsWebTextarea = createFjsTextarea(FjsInput);

export const fjsComponents: Record<string, unknown> = {
  view: FjsView,
  text: FjsText,
  // Same component the Flutter path registers (components/rich-text.ts):
  // parsing and layout are one implementation; the nested-text paragraph
  // it relies on is base-css.ts's `text text` rule here.
  'rich-text': FjsRichText,
  image: FjsImage,
  // the drawing surface: a real <canvas> with dpr sizing and the shared
  // getContext registry (web/components/canvas.ts)
  'inner-canvas': FjsCanvasSurface,
  // …and the box around it, the same component the Flutter path mounts —
  // one implementation, two substrates (components/canvas.ts)
  canvas: createFjsCanvas(FjsCanvasSurface, FjsView),
  button: FjsButton,
  input: FjsInput,
  textarea: FjsWebTextarea,
  'scroll-view': FjsScrollView,
  'list-view': FjsListView,
  swiper: FjsSwiper,
  // No behaviour of its own: a page is a page with or without the wrapper
  // (spec 009 Q2). Registered so it is not treated as an unknown tag.
  'swiper-item': FjsSwiperItem,
  'safe-area': FjsSafeArea,
  divider: FjsDivider,
  progress: FjsProgress,
  switch: FjsSwitch,
  checkbox: FjsCheckbox,
  radio: FjsRadio,
  'radio-group': FjsRadioGroup,
  'checkbox-group': FjsCheckboxGroup,
  label: FjsLabel,
  form: FjsForm,
  slider: FjsSlider,
  'picker-view': FjsPickerView,
  'picker-view-column': FjsPickerViewColumn,
  // Same component the Flutter path registers (components/picker.ts): the
  // sheet is pure orchestration, so there is only one implementation.
  picker: FjsPicker,
  modal: FjsModal,
  'page-container': FjsPageContainer,
  refresh: FjsRefresh,
  // specs/052: the sticky pair. The section is a plain block (CSS sticky
  // takes its bounds from the parent box); the header carries the pin line
  // and the stickontopchange measurement.
  'sticky-section': FjsStickySection,
  'sticky-header': FjsStickyHeader,
};

export { normalizeStyleValues };
