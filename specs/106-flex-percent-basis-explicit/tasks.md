# Tasks: flex 主轴百分比参照改为显式标记

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表零变更（本 spec 只动 Dart 渲染层）

## 实现

- [x] T010 `packages/flutter_fjs/lib/src/render/decoration.dart`：新增 `FjsUncappedHeightScope`，解封高度的 `OverflowBox` 内容包进标记
- [x] T011 `packages/flutter_fjs/lib/src/render/flex.dart`：`mainAxisMax` 只认本节点标记；横向恢复 `maxWidth`

## 两端对齐

- [x] T020 Web 侧：不改（参照物），确认 `packages/fjs-runtime/src/web/` 零改动
- [x] T021 两端对拍：测试断言值与 web 的 CSS 语义一致（min-height → auto；固定高度盒 → 盒高）

## 测试

- [x] T030 `packages/flutter_fjs/test/percent_in_flex_test.dart`：min-height 纵向、min-width 横向、飞行盒三条用例

## 文档

- [x] T040 `docs/css-compat.md`：核对百分比条目已是 CSS 语义，无需改
- [x] T041 `docs/roadmap.md` 登记 specs/106

## 验收

- [x] T050 `pnpm run typecheck`（本 spec 不动 TS，确认不回退）——6 个包 Done（demo / hello-fjs 既有 TS2339 除外）
- [x] T051 `pnpm test`——cli 343、runtime 678、webview 36、webgl 30 全过
- [x] T052 spec.md 第 6 节逐条核对；Dart 测试与真机项标为需用户本机验证
