# Spec: vant 图标在 App 端高 1–2px

- **ID**: 131-vant-icon-height
- **状态**: done
- **日期**: 2026-09-25

## 1. 要解决什么

vant 图标 `<i class="van-icon">`（`font: 14px/1 vant-icon`，字形在 `::before { display: inline-block }`
盒里）在 App 上比 web 高：Grid 28px 图标 30（web 28），导航栏 16px 箭头 17（web 16）。
square Grid 格子（specs/130）因此溢出 1.5px，debug 包画溢出条纹。

`<i>` 映射为 `text`（段落），伪元素盒是段落里 `PlaceholderAlignment.baseline` 的 WidgetSpan。
这一行没有段落自身的字形，Flutter 的行度量不是 CSS 的 strut：

1. 没有字形 run 的行取默认度量，leading 按 proportional 分配，基线与伪元素内字形的 even
   基线不一致（Roboto 实测 22.04 vs 23.57）；
2. 占位 run 带上所在 span 字体的 lineGap（vant-icon 为 92/1024），上下各加一半。

两者叠加，行高 = max(ascent) + max(descent) > 字号。

## 2. 验收标准

- [x] `test/icon_line_height_test.dart`：vant-icon（`test/fixtures/vant-icon.ttf`）与 Roboto 两种
      字体，外层字号 12/28/36、伪元素 28 时段落高为 28/28/36；修复前 29/30/39。
- [x] `flutter test` 全绿。
- [x] 模拟器 demo vant-basic：Grid 图标 28、导航栏箭头 16；square 格子无溢出条纹。

## 3. 不做

- 有文字的段落里行内盒的基线对齐维持原状（文字 run 已提供正确度量）。
