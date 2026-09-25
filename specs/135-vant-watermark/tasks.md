# Tasks: 135-vant-watermark

- [x] T1 `demo/src/plugins/vant/VanWatermark.vue`：props/插槽对齐 + 格子平铺 + 有界测量重试
- [x] T2 `plugins/vant.ts`：注册 `van-watermark` + 样式 import（不从 vant 引 Watermark）
- [x] T3 `demo/src/pages/vant-watermark.vue` 六块对拍页 + index.vue 入口
- [x] T4 `pnpm --filter demo run typecheck` 通过
- [x] T5 `pnpm --filter demo run build:release` + fjsrun 冒烟无异常（bench/wm-smoke.ts）
- [x] T6 web 对拍截图：六块平铺、点穿计数、Popup 层级
- [x] T7 App 模拟器对拍：与 web 一致（fjs-go，Android 16 模拟器）
- [x] T8 `docs/vant-adaptation.md` 账本更新

## 过程记录

- **模板 ref 拿到的是 Fjsview 包装组件**：fjs 内置标签编译为组件（web）或
  native tag（App），模板 ref 解包需 `host.$el ?? host`（同 vant-float 页）。
- **`<image>` 标签被同名 prop 吞掉**（web 构建）：`image` 不是 web native
  tag，编译器先匹配 setup 绑定 → tag 编译成 prop 的值（URL），mountElement
  崩。改 `<component :is="resolveDynamicComponent('image')">`（runtime picker
  的先例，specs/008）；App 构建 image 是 native tag，此路不受影响。
- **转场中途的 rect 不可采信**：页面滑入时 rect 非零但偏小，首帧采信导致
  旋转示例只剩 1×1 格。测量改为逐帧采样、rect 连续两帧不变才收敛（≤30 帧）。
- **`#dcdee0 @ 0.6` 非渲染缺陷**：红色探针验证 opacity 对文字生效；vant
  默认水印色本来就是 ~4% 对比度，截图中"看不见"是客观对比度问题。
- 用户新增：全页水印 文字/图片 切换（vant-watermark.png 606×194 → tile
  125×40 按原始比例）；页面注释更正为「页面级 overlay 宿主」。
