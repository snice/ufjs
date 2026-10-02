# Tasks: 181-vapor-full-test

- [x] hello-fjs web VDOM 基线：66 路由静态遍历 + 41 路由按钮点击探针
- [x] hello-fjs web `enableVapor: true` 遍历对比，逐条修复（spec.md §8 #1–#12）
- [x] 回归测试 `packages/fjs-runtime/test/vapor-real-app.test.ts`（多根块、插槽转发、静态 v-for、v-for 别名、canvas 插槽 v-if、rich-text、对象式指令、render-host 更新、setup 抛错）
- [x] hello-fjs iOS 两种模式 66 路由遍历（`fjs eval` 驱动）+ 抽查截图
- [x] demo 三方库：方向由用户拍板 → specs/182
- [x] 页面缓存 activated / deactivated（#14），setup 抛错隔离（#13）
- [x] 文档：docs/vue3.md、docs/vapor-contract.md、docs/css-compat.md
- [x] 包体测量与对比总结 summary.md
- [x] `pnpm run typecheck`、`pnpm test`、`flutter test`
