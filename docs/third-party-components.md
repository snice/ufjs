# 三方组件库适配规范

> 第二层第 9.6 篇。写给要把一个第三方 Vue 组件库（vant、varlet、nut-ui……）
> 接进 fjs 的人。这份规范是从 vant 4 的完整适配（specs/068–134，2026-09）里
> 沉淀出来的打法，每一个条目都被真机对拍检验过；vant 的逐项落账见
> [vant-adaptation.md](vant-adaptation.md)，CSS 支持矩阵见
> [css-compat.md](css-compat.md)，首开性能专账见
> [vant-mount-perf.md](vant-mount-perf.md)。

## 为什么组件库要适配

Vue 生态的移动端组件库是按真浏览器写的，它们默认存在的四样东西，fjs 的
App 端（QuickJS + Flutter）都没有或有差异：

| 浏览器默认 | App 端现实 | 组件库踩到的典型症状 |
|---|---|---|
| `window` / `document` 全局 | 不存在，runtime **有意不模拟** | `ReferenceError` 把组件更新中途打断 |
| DOM 元素（Node 树、CSSStyleDeclaration） | fjs element（影子树 + 内联样式层） | `el.contains` / `inputRef.blur()` 抛 `TypeError: not a function` |
| 完整 CSS | 支持面见 [css-compat.md](css-compat.md) | 伪元素、属性选择器、`position: fixed` 各有边界 |
| 挂载即布局 | 页面树先建后显示，挂载帧量几何得全零 | Tabs 下划线停在 0、测高截断失效 |

适配的总思路不是「把 App 端伪装成浏览器」，而是**分层**：能通用的进
runtime（所有库受益），库特有的留在项目本地（升级可控），全局假象由项目
自己按需 opt-in（影响面锁死）。

## 四条总纲

