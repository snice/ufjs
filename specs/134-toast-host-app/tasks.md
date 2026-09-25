# Tasks: toast 宿主挂在 App 上，一个 App 一个

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及三张契约表（只动 Dart widget 挂载）

## 实现

- [x] T010 `FjsToastHost` 提供 `_FjsToastScope` 与 `covers()`；`onToast` 接管改成按 engine 的登记表——`packages/flutter_fjs/lib/src/widgets/toast_host.dart`
- [x] T011 `FjsApp.build` 在 Navigator 之上包 `FjsToastHost`——`packages/flutter_fjs/lib/src/fjs_app.dart`
- [x] T012 `FjsView` 上方已有同 engine 宿主就不再包——`packages/flutter_fjs/lib/src/fjs_view.dart`

## 两端对齐

- [x] T020 Web 侧不改：确认 `showToast` 挂 `document.body`、跨路由显示满 2 秒（`fjs-runtime/src/web/index.ts`）
- [x] T021 iOS 模拟器 hello-fjs 按钮页：toast 后立即返回，toast 仍显示 （未跑模拟器：Dart 测试已覆盖，用户确认直接提交）

## 测试

- [x] T030 `nav_router_test.dart`：单一宿主且 `onToast` 不变；pop 后 toast 仍在、2 秒后消失；独立 FjsView 兜底；乱序销毁不抛、全部销毁后还原
- [x] T031 跑 `flutter test`，确认不是 `No tests ran`

## 文档

- [x] T040 `docs/ui-api.md` 的 `toast` 一句补 App 端宿主归属与跨页
- [x] T041 `docs/overlay-host.md` 注明 `toast()` 不走 overlay 宿主
- [x] T042 `docs/roadmap.md` 有对应条目则打勾，没有就不加（无对应条目，未加）

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `flutter test`
- [x] T053 spec.md 第 6 节逐条核对，状态改 done
