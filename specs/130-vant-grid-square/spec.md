# Spec: vant Grid square 在 App 端的高度

- **ID**: 130-vant-grid-square
- **状态**: done
- **日期**: 2026-09-25

## 1. 要解决什么

vant Grid 的 `square` 模式靠 CSS 的百分比 padding 把格子撑成正方形：

```css
.van-grid-item { position: relative; box-sizing: border-box }
.van-grid-item--square { height: 0 }             /* 行内另写 flex-basis: 25%; padding-top: 25% */
.van-grid-item__content--square { position: absolute; top: 0; right: 0; left: 0 }
.van-grid-item__content { height: 100% }
```

Web 端正常。App 端格子高度为 0，内容溢出到下一个区块（specs/129 做 Popover 自定义内容时发现，
当时绕开没用 `square`）。三处原因：

1. **% padding 参照错了宽度**：CSS 的百分比 padding 参照包含块宽度（grid 宽 346），App 端按
   incoming max width 取，而 flex 子项的 `flex-basis` 已经把约束收紧成子项自身宽（86.5），
   于是 `padding-top: 25%` 只有 21.6。
2. **border-box 下 `height: 0` 没被 padding 撑开**：specs/129 的下限（盒子不小于自身
   padding + border）只算绝对值 padding，% padding 不在其中。
3. **绝对定位子盒的包含块**：`height: 100%` 参照父盒 padding box 高，delegate 同样用自身
   内容宽解析父盒的 % padding。

## 2. 验收标准

- [x] `test/percent_padding_square_test.dart`：row（wrap / 不 wrap）里 `flex-basis: 25%;
      height: 0; padding-top: 25%` 的子项为 100×100（容器宽 400），绝对定位
      `height: 100%` 子盒也是 100×100；修复前为 100×0。
- [x] `flutter test` 全绿（`edge_transition_test` 的 % padding 过渡不变）。
- [x] 模拟器：demo `vant-basic` 页新增的 4 列 square Grid，每格 86.5×86.5，内容盒同尺寸。

## 3. 不做

- vant 图标在 App 端比 web 高 1–2px（line-height: 1 的 `<i>` 段落里，伪元素盒子与空行
  基线对不上），使 square 格子内容溢出 1.5px（debug 条纹）。另案处理。
- 无 flex 容器传宽时（普通盒子自带 px width + % padding），% padding 仍按盒子自身宽算
  （既有行为，本次不改）。
