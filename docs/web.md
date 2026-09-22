# Web 平台

> 第二层第 4 篇。**「一份源码，三个目标」是 fjs 的第一约束**（宪法 I），
> 这篇讲 web 那一半怎么成立、以及两端还剩哪些差异。
> CSS 属性/选择器的支持矩阵在 [css-compat.md](css-compat.md)。

`fjs build --web` 把同一份 Vue 应用编译成浏览器能跑的静态站点：真 Vue
runtime-dom + vue-router，内置标签由一层 DOM 适配层实现。**页面源码一行不用改。**
微信小程序是第三条产物路径（编译期直译 WXML，不走 DOM 适配层），见
[miniprogram.md](miniprogram.md)。

```bash
pnpm run dev:web
pnpm run build:web
```

`fjs create` 生成的默认模板用 Vite 跑 Web 开发和构建，输出到 `dist/`。仓库里的
`examples/hello-fjs` 使用的是 CLI 内置 Web 模式，脚本为 `fjs dev --web` 和
`fjs build --web`，输出到 `dist/web/`。

两种方式都会走同一套 fjs Web alias：`fjs/app`、`fjs/router`、`fjs/web` 和
`fjs/pages`。产物是普通静态文件，可以交给任意静态托管。

**为什么没有 "Flutter Web" 目标**：早期设想里有过一条路——把 Flutter 宿主
编译到 Flutter Web，JS 侧不经 WASM 化的 QuickJS、直接用浏览器 JS。实际没走
这条：浏览器侧的载体就是上面的 DOM 适配层，无引擎、浏览器原生 JS、同一套
element API，产品层面已经是那个设想想要的东西。只有当「Flutter 渲染本身要
跑在浏览器里」（逐像素等同 App 的 widget 渲染）成为真实需求时，才值得重开
这个题目。

## 它是怎么成立的

| 层 | Flutter | Web |
|---|---|---|
| 渲染器 | fjs 自定义 renderer → op 帧 → Widget | Vue runtime-dom |
| `<view>` `<swiper>` … | Dart 侧 widget 映射 | `fjs/web` 里的 Vue 组件 |
| `<style scoped>` | fjs 样式引擎（自己做 cascade / 继承） | 真 CSS（`compileStyle` 注入 `<style>`） |
| 路由 | 原生 Navigator | vue-router（hash 模式） |
| `toast()` | 原生浮层 | DOM 浮层 |
| `new Worker('/workers/x.js')`（`src/workers/x.ts`，specs/049） | fetch 脚本 → Dart isolate + 独立 QuickJS | 真 Web Worker（路径即 URL；vite dev 中间件按需编译，构建写 `workers/`） |

内置标签在 web 上是**组件**（`fjs-runtime/src/web/components/`：`basic` 基础容器、
`form` 表单控件、`swiper`、`overlay` 下拉刷新与弹窗，`gestures` 是它们共用的点击 /
长按 / 拖拽），在 Flutter 上
是**元素**。SFC 编译时给 `@vue/compiler-dom` 传不同的 `isNativeTag` 来切换——
`text`、`image`、`switch` 这些本来是 HTML/SVG 原生标签，不显式声明就会被编译成
真元素，永远走不到适配层。

### 事件契约

原生侧所有事件的载荷都是**字符串**（JSI 边界只过标量），web 组件原样照搬，所以
同一个 handler 两边都对：

```vue
<switch :value="wifi" @change="(v: string) => (wifi = v === '1')" />
<slider :value="n" @change="(v: string) => (n = Number(v))" />   <!-- 两位小数 -->
<swiper @page-changed="(i: string) => (index = Number(i))" />
<input :value="name" @input="(t: string) => (name = t)" />
```

### 样式

`:style="{ fontSize: 16 }"` 在 Flutter 上是 16 像素，在 CSS 里是非法值。适配层
统一把数字按长度属性补 `px`（`opacity` / `flexGrow` / `lineHeight` 等无单位属性
除外），所以内联样式也不用分平台写。

