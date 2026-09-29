# Tasks: 156-flex-no-layoutbuilder

- [x] T1 `stretch_flex.dart`：`startWhenUnbounded`（layout / dry layout 按约束选 stretch / start）、
      `FjsAdaptiveShrinkCross`（只在父 flex 退成 start 时算数）、`FjsFlex` 读 `FjsClipScope`、补 text direction
- [x] T2 `flex.dart`：`buildFlex` 快路径 + `_layoutIndependent` 资格判断；`_flexChild(adaptiveShrink)`
- [x] T3 `flutter test` 全过；`flex_direct_path_test.dart`：快路径 / LayoutBuilder 路径逐节点对拍（含变异检验）
- [x] T4 真机 timeline：4050 显示帧 LAYOUT / 上屏前后
- [x] T5 真机抽查 hello-fjs 页面（用户确认无变样）
- [x] T6 文档、spec §8
