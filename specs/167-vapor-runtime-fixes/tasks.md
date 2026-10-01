# Tasks: 自研 vapor 运行时正确性修复 + enableVapor 下 pinia / 路由可用

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 op 协议 / natives / 事件类型：确认不涉及（plan §1 II）
- [x] T002 `vapor/host.ts`：HostReactivity 加可选 `beforeStopScope`；导出 `setVaporJobHook` / `setVaporErrorReporter`（框架中立 seam）

## 实现

- [x] T010 `vapor/host.ts`：#1 createIf 真假记忆；#2 renderEffect 入队去重；#3 flush 逐条 try/catch；job 钩子调用；removeBlock / createIf teardown / disposeBlock 移除前调 beforeStopScope
- [x] T011 新建 `vapor/instance.ts`：实例记录、currentVaporInstance、双模 onBeforeMount/onMounted/onBeforeUnmount/onUnmounted/provide/inject/hasInjectionContext、不支持钩子 warnOnce 版、runWithContext 上下文、reportVaporError
- [x] T012 `vapor/runtime.ts`：scope→实例登记、mountVaporComponent/createVaporApp/mountVaporComponentForAdopt 建实例与 pending mounted、stopScope 卸载顺序与兜底、VaporAppContext.provides、interop 调用隔离、resolveComponent 走实例链、接 job 钩子与错误上报
- [x] T013 入口导出：`vapor/index.ts`、`vapor/web-dom.ts`、`vue/vue-shim.ts` 导出双模函数；新建 `vapor/vue-pure.ts`
- [x] T014 `vapor/interop.ts`、`vapor/web-interop.ts`：mountAdoptNodes 触发收养块 mounted
- [x] T015 新建 `app/vapor-app.ts`：FjsVaporApp 外壳
- [x] T016 `app/flutter.ts` + `router/flutter.ts`：enableVapor 建 ctx+外壳、跑 plugins/setup 一次；路由收 vaporContext；per-page provide ROUTE/PAGE/ROUTER；useRoute/useRouter/onPageSettled 走 vapor inject；删 activeNativeRoute
- [x] T017 CLI `vue-plugin.ts`：usesEnableVapor 去注释+字面量判定+警告；vue-router 导入警告（esbuild vapor 分支 + compileVaporSfcModule）；webPureVaporPinPlugin `vue` → vue-pure.ts

## 两端对齐

- [x] T020 `app/web-vapor.ts` + `router/web.ts`：enableVapor 建 ctx+外壳、跑 plugins/setup；壳改「container 先进树再挂页」；per-page provide reactive ROUTE_KEY；web useRoute 走 vapor inject
- [x] T021 `packages/fjs/src/vite.ts`：enableVapor `vue` 别名 → vue-pure.ts
- [x] T022 两端对拍：vapor-app 同一份页面在 fjsrun 与浏览器表现一致（见验收）

## 测试

- [x] T030 新建 `fjs-runtime/test/vapor-lifecycle.test.ts`：#1 #2 #3 #4 #4b #9、scope 内部字段存在性
- [x] T031 `web-vapor-shell.test.ts` / `router-vapor-mount.test.ts`：#5 两端 route 注入、#7 pinia（setup(app) use）、onUnmounted 在 LRU 逐出 / 页面卸载时触发
- [x] T032 `fjs/test/vue-plugin-vapor.test.ts`：#6 注释 / 非字面量 / vue-router 警告
- [x] T033 `examples/vapor-app`：pinia store + onMounted 定时器 + onUnmounted 日志；`check/main.ts` 断言

## 文档

- [x] T040 `docs/vue3.md`：enableVapor 章节（pinia、生命周期、provide/inject、vue-router 引导、setup 只跑一次、非 enableVapor web composable 例外）
- [x] T041 `docs/vapor-contract.md`：beforeStopScope / job 钩子 / 错误上报 seam；`docs/toolchain.md`：enableVapor 静态判定规则
- [x] T042 `docs/roadmap.md`：无 vapor 条目，无需改动

## 追加（spec §8：返回失效）

- [x] T060 `router/flutter.ts`：vapor 分支用 vapor shell 包裹（本页 route），非 vapor shell warnOnce
- [x] T061 `app/web-vapor.ts`：shell 读本页 route，非 vapor shell warnOnce
- [x] T062 测试：两端 shell 包裹 / 本页 route / VDOM shell 警告
- [x] T063 `examples/vapor-app`：vapor Shell.vue + 页面标题 + 去掉 transition: false
- [x] T064 浏览器与 iOS 模拟器返回实测

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 bench `vapor` 回归、demo `vapor-check` / `nav-vapor`
- [x] T053 vapor-app：`check`、`build:web` 浏览器实测、iOS 模拟器实测
- [x] T054 spec.md 第 6 节逐条核对，状态改 done