1. **通用的进 runtime，库特有的留项目本地。** 判断标准：换个库还需要吗？
   `element.contains`、`<Transition>`、伪元素渲染是任何 DOM 式库都要的 →
   runtime（先 `/spec`）；vant 的 `useLockScroll` 守卫、Tabs 下划线重试是
   vant 自己的代码路径 → 项目本地插件。机制见
   [toolchain.md 的 `fjs.app` 钩子](toolchain.md#ui-组件库适配vite-插件的-fjsapp-钩子)。
2. **`window` / `document` 不在 runtime 模拟。** 给全局塞浏览器假象会翻转
   每个库里 `inBrowser` 之类的求值期判断，影响面不可控（specs/070 的结论）。
   库在模块求值时决定 `inBrowser`、且不做浏览器判断的路径很多时，由项目
   **为一个库 opt-in 一个只含它所需表面的最小侧影**（vant 的落法是
   `plugins/vant/dom-env.ts`，求值顺序抢在库前面）。
3. **显式降级优于坏 bundle。** 对库源码的补丁一律用**字面量锚点替换**：
   库升级后锚点对不上就跳过该补丁、构建告警一次并写明哪个功能在 App 端
   失效——降级成「这个功能又坏了」，而不是产出坏 bundle。
4. **两端同源。** 为适配新增的任何面向用户的能力（标签、样式、事件、API）
   Flutter 侧（`flutter_fjs/lib/src/`）和 web 侧（`fjs-runtime/src/web/`）
   都要成立，事件载荷一律字符串；小程序端还有第三份映射要核对
   （[miniprogram.md](miniprogram.md)）。只做一端等于没做。

## 接入清单（六步）

demo 的 vant 接入是参考实现，四个文件加一个侧影各管一件事
（[vant-adaptation.md](vant-adaptation.md) 有逐文件说明）。换一个库照此走：

1. **注册与样式**：`src/plugins/<lib>.ts`（**无平台后缀**——带 `.app.ts` /
   `.web.ts` 会静默跳过另一端，页面在那一端报
   `Failed to resolve component`）。对用到的组件逐个 `app.use` 全局注册；
   样式按需引入写进同一文件（esbuild 不做目录 index 推导，`vant/es/<comp>/style/index.mjs`
   这类路径必须写全），App 构建把每条样式 import 抽成 `registerStyles()`
   调用、web 端消费 CSS——一份清单同时喂两端。
2. **全局侧影（若需要）**：库在模块求值时判断 `inBrowser` 的，侧影 import
   必须放在插件文件**第一个**（ESM 按序求值）。只放库真正读的表面：
   `requestAnimationFrame`、读 fjs 样式引擎的 `getComputedStyle`、
   document 级 pointer-down 流、「首次可见」的 `IntersectionObserver`……
   每一项都要有「库哪里读它」的注释。web 构建里这些代码不运行。
3. **`fjs.app` 补丁**：本地 vite 插件（放 `vite/<lib>.ts`，和 vite.config
   放一起，不单独发 npm 包），对库源码做锚点替换。补丁通常落在三类：
   - `window` / `document` 守卫——库没做浏览器判断就摸全局的路径
     （App 端直接 `ReferenceError` 并把组件更新中途打断）；
   - `touch-action` 声明——在 scroll-view 里拖动的组件（Slider、Rate 这类）。
     web 上靠非 passive `touchmove` 里 `preventDefault()` 赢下手势，App 端
     监听在 JS 里跑、晚 Flutter 手势竞技场一帧，只有 `touch-action` 这个
     声明是两端都认的抢手势方式；
   - 测量重试——挂载帧读 `offsetLeft / offsetWidth` 还是 0 的，按 rAF
     重试至多 10 帧，量到为止（有界：真隐藏的组件不会无限重试）。
4. **web-only 插件**：只影响浏览器行为的适配带 `.web.ts` 后缀（如桌面
   浏览器引 `@vant/touch-emulator` 把鼠标转 touch——移动端库的清除图标、
   拖动只听 touch 事件）。App 端触摸本来就是 touch 事件，不需要。
5. **类型**：库自带 `GlobalComponents` 声明的（vant 4.10 起）什么都不用
   做；不带的手写一份 `GlobalComponents` 增强并和注册列表保持同步——
   插件管运行时，这个文件管 `vue-tsc` strictTemplates。
6. **两端对拍验收**：浏览器（375×812 或 393px 视口）↔ iOS/Android 模拟器
   逐屏截图对比 + 交互对拍（打开弹层、拖动、输入、点外关闭、返回键）；
   `pnpm test` + `flutter test` 回归网不破；新补丁的锚点缺失要有告警测试。
   验收口径写进 spec，页面源码一行不改是最高标准。

## runtime 已有通用面（接库前先查这里）

**接库遇到缺口的第一个动作是查这张表**——很多「vant 坏了」其实是
「vant 用到了一个 runtime 已经补好的东西，但你的调用姿势不对」。

### DOM 形状 API（元素上）

任何元素（经 `ref`、或作为事件 `target`）都带，按 DOM 写法操作的库不需要
fjs 适配。完整定义见 [ui-api.md](ui-api.md#元素上的-dom-形状-api)：

| 成员 | 说明与边界 |
|---|---|
| `el.style` | DOM 式写入面，走内联层；读不到层叠结果，只有内联值 |
| `getBoundingClientRect()` / `offset*` | navMount 当次不强制重排（全零）；页面挂上之后同一 tick 读会重排 |
| `isConnected` / `parentNode` / `nodeType` / `tagName` | 影子树的逻辑父链；`tagName` 是 fjs 标签大写 |
| `scrollTop` / `scrollLeft` / `clientTop` / `clientLeft` | 读最近一次 scroll 事件报告的偏移；可写不真滚 |
| `setAttribute` / `removeAttribute` | 与模板里写同名属性等价（popperjs 写 `data-*` 靠它） |
| `addEventListener` / `removeEventListener` | 事件名同 `on<Name>` prop；`passive` / `capture` 选项忽略 |
| `contains(other)` | 影子树后代判断；`::before` 盒上的按下 target 映射回宿主元素 |
| `focus()` / `blur()`（input/textarea） | 经 `fjs.control.*` 宿主模块路由到控件的 FocusNode |
| `value`（input/textarea） | DOM 式读写；`setSelectionRange()` 空操作 |

### vue-shim 导出（`vue` 包在 App 端的别名层）

组件库的 barrel 无条件 `import { vShow, withKeys, Transition, createApp } from 'vue'`——
这些名字只存在于 runtime-dom，缺一个整个构建就失败。shim
（`fjs-runtime/src/vue/vue-shim.ts`）逐个补上，语义按 fjs 的现实重述：

| 导出 | 语义 |
|---|---|
| `<Transition>` | fjs 版（BaseTransition + 样式引擎翻类）：animation 型 enter/leave 规则由 keyframes 引擎原生播放，transition 型由 App 端补间；结束时机取计算样式里 animation/transition 的「时长+延迟」较长者（没有 transitionend 可听） |
| `vShow` | 只碰内联 `display` 一项，元素其余规则不动（整张替换计算样式会让库组件丢样式） |
| `withKeys` | 直通——fjs 事件不带键码，处理器照跑而不是永不触发 |
| `<TransitionGroup>` | 纯透传 |
| `createApp` | 指名抛错——挂第二个根要真实 DOM 容器；库的命令式 API 内部 `document.createElement` + `createApp` 的（vant `showToast()`），App 端不可用，改用组件式写法 |
| `measureTextBlock` | 经 `__FJS_SHARED` 暴露给侧影：让库的测高逻辑用宿主排版（vant TextEllipsis 的二分截断靠它） |

另一条构建期修正：静态提升产出的 `createStaticVNode` 走
`insertStaticContent`（innerHTML 语义），本 renderer 没有——App 构建以
`hoistStatic: false` 编译 SFC（specs/070）。

### 事件契约

- 首参形状按**编译期标签**判定：fjs 内置标签收裸载荷（字符串），HTML/SVG
  标签（库渲染的 `div` / `span`）收模拟事件对象（`detail` / `target` /
  `clientX`）（specs/103）。
- tap/click 沿父链冒泡，`event.target` 是被点节点、`currentTarget` 是监听
  节点，`.stop` / `.self` / `.once` 生效；没有更深层 target——委托判断
  （`icon.contains(event.target)`）用 `contains()` 顶（specs/129）。
- `touchstart` / `touchmove` / `touchend` / `touchcancel` 任意标签可听，
  载荷对齐 DOM（specs/073 起）。
- document 级 pointer-down 流经 `__FJS_SHARED['fjs/vue'].onGlobalPointerDown`
  供给侧影，click-away（点外关闭）靠它。

### 浮层（`position: fixed` / Teleport）

fixed 元素被 renderer hoist 进页面自己的 overlay 宿主，随路由转场、模态
遮罩拦截返回；`<Teleport to="body">` 落到同一个宿主，其它选择器没有 DOM
可查。视觉与交互等效、不是 DOM 语义。详见
[overlay-host.md](overlay-host.md)。

### CSS 支持面（组件库高频项）

矩阵见 [css-compat.md](css-compat.md)，接库前重点核对：`:root/:host`
自定义属性（组件库主题 token 都声明在这）、`::before` / `::after` /
`::placeholder`、属性选择器（`[class*=…]`、`[data-*]`）、相邻兄弟 `+`、
`:disabled`、`font` 简写与 `@font-face`（图标字体）、`flex` 各默认值修正、
`border-radius: %`、`% padding`、`position: fixed`、`z-index`、`transition`
支持面、keyframes（`var()` 帧内解析）、SVG（含渐变）。

## 缺口分级：遇到问题怎么判

| 级别 | 判定 | 动作 |
|---|---|---|
| A | 用法越过了 runtime 已有 API 的**登记边界**（如把 `el.style` 当完整 CSSStyleDeclaration 读层叠结果） | 改调用姿势或加侧影垫层；runtime 不扩 |
| B | 缺的能力是**通用的**（换个 DOM 式库也需要） | 走 `/spec` 补进 runtime：CSS 进 [css-compat.md 第 6 节](css-compat.md#6-加一条新的-css-支持要改哪些地方) 流程；DOM API 进 `ui/element.ts` + web 侧同源实现 |
| C | 缺的路径是**这个库特有的**（守卫、重试、换声明） | 项目本地 vite 插件打锚点补丁；补丁要带 `feature` 说明，锚点失效能告警 |
| D | 库的设计**依赖真 DOM 无法模拟**（命令式 `createApp` 挂载、`attr()` 伪元素 content、深层事件委托） | 不硬模拟。登记为已知差异 + 换组件式写法（`<van-dialog v-model:show>`） |

判成 B 但急着跑通的，可以在 C 层临时垫（注明「等 spec 上收」），垫的部分
进 spec 的验收清单。

## 工作量预期

vant 是这条路线的完整标定，可作为预估参照（明细见
[vant-adaptation.md](vant-adaptation.md)）：46 个组件、6 个对拍页，直接由
它驱动的 spec 29 个、非 merge 提交 41 个、变更约 3.2 万行（含 runtime /
Dart / CLI / 测试 / 文档），其中**项目本地的适配代码只有 858 行**——大头
（CSS 引擎、DOM 形状 API、浮层、性能）都落成了 runtime 的通用能力。第二
个库的接入成本远低于第一个：先查「runtime 已有通用面」，预计只剩
注册/样式、侧影裁剪、少量补丁和类型。
