# Tasks: demo 接入 NutUI，首页改为分类手风琴

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及 op 协议 / natives / 事件类型三张表（本 spec 纯页面层；实现中若需下沉引擎，回到这里补任务）

## 实现

- [x] T010 装依赖 `@nutui/nutui@^4.3.14`、`@nutui/icons-vue`（不登记 `fjs.shared`，见 plan §3.1） —— `demo/package.json`
- [x] T011 新建 NutUI 注册插件（逐组件入口 + 样式 css.mjs + 图标样式）—— `demo/src/plugins/nutui.ts`
- [x] T012 新建 GlobalComponents 类型声明 —— `demo/src/nutui-components.d.ts`；逐组件入口的模块声明 —— `demo/src/nutui-modules.d.ts`（script 文件，模块里写会变成增强）
- [x] T013 新建路由目录，按 `基础能力 / 交互演示 / Vant / NutUI` 分组 —— `demo/src/catalog.ts`
- [x] T014 给现有页面 `<route>` 补 `group` / `desc` —— `demo/src/pages/{about,fetch,icons,drag,dnd,vant-*}.vue`
- [x] T015 首页改为 hero（计数器）+ 分类手风琴 —— `demo/src/pages/index.vue`
- [x] T016 新建 Button 页（类型/朴素/禁用/形状/加载/尺寸/块级/自定义颜色）—— `demo/src/pages/nutui-button.vue`
- [x] T017 新建基础组件页（Cell/CellGroup、Tag、Divider、Icon）—— `demo/src/pages/nutui-basic.vue`
- [x] T018 （计划外，plan §3.x）vue-shim 补 `withModifiers` —— `packages/fjs-runtime/src/vue/vue-shim.ts`

## 两端对齐

- [x] T020 Web 侧：`build:web` + 浏览器打开首页、两个 NutUI 页，截图留底（页面源码两端同源，无单独 web 实现）
- [x] T021 App 侧：iOS 模拟器同流程截图，与 web 对拍；差异按 plan §4 分类（已登记差异 / 需 Vite 补丁 `demo/vite/nutui.ts` / 需下沉引擎），后两类记入 spec「过程发现」

## 测试

- [x] T030 `pnpm --filter demo run build` 无 NutUI 相关构建错误，记录引擎 warnOnce 告警清单
- [x] T031 T018 的回归测试 —— `packages/fjs-runtime/test/vue-shim-modifiers.test.ts`
- [x] T032 T021 未在本 spec 修引擎（web flex 方向问题另开 spec），无需额外回归

## 文档

- [x] T040 更新 `demo/README.md`：NutUI 接入方式、首页分组靠 `<route>` 的 `group`
- [x] T041 vue-shim 补齐表加 `withModifiers` —— `docs/vue3.md`、`docs/third-party-components.md`
- [x] T042 本 spec 未改 CSS 引擎，`docs/css-compat.md` / `roadmap.md` 不动

## 验收

- [x] T050 `pnpm --filter demo run typecheck` 与 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对
