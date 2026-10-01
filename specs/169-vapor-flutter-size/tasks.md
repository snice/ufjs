# Tasks: enableVapor 的 Flutter 包体——渲染器移出包

对应 plan：`./plan.md`。

## 契约层

- [x] T001 确认不涉及 op / natives / 事件类型

## 实现 · L2

- [x] T010 拆 `vue/host-ops.ts`；`vue/renderer.ts` 只留渲染器部分并 re-export
- [x] T011 `vue/vue-shim.ts` / `vapor/backend-flutter.ts` / `vapor/interop.ts` 改从 host-ops 取
- [x] T012 互操作拆到 `vapor/backend-flutter-interop.ts`；`vapor/index.ts` 导入它；新增 `vapor/flutter-pure.ts`
- [x] T013 `router/flutter-vdom.ts` + `setVdomPageMounter`；`router/flutter.ts` 不再导入 createApp
- [x] T014 `app/flutter.ts` 注册 VDOM 挂载器；新增 `app/flutter-vapor.ts`
- [x] T015 `vue/index-vapor.ts`（enableVapor 的 `fjs/vue`，宿主原语面）。原计划的叶子说明符 `fjs/vue-style` 作废：页面 chunk 导入非共享说明符会各打一份宿主原语、状态分裂（plan 已更新）
- [x] T016 CLI：`flutterAliases(enableVapor)`（fjs/app / fjs/vapor / fjs/vue），build/dev 调用处传 enableVapor

## 实现 · L1

- [x] T020 `build.ts`：release 分包预构建收集名字；`sharedEntrySource` 具名导入 + 回退

## 测试

- [x] T030 runtime：enableVapor Flutter 纯面引用 VDOM 组件报错与 web 同文案；VDOM 挂载器未注册报错
- [x] T031 CLI：shared 收窄（具名 / 命名空间回退 / dev 不收窄）
- [x] T032 fjsrun 分包 eval：vapor-app / hello-fjs / demo release 产物

## 文档

- [x] T040 `docs/vue3.md`、`docs/code-splitting.md`、`docs/performance.md`

## 验收

- [x] T050 typecheck / test
- [x] T051 包体对比（vapor-app enableVapor vs VDOM；hello-fjs / demo 前后）
- [x] T052 bench / demo vapor-check / nav-vapor 回归
- [x] T053 vapor-app check + iOS 模拟器
- [x] T054 spec §6 逐条核对，状态 done
