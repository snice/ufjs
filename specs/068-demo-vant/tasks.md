# tasks · 068-demo-vant

- [x] demo 安装 vant，`fjs.packages` / `fjs.shared` 写入 `vant`
- [x] `src/plugins/vant.ts`：全局注册（app.use × 20）+ 按需样式引入
      （`vant/es/<comp>/style/index.mjs`，esbuild 需要写全 index）
- [x] `src/vant-components.d.ts`：GlobalComponents 声明，与注册列表同步
- [x] `src/pages/vant-basic.vue`：Button / Tag / Cell / Divider / Grid / Badge
- [x] `src/pages/vant-form.vue`：Field / Switch / Checkbox / Radio / Stepper / Rate / Slider
- [x] `src/pages/vant-feedback.vue`：Popup / ActionSheet / Dialog + 命令式调用结果自证
- [x] `src/pages/index.vue` 加三个入口按钮
- [x] vue-shim 补 `Transition` / `vShow` / `withKeys` / `createApp`（vant barrel 必需）
- [x] button.dart label 沿 text 后代递归（vant 的 span 包裹层），加 `label extraction` 回归测试
- [x] `pnpm --filter demo run typecheck` 通过
- [x] `pnpm --filter demo run build` + `fjsrun` 冒烟通过
- [x] `pnpm --filter demo run build:web` 通过
- [x] web 浏览器点验：组件渲染、vant 样式、v-model 均正常
- [x] App 端（fjs-go）结构正常、按钮 label 修复生效
- [x] 全 workspace `pnpm test` / `pnpm run typecheck`、flutter 相关测试不回归
- [x] 自动两端对比第二轮：修 display:flex 初始方向（row）、em 单位、纯绝对
      calc 尺寸、input 无界宽度；探针页识别 vant 非浏览器空操作
