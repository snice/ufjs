# Plan: 130-vant-grid-square

只动 Flutter 渲染层（web 端是浏览器原生 CSS，无需改）。

1. `render/decoration.dart`
   - 新增 `FjsPercentBase`（InheritedWidget）：`width` 为 % padding 的参照宽，`padding` 为
     本盒已解析的 padding（给绝对定位子盒）。
   - % padding 的 LayoutBuilder 优先用 `FjsPercentBase.width`，并用 `FjsPercentBase(padding:)`
     包住内容——同时把 width 清空，流内子节点的参照回到本盒内容宽，不串层。
   - border-box 下限：% padding + 绝对 width/height 时包一层 LayoutBuilder，用解析后的 padding
     做下限；参照宽与内层一致（无容器宽时取声明宽度），避免互相放大。
2. `render/flex.dart`
   - `_flexChild` / `_wrapChildMain`：row 子项带 % padding 时包 `FjsPercentBase(width: 容器宽)`。
   - `positionedChild`：delegate 路径优先用 `FjsPercentBase.padding`，`shouldRelayout` 比较它。
3. 测试 `test/percent_padding_square_test.dart`；demo `vant-basic.vue` 加 square 示例；
   `docs/css-compat.md` 百分比间距一行补充。
