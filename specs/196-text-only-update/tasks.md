# Tasks: 「只改文字内容」的更新快路径

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。
分支 `196-text-only-update`（叠在 195 之上；复用 194 的 `render/paint_only.dart`，合并顺序 193 → 194 → 195 → 196）。

## 契约层

- [x] T001 确认不动三张表

## 测量（已完成）

- [x] T010 真机量出改 N 格文字的帧拆分（见 spec §1）

## 实现

- [x] T020 `render/paint_only.dart`：抽出共用的 `_ownChain`；`classifyTextOnly` / `applyTextOnly`；`FjsPaintOnlyStats.textApplied` / `textFallbacks`；开关 `fjsTextOnlyEnabled`（`FJS_TEXT_ONLY`）与 `fjs.dev.textOnly`；`engine.dart` 注册
- [x] T021 `mirror_tree.dart`：`SET_TEXT` 分类入 `_textOnly` / `_touch`；`flushDirty` 处理（已脏跳过、失败回退）
- [x] T022 `examples/hello-js/src/flat4050.ts`：`__flat4050.setTextOnly('on'|'off')`

## 测试

- [x] T030 `test/text_only_test.dart`：对拍（同宽 / 变宽 / 变窄 / 多行 / 回原文 / transform / `:active` 容器 / 共享缓存 / 同帧改字与样式 / 连续改）、build 计数（200 个 ≤ 10%）、语义标签、父节点高度随多行变化
- [x] T031 回退各一例：空 ↔ 非空、richSpans、嵌套 text、htmlBlock、view 裸文本、button 子树、display:contents 父、transition、同帧别的 op 已要求重建、未挂载、自绘表面内、按下中
- [x] T032 `test/text_bump_bench_test.dart`：4050 同构负载改 200 / 2000 格，开 / 关两臂，≥12 轮，含 semantics 阶段
- [x] T033 变异检验：让快路径不换 span / 不清 `_recolored`，对拍应报像素不同

## 两端对齐（宪法 I）

- [x] T040 Web 侧不适用（浏览器自己决定重排重绘）；spec.md 补验证记录（`git diff` 无 `packages/fjs-runtime` / `packages/fjs` 改动）

## 文档（宪法 VIII）

- [x] T050 `docs/architecture.md`、`docs/performance.md`、`docs/roadmap.md`

## 验收

- [x] T060 `pnpm run typecheck`、`pnpm test`；`flutter test` 全量；`mount_bench` / `render_bench` / `theme_switch_bench` 同机对照不回退
- [x] T061 真机对照（iPhone 12，profile）：hello-js 4050 `bump(200)` / `bump(2000)` UI 线程最长帧开 / 关各 ≥4 次；画面一致
- [x] T062 spec §6 逐条核对，状态改 `done`
