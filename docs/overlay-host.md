# overlay 宿主：`position: fixed` 在 App 端去了哪里

> 专题文档（specs/069 → 070 → 129 → 133）。改 `position: fixed` 的 hoist、
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

`<Teleport to="body">`（vant Popover、`teleport="body"` 的 Popup）落在同一个宿主里。

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

## 4. 页面代码怎么写

- **想要"盖住页面、钉在屏幕上"才用 `position: fixed`**。只是想让元素叠在某个容器里，
  用 `absolute`：它留在页面里，没有宿主这一层。
- fixed 元素**脱离了原父节点**：scoped 后代选择器（`.block .x`）匹配不到它，
  继承样式也断开（同 web teleport 到 `<body>`）。给它写不依赖祖先的类选择器。
- `left` / `top` 为 `auto` 时贴 0，不是 CSS 的 static position，需要两端一致就显式写偏移
  （demo `vant-float` 的 `.van-sticky--fixed { left: 28px }`）。
- 宿主内元素之间按 `z-index` 排序，相等时保持插入顺序；和页面内元素之间不建模层叠上下文。
- 不经 safe-area 包裹：`top: 0` 会顶进状态栏区域。
- `position` 不再是 `fixed` 时元素回到原父节点的原位置（specs/129）。

## 5. 已知差异

| | App | Web |
|---|---|---|
| 模态时返回 | 拦截 | 浏览器后退**不拦截**，直接离开页面（没有 pushState 垫历史） |
| 转场 | 跟随页面的平移 / 缩放；透明度只按路由动画整体淡出，不逐像素复刻 builder 的效果 | 原生随页面 |
| 自建路由 | 宿主 App 自己用路由包 `FjsView` 时，要自己包 `FjsRouteAnchor`，否则宿主内容不随转场（退回旧行为） | — |
| 覆盖范围 | Navigator 区域；宿主 App 在 FjsApp 之外的 chrome 不被覆盖 | 视口 |

## 6. 相关文件

| 文件 | 作用 |
|------|------|
| `packages/fjs-runtime/src/vue/renderer.ts` | hoist / unhoist、`querySelector('body')`、`isModalMask`、宿主 `modal` 属性 |
| `packages/flutter_fjs/lib/src/node/overlay_host_adapter.dart` | `OverlayPortal`、`PopScope`、`_FollowRoute`（跟随锚点）、`z-index` 排序 |
| `packages/flutter_fjs/lib/src/widgets/route_anchor.dart` | `FjsRouteAnchor`：页面锚点（`LayerLink`） |
| `packages/flutter_fjs/lib/src/fjs_app.dart` | 每页包锚点；系统返回键 → `maybePop` |
| `packages/fjs-runtime/test/vue_overlay_pseudo.test.ts` | hoist 与模态判定测试 |
| `packages/flutter_fjs/test/overlay_host_test.dart` | 锚定、转场跟随、返回拦截测试 |
