# Tasks: App 端点击输入框外失焦并收起键盘

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 无契约变更（plan §1 II）

## 实现

- [x] T010 `widgets/blank_tap_blur.dart` + `fjs_view.dart` 页面根部接入
- [x] T011 `render/pointer_claim.dart` + `render/touch.dart`：touch 监听节点标记指针
- [x] T012 `node/overlay_host_adapter.dart`：fixed 弹层根部接入（deferToChild）

## 两端对齐

- [x] T020 Web / 小程序为原生行为，不改
- [x] T021 真机验证通过（用户 2026-09-24）

## 测试

- [x] T030 `input_control_test.dart`：tap 空白失焦 / @tap 节点不失焦 / touchstart 节点不失焦 / 拖动不失焦 / A→B 各一次 blur/focus

## 文档

- [x] T040 `docs/ui-api.md` 输入框焦点一节
- [x] T041 `docs/web.md` 已知差异

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`、`flutter test`（确认不是 No tests ran）——flutter 491 过；pnpm 仅 `.githooks/check-commit-msg.test.mjs` 因历史提交 `feat(mp):兼容anime` 失败，与本 spec 无关
- [x] T052 spec.md 第 6 节逐条核对
