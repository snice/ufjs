import type { StyleValue } from '@vue/runtime-core';
import type { FjsTouchEvent } from './ui/touch';
import type { FjsImageSrc } from './assets';
// The canvas surface is a real module type (canvas/types.ts) so a page can
// import it too — it doubles as the compatibility list in type form.
import type { FjsCanvasApi } from './canvas/types';
import type { RichTextNode, RichTextSpace } from './rich-text/types';
import '@vue/runtime-core';
import 'vue';

type FjsScalar = string | number | boolean;
type FjsNumberish = number | `${number}`;
type FjsBooleanish = boolean | 'true' | 'false';

/** One variant of a directive-driven animation (the `v-motion` shape): a
 * style/transform key-value map plus an optional `transition` config.
 * Structural on purpose — a page should not need to import the directive
 * library's types to typecheck. */
type FjsVariant = Record<string, unknown> & { transition?: Record<string, unknown> };

interface FjsBaseProps {
  id?: string;
  /** Template ref. Every tag can take one; `canvas` is the first that gives
   * a page something to call on it (getContext). */
  ref?: unknown;
  class?: unknown;
  style?: StyleValue;
  key?: string | number | symbol;
  // Directive-owned variant props (the `v-motion` pattern:
  // `:variants` / `:initial` / `:enter` / ...). They are read from
  // vnode.props by the DIRECTIVE, never by the element — the renderer just
  // forwards them like any prop and the native side ignores the unknown
  // keys. Declared on every tag (a directive can sit on any element) and
  // structurally typed, so a template with such a directive typechecks
  // without importing the directive library's types — the same keys the
  // library itself augments HTMLAttributes with on the DOM.
  variants?: FjsVariant;
  initial?: FjsVariant;
  enter?: FjsVariant;
  leave?: FjsVariant;
  visible?: FjsVariant;
  visibleOnce?: FjsVariant;
  hovered?: FjsVariant;
  tapped?: FjsVariant;
  focused?: FjsVariant;
}

interface FjsTapEvents {
  onTap?: () => void;
  onClick?: () => void;
  onLongPress?: () => void;
}

/** The DOM touch contract, on every tag that can be touched. Declare
 * `touch-action: none` (or pan-x / pan-y) in the node's style to keep an
 * enclosing scroller from taking the gesture over. */
interface FjsTouchEvents {
  onTouchstart?: (event: FjsTouchEvent) => void;
  onTouchmove?: (event: FjsTouchEvent) => void;
  onTouchend?: (event: FjsTouchEvent) => void;
  onTouchcancel?: (event: FjsTouchEvent) => void;
}

type FjsContainerProps = FjsBaseProps & FjsTapEvents & FjsTouchEvents;

interface FjsSafeAreaProps extends FjsContainerProps {
  /** Which edges take the system insets, space-separated: `"top"`,
   * `"top bottom"`… Omitted means all four (SafeArea's default). A navbar
   * takes `top`, a bottom bar `bottom`. */
  edges?: string;
}

interface FjsDefaultSlots {
  default?: () => unknown;
}

type FjsComponent<Props, Slots = FjsDefaultSlots> = {
  new (): {
    $props: Props;
    $slots: Slots;
  };
};

interface FjsImageProps extends FjsContainerProps {
  /** Suggests this project's images (generated into src/fjs-assets.d.ts)
   * without rejecting an http URL, an imported asset's hashed path, or a
   * src built at runtime. */
  src?: FjsImageSrc;
  /** Explicit mode wins over the legacy fit prop. */
  mode?:
    | 'scaleToFill'
    | 'aspectFit'
    | 'aspectFill'
    | 'widthFix'
    | 'heightFix'
    | 'top'
    | 'bottom'
    | 'center'
    | 'left'
    | 'right'
    | 'top left'
    | 'top right'
    | 'bottom left'
    | 'bottom right';
  /** Legacy compatibility prop; ignored when mode is present. */
  fit?: 'fill' | 'contain' | 'cover' | string;
  lazyLoad?: FjsBooleanish;
  onLoad?: (payload: string) => void;
  onError?: (payload: string) => void;
}

