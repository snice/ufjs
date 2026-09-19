# 070 实施记录（2026-09-19，第一轮）

## 已落地

1. **D1 根因修复（构建层）**：`vue-plugin.ts` 的 `compileTemplate` 加
   `hoistStatic: false`（抽成 `templateCompilerOptions()` 共享工厂，插件与
   测试同源）。带日志复现的报错链：`FjsException: [fjs/dispatch-event]
   TypeError: not a function at mountStaticNode` —— Vue 静态提升 vnode 的
   挂载路径调用 renderer 的 `insertStaticContent`，fjs 自定义 renderer 无此
   DOM innerHTML 语义。vant-feedback 因此整页空白；恢复渲染 ✓（设备验证）。
2. **构建产物回归**：`packages/fjs/test/vue-plugin-static.test.ts` —— app
   构建不得产出 hoisting（无 `_cache` 提升与静态 vnode），web 构建保持
   默认（DOM renderer 原生支持）。
3. **运行时兜底（宪法 V）**：nodeOps 补 `insertStaticContent`，手写
   `createStaticVNode` 会得到指名报错（不再是深处的 "not a function"）。
   回归：`vue_overlay_pseudo.test.ts`。
4. **D1 放大器修复（native）**：`fjs_vm_pump` 的 timer 抛错原先
   `fail_with_pending_exception` + return，**连同待执行的微任务队列一起
   丢弃**——Vue 调度器 flush、样式回调、hoist 全部没机会跑。vant 的
   `useRect`（`window is not defined`，Tabbar `setHeight` 每 tick 触发，
   设备日志面板可见 91 条刷屏）即因此冻结页面。改为上报后继续排空
   （timer 与 job 两处语义一致）。native 回归：抛错 timer 不饿死后续 job。
5. **诊断基建**：`MirrorTree` 增加 `debugLog` 注入口（engine 接到 onLog，
   设备端日志面板可见 op 流诊断）；`overlay_host_test.dart` 固化 overlay
   适配器的锚定契约（top:0→顶、bottom:0→底，widget 层验证通过）。

## 遗留（下轮从这里继续）

- **D3 根因未定位**：设备上 NavBar/Tabbar/遮罩仍未走 hoist（样式回调从未
  观察到 `position === 'fixed'`；MirrorTree create 探针无输出）。widget 层
  已排除适配器定位问题；新增发现：**以 SetProps 传递 host 样式（与 JS
  ensureOverlayHost 一致）时，Positioned.fill 委托几何与 interned 路径
  表现不一致（bar 被拉伸至整屏）**——该用例已在 widget 测试中复现过一轮
  （本会话中已摘除，复现步骤：host 节点样式改走 `props()` 而非 `node()`）。
  疑点集中在样式回调触发条件 / SetProps 与 interned 样式在 Dart 侧的读取
  差异。探针基建已就位（MirrorTree.debugLog → 引擎日志面板；
  `flutter run` 附着的 stdout 因块缓冲不可靠，用日志面板或 os_log）。
- vant 的 `window` 无守卫调用（`useRect`/`isHidden`，Tabs/Tabbar 在用）
  持续以 `[fjs/timer]` 刷日志——引擎已容忍，日志降噪可考虑 warn 级别合并。
- 验收 3（弹层打开时滚动页面）待 D3 修复后补测；vant-feedback 已垫底至
  可滚动。

## 设备操作备忘（本轮沉淀）

- 日志流：`flutter run` 附着的 stdout 经 nohup/pty 都会块缓冲或断流；
  **fjs-go 自带「开发菜单 → 日志」面板（LogStore，错误级）是最可靠通道**。
  FAB 中心约在 (372, 578)pt（iPhone 17 Pro）。
- agent-device（XCTest 后端）可点击/滚动/语义树；vant Key 等 touchstart
  组件的输入在 XCTest tap 下未验证通过。
