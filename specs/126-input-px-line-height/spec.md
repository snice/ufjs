# Spec: input 认绝对行高（vant Field label 与输入文字对齐）

- **ID**: 126-input-px-line-height
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

demo `vant-form` 页，iOS 上 Field 行里占位文字「请输入」比 label「姓名」高约
1.5–2pt（web 已对齐，spec 100 修过 label 那一半）。

**根因**：`.van-field__control` 是 `line-height: inherit`，继承 `.van-cell` 的
`24px`。Dart `input.dart` 的 `_textStyle` 只认无单位倍数
（`lineHeightMultiplier`），`24px` 回落到默认 1.4 → 行盒 19.6 而不是 24；
输入框比 label 矮 ~4px、贴在 value 列顶部，文字中线高 ~2px。文本节点
（`widgets/text.dart`）早就把 px 换算成倍数，输入框漏了。
同时 `_hintStyle` 的默认行高写死 1.4，而浏览器里占位文字用的是输入框自己的
行高。

## 2. 不做什么

- 不改 CSS 引擎、不改 vant 样式、不改 web（原生 input 本来就对）。
- 不动 `placeholder-style` 的四键契约：写了 `line-height` 仍以它为准。

## 3. 用户可见的行为

页面零改动。`<input style="line-height: 24px">`（含继承来的）在 App 上行盒
24px，与 web 相同；vant Field 的 label 与占位/输入文字在同一水平中线。
占位文字没写 `placeholder-style` 的 line-height 时，与输入文字同行高。

## 4. 两端约定

| | Flutter | Web |
|---|---|---|
| 行高 | px 行高按 `px / font-size` 换成倍数，与 text.dart 同一算法 | 原生 |
| 已知差异 | 无新增 | — |

## 5. 契约变更

- [x] 都不涉及

## 6. 验收标准

1. `flutter test` 通过；新增测试：`lineHeight: "24px"`、`fontSize: 14` 的单行
   input，TextField 文本样式 `height == 24/14`，占位样式同值。
2. iOS 模拟器 vant-form：姓名 / 请输入 中线一致（截图对比）。

## 7. 待澄清

无。
