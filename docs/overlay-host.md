# overlay 宿主：`position: fixed` 在 App 端去了哪里

> 专题文档（specs/069 → 070 → 129 → 133 → 136）。改 `position: fixed` 的 hoist、
> `fjs-overlay-host` 的 Dart 适配、页面返回语义之前先读这一篇。

## 1. 它是什么

Flutter 没有"相对视口定位"：`position: fixed` 如果留在原地，会随页面一起滚走。
所以 App 端 renderer 把**解析结果为 `position: fixed` 的元素**整体挪进页面的
overlay 宿主（保留标签 `fjs-overlay-host`，页面代码不要手写）：

```
page root
├── 页面内容（滚动）
└── fjs-overlay-host          ← renderer 第一次遇到 fixed 元素时惰性创建
    ├── .van-overlay           ← 遮罩
    ├── .van-popup             ← 弹层面板
    └── .van-sticky--fixed     ← 吸顶中的 Sticky
```

Dart 侧（`overlay_host_adapter.dart`）用 `OverlayPortal` 把宿主子树画进 FjsApp
Navigator 的 Overlay，**紧贴本页的路由 entry 之上**：

- 不随页面滚动，偏移和 `%` 尺寸参照整个 Navigator 区域；
- 新页面 push 上来会盖住它，页面 offstage 时它也 offstage；
- 宿主内容**跟着页面走**（specs/133）：FjsApp 给每页包一个 `FjsRouteAnchor`，宿主经
  `LayerLink` 跟随页面实际被画出的位置——返回时和页面一起滑走 / 缩放，不会停在上一页上面。
  非 Cupertino 式的转场（fade、zoom、Android 默认）另按路由动画淡入淡出。

`<Teleport to="body">`（vant Popover、`teleport="body"` 的 Popup）**不**进页面宿主，
进 app 级宿主（specs/136，见第 4 节）：web 上 teleport 到 body 的 DOM 本来就在页面之外。

`fjs` 的 `toast()` **不走**这个宿主：它不是 fixed 元素，App 端由 `FjsApp` 上唯一的
toast 宿主显示，跨页面（specs/134，见 [ui-api.md](ui-api.md)）。vant 的 `showToast()`
是 fixed 元素，照常进本页的 overlay 宿主、随页面离场。

Web 端没有这层：原生 CSS 的 `fixed` 本来就在页面 DOM 里，跟着路由一起走。

## 2. 谁会进宿主

只看"解析后是不是 `fixed`"，不看是哪个组件。现有来源分三类，App 端行为不同：

| 类别 | 例子 | 返回键 / 侧滑 | 说明 |
|------|------|--------------|------|
| **模态弹层** | vant Overlay 遮罩及其 Popup / Dialog / ActionSheet / ShareSheet / Picker·Calendar 弹层；手写的全屏遮罩 | **拦截** | 必须先关掉弹层才能返回 |
| 非模态浮层 | vant Toast / Notify（无遮罩）、Popover | 照常返回 | 随页面一起离场 |
| 页面级固定元素 | vant Sticky 吸顶态、NavBar `fixed`、Tabbar `fixed`、飞行动画盒（hello-fjs `HeroFly` / `shared-element`） | 照常返回 | 随页面转场，不跨页残留 |

## 3. 模态判定与返回拦截

**判定按形状，不按类名**（`fjs-runtime/src/vue/renderer.ts` 的 `isModalMask`）。
宿主里只要有一个这样的元素，就算模态：

- `position: fixed`，`display` 不是 `none`，`visibility` 不是 `hidden`；
- `pointer-events` 不是 `none`：触摸点穿的全屏层（vant 全页 Watermark）不挡页面，也不拦返回；
- `left` 和 `top` 为 0；
- 横向铺满：`right: 0` 或 `width: 100%` / `100vw`；纵向同理（`bottom: 0` 或 `height: 100%` / `100vh`）。

vant 的 `.van-overlay`（`top: 0; left: 0; width: 100%; height: 100%`）刚好是这个形状。
自己写遮罩也照这个写，不用额外标记。

判定结果以宿主节点的 `modal` 属性（布尔，经已有的 `setProps`）传给 Dart，
Dart 在页面路由上挂 `PopScope(canPop: !modal)`：

| 返回入口 | 模态开着时 |
|---------|-----------|
| iOS 左边缘侧滑 | 手势不启动 |
| Android 物理返回 / 预测式返回 | 不返回（FjsApp 的 `NavigatorPopHandler` 走 `maybePop`） |
| 宿主 Flutter 代码里的 `Navigator.maybePop` / `BackButton` | 不返回 |
| 页面代码自己调 `router.back()` | **不拦截**：业务主动的跳转由业务负责 |

debug 构建里被拦下会打印 `fjs: back held — a modal mask is open in the overlay host`。

**副作用要知道**：

- 遮罩的离场动画期间（vant 默认 0.3s）仍算模态，返回会被拦。
- `showToast({ forbidClick: true })` 会铺一层透明全屏遮罩，Toast 显示期间返回被拦。
  这与"遮罩挡住页面交互"的语义一致。

## 4. 宿主级别：页面级 / app 级（specs/136）

fixed 元素默认进本页的**页面级**宿主（上面几节说的都是它）。加元素属性 `overlay="app"`
改进 **app 级**宿主：

```html
<van-watermark overlay="app" content="内测环境" />
```

| | 页面级（默认） | app 级（`overlay="app"`） |
|---|---|---|
| Dart 挂载 | `OverlayPortal`，贴本页路由 entry | `FjsAppOverlayHost`，FjsApp 里 Navigator 之上、toast 宿主之下 |
| push 新页面 | 被盖住 | **不被盖**，画在所有页面之上 |
| 发起页面离场 | 随页面销毁 | 同样随页面（Vue 卸载）移除——所有权不变，宿主只是"画的地方" |
| 系统返回 | 有模态遮罩才拦 | **只要有可见元素就拦**（见下） |

