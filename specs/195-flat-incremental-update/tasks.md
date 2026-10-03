# Tasks: 自绘表面的增量更新路径

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。
分支 `195-flat-incremental-update`（叠在 194 之上；代码只涉及 193 的 `lib/src/flat/`，合并顺序 193 → 194 → 195）。

## 契约层

- [x] T001 确认不动三张表（`git diff --stat 194-paint-only-style-update` 里没有 op / natives / 事件文件）

## 测量

- [x] T010 真机量出改 1 格 / 挂载一帧里 `flat.prepare` / `flat.layout` / `flat.paint`（Timeline 标记已加，数据见 spec §1）
- [x] T011 把「布局整趟重跑」与「绘制整层重录」各占多少写进 spec.md「结论」（用 T030 / T040 落地前后的真机对照回答）

## 增量布局

- [x] T020 `flat_layout.dart`：`markDirty` 只标节点自己并入 `_dirtyList`；`layoutRoot` 自底向上处理（尺寸没变停、变了上推、`usedTwoPass` 的父一律上推、根约束变了整体重排）；沿父链重算 `bounds`
- [x] T021 `test/flat_layout_test.dart`（新）：4050 网格改一个文字（宽度不变）`FlatStats.relaidNodes == 1`；改成更宽的文字（cell 变宽）重排的节点数在受影响链上；改 grow 项、改孩子数、改 `display:none`、两趟 flex 的父（shrink-to-fit 里的 stretch）各一例，对拍全量结果
- [x] T022 `flat_incremental_test.dart`：种子扩到 12、每个 100 步；加定向用例

## 分块绘制

- [x] T030 `flat_layout.dart`：节点记所属块、`FlatChunk`（脏标记、层句柄），脊柱与块的划分（≥ 4 个可见孩子、否则退化单层）；重算过的节点把所属块标脏
- [x] T031 `flat_surface.dart`：`paint` 里脊柱背景画进自己的层；块 `pushLayer` 重录 / `addLayer` 复用；块级视口裁剪；`detach` 释放层；`FlatStats.paintedChunks` / `reusedChunks`
- [x] T032 `test/flat_chunk_test.dart`（新）：改 1 格只录 1 块（其余复用）；视口外的块不录制、滚进来后画面与现有渲染器逐像素一致；挂载 / 卸载 / 再挂载；块位置变化只改 offset 不重录；孩子 < 4 个退化单层
- [x] T033 对拍：`flat_parity_test.dart` 全部在分块路径上逐像素一致（含单层退化与多块）

## 验收

- [x] T040 `flutter test` 全量（native 已编译）；`pnpm run typecheck`、`pnpm test`；`flat_bench_test` 离线对照记录
- [x] T041 真机对照（iPhone 12，profile）：4050 网格改 1 格 UI 线程最长帧 ≤ 现有渲染器（目前 24.3 vs 4.6 ms）；`update1` 上屏不高于现有；挂载帧与 hide 不退化；raster 线程不明显上升；数据写进 spec.md「结论」
- [x] T042 文档：`docs/architecture.md`、`docs/performance.md`、`docs/roadmap.md`
- [x] T043 `git diff --stat 194-paint-only-style-update` 只含预期路径；spec §6 逐条核对，状态改 `done`
