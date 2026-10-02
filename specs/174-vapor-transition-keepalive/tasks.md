# Tasks: 174-vapor-transition-keepalive

- [x] T1 host.ts：createSwitch（createIf / createKeyedFragment 改用），parentNode 兜底，switchOf，分支实例收集；既有测试绿
- [x] T2 runtime.ts：createDynamicComponent 真动态
- [x] T3 vue/transition-timing.ts（从 vue-shim 挪出），Flutter backend transition 原语
- [x] T4 web-dom：transition 原语 + class 写入保留转场类
- [x] T5 vapor/transition.ts + VaporTransition + applyVShow 接转场
- [x] T6 instance.ts：children、onActivated/onDeactivated；VaporKeepAlive
- [x] T7 单测：dynamic、transition（web + Flutter）、keep-alive
- [x] T8 typecheck + pnpm test + 体积（未使用时不进包）
- [x] T9 vapor-app /motion 页；浏览器 + iOS；check
- [x] T10 文档（vue3.md / vapor-contract.md）

## 结果
- 单测：web 8 条（动态组件 / v-if / class 重渲染保留转场类 / v-show 取消 / out-in / appear + css=false / KeepAlive LRU / include），Flutter 2 条（样式引擎里的类名时序、KeepAlive 同一元素回到树上）
- 未使用 Transition / KeepAlive 的包里没有它们（`/* @__PURE__ */`）；共享的分支切换机制 +1.9 KB
- 浏览器：v-if / v-show 类名时序、out-in 先离场后进场、KeepAlive 切回计数保留、activated/deactivated 日志；无报错
- iOS 模拟器（dev）：motion 页 v-if 淡出后移除、KeepAlive 切回 Tab A · 2；日志 0 错误
- vapor-app Flutter check（fjsrun）通过
- 顺带修：作为组件 / slot 根的 v-if 切换时父节点用 `parentNode(anchor)` 兜底