interface FjsButtonProps extends FjsContainerProps {
  disabled?: FjsBooleanish;
  /** default（描边）/ primary / warn；`plain` 是同色描边版。 */
  type?: 'default' | 'primary' | 'warn';
  size?: 'default' | 'mini';
  plain?: FjsBooleanish;
  /** 转圈期间不派发 @tap。 */
  loading?: FjsBooleanish;
  /** 点它就触发最近祖先 <form> 的 submit / reset。 */
  formType?: 'submit' | 'reset';
}

interface FjsInputProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsScalar;
  placeholder?: string;
  secure?: FjsBooleanish;
  multiline?: FjsBooleanish;
  disabled?: FjsBooleanish;
  keyboard?: 'text' | 'number' | 'decimal' | 'tel' | 'email' | string;
  /** 超长直接截断；-1（默认）不限。 */
  maxlength?: FjsNumberish;
  /** 表单里的字段名，<form> 的 @submit 用它当键。 */
  name?: string;
  onInput?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onTextChanged?: (value: string) => void;
  /** 载荷是当前文本。 */
  onFocus?: (value: string) => void;
  onBlur?: (value: string) => void;
  /** 下面四个由 input / textarea 共用的原生 widget 实现，`textarea` 是它们的
   * 规范入口（docs/ui-api.md），但写在 `<input multiline>` 上同样生效。 */
  autoHeight?: FjsBooleanish;
  focus?: FjsBooleanish;
  autoFocus?: FjsBooleanish;
  confirmType?: 'send' | 'search' | 'next' | 'go' | 'done' | 'return';
  /** 只认 color / font-size / font-weight / line-height 四个键。 */
  placeholderStyle?: string;
  /** 行数变化时派一次，载荷是 {"height":n,"lineCount":n}。 */
  onLinechange?: (payload: string) => void;
}

/** 多行输入。是 JS 组件（components/textarea.ts），渲染成 `<input multiline>`，
 * 所以 props 是 input 的子集加上 textarea 自己的默认值（maxlength 默认 140）。 */
interface FjsTextareaProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsScalar;
  placeholder?: string;
  /** 只认 color / font-size / font-weight / line-height 四个键。 */
  placeholderStyle?: string;
  disabled?: FjsBooleanish;
  /** 超长直接截断；-1 不限。**默认 140**，和 input 的 -1 不同（照小程序）。 */
  maxlength?: FjsNumberish;
  /** 高度跟着内容长，style.height 被忽略。 */
  autoHeight?: FjsBooleanish;
  /** 受控焦点：false → true 抢焦点，true → false 失焦。 */
  focus?: FjsBooleanish;
  autoFocus?: FjsBooleanish;
  /** 键盘右下角按键。`return` 时按键就是换行，不派 @confirm。 */
  confirmType?: 'send' | 'search' | 'next' | 'go' | 'done' | 'return';
  name?: string;
  onInput?: (value: string) => void;
  onTextChanged?: (value: string) => void;
  /** confirm-type != return 时按下确认键；载荷是当前文本。 */
  onConfirm?: (value: string) => void;
  onFocus?: (value: string) => void;
  onBlur?: (value: string) => void;
  /** 载荷 {"height":n,"lineCount":n}，只有行数变化才派。 */
  onLinechange?: (payload: string) => void;
}

/** 富文本。是 JS 组件（components/rich-text.ts）：解析、白名单、默认样式都在 JS，
 * 渲染成 view / text / image / divider。内部节点不派事件，组件自身的 @tap 照常。 */
interface FjsRichTextProps extends FjsContainerProps {
  /** HTML 字符串或节点数组（小程序的形状）。非白名单标签连同子树删除并告警。 */
  nodes?: string | readonly RichTextNode[];
  /** 不设时连续空白折叠成一个；设了之后每个空格都保留。 */
  space?: RichTextSpace;
  /** 不支持，写 true 会告警。 */
  userSelect?: FjsBooleanish;
  /** Skyline 专属，只认 default，其余告警。 */
  mode?: string;
}

/** checkbox / radio / switch：`value` 恒为控件自身的选中态，`name` 是它在
 * <radio-group> / <checkbox-group> / <form> 里的标识。 */
interface FjsChoiceProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsBooleanish;
  disabled?: FjsBooleanish;
  name?: string;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

/** radio-group 的 @change 载荷是选中项的 name（无选中为空串）；
 * checkbox-group 的是选中项 name 的 JSON 数组串，按文档顺序。 */
