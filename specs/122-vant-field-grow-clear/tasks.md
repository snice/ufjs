# Tasks: 122-vant-field-grow-clear

- [x] T001 `stretch_flex.dart`：`inCrossPass` + `FjsCrossLineItem` / `RenderFjsCrossLineItem`
- [x] T002 `flex.dart`：`measureCross` 时给子项套 `FjsCrossLineItem`（Flexible 外置、Spacer 跳过）
- [x] T003 `input.dart`：value 首次出现即对账；onChanged 同步 mirror 的 value
- [x] T004 测试：`stretch_flex_grow_test.dart`、`input_control_test.dart` 新用例
- [x] T005 `flutter test` 全过；`pnpm test` 全过
- [x] T006 模拟器验证：vant-form 备注长高、vant-nav Search 清除
- [x] T007 文档：077 T060 勾掉指向本 spec；renderer.ts 注释更新

备注：`pnpm test` 中 JS 各包全过；根目录 `.githooks/check-commit-msg.test.mjs`
回放历史提交失败（历史标题 `feat(mp):兼容anime` 不合规），与本 spec 无关，未处理。
