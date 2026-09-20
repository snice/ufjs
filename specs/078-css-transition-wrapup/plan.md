# Plan: 078-css-transition-wrapup

JS 侧与 web 侧零改动。全部工作在 `packages/flutter_fjs/lib/src/`，复用
spec 045 立下的模式（`liveTrack` 门 + TweenAnimationBuilder）。

## 文件与改动

1. **`widgets/text.dart`**
   - `fjsTextStyle` / `fjsSpanStyle` 增加可选 `Color? color` 覆写参
     （null 时走 `style.color ?? #333333` 既有链）。
   - `buildText` 的三个产段路径（richSpans、裸 Text、混合 Text.rich）用
     本地 `_animateTextColor(track, style, build)` 包：track 存在且
     duration > 0 时 TweenAnimationBuilder 逐帧以插值色重建段落；
     空盒 LayoutBuilder 路径无文字色，不包。

2. **`render/decoration.dart`**
   - padding（两处：绝对 `style.padding` / 相对 LayoutBuilder 的
     `resolveEdgeLengths`）与 margin（两处同构）抽本地 `pad()/mar()`
     小助手：track 活跃时 `TweenAnimationBuilder<EdgeInsets>` 包
     Padding，否则原样。相对路径在 LayoutBuilder 内先 resolve 再进
     tween，% 值插值同样成立。
   - `paintedOver` 的自绘边框（uniform dashed → `FjsDashedBorderPainter`、
     分边 → `FjsSideBorderPainter`）：`liveTrack('borderColor')` 活跃时
     用 `_BoxBordersTween`（每边 ColorTween，宽/kind 取终态）逐帧重建
     painter；其余路径不动。

3. **`render/dashed_border.dart`**：不改（painter 已按值重绘，
   shouldRepaint 比较值）。

## 测试（packages/flutter_fjs/test/）

- `text_color_transition_test.dart`：op 帧造 text 节点（仿
  active_style_test 的 `_W`），transition: color .3s + setStyle 换色，
  pump 中间帧断言插值色；无 transition 的对照组瞬时。
- `edge_transition_test.dart`：padding / margin 各一，含 % 值路径。
- `border_color_transition_test.dart`：uniform dashed 与分边（border-bottom
  + 圆角）各一，从 CustomPaint 的 painter 上断言中间色。

## 顺序

1. text.dart 颜色过渡 → 用例
2. decoration.dart 边框色过渡 → 用例
3. decoration.dart padding/margin 过渡 → 用例
4. 文档：css-compat.md（transition 条目、单位节）、roadmap.md
