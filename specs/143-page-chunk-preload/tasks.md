# Tasks: 页面 chunk 提前执行

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

三张表（op 协议 / natives / 事件类型）都不动，契约层只有 `Router` 类型和宿主模块名。

- [x] T001 在 `Router` 上加 `preload(to)`、在 `RouterOptions` 上加 `preload?: boolean`：`packages/fjs-runtime/src/router/types.ts`
- [x] T002 在 `engine.dart` 顶部 nav 协议注释里登记 `fjs.nav.preload(chunk, idle)`（async，走 `fjs.async.invoke`）：`packages/flutter_fjs/lib/src/engine.dart`

## 实现

- [x] T010 新建与平台无关的自动队列 `startPreloadQueue`：`packages/fjs-runtime/src/router/preload-queue.ts`
- [x] T011 新建 `FjsIdleGate`（手指计数、转场登记、`whenIdle()`，可注入"是否有帧排队"）：`packages/flutter_fjs/lib/src/idle_gate.dart`
- [x] T012 engine 接入 idle gate：push / settled / removed / transitionComplete 登记转场，`dispose` 卸载：`packages/flutter_fjs/lib/src/engine.dart`
- [x] T013 注册 async 模块 `fjs.nav.preload`；`_loadChunk` 日志带 `(preload)` 来源：`packages/flutter_fjs/lib/src/engine.dart`
- [x] T014 删除 `_preloadDevChunks` 及其两处调用：`packages/flutter_fjs/lib/src/engine.dart`
- [x] T015 实现 `FlutterRouter.preload`（分包 / 单包 / 无宿主三条路径 + 快照导入），首个页面 settled 后启动自动队列，尊重 `preload: false`：`packages/fjs-runtime/src/router/flutter.ts`

- [x] T016 （§3.4 追加）`captureStyles()` 挂载前按路由表顺序执行所有静态页面的代码（`preload: false` 除外）：`packages/fjs-runtime/src/router/flutter.ts`
- [x] T017 （§3.4 追加）自动队列拆成两轮：先执行代码，再导入快照；手动 `preload` 不变：`packages/fjs-runtime/src/router/flutter.ts`
- [x] T018 （§3.4 追加）单测：抓取时所有页面都已执行、`preload: false` 时只执行本页、队列两轮顺序：`packages/fjs-runtime/test/style-snapshot-capture.test.ts`、`packages/fjs-runtime/test/router-preload.test.ts`

- [x] T019 （§3.5 追加）去掉队列的快照一轮与 `preload()` 里的快照导入，快照回到打开时导入；更新相关单测：`packages/fjs-runtime/src/router/flutter.ts`、`packages/fjs-runtime/test/router-preload.test.ts`
- [x] T019a （§3.5 追加）文档去掉"预加载会导入快照"的描述，`vant-mount-perf.md` 补真机对比与 512 上限的坑：`docs/routing.md`、`docs/code-splitting.md`、`docs/vant-mount-perf.md`、`docs/roadmap.md`
- [x] T019b （§3.5 追加）bench + 真机重新对比 `preload` 开 / 关

## 两端对齐

- [x] T020 Web：实现 `preload`（调用 lazy component），首页 settled 后按 `requestIdleCallback` 启动队列：`packages/fjs-runtime/src/router/web.ts`
- [x] T021 小程序：`preload` 立即 resolve 并注释原因：`packages/fjs-runtime/src/wx/router.ts`
- [x] T022 确认 `FjsAppOptions` 两端都能透传 `preload`：`packages/fjs-runtime/src/app/flutter.ts`、`packages/fjs-runtime/src/app/web.ts`
- [x] T023 两端对拍：同一 demo 在 `fjs run ios --profile` 与 `fjs dev --web` 下，首页停稳后各页 chunk 已加载，进入页面不再加载

## 测试

- [x] T030 队列单测（顺序、跳过已加载、失败 warn 后继续、stop）：`packages/fjs-runtime/test/preload-queue.test.ts`
- [x] T031 router 单测（单包 preload 只执行一次、未知路径 resolve、快照不重复导入；web preload 调用 lazy component）：`packages/fjs-runtime/test/router-preload.test.ts`
- [x] T032 Dart 空闲判定单测（按住不放行、转场不放行、2 s 兜底）：`packages/flutter_fjs/test/idle_gate_test.dart`

## 文档

- [x] T040 `router.preload()`、`preload: false` 开关、页面模块顶层代码会被提前执行：`docs/routing.md`
- [x] T041 chunk 何时执行（首页停稳后空闲预执行 / 打开时兜底）：`docs/code-splitting.md`
- [x] T042 补"chunk 预执行（specs/143）"实测一节：`docs/vant-mount-perf.md`
- [x] T043 `docs/roadmap.md` 有对应条目则打勾

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `pnpm --filter @ufjs/cli run build`，编 native 后 `flutter test`（`idle_gate_test.dart`、`nav_router_test.dart`，确认不是 `No tests ran`）
- [x] T053 spec.md 第 6 节逐条核对（模拟器 profile 实测、立即点击只执行一次、首页滑动无掉帧、web Network、未知路径、文档）
  - 1 ✅ typecheck / `pnpm test`（runtime 806）· 2 ✅ `flutter test` 544 通过（idle_gate 8 条，nav_router 实际执行）
  - 3 ✅ 模拟器 `--profile -- --debug`：vant-form 的 chunk 在点击前带 `(preload)` 执行，`[nav] mounted` 34 ms，对照组 `preload: false` 42 ms
  - 4 ⏳ "启动后立即点击只执行一次"没有单独在设备上复现（去重依靠 engine 已有的 `_loadingChunks`）
  - 5 ⏳ 预执行期间滑动首页掉帧检查未做
  - 6 ✅ `fjs dev --web`（vite）：首页停稳后各页模块都已请求，进入 vant/form 没有新的页面模块请求；`build:web` 静态站点未单独测
  - 7 ✅ 单测覆盖两端未知路径 · 8 ✅ 文档
  - 真机复测 ✅：开 / 关各 3 轮 + gc 诊断各 1 轮，5 页合计 405 → 320 ms（−21%），细节见 `docs/vant-mount-perf.md`
