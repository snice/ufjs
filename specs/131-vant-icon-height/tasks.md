# Tasks: 131-vant-icon-height

- [x] T1 设备上量出规律：`<i>` 高 = f(字号)，伪元素盒 28 不变
- [x] T2 解码 vant-icon ttf，测试里复现 29/30/39
- [x] T3 TextPainter 隔离：默认度量 proportional + 占位 run 的 lineGap
- [x] T4 text.dart：strut + word joiner + 占位 `_noMetrics`
- [x] T5 回归测试（修复前失败），`flutter test` 全绿
- [x] T6 模拟器验证，docs/css-compat.md
