# Plan: toast 宿主挂在 App 上，一个 App 一个

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 让 App 端向 web 对齐（web 本来就一个 `document.body` 宿主、跨路由）。Flutter 改 `lib/src/widgets/toast_host.dart`、`lib/src/fjs_view.dart`、`lib/src/fjs_app.dart`；web 不改 |
| II 边界即契约 | 否 | 三张表都不动；`engine.onToast` 是现成的 Dart 回调 |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | 外观不动 |
| V 静默失效是 bug | 是 | 修掉"`onToast` 还原成已销毁宿主"这一静默失效；测试断言非 `No tests ran` |
| VI 注释记录权衡 | 是 | 注释写清：为什么挂在 Navigator 之上（跨页）；为什么 `FjsView` 仍兜底；为什么用按 engine 的登记表而不是前驱链 |
| VII JS 能包就不要下 Dart | 否 | 纯 Dart 挂载位置 |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`（toast 一句）、`docs/overlay-host.md`（`toast()` 不走 overlay 宿主） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 / JS runtime / Web / C++ | — | 不动 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/toast_host.dart` | ① 宿主向子树提供 `_FjsToastScope(engine)`，加 `static bool covers(context, engine)`。② `onToast` 接管改成按 engine 的登记表（`Expando<_Hosts>`：原回调 + 活着的宿主列表），销毁时交给列表里最后一个活宿主，列表空了还原原回调 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_app.dart` | `build()` 在 `NavigatorPopHandler` 外包 `FjsToastHost` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_view.dart` | 上方已有同 engine 宿主（`FjsToastHost.covers`）就不再包 |
| Dart 测试 | `packages/flutter_fjs/test/nav_router_test.dart` | spec §6-2 四条 |
| 文档 | `docs/ui-api.md`、`docs/overlay-host.md` | 见 VIII |

## 3. 方案

- **挂在 Navigator 之上**：`FjsApp` 的 `build` 里包在 `NavigatorPopHandler` 外（`FjsPerfOverlay` 之内），
  和 perf 面板同理——不随路由重建，也不在 `fjs-tree-<generation>` 的 KeyedSubtree 里，
  整树重载不撤 toast。显示位置不变：仍插 `Overlay.of(context, rootOverlay: true)`。
- **`FjsView` 兜底**：`getInheritedWidgetOfExactType<_FjsToastScope>()` 取到且 engine 相同就跳过；
  不建依赖（宿主不会在 FjsView 生命周期内出现/消失，出现了也只是多一层兜底）。
- **登记表替代前驱链**：前驱链只在严格栈序销毁时正确。登记表：
  第一个宿主挂上时记下 `engine.onToast` 原值；`onToast` 始终指向最后挂上的活宿主；
  销毁时若 `onToast` 仍是自己，就交给剩下的最后一个，没有了就还原原值；若 `onToast`
  已被宿主 App 改掉，不碰它。

被否掉的备选：
- **只在 FjsApp 挂、FjsView 不兜底**：直接嵌 FjsView 的宿主会丢 toast，回退。
- **toast 画进 Navigator 的 Overlay**（`_navigator.currentState.overlay`）：只覆盖 Navigator 区域，
  和现在的 root Overlay 行为不同，没收益。

## 4. 风险

- 宿主 App 在 `FjsApp` 之上自己设了 `engine.onToast`：FjsApp 的宿主挂上时会接管（同现在每页宿主的行为），
  卸载时还原。行为不变。

## 5. 验证路径

`flutter test`（native 已编）→ `pnpm run typecheck` / `pnpm test`（不受影响，照跑）→ iOS 模拟器 hello-fjs 按钮页。
