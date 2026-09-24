# Spec: vant Field 多行长高 + Search 清除按钮（App 端）

- **ID**: 122-vant-field-grow-clear
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

两个 App 端（Flutter）才有的 vant Field 缺陷，web 正常：

1. **多行不长高**（vant-form「备注」，`type="textarea" autosize`）：
   输入换行后 TextField 自身已经长高，但所在 cell 仍停在初始高度，
   第 3 行起被 cell 的 `overflow: hidden` 裁掉，并压住字数统计。
   即 specs/077 挂账的 T060。
   模拟器实测：`.van-field` 行高 60、`van-field__value` 40，而其内容
   （body 60 + word-limit 20）已是 80。
   **根因**：cell 是 `flex-wrap` 行、`align-items: stretch`、高度无界 →
   走 `FjsShrinkStretchFlex` 两段式（先量后撑）。第二段把行高作为
   **紧约束**交给子项，Flutter 据此把子项（value 列）当成 relayout
   boundary。textarea 长高时 `markNeedsLayout` 停在 value 列，cell 的
   测量段再也不会重跑 —— 不只是 textarea，任何两段式 stretch 行内的
   子树内容变化（文字换行变多等）都会被同样截断。
2. **Search 清除无效**（vant-nav 的 `van-search`，`clearable`）：
   点清除图标后 v-model 已经变空（回显「输入：（空）」），但输入框里
   仍显示原文字。
   **根因**：vant 从不绑定 `:value`，只通过 `inputRef.value.value = ''`
   写值（renderer 把它转成 `setProps({value})`）。Dart 侧
   `FjsInput.didUpdateWidget` 用 `_lastPropValue` 判断「prop 变了才覆盖」：
   - 首次出现的 `value` 只在「输入框为空」时才填入 → 第一次清除被忽略；
   - 用户打字不更新 prop，于是第二次写入同值 `''` 时 prop 没变 → 也被忽略。

## 2. 不做什么（Non-goals）

- 不改 op 协议、不加 `scrollHeight`（vant resizeTextarea 那条路）。
- 不重写 flex 引擎的行高模型；只修两段式布局的脏标记传播。
- 不处理「父级标记 shrink-to-fit」触发的两段式（`_shrinkToFit()`
  那条路），只覆盖构建期就知道要量的 `measureCross`（无界 stretch 行、
  align-self）——vant cell 属于前者。另一条若有同类现象再单独立项。
- web 端不动（真 DOM，两项都正常）。

## 3. 用户可见的行为

页面代码零变化：

```vue
<van-field v-model="remark" type="textarea" rows="2" autosize maxlength="50" show-word-limit />
<van-search v-model="searchValue" placeholder="请输入搜索关键词" />
```

- 备注逐行输入，cell 随内容长高，字数统计始终在内容下方、不被遮挡；
  删行后 cell 缩回。
- Search 输入后点右侧清除图标，输入框立即清空；再输入再清除，依旧清空。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 多行长高 | 本 spec 修复：两段式 flex 子项内容变化会触发整行重新测量 | vant resizeTextarea（真 DOM），已正常 |
| 清除 | 本 spec 修复：JS 每次写 `el.value` 都生效 | 真 DOM，已正常 |
| 已知差异 | 无新增 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `cd packages/flutter_fjs && flutter test` 通过，新增用例：
   - 两段式 stretch 行里，子树内部（不经父 widget 重建）长高后，行高跟着变；
   - input 无 `value` prop 时打字，JS 写 `''` 清空；再打字、再写 `''` 仍清空。
2. `pnpm test` 通过。
3. 模拟器 demo：vant-form 备注输入 3 行，cell 随之长高、字数统计不被遮挡；
   vant-nav Search 输入后点清除，输入框清空（连续两次）。

## 7. 待澄清

- 无。
