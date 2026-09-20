# Spec: Field 控件属性对齐 DOM——readonly/disabled/rows/auto-height/focus/blur

- **ID**: 077-field-control-props
- **状态**: done（auto-height 一项未达成，挂账 T060，见文末）
- **日期**: 2026-09-20

## 1. 要解决什么

vant Field 在 App 端四个实际问题（specs/068–073 对拍的遗留）：

1. **只读字段可编辑**：vant 往 input 元素绑 `readonly`，peer 的
   `FjsInput` 没读——`TextField` 照常可输入。
2. **禁用字段可编辑**：同上，`disabled` 被忽略。
3. **focus 时抛 `TypeError: not a function`**：vant 对只读字段聚焦后立刻调
   `inputRef.value.blur()` 拒焦，fjs 的 Element 没有这个方法。
4. **多行不随内容长高**：vant 的 autosize 依赖 DOM `scrollHeight`，App 上
   量不出，盒子停在默认高度。
5. **输入框灰底**：宿主主题若设 `InputDecorationTheme(filled: true)`
   （fjs go 就是），`FjsInput` 的 TextField 会继承填充色，在白色卡片上画
   出灰色胶囊——输入框的盒子只该由页面 CSS 决定。

## 2. 不做什么（Non-goals）

- 不做 Element `scrollHeight`（vant resizeTextarea 的另一条路）——auto-height
  原生长高已覆盖需求，布局同步的行高差（多行第三行底部裁掉约半行，
  `line-height: inherit` 与盒子高度换算）单独立项。
- 不动 `:read-only` CSS 支持（仍是不支持子集，warnOnce）。

## 3. 用户可见的行为

页面代码零变化；vant Field 的只读/禁用/autosize 在 App 端与 web 一致：
只读字段聚焦即被拒（键盘收回）、禁用字段不可聚焦不可编辑且命中 `:disabled`
样式、autosize 多行随内容长高、输入框无宿主主题灰底。

## 4. 两端约定（宪法 I）

| | Flutter（App） | Web |
|---|---|---|
| readonly/disabled | TextField `readOnly` / `enabled`；`:disabled` 经引擎 DISABLED_CLASS | 原生属性，原生 CSS |
| auto-height（裸 textarea） | renderer 默认带 `auto-height`，Dart 原生长高 | DOM 语义，vant autosize 自算 |
| focus()/blur() | `fjs.control.focus/blur` host 模块 → 控件 FocusNode | 原生 DOM 方法 |
| 已知差异 | 多行第三行底部可能裁剪约半行（行高换算），已挂账 | 无 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及——`fjs.control.*` 是 Dart host 模块（同 `fjs.nav.*` 惯例），
  不触碰 natives 表；Element 新增方法属 DOM 形状面，web 端原生已有。

## 6. 验收标准

1. `flutter test`（新增 `input_control_test.dart` 8 条：readonly 行为、
   disabled 属性、普通输入不受影响、宿主主题 filled 压不住、rows、
   focus/blur 注册表、卸载清理、linechange 载荷）——全过。
2. `pnpm test` + typecheck 全绿。
3. 模拟器（fjs run ios Demo 宿主）：vant-form 只读字段聚焦无 TypeError
   （全日志 0 次）、禁用字段灰字不可交互、备注 autosize 随输入长高。
   **落地修订**：TypeError 归零 ✓、禁用灰字 ✓；**「autosize 随输入长高」
   未达成**——peer 的 auto-height 成立（TextField 实测长到 120pt），但
   外层 fjs flex 的行高模型把 cell 钳在一行高、cell 裁掉长出部分。两轮
   修复尝试（intrinsic 应答、linechange 回写 style.height）均无效，已
   回退；完整诊断与下一步方向挂账 tasks T060，改天单独立项。
4. 宿主主题 filled 不再影响输入框（fjs go 重编后灰块消失）。

## 7. 待澄清

- 无。