基础样式表（`fjs-runtime/src/web/base-css.ts`）把容器都做成 `box-sizing:
border-box` 的列 flexbox，对齐 Flutter 的「padding 在盒内、margin 在盒外」。
定位（`position: relative` + 子节点 `absolute`）web 上就是 CSS 自己那套，不
需要适配。另外几条也是为了让两边量出来一样：

- **根节点占满屏幕**：`#app > *` 和 `fjs-page-entry > *` 拿 `flex: 1 1 0%`
  （不是 `flex-grow: 1`——基准必须是 0，否则内容的自然高度还会叠上去），
  对齐 Flutter 路由给页面根 widget 的整屏紧约束。否则内容不满一屏时，
  底部 tabBar 会跟在内容后面而不是贴底。
- **默认行高 1.4**：CSS 的 `normal` 和 Flutter 的字体度量是两个数（同一页里中英
  文还各算各的），两边都钉死同一个倍数（`widgets/text.dart` 与 `text` 规则），
  行高不写就一致。
- **子节点不收缩，`flex-grow` = `Expanded`**：Flutter 的 Column/Row 子节点保持
  自然尺寸、超出就溢出，CSS flex 却会把它们压扁——一屏装不下的页面因此把每行的
  padding 和行盒挤没了，底部 tabBar 也跟着被压扁、切 tab 时抖动。所以内置标签
  一律 `flex-shrink: 0`；而 `flex-grow: n` 在 Dart 侧就是 `Expanded`（只拿剩余
  空间），web 侧由 `injectStyle()` / 内联样式归一化改写成 `flex: n 1 0%`，语义
  对齐。写了 `flex-basis` 的话以它为准。
- **滚动条不占布局**：Flutter 的滚动条是浮层，web 上一条随页面长度出现／消失的
  滚动条会让每次切 tab 都横向抖一下，所以 `scroll-view` / `list-view` 只沿自己
  的方向滚动，并隐藏滚动条。

### 内置组件的默认外观

`button` / `input` / `switch` / `checkbox` / `slider` / `progress` / `divider`
在 Dart 侧是 Material widget，默认外观（配色、内边距、边框、字号、点击区）本来
跟 CSS 基础样式表对不上。现在以基础样式表（`base-css.ts`）为准，Dart 侧把这些
默认值对齐过去，例如按钮默认 `10px 16px` 内边距、`1px rgba(0,0,0,0.16)` 边框、
`#007aff` 文字、14px/400 字重（Material 的 48dp 点击区和 64dp 最小宽度也去掉），
`switch` 用 iOS 绿 + 白滑块，`checkbox` 用 `#007aff` + 2px 灰描边。页面自己写的
样式照常覆盖默认值——`border-color` 单独出现时按 CSS 语义算 1px 边框。

`input` 的边框、圆角、内边距一律由页面样式决定（Material 自带的
`OutlineInputBorder` 会和页面画的框叠成两层，已关掉），placeholder 两边都钉成
`#999999`。

