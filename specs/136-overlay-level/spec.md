# Spec: fixed 元素的 overlay 宿主级别（页面级 / app 级）

- **ID**: 136-overlay-level
- **状态**: in-progress
- **日期**: 2026-09-25
- **来源**: specs/135 对拍时确认的全页水印归属问题（页面级宿主随页面离场）
- **已定**: 属性名 `overlay="app" | "page"`（用户确认）；web 端**不做** portal，
  按宪法 I 登记差异；**Teleport `to="body"` 改指 app 级宿主**（用户确认）——
  这同时让 App 端对齐 web 的真实行为：web 上 teleport 到 body 的 DOM 本来就
  活在页面之外、随组件树卸载才消失。

## 1. 要解决什么

App 端 `position: fixed` 元素一律 hoist 进**本页的页面级 overlay 宿主**
（specs/133：宿主贴本页 entry、随路由转场、页面 pop 即销毁）。唯一的 app 级
浮层是 `toast()`（specs/134，FjsApp 上的 `FjsToastHost`），但那是宿主模块调用，
业务元素进不去。于是"跨页存活的业务浮层"——常驻水印、全局 loading、跨页
悬浮球——两端都做不出来：

- App 端：页面 push 后被盖住（页面级宿主贴本页 entry 之下），pop 后销毁。
- Web 端：更根本没有这层（原生 fixed 跟着页面 DOM 走，KeepAlive 把页面
  detach 后元素就没了，docs/overlay-host.md §1 末尾）。

现在的替代是**把 fixed 元素放进 Shell 层**（Shell 的宿主随 app 存活），但这
是位置巧合不是语义：Shell 不是"页面"却要当页面宿主的持有者，且对"某页面
里发起、但要跨页存活"的浮层（如页面 A 里点开的悬浮球）无解。

### 方案（推荐）：元素属性 `overlay="app"`，默认 `page`

```html
<van-watermark overlay="app" content="内测环境" />   <!-- 跨页存活 -->
<van-popup overlay="page" ... />                      <!-- 现状，默认 -->
```

- **JS 侧**（`fjs-runtime/src/vue/renderer.ts` hoistIfNeeded）：解析出
  `position: fixed` 后按元素属性 `overlay` 分流——`app` 进 app 级宿主，
  缺省/`page` 走现状。app 级宿主是新保留 tag `fjs-app-overlay-host`（JS 侧
  create 后 reparent，op 协议零改动——属性是标量，宿主路由是纯 JS 记账）。
- **Dart 侧**：新 adapter 仿 `overlay_host_adapter.dart`，但**没有**
  PopScope/modal、**不跟随** `FjsRouteAnchor`——它画在 FjsApp Navigator 的
  Overlay 最顶层（toast 宿主同层），不随任何页面转场。内部沿用 z-index 稳定
  排序（specs/129）。
- **所有权不变**：元素的逻辑父链仍在发起页面（`hoistedFrom` 记账已有），
  页面 pop → Vue 卸载 → 元素从 app 宿主移除。app 宿主只是"画的地方"，
  不是常驻缓存，不引入新的泄漏面。语义上 `overlay="app"` = **本页面在栈内
  期间画在所有页面之上**；要真正永驻，元素由 Shell 层持有 + `overlay="app"`。

### 两端同源（宪法 I）的关键点

web 端没有 hoist 层，`overlay="app"` 必须有同义实现才不算只做一端：web
适配层把该元素真 portal 到 body 级容器（`fjs-runtime/src/web/components/`
overlay.ts 扩展），页面 KeepAlive detach 不影响它。**这是本 spec 的主要
工作量**；若决定 web 端先不做，须按宪法 I 登记差异（web 上退化为页面级）。

### 语义细节（已定）

- 页面转场：app 宿主子树**不随**转场（这正是它的意义）；发起页 pop 时元素
  随 Vue 卸载销毁（所有权记账不变）。
- modal/返回（实测后用户改定）：app 宿主里**只要有可见元素（display 不是
  none）就拦系统返回**——iOS 侧滑、Android 物理返回，根页面上也不退出 App；
  `router.back()` 不拦。常驻水印放根页面 + `overlay="app"`，不受影响。
  另：`pointer-events: none` 的全屏层不再算 specs/133 的模态遮罩。
- `overlay` 属性变更：**支持迁移**（page↔app 双向，hoist 记账已有搬移原语；
  patchProp 路径检测值变化即迁移）。
- z 序：app 宿主整体在所有页面宿主之上（与 toast 宿主同层的 persistent
  widget，toast 在其上），宿主内部按 z-index。
- 挂载点（Dart）：app 宿主根是**独立的无父根**（`createRoot('fjs-app-overlay-host')`
  + `__appOverlay: true` 标记，进 `tree.rootChildren`），由 FjsApp 里
  Navigator 之上的 persistent widget（FjsToastHost 同层先例）渲染——页面级
  宿主的 OverlayPortal 走 theatre 语义，被新页面盖住，达不到 app 级，不能复用。

## 2. 验收标准

- [ ] JS 单测：hoist 路由按 `overlay` 属性分流（默认 page 不回归）；app 宿主
      根的创建/元素进出记账；`overlay` 变更迁移；Teleport `to="body"` 指向
      app 宿主。
- [ ] Dart 单测：`fjs-app-overlay-host` 根渲染在 Navigator 之上（push 新页不
      被盖）、不随页面转场、子树随 Vue 卸载消失；base 页（navKey 0）不重复
      渲染它。
- [ ] demo（vant-watermark 页）：`overlay="app"` 的水印，push 第二页仍显示、
      页面级对照被盖住；发起页 pop 后水印消失。
- [ ] web 端：`overlay` 属性无效果（原生 fixed 跟页面 DOM），差异登记进
      docs/overlay-host.md；Teleport to body 在 web 本来就是 body 级 ✓。
- [ ] `pnpm test` + `flutter test` 回归网不破；docs/overlay-host.md 增补级别
      一节。

## 3. 不做

- 不做 CSS 属性方案（归属是结构决策，属性翻转的跨宿主迁移语义含糊；
  Vue Teleport 的先例也是元素属性 `to`）。
- 不做三级以上/命名宿主（只有 page/app 两级）。
- 不改 `<Teleport>` 语义、不把 toast 宿主并进来（`toast()` 保持宿主模块调用）。
