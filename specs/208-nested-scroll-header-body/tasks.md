# Tasks: 208

- [x] 1. `tags.json` 加两个标签；`event-emits.ts` 加两行（+`vue-global.d.ts`）
- [x] 2. mp：`wxml.ts` skyline 透传三处让位 + webview 降级 + 编译校验 warn；`mp-compiler.test.ts` 用例（87 过）
- [x] 3. web：`web/components/nested-scroll.ts` + `index.ts` + `base-css.ts` + vapor 注册；`web-nested-scroll.test.ts`（实测滚轮钉尾 212）
- [x] 4. App：`widgets/nested_scroll.dart` + `node_adapters.dart` 路由 + `scroll_view.dart`/`list_view.dart` 吸收（+`decoration.dart` ignoreHeight）；`nested_scroll_test.dart` 4/4，全量 782 过
- [x] 5. hello-fjs 嵌套滚动页（comp/container/nested-scroll.vue）；web 实测通过；iOS 模拟器对照见 §7
- [x] 6. `docs/ui-api.md`、`docs/miniprogram.md`；`@ufjs/cli` dist 重建；typecheck / test 全绿