`button` 自带按下态：`.fjs-button:active` 叠一层 10% 黑（WeUI 的
`--weui-BTN-ACTIVE-MASK`——白底按钮变灰、填充按钮变深）。Flutter 侧用 pointer
down 立刻叠这层（和 CSS `:active` 同一套，不走 Material 的 tap 竞技场——
`onTapDown` 要等 `kPressTimeout`，点按会来不及画），并关掉水波纹。Material
默认用前景色着色，填充按钮按下反而变亮，方向是反的。新增或改默认样式时以
[WeUI 组件列表](https://wechat.design/tool/weui-mobile#weui%E7%BB%84%E4%BB%B6%E5%88%97%E8%A1%A8)
和 [WeUI 源码](https://github.com/Tencent/weui) 为准，详见 [UI API 参考](ui-api.md)。

Material 还会在控件外围预留点击区（checkbox 40dp、switch / slider 48dp），一列
设置项会因此被撑开好几十像素，CSS 只按控件本身算高度——所以这些默认值也一并去
掉了（checkbox 固定 20px，switch / slider 用 `shrinkWrap`）。`disabled` 的
switch 按 `.fjs-switch.disabled` 走 50% 透明度。

未声明颜色的 `text` 用基础样式表 `body` 的 `14px / #333333`（Flutter 默认会走
主题的 `DefaultTextStyle`，颜色对不上）。

### image 的缓存与 lazy-load

`mode` 的 14 个值在两端共用一份解析（`fjs-runtime/src/image/mode.ts`，Dart 侧
`render/image_mode.dart` 逐条镜像），web 落成 `object-fit` + `object-position`，
Flutter 落成 `BoxFit` + `Alignment`。两处 web 特有的写法值得知道：

- `widthFix` / `heightFix` 落成 `height: auto` / `width: auto`。`width: auto` 在
  column flex 里仍然会被拉伸到父容器宽，所以 `heightFix` 还要一条
  `align-self: flex-start`，才和 Flutter 的 `高 × 比例` 得到同一个盒子；
- 未知 `mode` 两端都 `warnOnce` 后降级到 `scaleToFill`，不静静回落。

缓存和延迟加载的**实现**不同，但可观察的时机相同：

- Flutter 用 `cached_network_image` 的内存 + 磁盘缓存，web 就是 `<img>`，交给浏览器
  的 HTTP 缓存。fjs 不提供跨端统一的缓存管理或清理 API；
- `lazy-load` 在 web 是 `IntersectionObserver`，在 Flutter 是沿
  `RenderAbstractViewport` 往上比对 viewport（复用滚动剔除那套 RenderBox 坐标，
  没有引入 `visibility_detector`）。两边共用同一个预加载余量
  `IMAGE_LAZY_PRELOAD_PX = 240`（`fjs-runtime/src/image/lazy.ts`）——web 把它当
  `rootMargin` 传给 observer，Flutter 用它 inflate 图片矩形。少了这个常量，同一页
  在两端会在不同的滚动位置开始加载；
- 拿不到 `IntersectionObserver`（老浏览器）或者外面根本没有滚动容器时，两端都
  `warnOnce` 后**立即加载**，不假装延迟。

本地图片（`import` 进来的资源、`public/` 下的文件）两端都是根绝对路径，web 从
站点根取，Flutter 连着 dev server 时向它要、release 时读 `assets/fjs/public/`。
两处差异：

- **`.svg` 只有 web 能显示**。浏览器原生支持，Flutter 侧没有 SVG 解码器（本包
  不带 `flutter_svg`），会 `warnOnce` 说明后走 `@error`。要两端都显示就用
  PNG / WebP。
- **dev 下改 `public/` 里的图**：web 刷新即可；Flutter 侧图片缓存按 URL 建键，
  而 public 文件的路径不会变，所以 dev URL 上带了一个随完整 reload 自增的
  `?fjs=<n>`。页面 chunk 级别的热替换不会 bump 它，那种情况下要一次完整 reload
  才看到新图。`import` 的资源没有这个问题（hash 在文件名里）。

`@load` / `@error` 的载荷在 `fjs-runtime/src/image/events.ts` 编码，两端逐字符相同。
web 的宽高取 `naturalWidth` / `naturalHeight`，Flutter 取 `ImageInfo` 的
`image.width` / `image.height`；`@error` 只给固定文案，浏览器和平台各自的原始错误
都不进载荷。

### web-view 是 iframe，有三件事和 App 不一样

`web-view`（模块 `@ufjs/webview`）在 web 上是一个 `<iframe class="fjs-web-view">`。
props 与三个事件的载荷和 App 逐字符相同，但底下的 substrate 决定了三处差异，都不是
「还没做」，是浏览器就这样：

- **`@error` 基本不会来。** HTTP 404 / 500 对 iframe 来说是**成功**加载了一张错误页，
  会触发 `load`；网络层失败通常什么都不派。所以别拿 `@error` 做失败检测——要可靠，
  让网页自己在加载完成时 `fjs.postMessage('ready')`，那条消息两端都准。
- **注入不了脚本。** 跨源 iframe 里没法塞 `window.fjs`，所以网页要自带那 5 行 shim
  （`docs/ui-api.md` 有）。App 侧由 JavaScriptChannel 注入，同一行
  `fjs.postMessage(...)` 两端都能用。
- **消息要双重过滤。** `window` 的 `message` 是条公共总线：页面里任何东西都能往上发，
  别的 iframe 也有自己的。所以只认「`event.source` 是这个 iframe 的 contentWindow」
  且「形如 `{__fjs: string}`」的消息，其余**静默忽略**——那是别人的流量，不是错误，
  告警反而会刷屏。

还有一条不属于 web 但会在开发时撞到：**iOS 模拟器**里网页的中文可能是豆腐块。排查过
不是编码（字节是合法 UTF-8、响应带 `charset=utf-8`、同一份文件换 vite 服务一样）、
也不是没字体（同一个 WebView 打开 m.baidu.com 中文正常），而是页面 font stack 以
`-apple-system` / `system-ui` 开头时，模拟器的 web content 进程不再往 CJK 回退。
换一个不以它开头的 stack 即可，真机不受影响。

### textarea 的高度与确认键

`textarea` 是两端共用的 JS 组件（`components/textarea.ts`），只有渲染目标不同：
Flutter 路径渲染 `input` 元素，web 路径渲染 web 适配层的 `FjsInput`，后者吐出一个
真正的 `<textarea class="fjs-input">`。默认值、props 归一化和 `@linechange` 的
「只有变化才派」都在组件里，两端共用一份。

高度的两种形态落法不同，可观察的行为相同：

- `auto-height`：web 每次输入把内容高写回内联 `height`（量之前先临时 `rows=1` +
  `height:auto`，因为 `rows=3` 的 `scrollHeight` 是**盒子**高而不是内容高）；Flutter
  是 `maxLines: null`。关掉 `auto-height` 时 web 会把自己写的内联 `height` 还给 CSS
  ——页面自己写的内联高度不动；
- 默认（`auto-height` 关）：web `rows="3"` + `overflow-y: auto`，Flutter
  `maxLines: 3`；页面给了 CSS 高度时，web 由 CSS 决定、Flutter 走 `expands`。两边
  都是「到三行为止，之后在框里滚」。

两处 web 特有的取舍：

- **没有 resize 手柄**：浏览器默认给 `<textarea>` 一个右下角拖拽角，Flutter 没有。
  留着就是一个只在一端存在、谁也没声明过的差异，所以 `base-css.ts` 里写死
  `resize: none`；
- **`confirm-type` 在桌面浏览器上只有一半意义**：它落成 `enterkeyhint`，那是给移动端
  软键盘看的，桌面上没有键可改。但**回车的行为两端一致**——`return` 时插入换行，
  其余五个值按下回车派 `@confirm` 并吞掉换行。

`placeholder-style` 在 web 上通过四个 CSS 变量喂给 `::placeholder`（`base-css.ts`），
Flutter 解析成 hint 的 TextStyle。两边都只认那四个键，其余键在 JS 组件里就 `warnOnce`
掉了，不会一端生效一端不生效。

`@linechange` 的 `lineCount` 两端必须相同，`height` 允许差一两个像素：web 用
`scrollHeight / lineHeight` 推，Flutter 用 TextPainter 的行度量，最后一个亚像素对不齐
是正常的。

### scroll-view 的 direction

`direction: horizontal` 是 scroll-view 自己的样式键（决定 Flutter 那个
scrollable 的轴），而 CSS 里同名属性是 `ltr / rtl`——浏览器会把
`direction: horizontal` 当非法值丢掉，横向 scroll-view 于是根本滚不动。
`injectStyle()` 把它改写成它实际代表的那对 `overflow`（内联 `:style` 里的同名键
在样式归一化时同样处理），真正的 `direction: ltr | rtl` 原样放行。

到边事件（`@scrolltoupper` / `@scrolltolower`）和 `@scroll` 的载荷不在这一层
决定：规则写在 `fjs-runtime/src/scroll/metrics.ts`，web 组件直接调它，Dart 侧的
`render/scroll_metrics.dart` 逐条镜像同一份语义，所以两端派事件的时机和载荷字符串
都对得上。两处平台差异值得知道：

- **iOS 的橡皮筋回弹**会让偏移越过两端一小段，但「进入阈值区才派一次」的状态机
  是按区间判定的，回弹期间不会重复派 `@scrolltolower`；
- 浏览器不报「另一根轴」的尺寸，横向滚动时 `scrollHeight` 是 0（纵向时
  `scrollWidth` 是 0），两端一致，页面别指望拿到未滚动那根轴的长度。

滚动容器也支持鼠标拖拽：渲染器给每个 Flutter scrollable 换了接受鼠标拖拽的
ScrollBehavior，而浏览器只认滚轮和手指。拖动超过 4px 才算拖（否则点一下还是
点击），拖完那一下 click 会被吞掉——拖拽在两个平台上都不是点击。

### swiper

`swiper` 的每一页是它的一个 `swiper-item` 子节点（编译期强制，specs/051）：
`<swiper><swiper-item v-for=.../></swiper>` 交给插槽的是一个 Fragment，web 侧先摊平，
再把每个 `swiper-item` 本身当轨道格（加 `.fjs-swiper-item`），不再额外包一层
（Flutter 那边看不到 Fragment——JS 渲染器在发 op 之前就摊掉了）。render 函数或
`<slot>` 塞进来的裸子节点仍当一页，由组件包一层 `swiper-item` 并告警一次。
每页内容由 `swiper-item > *` 撑满，对齐 PageView 给每页的紧约束。

翻页由组件自己驱动，不交给 CSS scroll-snap：一次快速滑动或一次长拖会跨过好几个
snap 点，而 PageView 一个手势只翻一页。所以轨道是 `overflow: hidden`（`scrollLeft`
照样能设）+ `touch-action: pan-y`，滚轮和手指都无法在背后偷偷平移它：

- 拖拽（鼠标和手指同一套 pointer 逻辑）最多拖到相邻那一页，松手按 PageView 的
  五分之一页阈值决定翻不翻，再平滑落位；
- 触控板／横向滚轮一次手势只翻一页，其后的惯性事件在 400ms 内被忽略；
- 纵向滚轮原样放行，页面照常滚动；
- 首尾会夹住，窗口尺寸变化后仍停在当前页（`ResizeObserver` 重新对齐）。

`circular` 两端实现不同：Flutter 用一个无边界的 PageView 取模，web 复制首尾两页
再在越界时无声跳回。但 `@change` 的语义相同——两端报的都是**真实索引**，页面永远
看不到克隆页的号（取模逻辑同样来自 `scroll/metrics.ts` 的 `wrapIndex`）。

翻页后回派 `@change`（旧名 `@page-changed` 仍可用），载荷与 Flutter 一致。

### picker-view

`picker-view` 在 web 侧用原生滚动和 `scroll-snap-type: y mandatory` 做吸附，
每列是一个纵向 snap 容器；`picker` 仍是和 Flutter 共用的 JS 组件，弹层、四种
mode 的列生成、确定/取消都不分平台。几何值和 Flutter 侧钉在同一组 WeUI 扁平滚轮
数字上：行高 44px、可见 5 行、容器高 220px、居中 44px 选中框，上下各 88px 蒙层
渐隐。

滚动结束的语义两端一致，都是「停下才派一次」：现代浏览器优先用 `scrollend`，
老 Safari 没有这个事件时用 150ms 防抖兜底。Flutter 的 `ListWheelScrollView` 在
iOS 上会带系统触感反馈；web 没有触感，这是 picker 系列目前唯一用户可感知的
平台差异。

## 已知差异

- **`fjs debug` 仅 App 端**（spec 088）：断点调试器是开发者工具而非页面能力，
  不适用两端同源——web 构建在浏览器里跑，用浏览器自带 DevTools（Vite 的
  source map）。App 的 dev 模式由 spec 094 把 Vue SFC map 接到同一套
  Chrome DevTools 上。页面代码零改动，两端契约不受影响。
- **dev 热更新**：`fjs dev --web` 下页面收到任何变更推送都是整页刷新
  （`fjs dev --pages` 对 App 端可以做到 unit / page 级热替换，spec 037）。
  浏览器没有「VM 重建」的成本，整页刷新与热替换开销同量级；用户自建 vite
  工程（`dev:web`）则是 vite 原生的组件级 HMR。
- **`flex-direction: row` 的交叉轴默认值**：Flutter 是 `center`，CSS 是
  `stretch`。在乎的地方显式写 `align-items`。
- **页面状态**：web 默认 `<KeepAlive>`，按历史栈条目各挂一份外壳（各自的
  `<scroll-view>`）。新 `push` 从 `(0, 0)` 起，返回还原离开时那一页。**只缓存
  还在栈上的页**：pop 掉的那一页连同它的状态一起销毁，和 Flutter 出栈即 dispose
  一致——再 `push` 同一个路径拿到的是一个全新组件，不会看到上次留下的计数。完全
  不缓存（连返回也重挂）传 `keepAlive: false`。Flutter 侧还有一类显式保活：
  `meta.tab` 页面在 tab 间切换时只隐藏不卸载，直到离开 tab 组才释放；web 侧的
  tab KeepAlive 与此对齐。
- **`refresh` 下拉刷新**：web 只做了触摸端的简化版；纯桌面浏览器上拉不出来。
  这类页面可以用 `<route>` 的 `"platforms": ["app"]` 只在 App 端提供。
- **`platforms` 门控**：web 构建的路由表里不会出现 App 专属页面，页面代码也不会
  进产物。
- **触摸事件**：web 侧由 pointer 事件合成（所以鼠标也能跑同一份拖拽代码），
  一次 `pointermove` 只带一根手指，而 Flutter 会把一帧内多根手指的移动合成
  一条事件。`preventDefault()` / `stopPropagation()` 在 web 上是真的转发给
  原生事件，Flutter 上是空实现——两端都生效的是 `touch-action`。
- **`<canvas>` 的底子不同**：web 侧是浏览器原生的
  `CanvasRenderingContext2D`，App 侧是 JS 的同名状态机 + Flutter 回放。两个
  后果：① 浏览器的 context 上有的方法（`getImageData`、`filter`、
  `roundRect`…）在 fjs 的类型里根本不存在，写了会编译报错——**以
  [canvas-compat.md](canvas-compat.md) 为准，不要以浏览器为准**；②
  `measureText()` 的数值两端有亚像素差（Flutter 的 `TextPainter` 对浏览器的排版
  引擎），阴影模糊也只是近似。`getContext('webgl')` 在 web 上同样返回 `null`：
  浏览器明明有，但让它在这里能用，就等于让页面在浏览器上跑通、到 App 上空白。
- **`<button loading>` 的转圈**：Flutter 用 Material 的
  `CircularProgressIndicator`，web 用一圈 CSS 动画。行为一致（转圈期间按钮不
  派发 tap，且**不**像 `disabled` 那样变淡），但两者的线宽与转速不是像素级
  相同。
- **`<label>` 不是原生 `<label>`**：web 侧渲染成普通容器 + JS 转发。原生
  `for` 只认真正的表单元素，而 fjs 的 checkbox / radio / switch 在 DOM 里是
  自定义元素，混用会一半走原生一半走 JS，且原生 label 包住 input 时点击会触发
  两次。转发时会跳过「点击本来就落在控件上」的情况——Flutter 上这件事由手势
  竞技场天然完成。
- **`picker-view` 的触感反馈**：iOS 端滚轮来自 `ListWheelScrollView`，滚到整项时
  有系统触感；web 端用 scroll-snap，没有触感。事件载荷、吸附到整项和默认几何
  保持一致。
- **滚轮（`picker-view`）的手感**：吸附与惯性两端都交给平台——Flutter 是
  `ListWheelScrollView`，web 是 `scroll-snap-type: y mandatory`，谁也没手写
  减速曲线。差别有两处：iOS 滚到每一项时有系统触感反馈（关不掉，也无法在 web
  复现）；`@change` 的「停下」在 Flutter 是控制器的落位回调，在 web 优先用
  `scrollend`，老 Safari 没有这个事件时退回 150ms 防抖。几何取的是同一组数值
  （44px 行高、5 行、居中一条 1px 选中框、上下 88px 渐隐）。
- **图片缓存**：Flutter 走 `cached_network_image`（内存 + 磁盘，进程内命中不再发
  请求），web 走浏览器 HTTP 缓存。命中缓存时两端都仍然只派一次 `@load`，但「什么
  时候算命中」由各自的实现决定，页面别拿它做逻辑。
- **`<textarea>` 的 resize 手柄**：浏览器默认能拖右下角改高，Flutter 不能，所以
  fjs 关掉了它。要可调高度就自己做，不要指望浏览器默认值。
- **`<rich-text>` 的 margin 折叠只做了一半**：浏览器里相邻块的上下 margin 会折叠，
  而 fjs 两端的容器都是 flex，不折叠。rich-text 在 JS 里把**默认样式给的** margin
  （`p`、`h1`–`h6`、`ul`…）按 CSS 折叠好了；页面 class 或 `style` 属性给的 margin JS
  看不到解算结果，不折叠——两端一致，但会比浏览器里多出一段间距。
- **`<rich-text>` 里的 HTML 不走浏览器解析**：web 侧也用 runtime 自带的解析器，不用
  `DOMParser` / `innerHTML`，残缺 HTML 的容错规则两端相同，但和浏览器不是逐条一致
  （没有做格式元素的 adoption agency：`<b><p>x</b>y</p>` 的尾巴样式可能不同）。
- **`el.style`（DOM 形状）在 App 端是合成物**：为了 `@vueuse/motion` 这类
  直接写 `el.style[key] = v` 的 DOM 库，fjs 元素在 App 端合成了一个 `style`
  对象（spec 042）。写入走样式引擎的 inline 层（与 `:style` 绑定共用一条
  记录，谁也不覆盖谁），但与真 DOM 有两处差异：**读**只返回 inline 记录里
  已写的值，读不到级联/计算样式（没有 `getComputedStyle` 语义）；motion 的
  `hovered` / `tapped` / `focused` / `visible` 变体在 App 端不生效——它们要
  DOM 事件监听与 IntersectionObserver。`initial` / `enter` / 命名变体 /
  spring 过渡两端一致（Anime.js 走对象通道是另一种接法，见 spec 031）。
- **页面组件要有单一根节点**：页面转场用 `<Transition>` 包着，多根节点会退化。
- **`getBoundingClientRect` / `offset*` 在 App 的 navMount 窗口内不强制重排**
  （specs/086）：刚 push 进来的节点第一拍可能量到 0，下一 Flutter 帧才
  layout 上屏；页面已挂上之后同一 tick 改树再读仍强制重排（specs/073）。
  浏览器里 `getBoundingClientRect` 始终可强制重排，没有这个窗口。

## 选项

```ts
createFjsApp({
  routes,
  shell: Shell,
  history: 'hash',      // 默认；'history' 需要服务端回退到 index.html
  keepAlive: true,      // true / false / 数字（最多缓存几页）
  transition: 'fjs-page', // 或 false 关掉页面转场
  el: '#app',
});
```

`history` / `keepAlive` / `transition` / `el` 只在 web 生效，Flutter 侧忽略；
`rootTag` 只在 Flutter 生效。两边共用一份 options 是刻意的——`main.ts` 不用分叉。

## 相关

- [路由](routing.md)
- [UI 标签参考](ui-api.md)
