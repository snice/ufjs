# Plan: 122-vant-field-grow-clear

只动 Flutter 侧两处，JS / 协议不变。

## A. 两段式 flex 的脏标记传播（`render/stretch_flex.dart` + `render/flex.dart`）

- `FjsShrinkStretchFlex` 暴露 `inCrossPass`（第二段 `_crossTight != null` 期间为真）。
- 新增 `FjsCrossLineItem` / `RenderFjsCrossLineItem`（RenderProxyBox）：
  - 父是正处于第二段的两段式 flex、且自身收到紧约束时：给子项的交叉轴
    max 放一个亚像素余量（不再 `isTight` → 子项不成 relayout boundary，
    子树的 `markNeedsLayout` 能传到这里），自身尺寸仍按紧约束取；
  - 覆写 `markNeedsLayout`：处于上述状态时同时 `markParentNeedsLayout()`，
    把脏标记继续交给 flex（同 Flutter 的 `markNeedsLayoutForSizedByParentChange`）。
  - 其余情况纯透传。
- `buildFlex`：`measureCross` 为真时，每个子项套 `FjsCrossLineItem`；
  `Flexible`/`Expanded` 包在外层（ParentData 必须落在 flex 的直接子
  render object 上），`Spacer` 不包。

## B. 输入框值对账（`widgets/input.dart`）

- `value` prop 首次出现：与控制器文本不同就覆盖（不再只填空框）。
- `onChanged`：若节点带 `value` prop，把 mirror 节点的 `value` 与
  `_lastPropValue` 同步成用户刚打的文本（DOM 语义：value 就是当前文本）。
  这样 JS 再写任何与当前文本不同的值（包括再次写 `''`）都是一次真正的
  变化；无关 rebuild 时 prop == 控制器文本，不会回滚用户输入。

## 测试

- `test/stretch_flex_grow_test.dart`：FjsFlex(measureCross) 行 + 子项内部
  StatefulWidget 自己 setState 长高 → 行高跟随；并留一条对照说明不套
  FjsCrossLineItem 时不跟随（锁住根因）。
- `test/input_control_test.dart`：无 value prop → enterText → 写 `value:''`
  → 空；再 enterText → 再写 `''` → 空。

## 文档

- specs/077 tasks T060 勾掉并指向本 spec；renderer.ts 那段「挂账未修」注释更新。
