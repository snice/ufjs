# Tasks: input 认 DOM 的 type / inputmode / enterkeyhint

对应 plan：`./plan.md`。

## 契约层

- [x] T001 无契约变更

## 实现

- [x] T010 `input.dart`：`_keyboardType` 读 `inputmode` / `type`
- [x] T011 `input.dart`：`obscureText` 读 `type=password`，遮挡时关联想/纠错
- [x] T012 `input.dart`：`_textInputAction` 读 `enterkeyhint` / `type=search`

## 两端对齐

- [x] T020 `web/components/form.ts`：不覆盖页面的 `type` / `enterkeyhint`

## 测试

- [x] T030 Dart：`input_control_test.dart` 新增映射用例
- [x] T031 Web：`FjsInput` 透传 `type=password`

## 文档

- [x] T040 `docs/ui-api.md` input 行

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm --filter @ufjs/runtime test`、`flutter test`
- [x] T052 spec.md 第 6 节逐条核对
