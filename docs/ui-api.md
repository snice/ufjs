# UI API 参考

> 第二层第 2 篇。标签、事件、样式的**完整清单**。
> 样式的支持边界（哪些 CSS 属性/选择器能用）在
> [css-compat.md](css-compat.md)；实现原理在
> [custom-renderer.md](custom-renderer.md)。

fjs 用 HTML 风格的语义标签构建 UI，由 Dart 侧映射为 Flutter Widget，
由 [`web/components/`](../packages/fjs-runtime/src/web/components/) 映射为
浏览器上的 Vue 组件。标签既可用于 element API，也可用于 Vue 模板。小程序端
由编译期标签映射直出（同名标签、内置 class 或 runtime 组件），映射表与已知
差异见 [miniprogram.md](miniprogram.md)。

标签清单的唯一来源是
[`tags.json`](../packages/fjs-runtime/src/tags.ts)，组件 d.ts 和 Volar
数据都从它生成。

## 标签全集

| 标签 | Flutter 映射 | props / 事件 |
|------|--------------|--------------|
| `view` | Flex + 容器装饰 | 默认**纵向** flex（注意和 CSS 的 `row` 默认值不同）|
| `text` | Text；有子节点时是 `Text.rich` | 文本由 setText 或子文本节点设置。**`text` 里嵌的 `text` 是同一段落里的行内片段**（各自的颜色 / 字号 / 字重 / 装饰线 / 背景色），其余子节点（`image`、`view`）是行内块，底边落在基线上。片段上的 margin / padding / border / 宽高无效（两端都是）；`text-align` / `max-lines` / `white-space` 只认最外层。片段上的 `@tap` / `@click` 两端都能点（App 上是片段自己的识别器，片段里的子片段继承它，同 DOM 冒泡；specs/128） |
| `image` | Image（`src` 是 http(s) 走 `cached_network_image`，本地图走 dev server / Flutter asset）| `src`（三种写法见下）、`mode`（14 个，见下表）、`lazy-load`、`fit`（旧写法）；`@load` / `@error`。详见下表 |
| `canvas` | **不是 Dart 标签**：两端共用 `components/canvas.ts`，渲染成 `view` + 绘制面 `inner-canvas`（后者才是 CustomPaint）| `ref` 拿到 `getContext('2d')` / `toDataURL()` / 只读的 `width` / `height`（逻辑像素）；`@resize`；`defer-resize` 把首次 `@resize` 推迟到路由转场结束（默认关，首帧贵的图表才开）；**默认插槽是画布上方的 overlay**（tooltip、图例…）。支持范围见 [canvas-compat.md](canvas-compat.md) |
| `button` | TextButton（Material 自带的 chrome 全部关掉）| 文本取子 text 节点；自带按下态；`type`(default/primary/warn) / `size`(default/mini) / `plain` / `loading` / `disabled` / `form-type`(submit/reset) |
| `input` | TextField | `value` / `placeholder` / `secure` / `multiline` / `readonly`(只读，可聚焦但不可编辑) / `disabled`(禁用，不可聚焦) / `rows`(多行行数) / `keyboard`(text/number/decimal/tel/email) / DOM 别名 `type`(password/tel/email/url/number/search)、`inputmode`(numeric/decimal/tel/email/url)、`enterkeyhint`(同 `confirm-type`)——优先级 `keyboard` > `inputmode` > `type`，`secure` 或 `type=password` 即遮挡（vant Field 走的就是这组，specs/125） / `maxlength`(-1 不限) / `name`，`onTextChanged` / `onSubmit` / `onFocus` / `onBlur`；多行那组 props 见 `textarea` |
| `textarea` | **不是 Dart 标签**：两端共用 `components/textarea.ts`，渲染成 `<input multiline>` | `value` / `placeholder` / `placeholder-style` / `disabled` / `maxlength`(**默认 140**) / `auto-height` / `focus` / `auto-focus` / `confirm-type` / `name`；`@input` / `@focus` / `@blur` / `@confirm` / `@linechange`。详见下表 |
| `rich-text` | **不是 Dart 标签**：两端共用 `components/rich-text.ts`，把 HTML 解析后渲染成 `view` / `text` / `image` / `divider` | `nodes`（HTML 字符串或小程序节点数组）/ `space`(ensp/emsp/nbsp)；内部节点不派事件，组件自身的 `@tap` / `@longpress` 照常。详见下表 |
| `scroll-view` | SingleChildScrollView | `scroll-x` / `scroll-y` 选轴（也可用样式键 `direction: horizontal`）、`scroll-top` / `scroll-left`、`scroll-into-view`、`scroll-with-animation`、`upper-threshold` / `lower-threshold`（默认 50）；`@scroll`（六字段 JSON 串）/ `@scrolltoupper` / `@scrolltolower`。详见下表 |
| `sticky-header` / `sticky-section` | PinnedHeaderSliver + SliverMainAxisGroup（挂在 sliver 化的 CustomScrollView 上）| 吸顶布局，对齐微信 skyline 同名组件。必须作为 scroll-view 的**直接子节点**（此时该 scroll-view 自动走 sliver 布局；`type="custom"` 属性可写可不写，会被接受并忽略）。`@stickontopchange` 载荷 `{"isStickOnTop":bool}` JSON 串。详见下表 |
| `list-view` | ListView.builder | 大列表；`items` + 行插槽，两端都只挂载视口附近的行 |
| `switch` | Switch | `value`，`onValueChanged("1"/"0")` |
| `checkbox` | Checkbox | `value`，`onValueChanged`；`name` 是它在组/表单里的标识 |
| `radio` | 自绘圆形控件（不用 Material Radio，避免 40px 点击区）| 同 checkbox；点已选中的不会取消 |
| `radio-group` | 容器 + 控件作用域 | 组内互斥；`onValueChanged` 载荷是选中项的 `name`（无选中为空串）|
| `checkbox-group` | 容器 + 控件作用域 | `onValueChanged` 载荷是选中项 `name` 的 JSON 数组串，按文档顺序 |
| `label` | 容器 + 点击转发 | `for` 指向控件的 `id`，没有就取子树第一个控件；checkbox/radio/switch 是切换，input 是聚焦；没有子节点时渲染自己的文本 |
| `form` | **不是 Dart 标签**：两端都由 JS 组件实现（Flutter 走 `components/form.ts`，web 走 `web/components/form.ts`），渲染成一个 `view` | `@submit` 载荷是 `{name: value}` JSON 串，子树里每个带 `name` 的控件都在（未改动的也带默认值），值取控件当前态——未受控的输入框也算；`@reset` 只发事件，**值的回滚归页面**，所以进表单的字段都该绑 `:value`，没绑的页面清不掉。配 `<button form-type="submit">` / `="reset"` |
| `defer` | **不是 Dart 标签**：两端都由 JS 组件实现（`components/defer.ts`，web 走 `web/components/defer.ts`），挂上之后**不留包裹层** | 首屏优先：插槽内容等页面转场结束（[`onPageSettled`](#页面onpagesettled)）才挂载，之前只渲染一个占位盒子；`placeholder-height`（px，数字或 `'120px'`）给占位定高，补挂时滚动条不跳。只包首屏以下的内容，见[下文](#首屏优先defer) |
| `slider` | Slider | `value` / `min` / `max` / `name`，`onValueChanged`（两位小数的数值串）|
| `progress` | Linear/CircularProgressIndicator | `value`(0-1)，缺省为 indeterminate；`type: circular` |
| `divider` | Divider | `color` / `height` |
| `safe-area` | SafeArea | `edges`：只让出列出的边，空格分隔（`"top"`、`"top bottom"`…），缺省四边全让。导航栏用 `top`、底栏用 `bottom` |
| `picker-view` | 一行 `ListWheelScrollView`（每列一个）| `value` 是各列选中下标的数组（越界取末项）、`item-height`（默认 44）、`indicator-style`；滚动停下派 `@change`，载荷是下标数组的 JSON 串。只认 `picker-view-column` 子节点，其余会告警并丢弃 |
| `picker-view-column` | 一列的选项容器 | 子节点即选项 |
| `picker` | **不是 Dart 标签**：两端共用 `components/picker.ts`，渲染成 `modal` + `picker-view` + 两个 `button` | 插槽内容是页面上那一行，点它弹出；确定派 `@change`、取消/蒙层关闭派 `@cancel`；`disabled` 不弹。四种 `mode` 见下表 |
| `refresh` | RefreshIndicator | `onRefresh`（600ms 后自动收起）|
| `swiper` | PageView | `current`、`circular`、`autoplay` + `interval`、`duration`、`vertical`、`indicator-dots`；`@change`（真实索引串）。详见下表 |
| `swiper-item` | 撑满一页的容器 | 只在 `swiper` 内有意义 |
| `picker-view` | ListWheelScrollView 行 | 内嵌滚轮；`value` 是每列选中下标数组；`item-height` 默认 44；`indicator-style` 覆盖选中框；`onValueChanged` 载荷是下标数组 JSON 串 |
| `picker-view-column` | picker-view 的一列 | 只在 `picker-view` 内有滚轮语义；子节点即选项 |
| `modal` | BottomSheet | `visible` 驱动：true 打开、置回 false 关闭；原生手势关闭回派 `onModalClosed`；打开期间内容保持响应式更新（事件仍回派）|
| `fjs-overlay-host` | **运行时保留，页面不要手写**：`OverlayPortal`，子树画在 Navigator 的 Overlay、紧贴本页之上（specs/069 contract.md）| renderer 第一次遇到 `position: fixed` 元素时惰性创建，fixed 元素整体挪进来：不随页面滚动、随页面转场（specs/133）、按 `z-index` 叠放。宿主里有全屏遮罩时页面的系统返回被拦截（`modal` 属性，由运行时写）。谁会进来、模态判定、写法约束见 **[overlay-host.md](overlay-host.md)**。旧宿主不认识这个标签时按普通 `view` 兜底 |
| `page-container` | 原生标签：route 级透明路由（遮罩 + 面板），返回手势关闭的是容器 | `show` / `duration`(300) / `z-index`(100) / `overlay`(true) / `position`(bottom/top/right/center) / `round` / `close-on-slide-down`；生命周期 `@before-enter` → `@enter` → `@after-enter`，离场链 `@before-leave` → `@leave` → `@after-leave`（**所有**关闭路径都走完），点遮罩派 `@clickoverlay`（不自动关）。详见下表 |
| 自定义标签 | `engine.registerComponent` 注册的 Dart 组件（platform view 也经此接入）| 任意 props；未注册回落 `view` |

`<button>` 的默认描边、`type` 的配色、`radio` 的圆圈都是**宿主的默认值**
（`widgets/button.dart` / `widgets/radio.dart` 与 web 的 `.fjs-button--*` /
`.fjs-radio` 取同一组数值）；页面自己写的 `border` / `background-color` 照旧盖过
它们。配色跟已发布的控件走 iOS 蓝 `#007AFF`（warn 是 `#FF3B30`），按下态仍是
WeUI 的 10% 黑遮罩 —— 取舍写在 `specs/007-form-components/plan.md` §3.6。

### image

| prop | 说明 |
|---|---|
| `src` | 见下面「src 的三种写法」。空串不发请求也不派事件。换 `src` 就是新的一轮加载，旧请求的结果不会回派到新 `src` 上 |
| `mode` | 14 个值，默认 `scaleToFill`。**不认识的值会告警并降级**，不静静回落 |
| `lazy-load` | 进入可视区域附近才请求。两端用同一个预加载余量 240px（`fjs-runtime/src/image/lazy.ts`：web 传给 IntersectionObserver 当 `rootMargin`，Flutter 拿它比对 viewport），所以同一页在两端是在同一个滚动位置开始加载的。离开视口不取消已发出的请求，再进来复用结果 |
| `fit` | 旧写法，只在**没写** `mode` 时才读。两个都写以 `mode` 为准 |

| mode | 语义 | Flutter | web |
|---|---|---|---|
| `scaleToFill`（默认）| 拉伸填满，不保持比例 | `BoxFit.fill` | `object-fit: fill` |
| `aspectFit` | 保持比例完整显示，盒子留白 | `BoxFit.contain` | `contain` |
| `aspectFill` | 保持比例填满，超出裁掉 | `BoxFit.cover` | `cover` |
| `widthFix` | 宽度按样式走，高度按原图比例算 | `SizedBox(w, w / ratio)` | `height: auto` |
| `heightFix` | **样式里声明了 `width` 就以宽为准**（此时与 `widthFix` 同解），没声明 `width` 才以高为准、宽度按比例算——与微信小程序实拍一致 | 声明了宽 `SizedBox(w, w / ratio)`，否则 `SizedBox(h * ratio, h)` | 不覆盖 width（`align-self: flex-start` 先离开列向拉伸），量到用宽后把 `height` 钉成 `w / ratio`；页面 CSS 本来就给出这个高时不干预 |
| `top` / `bottom` / `center` / `left` / `right` | **不缩放**：按对齐开一个 1:1 原图窗口，超出盒子的部分裁掉（微信「不缩放，仅显示顶部区域」这类语义） | `BoxFit.none` + `Alignment` | `object-fit: none` + `object-position` |
| `top left` / `top right` / `bottom left` / `bottom right` | 同上，窗口贴对应角 | 同上 | 同上 |

`widthFix` / `heightFix` 要拿到原图 intrinsic 尺寸才能定另一边：图还没到时先按样式
给的那一边撑出一个有限的占位盒（`width` 和 `height` 都声明时就是页面自己的盒子），
metadata 一到再换成真实比例，父布局不会抖。样式里没给那一边的尺寸（`widthFix`
却没写 `width`）就退化成普通内容盒，并 `warnOnce` 说明。九个位置类 mode 与
`heightFix` 的宽优先规则都是照微信小程序实拍对齐的（`specs/102-image-mode-wechat-parity`）。

> **首参形状（specs/103、104）**：看事件，不只看标签，以 web 为准。
> fjs 标签在 web 上 `emits` 的事件（下表里的 `@tap` / `@load` / `@input` /
> `@change` / `@scroll`……）首参是**裸载荷**（字符串 / 数字 / 无参），
> `JSON.parse(payload)` 直接可用；其余事件——尤其是 fjs 标签上的 `@click`
> ——在 web 上透传到根 DOM 元素，首参是**事件对象**（`detail` / `target` /
> `clientX` / `stopPropagation`），所以 `@click.stop` / `.prevent` 两端都能用。
> 绑在**非 fjs 标签**（如 vant 的 `div`）上的事件一律是事件对象。
> 每个标签 emit 哪些事件见 `fjs-runtime/src/event-emits.ts`。
> 已知限制：`@tap.stop` 两端都不可用（`tap` 是无参 emit）。

| 事件 | 载荷 | 次数 |
|---|---|---|
| `@load` | `{"width":600,"height":400}`，字段顺序固定，是**原图像素**尺寸，不带单位 | 当前 `src` 成功后一次 |
| `@error` | `{"errMsg":"image load failed"}` | 当前 `src` 失败后一次 |

#### src 的三种写法

一份源码要在浏览器和 App 上都能取到同一张图，所以本地图片统一是**根绝对路径**，
剩下的事交给宿主（specs/017-local-image-assets）。

| 写什么 | 打包器给出的 src | web 从哪取 | Flutter 从哪取 |
|--------|------------------|-----------|----------------|
| `import png from '@/assets/x.png'` | `/assets/x-<hash>.png` | 站点根 | 连着 `fjs dev` 时问 dev server，否则 `assets/fjs/public/assets/x-<hash>.png` |
| `src="/images/x.png"`（`public/` 下的文件） | 原样 | 站点根 | 同上，release 时是 `assets/fjs/public/images/x.png` |
| `src="https://…"` | 原样 | `<img>`，缓存交给浏览器 | `cached_network_image`，带内存/磁盘缓存 |
| `src="data:image/…;base64,…"` | 原样 | `<img>`，浏览器原生解码 | `MemoryImage`（spec 023：给内存中的字节一条进宿主解码器的路，three.js 的 createImageBitmap 走它）|

`asset://x` 是旧写法，等价于 `/x`，两端都还认。

**编辑器会提示有哪些**：`fjs` 把 `public/` 和 `html/` 扫成
`src/fjs-assets.d.ts`（生成物，别手改），`<image src>` 输入 `/` 就列出项目里的
图片，`<web-view src>` 列出 `html/` 下的页面 —— 两个标签各查各的表，互不串门。

类型上仍然接受任意字符串（否则 http URL、`import` 来的哈希名、模板串拼的 src 全
要误报），所以**打错字不是类型错误**。查错由构建期那条检查负责：写死的本地 src
指向不存在的文件时 `fjs build` 会 warn 并给出最接近的候选。动态 `:src` 不参与
检查，宁可漏报也不误报。

**不要写相对路径**（`images/x.png`、`./x.png`）：在浏览器上它按当前路由解析，
`/comp/image` 这一页会去要 `/comp/images/x.png`；Flutter 侧会 warn 一次并按根路径处理。

`public/` 会**整个目录**进 App 包（包括只给 web 用的文件），见
[toolchain.md](toolchain.md)。`.svg` 只有 web 侧能显示，Flutter 侧 warn + `@error`，
见 [web.md](web.md)。

两个事件互斥，同一轮加载只会有一个，组件重建也不会补派；两端的载荷**逐字符相同**
（编码在 `fjs-runtime/src/image/events.ts`，Dart 侧 `widgets/image.dart` 用同一份格式）。
平台原始异常不会跨桥——`errMsg` 是固定文案，免得同一个错误在两端因为异常类名不同
给出不一样的字符串。没有监听器时图片照样加载和缓存，不会因为没人听就改变画面。

### canvas

页面拿到的是 web 那套 `CanvasRenderingContext2D`——同名同签名，一份绘制代码两端都跑：

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { FjsCanvasApi } from 'fjs';

const cv = ref<FjsCanvasApi>();
onMounted(() => {
  const ctx = cv.value?.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#07c160';
  ctx.fillRect(20, 20, 120, 60);
});
</script>

<template><canvas ref="cv" class="cv" /></template>
<style scoped>.cv { width: 100%; height: 200px; }</style>
</script>
```

三条和 DOM 不一样的地方，其余细节全在
[canvas-compat.md](canvas-compat.md)：

| | 说明 |
|---|---|
| 尺寸 | `width` / `height` 是**只读的逻辑像素布局尺寸**，由样式决定；不是位图尺寸。设备像素由宿主处理，**页面不用乘 devicePixelRatio** |
| `getContext` | `'2d'` 内置；`'webgl'` / `'webgl2'` 需安装 [`@ufjs/webgl`](../packages/fjs-webgl) 模块并 import（spec 022）。webgl 坐标是位图像素（页面自己处理 dpr），支持范围见 [canvas-compat.md](canvas-compat.md)；未安装或其余类型返回 `null` 并告警一次 |
| 读回 | `toDataURL()` 返回 **Promise**；`getImageData` 不支持 |
| 首次绘制 | 按尺寸画就写在 `@resize` 里（载荷 `{"width":n,"height":n}`）：App 侧 `onMounted` 时 canvas 还没有尺寸 |

绘制是保留式的：画完的东西留着，直到覆盖整块画布的 `clearRect(0, 0, width,
height)`。每帧重画的页面按 web 的常规写法先清一次即可。

事件用通用触摸事件；自己处理手势的 canvas 记得写 `touch-action: none`。
命中测试用触点的 **`offsetX` / `offsetY`**（相对本元素左上角），
不要用 `clientX` / `clientY`（那是页面坐标）。

### web-view（模块 `@ufjs/webview`）

嵌一张网页。**它不是内置标签**，要先装：

```bash
pnpm add @ufjs/webview
```

装上即用，没有第二步（autolink）。做成模块而不是内置标签是因为
`webview_flutter` 要求 Dart SDK ^3.5，而 `flutter_fjs` 声明的是 >=3.3——内置的话
所有不用它的应用都要跟着抬下限。

| prop | 说明 |
|---|---|
| `src` | `http(s)://` 外部网页；`asset://<path>` 加载模块自带的页面（见下）。其它 scheme（`file:` / `javascript:` / `data:` / `about:`）`warnOnce` 后不加载——两端可用性差太远，给了就是不可移植的坑。空 `src` 渲染空盒子、不发请求 |

| 事件 | 载荷 |
|---|---|
| `@load` | `{"src":"https://example.com/a"}` |
| `@error` | `{"src":"…","errMsg":"web-view load failed"}` |
| `@message` | `{"data":"网页传来的字符串"}` |

`@load` / `@error` 互斥，同一次加载只派一个；换 `src` 后旧页面的结果不会回派。
`errMsg` 是固定文案——WKWebView 和浏览器的错误串完全不同，放进契约等于没有契约。

**布局：它是普通盒子。** 小程序规定 `web-view` 自动铺满整页、覆盖其他组件、每页只能
有一个，**fjs 不跟**：`width` / `height` / `flex-grow` 都算数，一页放几个都行。想要
小程序那种效果写 `flex-grow: 1`。没有任何尺寸时渲染零高盒子并告警——网页没有天然
高度，猜一个只会得到所有人都意外的数字。

**`@message` 立即派。** 小程序把消息攒成数组，只在后退 / 组件销毁 / 分享 / 复制链接时
一次性交给 `bind:message`；fjs 每调一次派一次。实时双向才是这个能力的正常用法，而且
「分享」「复制链接」这两个时机 fjs 根本没有，照搬只会得到一个残缺的状态机。

**网页那一侧怎么发消息**：调 `fjs.postMessage('…')`。App 上这个对象由宿主注入；
浏览器里跨源 iframe 注入不了脚本，所以网页要自带 5 行 shim：

```js
window.fjs = window.fjs || {
  postMessage: (data) => parent.postMessage({ __fjs: String(data) }, '*'),
};
```

网页也可以靠 `window.fjs` 在 shim 之前是否已存在，判断自己跑在 App 里还是浏览器里
（对应小程序的 `window.__wxjs_environment`）。

**两个 JS 世界互不相通**：网页里没有 fjs 的 natives，`import { toast } from 'fjs'`
不存在也不会有，唯一的通道就是 `@message` 的字符串。

`src` 有三种写法：

| 写什么 | 是什么 | 放哪 |
|--------|--------|------|
| `https://…` | 外部网页 | — |
| `/html/guide.html` | **app 自己的页面** | 项目根的 `html/`，唯一位置 |
| `asset://demo.html` | **模块自带的页面** | 模块自己的 `public/` |

后两种都是本地文件，但来源不同，所以解析也不同。别写相对路径（`guide.html`）：
两端都会判成 `unsupported`，`warnOnce` 之后什么都不加载。

**`/html/…`**：app 自己写的页面，走的是和本地图片同一条根路径约定（017）：

| 场景 | 解析成 |
|---|---|
| app dev | `http://<devHost>/html/guide.html`（dev server 提供）|
| app release | Flutter asset `assets/fjs/public/html/guide.html` |
| web | `/html/guide.html`（构建把 `html/` 拷进站点根）|

**`asset://`**：模块可以带 `public/`，页面永远只写 `asset://demo.html`，三处各自解析：

| 场景 | 解析成 |
|---|---|
| app dev | `http://<devHost>/modules/webview/demo.html`（dev server 提供）|
| app release | Flutter asset `assets/fjs/modules/webview/demo.html` |
| web | `/fjs-modules/webview/demo.html`（fjs 的 vite 插件与 web 构建提供）|

release 下 Flutter asset 的**键**不能带查询串，但 `asset://` 页面仍然可以带参数：
实现会用不含 `?` / `#` 的路径查找 bundle asset，再在同一份本地页面 URL 上恢复 query
和 fragment。页面可以照常读取 `location.search` / `location.hash`，相对资源路径也不变。
因此 `asset://demo.html?q=1#top` 在 dev、release、web 三处都能传参；只有非法路径仍会
`warnOnce` 后不加载。

链接里有中文时自己 `encodeURIComponent`——iOS 上未编码的中文链接会白屏，这条和小程序
一样。另外：在 **iOS 模拟器**上，网页里的中文可能显示成豆腐块，那是模拟器 web content
进程的字体回退问题（页面的 font stack 别以 `-apple-system` / `system-ui` 开头就好），
和编码、和 fjs 都无关，真机不受影响。

### textarea

多行输入。它是 JS 组件（宪法 VII），渲染成一个 `<input multiline>`：`tags.json` 里
没有 `textarea`，两端也没有第二个原生实现。

| prop | 默认 | 说明 |
|---|---|---|
| `value` | — | 受控值，和 `input` 一样「受控但不粘手」 |
| `placeholder` / `placeholder-style` | — | `placeholder-style` 只认 `color` / `font-size` / `font-weight` / `line-height` 四个键，其余键 `warnOnce` 后忽略 |
| `disabled` | `false` | 不可编辑 |
| `maxlength` | **`140`** | 超长直接截断；`-1` 不限。**和 `input` 的默认值（-1）不同**，这是照小程序取的 |
| `auto-height` | `false` | `true` 时高度跟着内容长，`style.height` 被忽略；`false` 时高度由样式决定，没写就是**三行**（Flutter `maxLines: 3` / web `rows="3"`，跟着字号走），内容超出**在框里滚动** |
| `focus` / `auto-focus` | `false` | 受控焦点：只有 `false → true` 才抢焦点。用户点走造成的失焦不回写 prop，也不会因为 prop 还是 `true` 就把焦点抢回来。两个同时写以 `focus` 为准并告警 |
| `confirm-type` | `return` | 键盘右下角按键：`send` / `search` / `next` / `go` / `done` / `return`。`return` 时按键就是换行，**不派** `@confirm`；其余五个按下时派 `@confirm` 且不插入换行。未知值告警后按 `return` |
| `name` | — | 表单字段名，`<form>` 的 `@submit` 用它当键 |

| 事件 | 载荷 |
|---|---|
| `@input` / `@text-changed` | 当前文本。与 `input` 逐字节相同 |
| `@focus` / `@blur` | 当前文本，一次转换一条 |

**点外面失焦**（specs/124）：输入框聚焦时，点页面上**没有事件处理的地方**
（空白、静态文字）会失焦、派 `@blur`、收起键盘，与浏览器一致。点带
`@tap` / `@click` / `@touch*` 的节点或 button / switch 等控件**不失焦**——事件
归页面处理，要收键盘自己调 `blur()`（vant 清除图标因此清空后仍保持焦点）。
拖动、滚动不失焦。
| `@confirm` | 当前文本。复用 `FJS_EVENT_TEXT_SUBMITTED`(4)——它就是 `input` 的 `@submit` 在多行下的名字 |
| `@linechange` | `{"height":68,"lineCount":3}`，字段顺序固定；`height` 是**内容**高（不是盒子高），一位小数 |

`@linechange` 只在**行数变化**时派：同一行数内继续输入不重复派，首帧的初始行数也不派
（和 scroll-view 的到边事件同一套「进入才派」语义，写在
`fjs-runtime/src/textarea/lines.ts`）。载荷里**没有** `heightRpx`：rpx 是小程序的
设计宽度单位，fjs 没有这个坐标系，给一个假的换算比给不出更糟。`height` 两端可能差
一两个像素（字体度量不同），`lineCount` 必须相同。

`auto-height` / `focus` / `auto-focus` / `confirm-type` / `placeholder-style` 这几个
落在 `input` 和 `textarea` **共用的原生 widget** 上，所以写在 `<input multiline>` 上
一样生效。文档把 `textarea` 当规范入口，但不假装 `input` 不认。

**已知缺口（specs/077 遗留）**：裸 `h('textarea')`（vant Field 的路径）在 App 端
不随内容长高——field 自身会长（`auto-height` 语义在 widget 层成立），但外层
fjs flex 的行高计算不跟随，cell 把超过约两行的部分裁掉。诊断数据与已否掉的
方案见 specs/077 的 tasks（T060）。

小程序 textarea 的这些 props fjs **不实现**，写了会 `warnOnce`：`cursor-spacing`、
`adjust-position`、`hold-keyboard`、`show-confirm-bar`、`fixed`、`adjust-keyboard-to`、
`disable-default-padding`、`cursor`、`selection-start`、`selection-end`。前七个是键盘与
原生 webview 的旋钮，两端都给不出对应行为；后三个（光标与选区）留待需要时另开 spec。

### rich-text

后端下发一段 HTML / 节点数组、前端原样展示。它是 JS 组件（宪法 VII）：解析、白名单、
默认样式、列表编号、表格退化都在 `fjs-runtime/src/rich-text/` 里，**两端同一份**——
web 侧也不用浏览器的 `DOMParser`，所以残缺 HTML 的容错两端一致。宿主只提供一件事：
嵌套 `text` 的行内排版（见标签表 `text` 那一行）。

```vue
<rich-text :nodes="'<p>满 <b style=&quot;color:#FA5151&quot;>199</b> 减 30</p>'" />
<rich-text :nodes="[{ name: 'div', attrs: { class: 'box' }, children: [{ type: 'text', text: 'Hello' }] }]" />
```

| prop | 默认 | 说明 |
|---|---|---|
| `nodes` | `[]` | HTML 字符串，或小程序的节点数组（`{ name, attrs, children }` / `{ type: 'text', text }`，类型 `RichTextNode` 从 `fjs` 导出）。结构非法的节点丢弃并告警。变化时整段重建 |
| `space` | 不设 | 不设时连续空白按 HTML 折叠成一个空格（`pre` 里除外）；`nbsp` / `ensp` / `emsp` 把每个空格换成 U+00A0 / U+2002 / U+2003。未知值告警后按不设 |
| `user-select` | `false` | **不支持**，写 `true` 告警 |
| `mode` | `default` | Skyline 专属，**不支持**，其它值告警后按 `default` |

- **白名单**照小程序原样：标签名大小写不敏感；不在白名单里的标签（`script`、`iframe`…）
  **连同子树**删除，每个标签名告警一次；属性只留 `class` / `style` 与该标签自己的
  （`img` 的 `src alt width height`、`ol` 的 `start type`、`td/th` 的 `colspan rowspan
  width height`…），`id` 不支持
- **`class` 能命中调用方页面的 `<style scoped>`**：组件把页面的 scope 挂到每个内部节点上，
  和小程序「页面样式对 rich-text 的 class 生效」一致。`attrs.style` 是内联样式，压过默认值
- **默认样式**取浏览器 UA 样式表：`h1`–`h6` 的字号与上下间距、`p` / `ul` / `ol` 上下
  14px、`blockquote` 左右缩进 40px、`b` 加粗、`i` 斜体、`u` 下划线、`s` 删除线、`code` /
  `pre` 等宽、`mark` 黄底、`sub` / `sup` 上下标、`q` 加引号。相邻块之间的默认 margin 按 CSS
  折叠成较大的那个
- **列表**：`li` 是「标记 + 内容」两栏，`ul` 按嵌套层数用 `•` `◦` `■`（第三层不用更小的
  `▪`：它是 emoji 码位，iOS 上会画成方框），`ol` 认 `start` 与 `type`（`1 a A i I`）
- **表格退化成 flex 网格**：行横排，单元格按 `width` 定宽、否则等分，`th` 加粗居中；
  **`colspan` / `rowspan` 不支持**，告警后忽略
- **`img` 与文字排在同一行**；只给 `width` 或 `height` 时按图片比例（`widthFix` /
  `heightFix`），都不给时按原图且不超过容器宽。`src` 的写法同 `image` 标签
- **内部节点不派事件**（小程序同样屏蔽），`<a>` 没有跳转

**节点构成**（`specs/035`，老 iPhone 上节点数就是耗时）：

- 一个段落**一个节点**：段落里的加粗、变色、上下标这些行内片段，由组件拍平后放在段落
  `text` 的内部 prop `richSpans` 上，宿主直接排版（Flutter 建 `TextSpan`，web 建
  `<span>`）。`richSpans` 只给 rich-text 用，不是 `text` 的公开能力，形状随组件变
- 块里只有一段文字时，块与段落是同一个 `text`（`<p>`、`<h3>`、`<td>` 不再多套一层
  `view`）；只有一个字符串的片段 / 标记直接是元素文本，不单建文本子节点
- **两种段落会多出节点**：行内元素上带 `class`（要样式引擎按作用域解算），或段落里有
  `img`（要自己的节点收加载事件）——这一段退回嵌套 `text` 节点。编辑器产出的正文多用
  内联 `style`，走的是一段一个节点的路
- 参考量级（`packages/fjs-runtime/test/rich-text-node-budget.test.ts` 钉住）：30 段混排 +
  10 项列表 + 5×3 表格 + 3 张图，约 **90 个节点**（035 之前 486）。**上千段的长文仍然该用
  `list-view` 或分页**，rich-text 不做虚拟化

与小程序的差异：

- 默认样式里的 `em` 按 **14px** 折成固定像素（`h1` = 28px）。给 `<rich-text>` 设
  `font-size` 时正文字号会跟着变，**标题与间距不会**——CSS 引擎没有 `em`
- 页面 class 给的 margin 不参与折叠（只有默认 margin 之间折叠），见
  [web.md](web.md#已知差异)
- `ruby` / `rt` 只做退化：注音以小字接在正文后面
- `sub` / `sup` 在 Flutter 上是平移出来的小段落，行盒不会像浏览器那样被撑高，也不能在
  内部换行

### scroll-view

| prop | 说明 |
|---|---|
| `scroll-x` / `scroll-y` | 滚动轴。两个都写会告警并按纵向处理 |
| `scroll-top` / `scroll-left` | 受控偏移，但**不粘手**：值没变就不动，用户滚到别处再来一次同样的值不会被拽回去 |
| `scroll-into-view` | 子孙节点的 `id`。匹配不到会告警，不会静静不动。三端都是「值变化才触发」，**置空 `''` 会重置记忆**：先置空、nextTick 后设回同一 id，就能重复跳同一目标（微信惯用法）。目标在 `sticky-header` 里时，落点是**组起点**（布局位置）而非吸顶后的绘制位置，三端一致（specs/054） |
| `scroll-with-animation` | 上面两个的移动是否带 250ms 动画 |
| `upper-threshold` / `lower-threshold` | 距顶/距底多少 px 算「到边」，默认 50 |

| 事件 | 载荷 |
|---|---|
| `@scroll` | `{"scrollTop":…,"scrollLeft":…,"scrollHeight":…,"scrollWidth":…,"deltaX":…,"deltaY":…}`，字段顺序固定、数值一位小数（两端逐字符一致，见 `fjs-runtime/src/scroll/metrics.ts`）|
| `@scrolltoupper` / `@scrolltolower` | 无载荷。**进入**阈值区才派一次，离开再回来才重派；打开时就在顶部**不算**「到顶」 |

`scroll-x` / `scroll-y` 压过样式键 `direction`——两者在不同层，写了哪个都还能用。

### sticky-header / sticky-section

吸顶布局（specs/052），对齐微信 skyline 的同名组件。用法：

```vue
<scroll-view type="custom" scroll-y style="height: 420px">
  <sticky-section>            <!-- 分组：header 吸顶，随组尾离场 -->
    <sticky-header><view class="cap">组名</view></sticky-header>
    <view>条目…</view>
  </sticky-section>
</scroll-view>
```

| prop（sticky-header） | 说明 |
|---|---|
| `offset-top` | 吸顶时距滚动视口顶部的距离（px，默认 0）。Flutter 端 header 上方会保留这段空隙（静止态也保留），web 是纯 CSS 的 `top`，吸顶态两端一致 |
| `allow-overlapping` | 允许与前一个 sticky-header 重叠。web 本来就是覆盖语义；Flutter v1 不支持，告警后按推挤处理 |
| `padding` | 接受但不生效（微信 3.0.0），外层节点自己写 padding |

| prop（sticky-section） | 说明 |
|---|---|
| `push-pinned-header` | 默认 `true`（组内吸顶元素互推）。web 的 CSS sticky 天然按组边界离场；显式 `false` 在 Flutter 端告警后仍按 `true` 处理（组内推挤之外的重叠语义需要自绘 sliver，v1 不做）|

| 事件 | 载荷 |
|---|---|
| `@stickontopchange`（sticky-header）| `{"isStickOnTop":bool}` JSON 串。web 与 Flutter 端**状态翻转才派一次**，打开时就在顶部的 header 不派首次；小程序 skyline 的原生组件会在首帧对每个 header 先派一次 `false`，文档差异见 docs/miniprogram.md |

三端行为：web 是 CSS `position: sticky`（吸顶边界 = 父元素盒子）；Flutter 是
`PinnedHeaderSliver` + `SliverMainAxisGroup`（scroll-view 的直接子节点含 sticky
标签或 `position: sticky` 样式时整体切到 sliver 布局，普通子节点按原 flex 基线
分 run 排列）；小程序 skyline 是原生组件，webview 渲染器编译为 runtime 自定义
组件 `fjs-sticky-header` / `fjs-sticky-section`（virtualHost + IntersectionObserver，
`offset-top` 支持绑定值、事件生效）。

样式级 `position: sticky; top: N`：三端生效，语义同上（直接子节点 = 整段
吸顶、section 内 = 随组边界离场）。样式路径不派 `@stickontopchange`（web
原生样式也没有事件）；深层嵌套在 Flutter 端不吸顶并告警。

已知差异（都登记在 specs/052）：

- `offset-top > 0` 时 Flutter 端静止态保留这段空隙，web 不保留；
- 同一 sticky-section 内放**多个** sticky-header：web 与 Flutter 端后者覆盖/
  堆在前者身上，不是微信的互推（一组一 header 是主用法）；
- scroll-view 自身的 padding/背景在 sticky 模式下应用于滚动区**外层**
  （sliver 不可跨），与普通模式的 Flutter 实现一致。

### swiper

| prop | 说明 |
|---|---|
| `current` | 受控页码，越界会告警并落到最后一页 |
| `circular` | 首尾相接。Flutter 用无边界 PageView 取模，web 用复制首尾页，但 `@change` 两端都报**真实索引**，页面看不到克隆页的号 |
| `autoplay` / `interval` | 自动播放及其间隔（默认 5000ms）；手指按住时暂停 |
| `duration` | 翻页动画时长（默认 500ms）|
| `vertical` | 上下翻页 |
| `indicator-dots` | 底部指示点，当前页填黑、其余 30% 黑 |

`@change` 的载荷是索引串；`animateTo` 途中经过的页不会逐个上报，只报落点。

`swiper` 的直接子节点**必须是 `swiper-item`**，与小程序一致，三端**编译期报错**
（带模板行列号）。`<template v-for/v-if>` 不算一层，检查它里面的子节点；`<slot>` 放行。
element API、render 函数或 slot 塞进来的非 `swiper-item` 子节点编译期看不到，运行时
仍当一页，但会告警一次（specs/051）。`swiper-item` 自己撑满一页，页面里那层
`<view class="slide">` 不用再写高度。

```vue
<swiper>
  <swiper-item v-for="s in slides" :key="s">
    <view class="slide">{{ s }}</view>
  </swiper-item>
</swiper>
```

### page-container（页面容器，specs/065）

对齐微信 2.16.0 的"假页"容器：遮罩 + 四向弹出面板，**返回操作（右滑手势 /
安卓物理返回）关闭的是容器而不是页面**。三端实现不同、契约一致：

```vue
<page-container :show="show" position="bottom" round
                :close-on-slide-down="true"
                @after-leave="show = false" @clickoverlay="show = false">
  <view class="panel">…</view>
</page-container>
```

| prop | 默认 | 说明 |
|---|---|---|
| `show` | false | 显隐由页面状态驱动；被返回手势/下滑关掉后，页面在 `@after-leave` 里把它归位 false |
| `duration` | 300 | 进出场动画时长 ms |
| `z-index` | 100 | 层级。Flutter 端只按路由顺序（每页一个容器的约束同 wx）|
| `overlay` | true | 是否显示遮罩。开着时容器本身挡住页面交互，同 wx 的页面语义 |
| `position` | bottom | `top` / `bottom` / `right` / `center`；未知值告警并按 bottom |
| `round` | false | 面板圆角 24（WeUI 半屏弹窗，两端同值）|
| `close-on-slide-down` | false | 下滑（right 为右滑、top 为上滑）过 80px 或快甩关闭 |
| `overlay-style` / `custom-style` | — | 遮罩 / 面板的 css 文本。mp 原生全量支持；web 照单全收；**Flutter 只认 background(-color)、border-radius、opacity**，其余键告警一次 |

事件全部无载荷，按 wx 命名：进场 `@before-enter` → `@enter` → `@after-enter`；
离场 `@before-leave` → `@leave` → `@after-leave`；点遮罩 `@clickoverlay`。
点遮罩**不会自动关**，页面在自己的 handler 里改 `show`（wx 语义）。

离场链在**所有**关闭路径上恰好各派一次——包括页面自己置 `show = false`、
遮罩 handler、返回手势和下滑关闭——因为动画时钟在宿主手里，页面要靠
`@after-leave` 把 `show` 归位（这是它和 `modal` 的一个刻意差异：modalClosed
遵循「JS 发起的关闭不回报」，这里不行）。

三端差异：

| | Flutter | web | 小程序 |
|---|---|---|---|
| 实现 | route 级透明路由（`widgets/page_container.dart`）| Teleport to body + fixed + CSS transition（`web/components/page-container.ts`）| 编译透传 wx 原生 `<page-container>`（基础库 ≥ 2.16.0）|
| 返回手势关闭 | ✅ 路由 pop | ❌ 不拦浏览器返回 | ✅ wx 原生 |
| `close-on-slide-down` | 面板拖拽手势 | touch 拖拽 | wx 原生 |
| `overlay-style` / `custom-style` | 只认 background / border-radius / opacity | cssText 全量 | wx 原生 |
| center 位置 | 居中 fade | 居中 fade | **skyline 下 wx 原生容器不渲染面板**：内容在布局树（有尺寸、事件链正常）但 wx 自身的容器底和内容都不绘制，`custom-style` 等属性救不回（specs/065 automator 实测）；bottom/top/right 正常。mp 端需要居中弹层时暂用 `modal`，或向微信反馈 |

### picker 的四种 mode

| mode | `value` | `@change` 载荷 | 其它 props |
|---|---|---|---|
| `selector`（默认）| 下标 | 下标串，如 `"2"` | `range`、`range-key` |
| `multiSelector` | 下标数组 | 下标数组 JSON 串，如 `[1,0,3]` | `range`（二维）、`range-key`；列变化派 `@columnchange`，载荷 `{"column":0,"value":2}` |
| `time` | `"hh:mm"` | 同格式 | `start` / `end` |
| `date` | `"YYYY-MM-DD"` | 同格式 | `start` / `end` / `fields`(year/month/day) |

列的生成与值换算（日期数学、范围裁剪、对象数组按 `range-key` 摊平）都在 JS
侧（`components/picker-modes.ts`），Dart 只见字符串。`mode="region"` 未实现，
理由见 `specs/008-picker/spec.md` §2。

`toast` 不是标签，是全局函数：`import { toast } from 'fjs'; toast('msg')`。
App 端整个 App 只有一个 toast 宿主，挂在 `FjsApp` 的 Navigator 之上，toast 跨页面
显示满 2 秒，与 web 挂在 `document.body` 一致；宿主直接嵌 `FjsView`（不用 `FjsApp`）时
由 `FjsView` 兜底挂一个（specs/134）。

## 组件：picker

`picker` 不是 Dart 标签，而是两端共用的 JS 组件：它用 `modal` 打开底部弹层，
用 `picker-view` / `picker-view-column` 画滚轮，取消不改页面值，确定时才派
`@change`。`disabled` 为 true 时点击插槽内容不会弹出。

| mode | `value` | `@change` 载荷 | 其它 props |
|------|---------|----------------|------------|
| `selector`（默认） | 下标数字 | 下标串，如 `"2"` | `range`、`range-key` |
| `multiSelector` | 下标数组 | 下标数组 JSON 串，如 `[1,0,3]` | `range`（二维）、`range-key`；列变化派 `@columnchange`，载荷 `{"column":0,"value":2}` |
| `time` | `"hh:mm"` | 同格式 | `start` / `end` |
| `date` | `"YYYY-MM-DD"` | 同格式 | `start` / `end` / `fields`（`year` / `month` / `day`）|

`picker-view` 自己也可直接用在页面里：`value` 越界时落到该列最后一项，滚动停下
后才派一次 `@change` / `@value-changed`，载荷始终是字符串形式的 JSON 下标数组。
`picker-view` 只渲染 `picker-view-column` 子节点；其它子节点会被丢弃并告警一次，
避免静默失效。

## 设计参考

内置组件的默认外观（配色、圆角、按下态等）以微信 WeUI 为参照，Flutter 与
Web 两端取同一组数值。新增或改默认样式时先看：

- [WeUI 组件列表](https://wechat.design/tool/weui-mobile#weui%E7%BB%84%E4%BB%B6%E5%88%97%E8%A1%A8)
- [WeUI 源码](https://github.com/Tencent/weui)
- [微信小程序组件文档](https://developers.weixin.qq.com/miniprogram/dev/component/)

例如 `button` 按下立刻叠一层 10% 黑（`--weui-BTN-ACTIVE-MASK`，手指落下
当帧就画，不点按无反馈），白底变灰、填充色变深；页面自己写的 `:active`
会盖过它。

## 事件（props 形式）

| prop | 事件 | 载荷 |
|------|------|------|
| `onTap` / `onClick` | FJS_EVENT_TAP | — |
| `onLongPress` | FJS_EVENT_LONG_PRESS | — |
| `onTextChanged` | FJS_EVENT_TEXT_CHANGED | utf8 文本 |
| `onSubmit` | FJS_EVENT_TEXT_SUBMITTED | utf8 文本 |
| `onValueChanged` | FJS_EVENT_VALUE_CHANGED | "1"/"0" 或数值串 |
| `onPageChanged` | FJS_EVENT_PAGE_CHANGED | 索引串 |
| `onLoad` / `onError`（在 `image` 上）| FJS_EVENT_IMAGE_LOAD / FJS_EVENT_IMAGE_ERROR | `{"width":n,"height":n}` / `{"errMsg":"…"}` JSON 串 |
| `onLinechange`（多行 `input` / `textarea`）| FJS_EVENT_LINE_CHANGE | `{"height":n,"lineCount":n}` JSON 串 |
| `onLoad` / `onError` | FJS_EVENT_LOAD / FJS_EVENT_ERROR | **载荷形状由标签决定**：`image` 是 `{width,height}` / `{errMsg}`，`web-view` 是 `{src}` / `{src,errMsg}` |
| `onMessage`（`web-view`）| FJS_EVENT_MESSAGE | `{"data":"…"}` JSON 串 |
| `onModalClosed` | FJS_EVENT_MODAL_CLOSED | — |
| `onBeforeEnter` / `onEnter` / `onAfterEnter`（`page-container`）| FJS_EVENT_BEFORE_ENTER / ENTER / AFTER_ENTER | — |
| `onBeforeLeave` / `onLeave` / `onAfterLeave`（`page-container`）| FJS_EVENT_BEFORE_LEAVE / LEAVE / AFTER_LEAVE | 所有关闭路径（含返回手势/下滑）都走完整条离场链 |
| `onClickoverlay`（`page-container`）| FJS_EVENT_CLICK_OVERLAY | — |
| `onRefresh` | FJS_EVENT_REFRESH | — |
| `onFocus` / `onBlur` | FJS_EVENT_FOCUS / FJS_EVENT_BLUR | 输入框当前文本 |
| `onSubmit` / `onReset`（在 `form` 上）| — | 不过桥：`form` 是 JS 组件，事件在 JS 侧就地 emit（号段 22/23 仍登记在契约表里备用）|
| `onTouchstart` / `onTouchmove` / `onTouchend` / `onTouchcancel` | FJS_EVENT_TOUCH_* | TouchEvent 对象，见下 |

处理器函数留在 JS 侧注册表，跨桥只发送 `onTap: true` 标记。

经 Vue 模板绑定的处理器拿到 DOM 形状的事件对象：`detail` 是上表的载荷，
`target` / `currentTarget` 是元素本身。click 事件带 `clientX/clientY`
（按需读取）。

**tap / click 冒泡**（specs/129）：两端一致，点中的节点先收到，再由内向外
交给每个挂了 `@tap` / `@click`（或 `addEventListener('click')`）的祖先，
同 DOM click。冒泡时 `target` 是点中的节点、`currentTarget` 是当前监听节点
（Vue 的 `.self` 修饰符因此成立），`stopPropagation()` / `@click.stop` 截断
后续祖先。App 上 Flutter 只把点击交给最内层的识别器，冒泡在 JS 派发层完成，
祖先自己的识别器不会再触发一次。以前 App 不冒泡：vant Popover 的点击挂在
包住按钮的 `<span>` 上，按钮自己有 click 监听，弹层永远不开。只有 tap 冒泡，
输入 / 焦点等事件仍只派给自己；触摸事件另见下文。

### 元素上的 DOM 形状 API

任何元素（经 `ref` 拿到的、或作为事件 `target` 的）都带一小组 DOM 形状的
成员，按 DOM 写法的组件库（vant）不需要 fjs 适配就能操作。类型定义在
`fjs-runtime/src/ui/element.ts` 的 `Element`：

- `el.style`：DOM 式写入面（`el.style.opacity = 0.5`），走内联层、与
  `:style` 绑定共用同一份记录。不是真的 CSSStyleDeclaration——读不到层叠
  结果，只有内联值
- `el.getBoundingClientRect()`：border box 在窗口坐标系的位置与尺寸。同步
  返回。**未布局**的节点全零。Web 上浏览器会强制重排。App 上分两段：
  - **`navMount` 当次**（`dispatchEvent` 的 JS_Call + pump）：不强制重排，
    以免把刚推入的整页 `flushLayout` 叠在 JS 栈上冻住转场（specs/086）。
    刚创建、还没有 Flutter box 的节点就是全零
  - **页面已挂上之后**：读 rect 会强制同步重排，同一 tick 里取消
    `display:none` 再量高度能拿到新值（vant collapse，specs/073）
- `el.offsetWidth` / `offsetHeight` / `offsetLeft` / `offsetTop` /
  `offsetParent`：与 `getBoundingClientRect` 同一份布局（navMount 窗口内
  不强制重排；页面已挂上之后强制）。border box 尺寸，与相对 offsetParent
  （最近定位祖先，由 renderer 解析）的偏移；没有定位祖先时 `offsetParent`
  为 null、偏移即窗口坐标。vant Tabs 的下划线居中靠
  `title.offsetLeft + offsetWidth / 2`（specs/073）
- `el.isConnected`：元素挂在活着的页面树里为 true，卸载后 false；裸 element
  API（无 renderer）恒为 false。vant TextEllipsis 只在它为 true 时才测量截断
  （specs/128）
- `el.parentNode` / `parentElement`：挂载树里的逻辑父节点（页面根之上、
  卸载后为 null；`position: fixed` 元素是弹层宿主）。`nodeType` 恒为 1，
  `tagName` / `nodeName` 是 fjs 标签的大写（`VIEW`）。vant `useScrollParent`
  沿 `parentNode` 找 `overflow-y` 滚动祖先，Sticky 靠它监听页面的 scroll-view
  （specs/129）
- `el.scrollTop` / `scrollLeft`：滚动容器最近一次 scroll 事件报告的偏移，
  没滚过为 0；可写但不会真的滚动（宿主没有同步滚动命令），写入只是记下。
  `clientTop` / `clientLeft` 恒为 0。popperjs 定位弹层时会读这几个值
- `el.setAttribute(name, value)` / `removeAttribute(name)`：走 renderer 的
  属性路径，与模板里写同名属性等价（popperjs 写 `data-popper-placement`）
- `el.addEventListener` / `removeEventListener(type, listener)`：事件名同
  `on<Name>` prop（`'touchmove'` ↔ `@touchmove`），`passive` / `capture`
  选项忽略（vant Slider 经 useEventListener 挂在自身元素上的 touchmove
  靠它收到）
- `contains(other)`：`other` 是该元素本身或其后代时为 true，`null`、非元素、
  已卸载的节点为 false。vant Checkbox / Radio 点击时用它判断是否点在图标上
  （`icon.contains(event.target)`），App 上此前因缺这个方法抛
  `TypeError: not a function`、勾选无反应（specs/072）。Web 端即原生
  `Node.contains`。`position: fixed` 的元素在 App 上挂到弹层宿主下，与 DOM 里
  Teleport 到 body 一样不再算作逻辑父元素的后代。按下点在 `::before` /
  `::after` 装饰盒上时，document 级按下事件的 `target` 是生成它的元素（浏览器里
  伪元素从不是事件目标）——vant 按钮的 `::before` 盖满按钮，以前 Popover 的
  点外关闭把再次点按钮当成了点外面（specs/129）
- `input` / `textarea` 元素另有 `focus()` / `blur()`：DOM 式的控件焦点。
  vant Field 拿着模板 ref 调 `inputRef.value.blur()` 在只读字段聚焦时拒焦，
  App 上此前因缺这个方法在 `onFocus` 里抛 `TypeError`（specs/077）。App 端
  经 `fjs.control.focus` / `fjs.control.blur` 两个 host 模块路由到控件的
  FocusNode；Web 端就是原生方法。非控件元素调用是空操作
- `input` / `textarea` 元素另有 DOM 式的 `value` 属性——读取得到当前文本
  （最近一次输入事件或写入），写入会推到原生输入框；还有空操作的
  `setSelectionRange()`。vant Field 等按 DOM 写法（`event.target.value`、
  `inputRef.value.value = text`）实现 v-model 的库因此两端可用（specs/070）

## 触摸事件（对齐 DOM）

任何标签都可以监听 `touchstart` / `touchmove` / `touchend` / `touchcancel`，
拿到的事件对象和浏览器里的同名事件同形：

```vue
<view
  class="block"
  @touchstart="onStart"
  @touchmove="onMove"
  @touchend="onEnd"
  @touchcancel="onEnd"
/>
```

```ts
import type { FjsTouchEvent } from 'fjs';

function onMove(e: FjsTouchEvent) {
  const t = e.changedTouches[0];
  t.identifier;                  // 这根手指的 id，按下到抬起不变
  t.clientX; t.clientY;          // 逻辑像素；page/screen/x/y 同值
  e.touches;                     // 屏幕上所有按下的手指
  e.targetTouches;               // 其中按在这个节点上的
  e.changedTouches;              // 本次事件涉及的
  e.timeStamp;                   // 毫秒
  e.target.id;                   // 节点的 id 属性（target === currentTarget）
}
```

一次多指、`changedTouches` 只带变化的那几根、`touchend` 时手指已从
`touches` 里移除只留在 `changedTouches` —— 都和 DOM 一致。

**双指手势**（捏合缩放这类）就是从 `touches` 里取前两根算几何量，配
`touch-action: none` 一起用 —— 少了后者，外层滚动容器会在双指张合时把手势
抢走，画布一次 move 都收不到：

```ts
function onMove(e: FjsTouchEvent) {
  const [a, b] = e.touches;
  if (a && b) {
    const gap = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    // 和上一帧的 gap 比得到倍率；手指对（identifier）变了要重新取基准，
    // 否则抬起一根手指的那一帧会跳
    return;
  }
  // 单指分支
}
```

```css
.gl { touch-action: none; }   /* 这个节点自己吃掉手势 */
```

完整例子见 `examples/hello-fjs/src/gltf/pinch.ts` 与两个 glTF 查看器页
（spec 029）。桌面浏览器用鼠标只有一个指针、捏不出来，示例页另配了一对
`−` / `+` 按钮补齐 —— fjs 没有 wheel 事件。

与浏览器的差别（都是有意为之）：

- 没有深层 target：`target` 就是挂监听的那个节点，`currentTarget` 是同一个
  对象。没有 DOM 那种事件委托。因此靠 `target` 判断点中哪个子节点的写法在
  App 上只认得监听节点本身——例如 vant Checkbox / Radio 设了 `label-disabled`
  时，App 上点图标也不会切换（默认不设时点哪都切换，两端一致）。
- 事件由内向外派发到路径上每个监听节点（相当于冒泡），但触摸事件的
  `stopPropagation()` 在 Flutter 上是空实现（tap / click 的冒泡可以截断，见上文）；`preventDefault()` 同理——原生
  默认行为要用 `touch-action` 关，那条两端都生效。
- App 上一根手指按在哪个节点，后续的 move/end 就一直归它，等价于 web 的
  pointer capture；web 侧实现也真的调了 `setPointerCapture`。
- Web 侧用的是 pointer 事件而不是 DOM touch 事件，所以桌面浏览器里鼠标也能
  跑同一套代码（和 Flutter 的 Listener 收鼠标一样）。

### touch-action：谁拿走这次手势

和 CSS 同名同义：默认 `auto` 时，外层滚动容器可以把手势抢走（抢走的那一刻
派发 `touchcancel`，和浏览器一样）。要让节点自己吃掉手势就声明：

```css
.block { touch-action: none; }   /* 全都归自己：拖拽块必写 */
.row   { touch-action: pan-y; }  /* 竖向留给外层滚动，横向归自己 */
```

Web 上这就是原生 CSS；Flutter 上它让节点进手势竞技场，在手指移动约 8px
（鼠标 1px）时抢下指针——早于滚动容器的 18px 阈值，所以滚动不会启动。
支持的值：`auto`（默认）、`none`、`pan-x`、`pan-y`、`manipulation`（同 auto）。

### 跟手不掉帧

- 一帧内到达的多个 move 会合并成一次派发（一帧一次跨桥），start/end/cancel
  之前会先把待发的 move 冲掉，顺序不会乱。
- 拖动请改 `transform: translate(...)` 而不是 left/top 或 margin：前者只重绘，
  不触发布局，命中测试也跟着一起动。
- 跨桥的 payload 是压缩过的 JSON：单指时只有一条
  `{"ts":…,"touches":[[id,x,y]]}`，另外两个列表相同就不发。

例子见 `demo/src/pages/drag.vue`（块拖拽、多指）和 `demo/src/pages/dnd.vue`
（网格 + 竖列表拖拽排序）。

## 样式（style 属性 / class / `<style scoped>`）

样式值支持三种来源（优先级从低到高）：HTML 标签默认样式（h1-h6、tr、
a 等）、class 匹配到的 CSS 规则、内联 style。CSS 文本里的值用 kebab-case
（`font-size: 16px`），内联对象用 camelCase（`fontSize: 16`）；数字不带
单位表示逻辑像素。

```ts
{ style: {
    // ---- 盒模型 ----
    width: 200, height: 48,
    minWidth: 0, minHeight: 0, maxWidth: 300, maxHeight: 120,
    margin: 16, padding: '8 16',        // 数字 | 'V H' | 'T H B' | 'T R B L' | 对象 | '8px'
    marginTop: 12, paddingLeft: 10,     // 单边写法；与简写同时出现时单边覆盖那一边
    backgroundColor: '#FF0000', color: '#333333',
    // 颜色也支持 #RGB/#RGBA/#RRGGBBAA、rgb()/rgba()/hsl()/hsla()、命名色
    borderRadius: 12,                   // 数字 | '8px' | '8px 16px' | '1px 2px 3px 4px'
    borderWidth: 1, borderColor: '#DDDDDD',
    border: '1px dashed #ccc',          // 简写：solid / dashed / dotted
    borderStyle: 'dashed',              // 单写；double/groove 等按 solid 画
    // borderWidth / borderColor / borderStyle 覆盖简写的对应分量；'none' 和 0
    // 宽度就是没有边框——button 自带的那道 hairline 也是这么关掉 / 换色的
    opacity: 0.8,
    overflow: 'hidden',                 // 裁剪内容
    // ---- flex 布局 ----
    flexDirection: 'row',               // 'row' | 'column'（默认）
    flexWrap: 'wrap',                   // 换行（映射 Wrap；此时 flexGrow 失效）
    justifyContent: 'center',           // start/end/center/space-between/...
    alignItems: 'center',               // start/end/center/stretch
    flexGrow: 1,                        // 映射 Expanded；也支持 flex: 1 简写
    gap: 8,                             // 子项间距（rowGap/columnGap 可分别指定）
    // ---- 定位 ----
    position: 'relative',               // 本盒子成为定位上下文；配 top/left 只挪画面，不动布局
    position: 'absolute',               // 脱离文档流，按最近的定位祖先摆
    top: 0, right: -4, bottom: 0, left: 0,
    // ---- 文字（color/fontSize 等沿树继承，同 CSS）----
    fontSize: 16, fontWeight: 600,      // 100-900 | 'normal' | 'bold'
    fontStyle: 'italic', fontFamily: 'Roboto',
    lineHeight: 1.5,                    // 数字=倍数；'24px'=绝对值
    letterSpacing: 0.5,
    textAlign: 'center',
    textDecoration: 'underline',        // underline | line-through | overline
    textTransform: 'uppercase',         // uppercase | lowercase | capitalize
    whiteSpace: 'nowrap',               // 单行截断
    maxLines: 2, overflow: 'ellipsis',
    // ---- 变换 / 手势 ----
    transform: 'translate(12px, -4px) scale(1.06) rotate(5deg)',
    // translate / translateX / translateY / translate3d / scale / scaleX /
    // scaleY / rotate(deg|rad|turn|grad) / matrix(a,b,c,d,e,f)，从左到右复合。
    // 只重绘不重排，命中测试跟着动——拖动就用它
    touchAction: 'none',                // auto | none | pan-x | pan-y
    // ---- 视觉效果 ----
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',   // 字符串或数组
    textShadow: '0 1px 2px #000000',
    background: 'linear-gradient(180deg, #4facfe 0%, #00f2fe 100%)',
    // 也支持 background-image / radial-gradient / to bottom 等方向
} }
```

也可把样式键直接放在 props 顶层（两种写法都支持）。`overflow: 'ellipsis'`
与 `overflow: 'hidden'` 共用 `overflow` 键：text 节点上是截断省略，容器上
是裁剪。

Vue SFC 的 `<style>` / `<style scoped>` 编译后由运行时样式引擎解析并按
class 匹配（选择器范围与层叠规则见 docs/vue3.md）。CSS 自定义属性
（`--x` + `var()`，含 fallback/链式/循环安全）与 Vue 的 `v-bind()`
CSS 绑定（响应式值注入）均受支持：变量在 JS 侧解析完成后才跨桥，
`--x` 定义本身不会出现在原生样式里。

### 自定义字体（`@font-face`）

样式表里的 `@font-face` 两端都生效（specs/071），iconfont 写法照 web：

```css
@font-face {
  font-family: "my-icons";
  src: url("./fonts/my-icons.woff2") format("woff2");
}
.icon-home::before { font-family: "my-icons"; content: "\e601"; }
```

App 端的链路：`fjs build` / `fjs dev` 把 WOFF2 / WOFF / 本地字体文件转成
TrueType 内联进样式；运行时样式引擎解析 `@font-face`，调用宿主方法
`fjs.font.load(family, dataUrl)`（走 `invokeHost`，同步返回、不回派事件）；
Dart 侧 `font_loader.dart` 用 `loadFontFromList` 注册，已显示的文字自动重排。
远程字体地址不支持，限制清单见 [css-compat.md](css-compat.md)。

## element API（无框架）

```ts
import { h, createRoot, setText, setProps } from 'fjs';

const root = createRoot('view');               // 挂到宿主根容器（id 0）
const label = h('text', { style: { fontSize: 20 } }, 'hi');
root.appendChild(label);

let n = 0;
root.appendChild(h('button', {
  onTap: () => setText(label, `taps: ${++n}`),
}, '+1'));
```

所有操作自动按微任务聚合为一次二进制帧提交。

## Vue 3 用法

```ts
import { createApp, flutterRoot } from 'fjs/vue';
createApp(App).mount(flutterRoot('scroll-view'));
```

- 模板标签即上表标签；`@tap`/`:on-tap` 两种事件写法等价（kebab 会自动
  camelCase 化）
- `v-for`/`v-if`/`computed`/`ref` 全部可用；`v-model` 不可用（见
  [vue3.md](vue3.md#不可用--注意)）
- `createApp` 必须从 `fjs/vue` 导入（不要从 `vue` 导 DOM 版 createApp）
- 挂载根：`flutterRoot('scroll-view')` 适合整页滚动的应用；要做「顶部导航栏
  + 中间滚动区 + 底部 tabBar」这种固定外壳直接写就行：根节点
  （`flutterRoot()`，默认 `view`）的子节点默认按 `flex-grow: 1` 撑满整页——
  和 web 基础样式表里的 `fjs-page-entry > * { flex: 1 1 0% }` 是同一条规则，
  中间那块的 `flexGrow` 才有东西可分。示例见 `examples/hello-fjs`

## 页面：`onPageSettled`

```ts
import { onPageSettled } from 'fjs/router';

onPageSettled(() => {
  // 这一页的路由转场已经跑完，现在干重活不会掉帧
  buildTheExpensiveThing();
});
```

**为什么需要它**：JS 跑在 UI 线程上（[threading-model.md](threading-model.md)），
一段几十毫秒的同步计算就是一次卡帧。页面刚被 push 进来的那几百毫秒，正是
Navigator 在跑转场动画的时候——首屏建图、解析大 JSON 这类活落在这里，用户
看到的就是转场卡一下。实测三张 F2 图的首帧渲染约 210ms，把整段转场动画的帧
全丢了（specs/027）。

契约（两端一致）：

* **一次性**，最多触发一次。
* **永远异步**：已经 settled 的页面上调用它，回调也在下一个微任务里跑，
  这样 `setup()` 里的调用方能先跑完自己的初始化。
* **没有转场的页面立即算 settled**：初始页、tab 切换、`meta.transition: false`。
* 页面卸载后不再触发。
* 转场信号 1s 还没到就强制放行并告警一次——宁可早跑，也不能让页面永远等着
  （那会表现为「图表不出来」且没有任何提示）。

两端的实现底座不同，语义相同：Flutter 侧是路由 `didPush()` 的动画结束
（新事件 `FJS_EVENT_NAV_SETTLED = 31`），web 侧是 `<Transition>` 的
`afterEnter`。

> **`<canvas>` 有个现成的开关**：加 `defer-resize`，它的**首次** `@resize`
> 就会等转场结束再派，图表页照常在 `@resize` 里建图即可。默认不延迟。见
> [canvas-compat.md](canvas-compat.md)。

### 首屏优先：`<defer>`

```vue
<scroll-view class="page" scroll-y>
  <view class="block">…首屏可见的部分，照常同步挂载…</view>
  <defer placeholder-height="1200">
    <view class="block">…首屏以下，转场结束后才挂…</view>
  </defer>
</scroll-view>
```

**为什么需要它**：Flutter 侧一个页面在 navMount 里同步挂载，push 转场在等它。
解释器下一个 vant 节点挂载约 150 µs（Vue + 元素层 + 级联，模拟器口径），350 个
节点的表单就是 50 ms 冻住的转场——单价削到头也一样（specs/118 的拆账见
[vant-mount-perf.md](vant-mount-perf.md)）。剩下的杠杆只有让首帧少挂节点。

* 补挂时机是 `onPageSettled`，不是「下一帧」：下一帧仍在转场里，补挂那几十
  毫秒会压在动画帧上。代价是折叠线下的内容晚 ~300 ms 出现。
* 挂上之后插槽内容直接是父元素的孩子（Fragment），`.page > .block` 这类选择器、
  flex 布局与不包 `<defer>` 时一致。
* 不做自动推迟：挂载前没有布局，猜错折叠线会让首屏空白。折叠线由页面作者决定。
* 页面已在屏上（没有转场）时也是异步的：下一个微任务就挂。
* 小程序端编译成透明 `<block>`（skyline 按需构建，没有这笔账），见
  [miniprogram.md](miniprogram.md)。

demo 的 vant-form / vant-more / vant-nav / vant-basic 就是这么写的。

**离场那一侧不需要单独的钩子**：路由把页面拆掉本来就排在离场动画之后
（Flutter 是 `route.dispose()` → `navPop`，web 是 `<Transition>` 的
`onAfterLeave` → KeepAlive 丢弃），所以 Vue 的 `onUnmounted` 就是那个时机，
两端一致。

可跑的例子：`examples/hello-fjs` 的「示例 → 交互演示 → 转场与重活」
（`src/pages/example/interaction/page-settled.vue`）。同一页两个按钮切 `?mode=`，
实测帧间隔：

```
等转场：54 15 10 17 20 13 15 16 17 18 18 17 15 17 16 17 16 17 16 17 222
        └────────────── 转场这 20 帧干净 ──────────────┘ └ 重活挪到这里
立刻干：294 23 14 15 16 19 14 17 18 20
        └ 重活压在第 1 帧，整段动画没了
```

## 已知限制

样式属性和选择器的**完整支持矩阵**在 [css-compat.md](css-compat.md)，
这里只列会让人写错代码的几条。

- **属性级过渡只认五个属性**：`transition` 对 `transform` / `opacity` /
  `background-color`（实色）/ `width` / `height` 两端渐变（spec 045，支持
  范围与差异见 [css-compat.md](css-compat.md#视觉效果)；尺寸逐帧重排）；
  其余属性 App 端瞬时生效。
  `animation` / `@keyframes` 不支持。**页面转场是另一回事，那个支持**，见
  [routing.md](routing.md#转场动画)
- **没有自定义字体加载**：`fontFamily` 只透传平台已装的字体。要用自带字体，
  在宿主 Flutter 工程里打包字体资源再按名引用
- 无 `align-self`（Flutter 的 Flex 没有逐子对齐）、无 inset 阴影
  （单边边框 `border-top` 等自 spec 041 起支持，见
  [css-compat.md](css-compat.md#边框与圆角)）
- dashed / dotted 有，但 CSS 没规定虚线的疏密，各浏览器自己定：这里按
  「线段和间隔都是边框宽度的 3 倍、点是 1 倍宽 2 倍间隔」画，和 Chrome 接近
  而非逐像素一致
- **列容器默认 `align-items: stretch`**：没有显式宽度的子节点会被拉满整行
  （横向容器默认是 `center`）。想让子节点按内容宽度收缩，**给容器**写
  `align-items: flex-start` —— 没有 `align-self`，收缩不了单个子节点。
  显式写了 width / height 的子节点会保留自己的尺寸，不被拉伸
- **定位就是 CSS 那一套**：任何盒子写了 `position: relative` 就是定位上下文，
  它的 `position: absolute` 子节点按 top/right/bottom/left 摆在它上面，其余
  子节点照常走 flex。（早期版本的 `stack` 标签已删除，用 `view` +
  `position: relative` 代替）
- 和 CSS 一样，没有定位祖先时 `position: absolute` 不生效（这边是留在流里，
  不像 CSS 那样退到视口）——所以父级要显式写 `position: relative`
- 定位子节点可以露到盒子外面（`top: -4px` 的角标），和 web 一样不裁剪；要裁
  就给父级加 `overflow: hidden`
- **emoji 系的码位在 Flutter 上可能渲染成方框**。中文、`◎ ✓ ✚ △ ›` 这类
  普通符号都正常（走系统字体的回退），但 Unicode 里可以按 emoji 呈现的码位
  （`✉ ★ ☎` 以及真 emoji）会被交给系统 emoji 字体，某些 Flutter / iOS 组合
  取不到它，就是一个方框——同一份代码在 web 上由浏览器自己的回退链兜住，所以
  只有 app 端出问题。写 `font-family: Apple Color Emoji` 也救不回来（那个字体
  同样解析不到）。**图标用 iconfont 或图片**，别用 emoji 字符；一定要 emoji
  就在宿主 Flutter 工程里打包一个 emoji 字体资源，再用 `font-family` 指名。
  （别指望 `fontFamilyFallback`：Flutter 里一旦给了回退列表，它会**取代**
  平台默认字体，中文会先崩）
- CSS 百分比与 `calc()` 只在**尺寸**上认（`width` / `height` / `min-*` /
  `max-*`）：`width: '50%'`、`height: 'calc(100% - 32px)'` 都可以，参照是父盒子
  在那个轴上给出的空间；无界的轴（列表、`scroll-view` 的纵向）按 CSS 退化成
  auto。`borderRadius: '50%'`、`padding: '5%'` 这类仍然不支持，见
  [css-compat.md](css-compat.md#单位)
- 选择器仅基础集（类/标签/后代/子代/`:deep`/`:global`），加上状态伪类
  `:active`（按压）与 `:hover`（桌面悬停，只能写在末位复合选择器上）以及结构
  伪类 `:first-child` / `:last-child`（任意复合选择器位置）；`@media` 已支持
  （基础语法子集，见 [css-compat.md](css-compat.md#5-media-媒体查询spec-043)），
  其他伪类、属性选择器、id 选择器、其余 at-rule 跳过并**告警**（不会静默丢弃）
- **`text` 里嵌 `text` 是行内片段**（spec 034 起）：以前 web 上一段一行竖着堆、
  Flutter 上只显示第一段，现在两端都连成一段。要竖排就把外层换成 `view`。片段上的
  盒模型属性（margin / padding / border / 宽高）无效，Flutter debug 构建会提醒一次
- 长列表请用 list-view（ListView）而非 scroll-view——**这不是微调**：
  `scroll-view` 会 build/layout/paint 它的每一个孩子，1000 行切主题实测
  最慢帧 166 ms 对 29 ms（[performance.md](performance.md#两个开关两条独立的账)）。
  debug 构建下孩子超过 200 个会打印一次提醒。给它 `items` 和一个
  `#default="{ item, index }"` 行插槽就会虚拟化——Flutter 侧由
  `ListView.builder` 懒构建，web 侧只挂载视口 ± `prefetchExtent` 的行，
  上下用占位块撑出完整滚动高度（滚动条、回退还原位置都照常）。
  行高必须固定：不是 64px 时用 `item-height` 告诉它，行高不一的列表两端都不支持

## 相关

- [Web CSS 兼容清单](css-compat.md) —— 属性 / 选择器支持矩阵
- [自定义渲染器](custom-renderer.md) —— 这些标签在 JS 侧是怎么变成 op 帧的
- [Vue 3 集成](vue3.md) —— SFC、scoped style
- [Web 平台](web.md) —— 同一份代码在浏览器上的差异
