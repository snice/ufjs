# Plan: overlay 宿主专题——跟随页面转场、模态拦截返回、使用范围收口

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 转场跟随、模态拦截只在 Flutter 侧有问题：web 的 fixed 本来就在页面 DOM 内随路由走。Flutter 改 `lib/src/node/overlay_host_adapter.dart`、`lib/src/fjs_app.dart`；web 不改代码，"浏览器后退不拦截"登记进 `docs/web.md` 已知差异与 `docs/overlay-host.md`（spec §7-3 已决） |
| II 边界即契约 | 否 | 三张表都不动。模态结论经已有的 `setProps`（op 协议现成）写成宿主节点的 `modal` 属性；`fjs-overlay-host` 是已存在的保留标签 |
| III 同步单线程零序列化 | 否 | 判定在样式回调里同步做；Dart 读节点属性，不往返 JS |
| IV 外观照 WeUI | 否 | 不改外观 |
| V 静默失效是 bug | 是 | 返回被拦截时 debug 下 `debugPrint` 一次原因（"overlay host has a modal mask"），否则用户会以为返回键坏了；Dart 测试断言非 `No tests ran` |
| VI 注释记录权衡 | 是 | 注释写清：为什么还留在根 Overlay 而不是画进页面；为什么 Cupertino 路由不直接调 `route.buildTransitions`（会再挂一个返回手势检测器）；为什么被盖住的页面整层隐藏而不是跟 secondaryAnimation 视差；模态为何按形状判 |
| VII JS 能包就不要下 Dart | 部分 | **判定**在 JS（样式引擎已经有解析后的样式，vitest 可测）。**转场跟随**与**拦截返回**必须在 Dart：前者要路由的 `animation` / `secondaryAnimation`，后者要 `PopScope` 挂到路由上，JS 拿不到这两样 |
| VIII 变更落到文档 | 是 | 新增 `docs/overlay-host.md`；改 `docs/ui-api.md`（`fjs-overlay-host` 行）、`docs/css-compat.md`（`position: fixed` 行）、`docs/web.md`（已知差异）、`docs/README.md` 与 `AGENTS.md` §6 文档地图 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动 |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | ① 新增 `isModalMask(style)`：`position: fixed`、`display` 非 `none`、`visibility` 非 `hidden`，且四边皆 0，或 left/top 为 0 且 width/height 为 `100%`（或 `100vw`/`100vh`）。② 宿主内元素的判定缓存 `modalShaped: Set<id>`，在样式回调（hoist/unhoist 同一处）更新；`dropElement` / `releaseRoot` / unhoist 时删。③ `syncHostModal(pageRoot)`：宿主子节点里有模态 → `setProps(host, { modal: true })`，结论变了才写 |
| JS runtime 测试 | `packages/fjs-runtime/test/overlay_modal.test.ts`（新） | `.van-overlay` 形状 → 宿主 `modal: true`；`display:none` 后 → false；Toast（居中小盒）、Sticky 吸顶（top 0、宽非 100%）、fixed NavBar（top 0、width 100%、height 46px）→ false；遮罩卸载 → false |
| Web 适配层 | — | 不动（已知差异） |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/node/overlay_host_adapter.dart` | ① `build()` 外包 `PopScope(canPop: !modal)`（`modal` 读 `context.node.props['modal'] == true`），PopScope 在路由子树里，挂到页面路由上。② portal 内容外包 `_FollowRoute`（§3.5 修正：不做"被盖住隐藏"）：取 `ModalRoute.of(context)`；按路由类型套同一动画（primary + secondary）：`CupertinoRouteTransitionMixin` 路由用 `CupertinoPageTransition(primary, kAlwaysDismissedAnimation, linearTransition: route.popGestureInProgress)`（不经 `buildTransitions`，否则再挂一个 `_CupertinoBackGestureDetector`）；`_FjsPageRoute` 用 `page.builder.buildTransitions(route, ctx, animation, kAlwaysDismissedAnimation, child)`；`MaterialPageRoute`（平台默认）用 `Theme.of(ctx).pageTransitionsTheme` 同一入口，iOS/macOS 平台落到 Cupertino 分支；取不到路由（宿主直接嵌 FjsView）→ 原样不包 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_app.dart` | `NavigatorPopHandler.onPopWithResult` 从 `pop()` 改成 `maybePop()`——`pop()` 无视 PopScope，这正是 Android 物理返回拦不住的直接原因。`_FjsCupertinoPageRoute` / `_FjsPageRoute` 需要暴露 `page`（已是 public 字段，`_FollowRoute` 放同库或加一个 `FjsRouteTransition` 小接口，见 §3.3） |
| Dart 测试 | `packages/flutter_fjs/test/overlay_host_test.dart` | 新增 group：push 第二页后第一页宿主子节点不命中；pop 转场中宿主内容的变换与页面同步（取中间帧，比较两者的 `localToGlobal`）；转场结束后不在树里；`modal: true` 时 `maybePop()` 返回 false、页面仍在；`modal` 缺省时正常 pop；Android 物理返回（`tester.binding.handlePopRoute()`）被拦 |
| 文档 | `docs/overlay-host.md`（新）、`docs/ui-api.md`、`docs/css-compat.md`、`docs/web.md`、`docs/README.md`、`AGENTS.md` | 见宪法 VIII 一行 |
| demo | `demo/src/pages/vant-float.vue` | 不改行为；页顶说明补一句"吸顶元素随页面转场（specs/133）"，便于回归时对照 |