interface FjsGroupProps extends FjsContainerProps {
  name?: string;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

/** 点 label 区域内任意位置，把点击转给目标控件：有 `for` 找 id 相同的那个，
 * 没有就取子树里第一个控件。checkbox / radio / switch 是切换，input 是聚焦。 */
interface FjsLabelProps extends FjsContainerProps {
  for?: string;
}

/** @submit 载荷是 {name: value} 的 JSON 串，收集子树里所有带 name 的控件；
 * @reset 无载荷，值的回滚由页面做。 */
interface FjsFormProps extends FjsContainerProps {
  onSubmit?: (value: string) => void;
  onReset?: () => void;
}

/** 首屏优先：插槽内容在页面转场结束（onPageSettled）后才挂载，之前只有一个
 * 占位盒子。挂上之后不留包裹层——插槽内容直接是父元素的孩子。 */
interface FjsDeferProps {
  /** 挂载前占位的高度（px，数字或 '120px'），避免补挂时滚动位置跳动。默认 0。 */
  placeholderHeight?: number | string;
  'placeholder-height'?: number | string;
}

interface FjsSliderProps extends FjsBaseProps, FjsTouchEvents {
  name?: string;
  value?: FjsNumberish;
  min?: FjsNumberish;
  max?: FjsNumberish;
  step?: FjsNumberish;
  disabled?: FjsBooleanish;
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

interface FjsProgressProps extends FjsBaseProps, FjsTouchEvents {
  value?: FjsNumberish;
  type?: 'linear' | 'circular' | string;
}

/** 页面内滚动容器。方向：`scroll-x` / `scroll-y` 优先，没写时回落到样式键
 * `direction: horizontal`（两者在不同的层，见 docs/ui-api.md）。 */
interface FjsScrollViewProps extends FjsContainerProps {
  scrollX?: FjsBooleanish;
  scrollY?: FjsBooleanish;
  /** 设置滚动位置；受控但不粘手——只有这个值变化时才跳。 */
  scrollTop?: FjsNumberish;
  scrollLeft?: FjsNumberish;
  /** 滚到 id 等于它的子节点。找不到会告警。 */
  scrollIntoView?: string;
  /** 上面两种跳变是否走动画。 */
  scrollWithAnimation?: FjsBooleanish;
  /** 距顶/底多远算触边，默认 50。 */
  upperThreshold?: FjsNumberish;
  lowerThreshold?: FjsNumberish;
  /** 小程序 skyline 的 sticky 宿主写法（specs/052）。app / web 端接受并忽略
   * ——出现 sticky 子节点即自动走吸顶布局。 */
  type?: string;
  /** 载荷是 `{scrollTop,scrollLeft,scrollHeight,scrollWidth,deltaX,deltaY}`
   * 的 JSON 串，一帧最多一次。 */
  onScroll?: (detail: string) => void;
  /** 进入阈值区时各派一次；待在区里不重复，离开再回来才重派。 */
  onScrolltoupper?: () => void;
  onScrolltolower?: () => void;
}

/** 吸顶布局（specs/052）：必须是 scroll-view 的直接子节点。 */
interface FjsStickyHeaderProps extends FjsContainerProps {
  /** 吸顶时距滚动视口顶部的距离（px）。 */
  offsetTop?: FjsNumberish;
  /** 小程序原生属性，app / web 端接受但 v1 不生效。 */
  allowOverlapping?: FjsBooleanish;
  padding?: unknown;
  /** 载荷是 `{"isStickOnTop":bool}` 的 JSON 串，状态翻转才派一次。 */
  onStickontopchange?: (detail: string) => void;
}

interface FjsStickySectionProps extends FjsContainerProps {
  /** 默认 true（组内吸顶元素互推）；app / web 端接受，差异见 docs/ui-api.md。 */
  pushPinnedHeader?: FjsBooleanish;
}

interface FjsSwiperProps extends FjsContainerProps {
  /** 受控页码；改它就翻过去，动画时长取 `duration`。 */
  current?: FjsNumberish;
  autoplay?: FjsBooleanish;
  /** 自动翻页间隔，默认 5000。 */
  interval?: FjsNumberish;
  /** 滑动动画时长，默认 500。 */
  duration?: FjsNumberish;
  /** 末页翻回首页。`@change` 派的始终是真实索引。 */
  circular?: FjsBooleanish;
  vertical?: FjsBooleanish;
  indicatorDots?: FjsBooleanish;
  indicatorColor?: string;
  indicatorActiveColor?: string;
  /** 索引串。 */
  onChange?: (index: string) => void;
  onPageChanged?: (index: string) => void;
}

interface FjsListViewProps<T = unknown> extends FjsContainerProps {
  items?: T[];
  itemHeight?: FjsNumberish;
  preloadExtent?: FjsNumberish;
  prefetchExtent?: FjsNumberish;
  onScroll?: (offset: string) => void;
}

interface FjsListViewSlots<T = unknown> {
  default?: (props: { item: T; index: number }) => unknown;
}

/** Declared as a generic function component (the shape Vue Language Tools
 * keeps generic) so the row slot's `item` follows the element type of
 * `items` instead of collapsing to `unknown`. */
type FjsListViewComponent = <T>(
  props: FjsListViewProps<T>,
  ctx?: unknown,
) => {
  __ctx?: {
    attrs?: unknown;
    slots?: FjsListViewSlots<T>;
    emit?: unknown;
    props?: FjsListViewProps<T>;
    expose?: (exposed: unknown) => void;
  };
};

/** 页面内嵌的滚轮。只认 <picker-view-column> 子节点，其它节点不渲染（会告警）。 */
interface FjsPickerViewProps extends FjsContainerProps {
  /** 每列选中项的下标；越界取该列最后一项。 */
  value?: number[];
  /** 中间选中框的样式，支持 height / border / background-color。 */
  indicatorStyle?: string;
  /** 行高，默认 44。两端同值。 */
  itemHeight?: FjsNumberish;
  /** 载荷是下标数组的 JSON 串，如 `[0,2]`；滚动停下才派发。 */
  onChange?: (value: string) => void;
  onValueChanged?: (value: string) => void;
}

type FjsPickerMode = 'selector' | 'multiSelector' | 'time' | 'date';

/** 从底部弹起的选择器。插槽内容就是页面上那一行，点它弹出。
 *
 * 这是个 JS 组件（components/picker.ts），不是 Dart 标签：弹层开合、列生成、
 * 值换算都是编排（宪法 VII）。 */
interface FjsPickerProps extends FjsContainerProps {
  mode?: FjsPickerMode;
  /** selector 的下标 / multiSelector 的下标数组 / time 的 "hh:mm" /
   * date 的 "YYYY-MM-DD"。 */
  value?: FjsNumberish | number[] | string;
  /** selector 是一维、multiSelector 是二维；对象数组配 rangeKey 使用。 */
  range?: readonly unknown[];
  rangeKey?: string;
  /** time / date 的有效范围。 */
  start?: string;
  end?: string;
  /** date 的粒度。 */
  fields?: 'year' | 'month' | 'day';
  disabled?: FjsBooleanish;
  /** 确定时派发；载荷格式随 mode，见 docs/ui-api.md。 */
  onChange?: (value: string) => void;
  /** 取消或蒙层关闭。 */
  onCancel?: () => void;
  /** multiSelector 某列变化，载荷 `{"column":0,"value":2}`。 */
  onColumnchange?: (value: string) => void;
}

interface FjsModalProps extends FjsBaseProps, FjsTouchEvents {
  visible?: FjsBooleanish;
  onModalClosed?: () => void;
}

/** 页面容器（specs/065）：遮罩 + 四向弹出面板的"假页"容器，返回操作
 * （右滑/物理返回）关闭容器而非页面。三端实现不同、契约一致，差异表见
 * docs/ui-api.md。 */
interface FjsPageContainerProps extends FjsBaseProps, FjsTouchEvents {
  /** 是否显示容器。显隐由页面状态驱动；返回手势/下滑关闭后，页面靠
   * @after-leave 把它归位 false。 */
  show?: FjsBooleanish;
  /** 进出场动画时长 ms，默认 300。 */
  duration?: FjsNumberish;
  /** 层级，默认 100。Flutter 端只按路由顺序；wx 同样限定每页一个容器。 */
  zIndex?: FjsNumberish;
  /** 是否显示遮罩，默认 true。 */
  overlay?: FjsBooleanish;
  /** 弹出位置：top / bottom（默认）/ right / center。未知值告警并按 bottom。 */
  position?: 'top' | 'bottom' | 'right' | 'center' | (string & {});
  /** 面板圆角。 */
  round?: FjsBooleanish;
  /** 下滑（position=right 时为右滑）一段距离后关闭，默认 false。 */
  closeOnSlideDown?: FjsBooleanish;
  /** 遮罩自定义样式（css 文本，同小程序的 overlay-style）。 */
  overlayStyle?: string;
  /** 面板自定义样式（css 文本，同小程序的 custom-style）。 */
  customStyle?: string;
  /** 下面七个都是无载荷的生命周期/遮罩事件（模板写 @before-enter、
   * @clickoverlay）；所有关闭路径都会走完离场链，@after-leave 是页面把
   * show 归位的挂点。 */
  onBeforeEnter?: () => void;
  onEnter?: () => void;
  onAfterEnter?: () => void;
  onBeforeLeave?: () => void;
  onLeave?: () => void;
  onAfterLeave?: () => void;
  onClickoverlay?: () => void;
  onClickOverlay?: () => void;
}

interface FjsRefreshProps extends FjsBaseProps, FjsTouchEvents {
  onRefresh?: () => void;
}

interface FjsCanvasProps extends FjsBaseProps, FjsTapEvents, FjsTouchEvents {
  /** Overlay content: ordinary fjs nodes drawn ON the canvas rather than in
   * it — a tooltip, a legend, a loading mask. Position them with
   * `position: absolute`; the canvas box is their containing block. */
  /** The box was laid out or resized; payload is `{"width":n,"height":n}` in
   * logical pixels. On Flutter this is the FIRST moment a canvas has a size
   * — `onMounted` is too early there — so a page that draws relative to its
   * box should draw here on both platforms. */
  onResize?: (payload: string) => void;
  /** Hold the FIRST `@resize` until this page's route transition has
   * finished. Off by default.
   *
   * Turn it on when the work that `@resize` kicks off is expensive enough to
   * drop frames — a chart, a WebGL scene. Three F2 charts cost ~210ms of
   * first paint and, without this, that lands on the frames the Navigator is
   * animating (specs/027). The cost is a transition's worth of blank canvas,
   * which is why a cheap canvas (a sparkline, a signature pad) should leave
   * it off. Later resizes are never deferred. */
  'defer-resize'?: boolean | '';
  deferResize?: boolean | '';
}

type FjsCanvasComponent = {
  new (): {
    $props: FjsCanvasProps;
    $slots: FjsDefaultSlots;
  } & FjsCanvasApi;
};

interface FjsGlobalComponents {
  view: FjsComponent<FjsContainerProps>;
  View: FjsComponent<FjsContainerProps>;
  text: FjsComponent<FjsContainerProps>;
  Text: FjsComponent<FjsContainerProps>;
  'rich-text': FjsComponent<FjsRichTextProps>;
  RichText: FjsComponent<FjsRichTextProps>;
  image: FjsComponent<FjsImageProps>;
  Image: FjsComponent<FjsImageProps>;
  canvas: FjsCanvasComponent;
  Canvas: FjsCanvasComponent;
  /** The drawing surface `canvas` wraps. A page writes `<canvas>`; this is
   * declared so the compiler and the IDE do not type it from the DOM. */
  'inner-canvas': FjsComponent<FjsBaseProps>;
  button: FjsComponent<FjsButtonProps>;
  Button: FjsComponent<FjsButtonProps>;
  input: FjsComponent<FjsInputProps>;
  Input: FjsComponent<FjsInputProps>;
  textarea: FjsComponent<FjsTextareaProps>;
  Textarea: FjsComponent<FjsTextareaProps>;
  'scroll-view': FjsComponent<FjsScrollViewProps>;
  ScrollView: FjsComponent<FjsScrollViewProps>;
  'list-view': FjsListViewComponent;
  ListView: FjsListViewComponent;
  swiper: FjsComponent<FjsSwiperProps>;
  Swiper: FjsComponent<FjsSwiperProps>;
  'swiper-item': FjsComponent<FjsContainerProps>;
  SwiperItem: FjsComponent<FjsContainerProps>;
  /** z-order container: children stack on top of each other, later ones
   * on top. Alignment within the box follows align-items/justify-content. */
  stack: FjsComponent<FjsContainerProps>;
  Stack: FjsComponent<FjsContainerProps>;
  'sticky-header': FjsComponent<FjsStickyHeaderProps>;
  StickyHeader: FjsComponent<FjsStickyHeaderProps>;
  'sticky-section': FjsComponent<FjsStickySectionProps>;
  StickySection: FjsComponent<FjsStickySectionProps>;
  'safe-area': FjsComponent<FjsSafeAreaProps>;
  SafeArea: FjsComponent<FjsSafeAreaProps>;
  divider: FjsComponent<FjsBaseProps & FjsTouchEvents>;
  Divider: FjsComponent<FjsBaseProps & FjsTouchEvents>;
  progress: FjsComponent<FjsProgressProps>;
  Progress: FjsComponent<FjsProgressProps>;
  switch: FjsComponent<FjsChoiceProps>;
  Switch: FjsComponent<FjsChoiceProps>;
  checkbox: FjsComponent<FjsChoiceProps>;
  Checkbox: FjsComponent<FjsChoiceProps>;
  radio: FjsComponent<FjsChoiceProps>;
  Radio: FjsComponent<FjsChoiceProps>;
  'radio-group': FjsComponent<FjsGroupProps>;
  RadioGroup: FjsComponent<FjsGroupProps>;
  'checkbox-group': FjsComponent<FjsGroupProps>;
  CheckboxGroup: FjsComponent<FjsGroupProps>;
  label: FjsComponent<FjsLabelProps>;
  Label: FjsComponent<FjsLabelProps>;
  form: FjsComponent<FjsFormProps>;
  Form: FjsComponent<FjsFormProps>;
  defer: FjsComponent<FjsDeferProps>;
  Defer: FjsComponent<FjsDeferProps>;
  slider: FjsComponent<FjsSliderProps>;
  Slider: FjsComponent<FjsSliderProps>;
  'picker-view': FjsComponent<FjsPickerViewProps>;
  PickerView: FjsComponent<FjsPickerViewProps>;
  'picker-view-column': FjsComponent<FjsContainerProps>;
  PickerViewColumn: FjsComponent<FjsContainerProps>;
  picker: FjsComponent<FjsPickerProps>;
  Picker: FjsComponent<FjsPickerProps>;
  modal: FjsComponent<FjsModalProps>;
  Modal: FjsComponent<FjsModalProps>;
  'page-container': FjsComponent<FjsPageContainerProps>;
  PageContainer: FjsComponent<FjsPageContainerProps>;
  refresh: FjsComponent<FjsRefreshProps>;
  Refresh: FjsComponent<FjsRefreshProps>;
}

declare module 'vue' {
  export interface GlobalComponents {
    view: FjsGlobalComponents['view'];
    View: FjsGlobalComponents['View'];
    text: FjsGlobalComponents['text'];
    Text: FjsGlobalComponents['Text'];
    'rich-text': FjsGlobalComponents['rich-text'];
    RichText: FjsGlobalComponents['RichText'];
    image: FjsGlobalComponents['image'];
    Image: FjsGlobalComponents['Image'];
    canvas: FjsGlobalComponents['canvas'];
    Canvas: FjsGlobalComponents['Canvas'];
    'inner-canvas': FjsGlobalComponents['inner-canvas'];
    button: FjsGlobalComponents['button'];
    Button: FjsGlobalComponents['Button'];
    input: FjsGlobalComponents['input'];
    Input: FjsGlobalComponents['Input'];
    textarea: FjsGlobalComponents['textarea'];
    Textarea: FjsGlobalComponents['Textarea'];
    'scroll-view': FjsGlobalComponents['scroll-view'];
    ScrollView: FjsGlobalComponents['ScrollView'];
    'list-view': FjsGlobalComponents['list-view'];
    ListView: FjsGlobalComponents['ListView'];
    swiper: FjsGlobalComponents['swiper'];
    Swiper: FjsGlobalComponents['Swiper'];
    'swiper-item': FjsGlobalComponents['swiper-item'];
    SwiperItem: FjsGlobalComponents['SwiperItem'];
    stack: FjsGlobalComponents['stack'];
    Stack: FjsGlobalComponents['Stack'];
    'sticky-header': FjsGlobalComponents['sticky-header'];
    StickyHeader: FjsGlobalComponents['StickyHeader'];
    'sticky-section': FjsGlobalComponents['sticky-section'];
    StickySection: FjsGlobalComponents['StickySection'];
    'safe-area': FjsGlobalComponents['safe-area'];
    SafeArea: FjsGlobalComponents['SafeArea'];
    divider: FjsGlobalComponents['divider'];
    Divider: FjsGlobalComponents['Divider'];
    progress: FjsGlobalComponents['progress'];
    Progress: FjsGlobalComponents['Progress'];
    switch: FjsGlobalComponents['switch'];
    Switch: FjsGlobalComponents['Switch'];
    checkbox: FjsGlobalComponents['checkbox'];
    Checkbox: FjsGlobalComponents['Checkbox'];
    radio: FjsGlobalComponents['radio'];
    Radio: FjsGlobalComponents['Radio'];
    'radio-group': FjsGlobalComponents['radio-group'];
    RadioGroup: FjsGlobalComponents['RadioGroup'];
    'checkbox-group': FjsGlobalComponents['checkbox-group'];
    CheckboxGroup: FjsGlobalComponents['CheckboxGroup'];
    label: FjsGlobalComponents['label'];
    Label: FjsGlobalComponents['Label'];
    form: FjsGlobalComponents['form'];
    Form: FjsGlobalComponents['Form'];
    defer: FjsGlobalComponents['defer'];
    Defer: FjsGlobalComponents['Defer'];
    slider: FjsGlobalComponents['slider'];
    Slider: FjsGlobalComponents['Slider'];
    'picker-view': FjsGlobalComponents['picker-view'];
    PickerView: FjsGlobalComponents['PickerView'];
    'picker-view-column': FjsGlobalComponents['picker-view-column'];
    PickerViewColumn: FjsGlobalComponents['PickerViewColumn'];
    picker: FjsGlobalComponents['picker'];
    Picker: FjsGlobalComponents['Picker'];
    modal: FjsGlobalComponents['modal'];
    Modal: FjsGlobalComponents['Modal'];
    'page-container': FjsGlobalComponents['page-container'];
    PageContainer: FjsGlobalComponents['PageContainer'];
    refresh: FjsGlobalComponents['refresh'];
    Refresh: FjsGlobalComponents['Refresh'];
  }
}

declare module '@vue/runtime-core' {
  export interface GlobalComponents {
    view: FjsGlobalComponents['view'];
    View: FjsGlobalComponents['View'];
    text: FjsGlobalComponents['text'];
    Text: FjsGlobalComponents['Text'];
    'rich-text': FjsGlobalComponents['rich-text'];
    RichText: FjsGlobalComponents['RichText'];
    image: FjsGlobalComponents['image'];
    Image: FjsGlobalComponents['Image'];
    canvas: FjsGlobalComponents['canvas'];
    Canvas: FjsGlobalComponents['Canvas'];
    'inner-canvas': FjsGlobalComponents['inner-canvas'];
    button: FjsGlobalComponents['button'];
    Button: FjsGlobalComponents['Button'];
    input: FjsGlobalComponents['input'];
    Input: FjsGlobalComponents['Input'];
    textarea: FjsGlobalComponents['textarea'];
    Textarea: FjsGlobalComponents['Textarea'];
    'scroll-view': FjsGlobalComponents['scroll-view'];
    ScrollView: FjsGlobalComponents['ScrollView'];
    'list-view': FjsGlobalComponents['list-view'];
    ListView: FjsGlobalComponents['ListView'];
    swiper: FjsGlobalComponents['swiper'];
    Swiper: FjsGlobalComponents['Swiper'];
    'safe-area': FjsGlobalComponents['safe-area'];
    SafeArea: FjsGlobalComponents['SafeArea'];
    divider: FjsGlobalComponents['divider'];
    Divider: FjsGlobalComponents['Divider'];
    progress: FjsGlobalComponents['progress'];
    Progress: FjsGlobalComponents['Progress'];
    switch: FjsGlobalComponents['switch'];
    Switch: FjsGlobalComponents['Switch'];
    checkbox: FjsGlobalComponents['checkbox'];
    Checkbox: FjsGlobalComponents['Checkbox'];
    slider: FjsGlobalComponents['slider'];
    Slider: FjsGlobalComponents['Slider'];
    modal: FjsGlobalComponents['modal'];
    Modal: FjsGlobalComponents['Modal'];
    'page-container': FjsGlobalComponents['page-container'];
    PageContainer: FjsGlobalComponents['PageContainer'];
    refresh: FjsGlobalComponents['refresh'];
    Refresh: FjsGlobalComponents['Refresh'];
  }
}

export {};
