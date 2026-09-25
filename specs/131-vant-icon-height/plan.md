# Plan: 131-vant-icon-height

只动 `packages/flutter_fjs/lib/src/widgets/text.dart`（web 为浏览器原生）。

- `_placeholdersOnly(node, childNodes)`：段落无自身字形、只有行内盒（Vue 空文本锚点不算）。
- 满足时：`Text.rich` 加非强制 `StrutStyle.fromTextStyle(paragraphStyle)`（按族名取度量，
  图标字体缺字形也不回退；更高的行内盒仍能撑高行）；末尾补一个 `_noMetrics` 字号的 U+2060，
  把默认度量挤出这一行。
- `_span` 的 WidgetSpan 一律 `style: _noMetrics`：占位只贡献盒子本身，不带字体 lineGap。
- 回归测试用真实 vant-icon ttf（从 vant 的 MIT woff2 解码）+ SDK 的 Roboto。
