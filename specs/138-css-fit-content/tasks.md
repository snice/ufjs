# Tasks: `width: fit-content`（App 端）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及 op 协议 / natives / 事件类型（`width` 仍是字符串值）——无文件改动

## 实现

- [x] T010 `widthFitContent` getter；尺寸属性上 `min-content`/`max-content`、非 width 的 `fit-content` → `fjsWarnOnce` —— `packages/flutter_fjs/lib/src/render/style.dart`
- [x] T011 定位盒：`_AbsGeometry.fitX` + `needsLayoutSize`；`_AbsLayoutDelegate` 松约束；`positionedChild` 套 `FjsShrinkCross` —— `packages/flutter_fjs/lib/src/render/flex.dart`
- [x] T012 在流内：column 父下 `widthFitContent` 并入 `shrinkBox`；row 父 `fjsWarnOnce` —— `packages/flutter_fjs/lib/src/render/flex.dart`
- [x] T013 lint 支持表 `UNSUPPORTED_SIZE_KEYWORDS` + 报告规则 —— `packages/fjs-runtime/src/css/support.ts`、`packages/fjs/src/commands/lint.ts`
- [x] T015 （plan §6 新增）content-box 定位盒：槽位与 min/max 约束加上 padding + border —— `packages/flutter_fjs/lib/src/render/style.dart`、`flex.dart`，测试 `test/fit_content_test.dart`
- [x] T014 demo 加"居中 Popup（短内容）"对拍按钮 —— `demo/src/pages/vant-feedback.vue`

## 两端对齐

- [x] T020 Web 侧：确认浏览器原生即可，`web/css-compat.ts` 无需改写（前缀由 parser 剥离）——无文件改动
- [x] T021 两端对拍：showToast 与居中 Popup 在 Android 与 web（375 宽）同宽

## 测试

- [x] T030 Dart widget 测试：定位盒短文字收缩居中 / min-width 生效 / 长文字 max-width 折行 / column 子项不 stretch —— `packages/flutter_fjs/test/fit_content_test.dart`
- [x] T031 lint 与支持表断言 —— `packages/fjs-runtime/test/css-support.test.ts`、`packages/fjs` lint 测试

## 文档

- [x] T040 盒模型表加 `fit-content` 行，§6 登记 row 子项与 min/max-content —— `docs/css-compat.md`
- [x] T041 删掉"文字 Toast 铺满整行"差异 —— `docs/vant-adaptation.md`、`docs/vue3.md`
- [x] T042 `docs/roadmap.md` 若有对应条目则打勾（无对应条目，未改）

## 验收

- [x] T050 `pnpm run typecheck` + `pnpm --filter demo run typecheck`
- [x] T051 `pnpm test` + `flutter test`
- [x] T052 spec.md 第 6 节逐条核对
  - 1 ✅ flutter 535 通过；`fit_content_test.dart` 5 条（定位盒收缩居中 / min-width / 长文字 max-width 折行 / column 子项 / 关键字判定），改动前 4 条布局用例全挂
  - 2 ✅ runtime 777（`css-support.test.ts` 集合断言）+ cli lint 用例（max-content / max-width: fit-content 报告，width/height: fit-content 零报告）
  - 3 ✅ `pnpm test` 通过，workspace / demo typecheck exit 0
  - 4 ✅ Android showToast：居中窄条 ≈127dp；web（427 宽）123.8px，居中——差 3px 是字体（模拟器 Roboto/Noto vs Mac Chrome PingFang），非布局
  - 5 ✅ 居中 Popup：Android ≈132×65dp，web 130×65，均居中
  - 追加：loading Toast（content-box）Android 120×120dp、内容居中，web 120×120；flutter 536 通过
  - 6 ✅ css-compat 盒模型表加行；vant-adaptation / vue3 删掉 Toast 宽度差异