## 3. 方案

### 3.1 判定放 JS，结论落成宿主属性

样式回调是唯一知道"某元素解析后是否全屏遮罩"的地方（`%`、`var()`、`inset` 展开都已做完），
而且每次 `v-show`/类名切换都会重新回调，天然覆盖 vant 关闭动画结束后的 `display: none`。
结论只有一个布尔，写成宿主节点的 `modal` 属性，走现成 `setProps`，零协议变更。

### 3.2 拦截：PopScope + maybePop

- `PopScope(canPop: false)` 让路由的 `popDisposition` 变成 `doNotPop`：Cupertino 返回手势
  由此**显式**禁用（不再依赖遮罩恰好挡住边缘的副作用），`maybePop` 返回 false。
- Android 物理 / 预测式返回经 `FjsApp` 的 `NavigatorPopHandler` 进来，它现在调 `pop()`，
  改 `maybePop()`。
- JS 侧 `router.back()` 走声明式 pages 更新，PopScope 不拦——符合 spec §3-3。

### 3.3 跟随转场：留在根 Overlay，按路由动画包一层

spec §7-4 定了仍在根 Overlay（坐标整屏、盖宿主 chrome）。portal 内容脱离了路由的
transition 子树，所以要在 portal 里把"本路由的进出场"再套一次；"被新页面盖住"直接整层
隐藏——新页面在 Navigator 的 Overlay 里，本就画在根 Overlay 之下，不隐藏就会盖在新页面上。

隐藏覆盖层的时机取 `secondaryAnimation.status != dismissed`：push 新页一开始就隐藏，
pop 回来要等上层页完全离场才显示。代价是返回到本页时 fixed 层在转场结束那一帧才出现，
可接受，写进文档。

### 3.4 被否掉的备选

| 备选 | 否掉原因 |
|------|---------|
| 宿主改画进页面自己的区域（Stack 叠在 FjsView 上） | 天然随路由走，但不再盖宿主 chrome，fixed 坐标变成相对页面区域——用户在 spec §7-4 否了 |
| `OverlayPortal` 改 target 最近的 Overlay（Navigator 的） | 子节点依旧被搬出路由的 transition 子树，不随页面滑动；且盖不住嵌套 Navigator 外的 chrome，两头不讨好 |
| portal 里直接调 `route.buildTransitions` | Cupertino / 平台默认 builder 会再包一个 `_CupertinoBackGestureDetector`，同一路由两个手势控制器，边缘拖动状态互相踩 |
| 在 portal 上重放 builder（§3.5 的做法） | 装饰盒 / scrim 在透明全屏层上参与命中测试，吞掉页面点击（§3.6） |
| 转场期间直接隐藏整层（不跟动画） | 实现最简单，但带遮罩的弹层在 push 进场时（页面挂载即弹）会闪现；Sticky 在侧滑一开始就消失，与页面脱节。保留为 `_FollowRoute` 取不到可识别路由类型时的兜底 |
| 模态靠显式属性标记 | 用户在 spec §7-2 选了形状自动判 |
| 模态判定放 Dart（读 `FjsStyle`） | 可行，但 `%` 与 `display` 等要在 Dart 再解一遍；JS 侧 vitest 覆盖更便宜，也让 web/mp 将来需要时复用同一判定 |
| 返回时关闭最上层弹层 | 用户在 spec §7-1 选了拦截 |

### 3.5 实现中修正（2026-09-25）

落地时发现 `OverlayPortal()` 默认构造指向**最近的** Overlay——即 FjsApp 内嵌 Navigator 的
Overlay，不是根 Overlay（specs/069 的注释与文档写错了）。portal 子树画在**自己路由的
entry 正上方**：新页 push 上来天然盖住它，路由 offstage 时它也一起 offstage。
因此：

