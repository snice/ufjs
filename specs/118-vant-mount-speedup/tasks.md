# Tasks: vant 页首开挂载提速

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不改 op 协议 / natives / 事件类型：`ops.ts` 只加缓存与写入快路径，帧字节不变（plan §1 II）；把「改前」帧 dump 存到 scratchpad 作对拍基线（`fjsrun --hex` 跑 demo bench bundle）
- [x] T002 `defer` 进内置组件清单：`packages/fjs-runtime/src/component-tags.json`，并在 `packages/fjs-runtime/src/vue-global.d.ts` 声明 `defer`（`placeholderHeight?: number | string`）

## 实现

- [x] T010 离线基准入库（先做，作为改前基线）：`demo/bench/mount.ts` + `demo/package.json` 的 `bench:mount`；跑一轮记录改前数字
- [x] T011 `OpWriter`：标签字节缓存、私有 `str()`（ASCII 直写 / 非 ASCII 回落）、`setText`/`setProps` 改走 `str()`、新增 `setPropsJson`：`packages/fjs-runtime/src/ui/ops.ts`
- [x] T012 Element 原型化（`ELEMENT_PROTO` + `Object.create`）：`packages/fjs-runtime/src/ui/element.ts`
- [x] T013 `setProps` 去 `Object.entries`；新增 `setConstProps`（按 props 对象身份缓存 JSON）：`packages/fjs-runtime/src/ui/element.ts`
- [x] T014 按节点记已注册事件类型，`forgetHandlers` 只删这些（含 `addDomListener`/`removeDomListener`）：`packages/fjs-runtime/src/ui/element.ts`
- [x] T015 锚点 / `htmlBlock` / `multiline` 常量 props 走 `setConstProps`：`packages/fjs-runtime/src/vue/renderer.ts`
- [x] T015a renderer 不再把 `role`/`tabindex`/`aria-*`/`data-*` 写进 op 帧（只记 devtools）；`camelize` 与 `parseEventName` 按 key 缓存：`packages/fjs-runtime/src/vue/renderer.ts`（plan §3.1 追加）
- [x] T016 子树标脏 epoch 去重（`ElementState.subtreeEpoch`）：`packages/fjs-runtime/src/css/style.ts`
- [x] T016a `ensure()` 共享空 class/scope 集（scopes 写时复制）、class 串解析结果按串缓存：`packages/fjs-runtime/src/css/style.ts`（plan §3.2 追加）
- [x] T017 跑 `bench:mount` 看卸载；> 10 ms 则继续查 `forgetSubtree`（`onceFired` 前缀扫描、`styleEngine.forget`）：`packages/fjs-runtime/src/vue/renderer.ts`
- [x] T018 `createDefer` 工厂 + Flutter 实例 `FjsDefer`：`packages/fjs-runtime/src/components/defer.ts`；在 `packages/fjs-runtime/src/app/flutter.ts` 注册 `defer`
- [x] T019 demo 的 vant-form / vant-more / vant-nav / vant-basic 首屏以下分组包进 `<defer>`：`demo/src/pages/vant-*.vue`

## 两端对齐

- [x] T020 Web 侧 `<defer>`：`packages/fjs-runtime/src/web/components/defer.ts`（同一工厂 + `router/web` 的 `onPageSettled` + `div` 占位），登记进 `packages/fjs-runtime/src/web/components/index.ts`
- [x] T021 小程序：`packages/fjs/src/mp/wxml.ts` 把 `defer` 编译成透明 `<block>`，丢弃 `placeholder-height`
- [x] T022 重建 `@ufjs/cli`（`component-tags.json` 被内联）；两端对拍：`build:pages`（Flutter bundle）与 `build:web` 都把 `defer` 当组件而非元素（检查产物里没有 `create("defer")` / 未知标签警告）

## 测试

