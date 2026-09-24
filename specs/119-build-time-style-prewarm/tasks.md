# Tasks: 构建期样式预热

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不改 op 协议 / natives / 事件类型；抓改前的 op 帧基线（`fjsrun --hex`，bench eager bundle）
- [x] T002 `registerStyles(scope, css, hash?)`：`packages/fjs-runtime/src/vue/renderer.ts` 接收并传给 `styleEngine.register`；`packages/fjs/src/bundler/vue-plugin.ts` 两处生成带 `sha1(scope+css)` 前 12 位

## 实现

- [x] T010 `StyleEngine.register` 记样式表日志（hash、scoped）、规则带 `sheet`；抓取模式下记录参与匹配的表（含 `:root` 表）：`packages/fjs-runtime/src/css/style.ts`
- [x] T011 defaultsId 按 JSON 内容可复现；`ComputeResult.rawText` + 命中检查：`packages/fjs-runtime/src/css/style.ts`
- [x] T012 `exportSnapshot()`：链树、匹配、计算节点、对象去重、flags、media、sheets/globals：`packages/fjs-runtime/src/css/style.ts`
- [x] T013 `importSnapshot(snap)`：校验 + 按树重放链键与计算结果、导入链进 retired 队列：`packages/fjs-runtime/src/css/style.ts`
- [x] T014 路由 `mount()` 前按 path 导入（按 matchEpoch 去重）；`captureStyleSnapshots()`：`packages/fjs-runtime/src/router/flutter.ts`
- [x] T015 `createFjsApp().mount()` 抓取模式分支：`packages/fjs-runtime/src/app/flutter.ts`
- [x] T016 CLI 预热模块：Node vm 执行 + 收集 + 追加：`packages/fjs/src/bundler/style-snapshot.ts`
- [x] T017 构建接入：`BuildOptions.styleSnapshot`，单包 / 分包两条路径，字节码之前；统计行；`buildCommand` 与 `commands/run.ts` 默认开、`fjs.styleSnapshot: false` 关：`packages/fjs/src/bundler/build.ts`、`packages/fjs/src/commands/run.ts`
- [x] T018 基准：`demo/bench/mount-core.ts` 支持 prewarm 模式 + 入口 `demo/bench/mount-prewarm.ts`，`bench:mount` 串上

## 两端对齐

- [x] T020 Web：确认 web 构建不生成、不带快照（`build:web` 产物无 `__fjsStyleSnapshots`）；spec §4 已登记「不涉及」
- [x] T021 小程序：确认 `--mp` 不走预热（不经 buildBundle）

## 测试

- [x] T030 `packages/fjs-runtime/test/style-snapshot.test.ts`：A 导出 → B 导入 → 全命中且逐元素相等；四种校验拒绝；导入后 register 失效；rawText 命中检查
- [x] T031 `packages/fjs/test/style-snapshot.test.ts`：追加行格式（es2019 可解析、字符串安全转义）、跳过动态路由、`styleSnapshot:false` 不生成
- [x] T032 对拍：prewarm 与不预热的 op 流逐节点解析后样式与结构相同；不预热 op 流与改前逐字节相同（plan §3.5）

## 文档

- [x] T040 `docs/toolchain.md`：build 多一步、统计行、关闭开关、dev 不开
- [x] T041 `docs/vant-mount-perf.md`：specs/119 实测（冷态 CSS、导入耗时、包体积、构建时间）
- [x] T042 `docs/performance.md`：一段指向
- [x] T043 `docs/roadmap.md`：完成项

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对

## 验收记录（2026-09-24，Linux 容器 · PrimJS Release · fjsrun）

| spec §6 | 结果 |
|---|---|
| 1 typecheck / test + 新单测 | ✅ `pnpm run typecheck` exit 0；`pnpm test`：runtime 740 / cli 391 / webview 36 / webgl 30。新增 `style-snapshot.test.ts`（12：导入后 match miss 0、逐元素相等、rawText、NUL、5 种拒绝各自与冷引擎逐元素相等、scoped 表不影响、版本、导入后 register 失效、重复导入）、`style-snapshot-capture.test.ts`（2：跳过动态路由、路由挂载前导入）、CLI `style-snapshot.test.ts`（12） |
| 2 build:pages 统计行 + chunk 带快照 | ✅ `style prewarm: 11 pages captured in 333ms (334 KB)`；快照在 chunk 第一行 |
| 3 对拍 | ✅ 不预热 op 流与改前（T001 基线）逐字节相同；预热 vs 不预热逐节点解析后样式与结构相同（5 万行 md5 一致）；demo 单包首页经路由导入同样一致 |
| 4 vant-form 首开 CSS ≤ 50% | ✅ 同步段 CSS 21.6–25.1 → 7.6–7.9 ms（≈ 33%）；补挂段 CSS 56 → 26.6 ms（≈ 48%）；match miss 270 → 1；导入 3.7–3.8 ms。vant-nav 补挂段只到 ~76%（Tabs/Swipe 运行时才定型的 20 个签名） |
| 5 构建时间 | ✅ demo `fjs build --pages`：关 2.0–2.1 s，开 2.5–2.8 s（+0.5 s）。体积：页面 chunk 80 → 465 KB，字节码 155 → 499 KB |
| 6 模拟器复核 | ⏳ 交用户；须用 `fjs run ios --profile` 或 `fjs build`（dev server 不预热） |

`examples/bench` 样式用例与 118 结束时持平（±3%）。