- app 宿主根是保留标签 `fjs-app-overlay-host` 的无父根（`__appOverlay` 标记），JS 侧
  惰性创建、每个 VM 一个；op 协议无改动，`overlay` 属性不过桥。
- `overlay` 值变化时元素在两个宿主间**迁移**，两边页面宿主的 `modal` 随之重新推导。
- **返回拦截**：app 宿主里只要有 `display` 不是 `none` 的子元素，iOS 侧滑、Android
  物理返回（包括根页面上的"退出 App"）都被拦下，debug 打印
  `fjs: back held — an overlay="app" element is up`。`router.back()` 照常返回。
  隐藏的不算：关掉的 Popover 靠 `v-show` 留在宿主里，不能让它一直拦返回。
- **放在哪一层**：要跨页常驻的浮层（全局水印）放在根页面 / Shell 上再加 `overlay="app"`
  ——根页面不会被返回弹出，也就不存在拦返回的问题。子页面里开 app 级元素，等于
  "这一页在栈里时画在最上面、并且锁住系统返回"。

### 游离根：不属于任何页面的第二个 app（specs/137）

组件库的命令式弹层（vant `showToast()` 等）要挂第二个 Vue app。`fjs/vue` 的
`createDetachedRoot()` 给它一个**不插入任何父节点**的容器（相当于 web 上 body 下的
`<div>`；Dart 侧是孤儿节点，不渲染），app 卸载后 `releaseDetachedRoot(root)` 释放。
容器里的内容这样上屏：

- `<Teleport to="body">`（Toast / Dialog / ImagePreview 默认）→ app 级宿主；
- 不 teleport 的 `position: fixed` 元素（Notify）→ 逻辑父链上没有页面，也进 app 级宿主。

判定"不属于页面"沿**逻辑**父链（hoist 过的元素走 `hoistedFrom`）找 app 宿主根或游离根，
先于页面宿主的查找——后者找不到页面时会回退到栈顶页面，弹层会被那一页盖住、随它销毁。
app 宿主里的元素 `isConnected` 为 true（body 语义）。

## 5. 页面代码怎么写

- **想要"盖住页面、钉在屏幕上"才用 `position: fixed`**。只是想让元素叠在某个容器里，
  用 `absolute`：它留在页面里，没有宿主这一层。
- fixed 元素**脱离了原父节点**：scoped 后代选择器（`.block .x`）匹配不到它，
  继承样式也断开（同 web teleport 到 `<body>`）。给它写不依赖祖先的类选择器。
- `left` / `top` 为 `auto` 时贴 0，不是 CSS 的 static position，需要两端一致就显式写偏移
  （demo `vant-float` 的 `.van-sticky--fixed { left: 28px }`）。
- 宿主内元素之间按 `z-index` 排序，相等时保持插入顺序；和页面内元素之间不建模层叠上下文。
- 不经 safe-area 包裹：`top: 0` 会顶进状态栏区域。
- `position` 不再是 `fixed` 时元素回到原父节点的原位置（specs/129）。

## 6. 已知差异

| | App | Web |
|---|---|---|
| 模态时返回 | 拦截 | 浏览器后退**不拦截**，直接离开页面（没有 pushState 垫历史） |
| 转场 | 跟随页面的平移 / 缩放；透明度只按路由动画整体淡出，不逐像素复刻 builder 的效果 | 原生随页面 |
| 自建路由 | 宿主 App 自己用路由包 `FjsView` 时，要自己包 `FjsRouteAnchor`，否则宿主内容不随转场（退回旧行为） | — |
| 覆盖范围 | Navigator 区域；宿主 App 在 FjsApp 之外的 chrome 不被覆盖 | 视口 |
| `overlay="app"` | 进 app 级宿主：push 不盖、有可见元素时拦系统返回 | **无效果**：原生 fixed 跟页面 DOM 走，KeepAlive 把页面 detach 后元素也不见；浏览器后退不拦（specs/136，宪法 I 登记） |
| `<Teleport to="body">` | app 级宿主（同样拦返回） | 真 body，不拦后退 |

## 7. 相关文件

| 文件 | 作用 |
|------|------|
| `packages/fjs-runtime/src/vue/renderer.ts` | hoist / unhoist、`querySelector('body')`、`isModalMask`、宿主 `modal` 属性、`overlay` 分流与迁移、游离根 |
| `packages/flutter_fjs/lib/src/widgets/app_overlay_host.dart` | app 级宿主渲染、`FjsAppOverlayBackGuard` 返回拦截 |
| `packages/flutter_fjs/lib/src/node/overlay_host_adapter.dart` | `OverlayPortal`、`PopScope`、`_FollowRoute`（跟随锚点）、`z-index` 排序 |
| `packages/flutter_fjs/lib/src/widgets/route_anchor.dart` | `FjsRouteAnchor`：页面锚点（`LayerLink`） |
| `packages/flutter_fjs/lib/src/fjs_app.dart` | 每页包锚点与 app 级返回守卫；系统返回键 → `maybePop` |
| `packages/fjs-runtime/test/vue_overlay_level.test.ts` | 级别分流、迁移、Teleport、卸载清理 |
| `packages/flutter_fjs/test/app_overlay_host_test.dart` | app 宿主不被盖、只画一次、返回拦截 |
| `packages/fjs-runtime/test/vue_overlay_pseudo.test.ts` | hoist 与模态判定测试 |
| `packages/flutter_fjs/test/overlay_host_test.dart` | 锚定、转场跟随、返回拦截测试 |