- [x] T030 `packages/fjs-runtime/test/ops-ascii.test.ts`：`str()` 写出的字节与 `utf8Encode` 逐字节一致（ASCII / 2B / 3B / 代理对 / 孤立代理）；标签缓存后 `create` 帧不变；`setPropsJson` 与 `setProps` 同帧
- [x] T031 `packages/fjs-runtime/test/element-proto.test.ts`：`Element` 成员齐全、`this` 绑定正确、`style`/offset getter 按实例 id 工作、两个元素互不串
- [x] T032 `packages/fjs-runtime/test/element-handlers.test.ts` 补用例：`forgetHandlers` 后 dispatch 不再命中、DOM listener 同样清掉、未注册事件的节点 forget 不出错
- [x] T033 CSS 标脏：在 `packages/fjs-runtime/test/css.test.ts` 旁新增 `css-mark-dedupe.test.ts`——自底向上挂载后样式正确、同 epoch 内移动已挂子树后样式正确、`markVisited` 显著下降
- [x] T034 `packages/fjs-runtime/test/defer.test.ts`：settled 前只出占位（带高度）、settled 后出内容且无包裹元素、settled 前卸载不补挂、非法 `placeholder-height` 告警
- [x] T035 `packages/fjs/test/mp-compiler.test.ts` 补用例：`<defer placeholder-height="200">` 编译成 `<block>`

## 文档

- [x] T040 `docs/ui-api.md`：内置组件表加 `defer` 一行（行为、`placeholder-height`、两端时机）
- [x] T041 `docs/miniprogram.md`：映射表加 `defer → block`，差异表登记占位高度被丢弃
- [x] T042 `docs/vant-mount-perf.md`：追加「specs/118」实测表（改前 / 改后、含与不含 `<defer>`）
- [x] T043 `docs/performance.md`：元素层单价一节（原型化、ASCII 直写、事件类型索引的前后单价）
- [x] T044 `docs/roadmap.md`：有对应条目则打勾，没有则不加

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对：
  1. typecheck / test 通过
  2. `pnpm --filter demo run bench:mount` 可用
  3. 同机 A/B（交替 3 轮 min，不含 `<defer>`）：元素层 ≥ −40%、markMs ≥ −50%、卸载 ≤ 10 ms、五页 match miss 不变
  4. 含 `<defer>`：vant-form 首开同步段 ≤ 改前 40%
  5. 模拟器 `[nav] mounted` —— 交用户复核（spec Q4）
  6. `build:release` / `build:pages` / `build:web` 成功
  7. `examples/bench` 样式用例 ±5%

## 验收记录（2026-09-24，Linux 容器 · PrimJS Release · fjsrun）

| spec §6 | 结果 |
|---|---|
| 1 typecheck / test | ✅ `pnpm run typecheck` exit 0（hello-fjs 需先 `fjs types` 生成被 gitignore 的组件类型；基线提交上同样的 3 个错误，与本 spec 无关）。`pnpm test`：runtime 726 / cli 379 / webview 36 / webgl 30 全绿 |
| 2 bench:mount | ✅ `pnpm --filter demo run bench:mount` 可用：两个入口各跑一个全新 VM（eager / 页面原样） |
| 3 A/B（热态 min，整页进首帧） | ✅ vant-form 元素层 32.5 → 16.9 ms（−48%）；markMs 5.7 → 1.4（−75%）；卸载 28.5 → 6.5 ms；match miss 五页 146/41/267/268/179 逐页相等。vant-more −43%、vant-basic −43%、vant-feedback −40%，vant-nav 元素层本来只有 ~10 ms，降得少 |
| 4 含 `<defer>` 首开同步段 | ✅ vant-form 冷 204–214 → 37–38 ms（≈ 18%，目标 ≤ 40%），热 100 → 20 ms |
| 5 模拟器 `[nav] mounted` | ⏳ 本容器无 Flutter，交用户复核（spec Q4） |
| 6 构建 | ✅ `build:pages`、`build:web` 成功。⚠️ `build:release` 的 JS 部分（分包 + 字节码）成功，随后 `fjs: flutter create failed`——容器没有 Flutter SDK，环境限制 |
| 7 examples/bench | ✅ 无回退且更快（帧字节逐字节相同）：style-mount-1000-rows 246 → 120 ms、theme-switch-vars 38.5 → 34.1 ms |

对拍：80 次挂载/卸载的 op 流，去掉 `role`/`tabindex`/`aria-*`/`data-*` 的 SetProps 后与改前逐行相同。
Web 端用 Chromium 实跑：进入 vant-form 首帧只有首屏（Radio 有、Stepper 无），转场结束后补齐，无页面错误。
