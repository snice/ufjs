# Tasks: touch-action: none 不得吞掉同节点的 @tap

对应 plan：`./plan.md`。

## 契约层

- [x] T001 三张表零改动 —— 纯 Dart 手势时序（plan §1 II 已核）

## 实现

- [x] T010 新增 `packages/flutter_fjs/test/tap_touch_action_test.dart`：
      control（只 @tap）+ `touch-action: none` + @tap 两用例，后者先红

- [x] T011 `packages/flutter_fjs/lib/src/render/touch.dart`：
      删 `addAllowedPointer` 里 `touch-action: none` 的 down 时
      `resolvePointer(accepted)` eager 分支，注释改为记录「为什么 down 时不
      eager-accept」（深度优先注册 + 8px 早于 18px 已够保滚动不被抢）

## 两端对齐

- [x] T020 Web 侧零改动（本来正确，宪法 I 的缺口在 Dart 侧）

## 测试

- [x] T030 `flutter test` 全量：新增两用例过；`touch_event_test.dart`
      的 none-keeps-list / fast-first-move / pan-y 不回归

## 文档

- [x] T040 不改文档 —— spec 029 表与类注释本就是正确语义，修完实现对齐它们

## 验收

- [x] T050 `flutter test` 全量通过（真实输出见汇报）
- [x] T051 `pnpm --filter hello-fjs run typecheck` 通过（页面零改动）
- [x] T052 spec.md 第 6 节逐条核对：1/2 过；第 3 条 App 端点画布为手工项
