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

- [ ] T020 Web：确认 web 构建不生成、不带快照（`build:web` 产物无 `__fjsStyleSnapshots`）；spec §4 已登记「不涉及」
- [ ] T021 小程序：确认 `--mp` 不走预热（不经 buildBundle）

## 测试

- [ ] T030 `packages/fjs-runtime/test/style-snapshot.test.ts`：A 导出 → B 导入 → 全命中且逐元素相等；四种校验拒绝；导入后 register 失效；rawText 命中检查
- [ ] T031 `packages/fjs/test/style-snapshot.test.ts`：追加行格式（es2019 可解析、字符串安全转义）、跳过动态路由、`styleSnapshot:false` 不生成
- [ ] T032 对拍：prewarm 与不预热的 op 流逐节点解析后样式与结构相同；不预热 op 流与改前逐字节相同（plan §3.5）

## 文档

- [ ] T040 `docs/toolchain.md`：build 多一步、统计行、关闭开关、dev 不开
- [ ] T041 `docs/vant-mount-perf.md`：specs/119 实测（冷态 CSS、导入耗时、包体积、构建时间）
- [ ] T042 `docs/performance.md`：一段指向
- [ ] T043 `docs/roadmap.md`：完成项

## 验收

- [ ] T050 `pnpm run typecheck`
- [ ] T051 `pnpm test`
- [ ] T052 spec.md 第 6 节逐条核对
