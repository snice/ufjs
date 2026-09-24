// Which events each fjs tag EMITS on web (specs/104) — the table the Flutter
// renderer uses to decide what a handler's first argument is.
//
// Web is the reference. There an fjs tag is a Vue component: an event it
// declares in `emits` reaches the handler as the component's raw payload
// (`emit('load', json)`, `emit('tap')`), while anything else — `@click`
// above all — falls through `hostAttrs(attrs)` onto the root DOM element
// and the handler gets a real DOM event. specs/103 decided by TAG alone,
// which handed `<view @click.stop>` a bare `null` on Flutter and made
// `withModifiers` throw on `.stopPropagation()`.
//
// The decision has to use the prop name the author WROTE: the renderer
// aliases `onClick` to `onTap` (both event number 1), so after aliasing the
// two are indistinguishable.
//
// Matching is case-insensitive. Vue only routes `emit('scrolltoupper')` to
// `onScrolltoupper`, but the Flutter side also accepts spellings such as
// `onScrollToUpper` / `onLineChange` (ui/element.ts EventType), and those
// were raw payloads before this table existed — lower-casing keeps them so.
//
// Kept as a separate table instead of having the web components import it
// (specs/104 option A): web is the reference and stays untouched;
// test/event-emits.test.ts compares this table with every web component's
// real `emits`, so the two cannot drift silently.
export const WEB_EMITS: Readonly<Record<string, readonly string[]>> = {
  view: ['tap', 'longPress'],
  text: ['tap', 'longPress'],
  image: ['tap', 'longPress', 'load', 'error'],
  'inner-canvas': ['tap', 'longPress', 'resize'],
  canvas: ['resize'],
  button: ['tap', 'longPress'],
  input: ['input', 'submit', 'textChanged', 'focus', 'blur', 'linechange'],
  textarea: ['input', 'textChanged', 'confirm', 'focus', 'blur', 'linechange'],
  'scroll-view': ['tap', 'longPress', 'scroll', 'scrolltoupper', 'scrolltolower'],
  'list-view': ['scroll', 'tap', 'longPress'],
  swiper: ['pageChanged', 'change'],
  'swiper-item': ['tap', 'longPress'],
  'safe-area': ['tap', 'longPress'],
  switch: ['change', 'valueChanged'],
  checkbox: ['change', 'valueChanged'],
  radio: ['change', 'valueChanged'],
  'radio-group': ['change', 'valueChanged'],
  'checkbox-group': ['change', 'valueChanged'],
  label: ['tap', 'longPress'],
  form: ['submit', 'reset'],
  slider: ['change', 'valueChanged'],
  'picker-view': ['change', 'valueChanged'],
  picker: ['change', 'cancel', 'columnchange'],
  modal: ['modalClosed'],
  'page-container': [
    'beforeEnter',
    'enter',
    'afterEnter',
    'beforeLeave',
    'leave',
    'afterLeave',
    'clickoverlay',
  ],
  refresh: ['refresh'],
  'sticky-section': ['tap', 'longPress'],
  'sticky-header': ['tap', 'longPress', 'stickontopchange'],
  // No entry = emits nothing on web (divider, progress, picker-view-column,
  // rich-text, and `stack`, which has no web component): every handler on
  // them is a fallthrough there, so it gets the event object here too.
};

const EMPTY: ReadonlySet<string> = new Set();
const lowered = new Map<string, ReadonlySet<string>>();

/** Lower-cased names [tag] emits on web; empty for a tag with none. */
export function emitsFor(tag: string): ReadonlySet<string> {
  const names = WEB_EMITS[tag];
  if (!names) return EMPTY;
  let set = lowered.get(tag);
  if (!set) lowered.set(tag, (set = new Set(names.map((n) => n.toLowerCase()))));
  return set;
}
