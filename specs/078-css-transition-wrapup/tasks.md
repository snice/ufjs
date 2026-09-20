# Tasks: 078-css-transition-wrapup

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 实现

- [x] T001 `widgets/text.dart`：fjsTextStyle 加 color 覆写参，buildText 三段落
  路径接 `_animatedParagraphColor`（TweenAnimationBuilder + `_ParagraphColorTween`）
- [x] T002 `render/decoration.dart`：paintedOver 自绘边框接
  `liveTrack('borderColor')` + `_BoxBordersTween`（每边 ColorTween，几何取终态）
- [x] T003 `render/decoration.dart`：padding / margin 四个消费点接
  EdgeInsetsTween（绝对 + 相对 LayoutBuilder 两条路径），顶层 `_liveTrack`
  助手 + `_animatedEdges`，局部 liveTrack 委托它

## 测试

- [x] T010 `text_color_transition_test.dart`：插值、无 track 瞬时、:active 压下
  渐变（3 条）
- [x] T011 `border_color_transition_test.dart`：uniform dashed 与分边
  （border-bottom + 圆角）从 painter 上断言中间色与终态几何（2 条）
- [x] T012 `edge_transition_test.dart`：padding / margin / % padding（同一参照
  下终值恰为 2×）/ 无 track 瞬时（4 条）

## 文档

- [x] T020 css-compat.md transition 条目改登记（color / 分边与虚线
  border-color / margin / padding 两端渐变；差异栏更新）
- [ ] T021 docs/roadmap.md 近期计划条目勾掉本项（收尾时统一）

## 验收

- [x] T030 `flutter test` 全过（464 过 3 跳，含新增 9 条）
- [x] T031 `pnpm run typecheck` + `pnpm test` 全绿
- [x] T032 hello-fjs「过渡演示」页扩三项面板（文字变色 / 虚线变色 / 间距渐变），
  vue-tsc 通过；web 与模拟器对拍随 083 收尾一起做
