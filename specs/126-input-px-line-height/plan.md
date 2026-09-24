# Plan: input 认绝对行高

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 只 Flutter 错；web 原生 input 已对 |
| II 边界即契约 | 否 | — |
| III | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 这就是一次静默回落，补测试 |
| VI 注释记录权衡 | 是 | 注释说明为什么占位默认跟输入行高 |
| VII | 必须 Dart | 输入框文字样式在 Dart |
| VIII 文档 | 否 | 行为与 css-compat 已声明的 line-height 支持一致，无新条目 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/input.dart` | `_lineHeight`：倍数，或 px/font-size；`_textStyle` 与 `_hintStyle` 默认都用它 |
| 测试 | `packages/flutter_fjs/test/input_control_test.dart` | 新增一条 |

## 3. 方案

复用 text.dart `fjsTextStyle` 的换算（`lineHeightAbsolute / fontSize`）。
占位默认行高取输入文字行高：InputDecorator 按基线对齐 hint 与输入，但行盒高
由两者较大者决定，写死 1.4 会让空框与有字时高度不同。

## 4. 风险

改变所有写了 px 行高的输入框高度（原来被忽略）——这正是与 web 对齐。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter test
```