- **删掉** §3.3 的"被盖住整层隐藏"：多余，且会让 push 过程中旧页的 fixed 层提前消失。
  Dart 测试用嵌套 Navigator（FjsApp 同形）验证：去掉 `_FollowRoute` 时"被盖住"用例仍过——
  证明这一条本来就成立，保留该用例作回归。
- `_FollowRoute` 把 `secondaryAnimation` 也喂给同一 builder（Cupertino 视差、Zoom 的下层动画一并跟上），
  只有无法重放的路由才退化成"转场中隐藏"。
- 真正的 bug 只剩一条：portal 子树被搬出了路由的 transition 包装。位置不变，
  与 spec §7-4"不挪位置、跟随转场"一致；§7-4 写的"根 Overlay"按实际更正为"Navigator 的 Overlay"。
- `maybePop()` 对被拦下的 pop 返回 true（"已处理"），测试断言改为"页面仍在"。

### 3.6 实现中第二次修正：跟随锚点，不重放 builder（2026-09-25，模拟器发现）

§3.5 的"把路由的 transition builder 套在 portal 内容上"在模拟器上**吞掉了页面所有点击**：
`CupertinoPageTransition` 里的边缘阴影是 `DecoratedBoxTransition`，装饰盒整块参与命中测试，
套在透明全屏层上就成了一块挡板（widget 测试原先没覆盖点击穿透）。任意 builder 都可能画 scrim / 阴影，
在透明层上重放本身就不对。改为：

- 新增 `flutter_fjs/lib/src/widgets/route_anchor.dart`：`FjsRouteAnchor`（`LayerLink` +
  `CompositedTransformTarget`），`fjs_app.dart` 每页包一层，并从 `flutter_fjs.dart` 导出给自建路由的宿主。
- `_FollowRoute` 用 `CompositedTransformFollower(showWhenUnlinked: false)` 跟随：页面怎么平移 / 缩放，
  层就怎么动；页面没被画（被盖住、offstage）时 follower 自动不显示。
- 透明度 LayerLink 带不过来：非 Cupertino 式路由额外 `FadeTransition(route.animation)`。
- 撤掉 §3.5 为重放而加的 `FjsTransitionRoute` 接口。
- 新增 widget 测试：iOS 平台下点层外空白处，页面收到点击。

## 4. 风险

- **Offstage 与 OverlayPortal**：`Offstage` 包在 portal 内容里（不是包 OverlayPortal），
  否则 controller 状态会被 detach。测试覆盖"盖住后再露出，弹层状态仍在"。
- **Cupertino 转场的偏移基准**：`CupertinoPageTransition` 的偏移按子树自身宽度算；portal 是整屏、
  嵌套 Navigator 可能更窄（demo Shell 左侧栏）——两者滑动距离会差一点。模拟器实测，
  差异明显就改用 `route.animation` 自己算 `SlideTransition`，偏移取页面 RenderBox 宽度。
- **`popGestureInProgress`**：侧滑中 Cupertino 用线性曲线，不传会与页面曲线不同步，拖动时错位。
- **forbidClick Toast** 的透明全屏遮罩也会判为模态，Toast 显示期间（默认 2s）返回被拦——
  文档写明，这与"遮罩挡交互"语义一致。
- **遮罩离场动画**期间（~300ms）仍判为模态，返回被拦，不致误伤。
- `NavigatorPopHandler` 改 `maybePop` 后，页面没 PopScope 时行为不变（`maybePop` 对可 pop 的路由等同 `pop`）。
- 不编 native 时 `flutter test` 会输出 `No tests ran`——验证要先编 native。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm --filter @ufjs/runtime test
cd packages/flutter_fjs/native && cmake --build build-native -j
cd packages/flutter_fjs && flutter test test/overlay_host_test.dart && flutter test
```

设备侧（spec §6 第 4–8 条）：

1. `pnpm --filter @ufjs/cli run build`，重启 demo 的 `fjs dev`（runtime 改动需重启）。
2. iOS 模拟器：vant-feedback 开 Popup → 侧滑被拦；vant-float 吸顶 → 返回，吸顶按钮随页滑走、
   无残留；吸顶后 push 另一页，吸顶按钮不在新页面上。
3. Android 模拟器：vant-feedback 开 Popup / ActionSheet / Dialog → 物理返回被拦；关掉后正常返回。
4. hello-fjs shared-element、demo vant-nav 回归；web 端 vant-feedback / vant-float 回归。
