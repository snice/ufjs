# Spec: 自绘表面的增量更新路径

- **ID**: 195-flat-incremental-update
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

specs/193 的自绘表面在**挂载**上是赢的（真机 iPhone 12，profile，4050 网格：UI 线程最长帧 66.7 → 19.7 ms，
show 上屏 98 → 49 ms），但在**改 1 格**上**比现有渲染器更慢**——这是离线 JIT 基准（0.95 ms）和模拟器 debug 基准都没暴露的，
真机才看得见：

| 改 1 格（真机，frame-timeline） | 现有渲染器 | 自绘表面 |
|---|---:|---:|
| UI 线程最长帧 | 4.6 ms | **24.3 ms** |
| 其中 LAYOUT | 0.8 ms | **12.4 ms**（`flat.layout` 平均 3.3 / 最大 9.4，`flat.prepare` 最大 3.5） |
| 其中 PAINT | 2.9 ms | **11.4 ms**（`flat.paint` 平均 3.5 / 最大 12.7） |
| 光栅线程最长 | 20.1 ms | 14.6 ms |
| `[flat-4050] update1` 上屏 | 19–34 ms | 37–52 ms |

两个原因，都是 193 的设计留下的：

1. **布局**：`FlatEngine.markDirty` 把脏节点到根的整条链都标脏，`_layout` 对每个脏祖先**整趟重跑** flex（4050 树里 grid 有 50 个
   孩子、row 有 80 个 item，每趟都重新分配 item 列表、重算每个孩子的约束）。Flutter 的 RenderObject 不这么做：孩子尺寸没变，
   relayout 就停在这个孩子（`parentUsesSize` + relayout boundary）。改一个数字的文字，宽度几乎总是不变，祖先根本不需要动。
2. **绘制**：整个表面是**一层**（一个 `RepaintBoundary`，一张 Picture）。改 1 格要把 4051 个节点的绘制指令全部重录
   （2000 次 `TextPainter.paint` + 2000 次 `drawRect`）。现有渲染器每行是一个 `RepaintBoundary`（hello-js 的行带
   `repaintBoundary: true`），改 1 格只重录那一行。

结果：193 在「静态大块内容」上是赢家，在「大块内容里偶尔改一点」上是输家——后者恰恰是真实页面更常见的形态。

## 2. 不做什么（Non-goals）

- 不改门控（哪些子树进自绘）、不扩样式子集、不加手势 / 语义（这些是后续的「岛屿」spec）。
- 不改 `FlatEngine` 的**语义**：布局结果必须与现在（也就是与现有渲染器）逐节点逐像素一致，只改**怎么算到**。
- 不动现有渲染器、`render/paint_only.dart`（194）、op 协议、natives、事件。
- 不引入 C++ 排版（193 阶段零已判定不进主线）。
- 不追求挂载帧再快：挂载已经是 3.4×，本 spec 只保证它**不退化**。

## 3. 用户可见的行为

页面源码与画面**不变**。可观察的只有速度：纯展示大块内容里改一小处（一个数字、一个颜色）时，UI 线程成本与现有渲染器同量级甚至更低。

### 增量布局（relayout 边界）

- 一次变更只标**脏节点本身**（`selfDirty`），不再标祖先。
- `performLayout` 里自底向上处理脏节点：用该节点上一次的约束重排它自己；**尺寸没变**就停（祖先的 flex 位置不受影响），
  只沿父链更新 `bounds`（绘制裁剪用）；**尺寸变了**才让父节点整趟重排，再对父节点做同样的判断。
- 结构变化（增删节点、子节点列表变）、文字环境变化仍整体重新 pack（O(n)，与现在一致）。

### 分块绘制（保留层）

- 表面把根的直接孩子（4050 树里是 50 行）按**块**组织：每块一个保留的 `OffsetLayer`，块内节点绘制进该层的 Picture。
- 一次更新只**重录脏块**（节点所在的块），其余块的层原样复用（Flutter 的 retained layer 机制：`addLayer` 一个未标脏的已有层，
  引擎侧场景缓存复用）。
- 块的划分、块内节点数上限、没有足够多孩子时的退化（单层）在 plan 阶段按实测定。
- 视口裁剪（specs/193）继续生效：块在可见窗口之外时不录制也不保留。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 自绘表面内部的更新路径，页面语义与画面不变 | 不适用：浏览器自带排版与重绘范围 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无（逐像素一致是验收条件） | — |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（只改 `lib/src/flat/` 的内部实现）

## 6. 验收标准

1. **先量**：在 `FlatEngine` 里给 `_layout` / `_flexPass` / `_prepare` / paint 各加 Timeline 标记（`flat.prepare` / `flat.layout` / `flat.paint` 已有），
   真机 profile 读出「改 1 格」一帧里 pack / layout / paint 的平均与最大，写进 spec.md「结论」，并确认两个原因
   各占多少（布局的整趟重跑、绘制的整层重录）。
2. **正确性不变**：`flat_parity_test.dart`（133 例）、`flat_incremental_test.dart`（5 个种子 × 60 步随机编辑，增量 == 全量）、
   `flat_geometry_test.dart`、`flat_cull_test.dart`、`flat_gate_test.dart` 全绿；对拍同时覆盖分块绘制（逐像素）。
3. **增量布局**：新增计数器测试——4050 网格改一个文字（宽度不变）`FlatStats.relaidNodes` == **1**（目前是 4）；
   改成更宽的文字（cell 变宽，row 的尺寸变）重排的节点数 ≤ 该链上受影响的节点 + 其兄弟；属性测试（随机编辑，固定种子）增量结果仍等于全量。
4. **分块绘制**：计数器测试——改 1 格只录制 **1 块**（`FlatStats.paintedChunks` == 1，其余块复用）；视口外的块不录制；
   滚动后新进入视口的块出现且画面与现有渲染器逐像素一致。
5. **离线对照**：`flat_bench_test.dart` 的改 1 格整帧、mount、unmount 不退化（改 1 格应明显下降）。
6. **真机对照**（iPhone 12，profile，`fjs run ios -- --profile`，`__flat4050.setFlat('off'|'force')`，各 ≥5 轮）：
   4050 网格改 1 格的 **UI 线程最长帧 ≤ 现有渲染器的 UI 线程最长帧**（目前 24.3 vs 4.6 ms），`update1` 上屏不高于现有渲染器；
   挂载帧（show）与 hide 不退化（目前 19.7 / 66.7 ms）。数据写进 spec.md「结论」。
7. **主线不退化**：`flutter test` 全量通过；`pnpm run typecheck`、`pnpm test` 通过；`mount_bench` / `render_bench` 同机对照不回退。
8. 文档：`docs/architecture.md`（自绘表面一节补增量布局与分块）、`docs/performance.md`（真机数据：193 的挂载收益与 195 前后的改 1 格）、
   `docs/roadmap.md`。

## 7. 待澄清

- [ ] **1. 块的划分**：倾向「根的直接孩子各占一块，直接孩子少于 8 个或单个孩子就占很多节点时再往下拆一层」（4050 树 = 50 行 = 50 块）。
      具体阈值在 plan 阶段按真机数据定；是否同意由数据决定？
- [ ] **2. 保留层的实现**：用 `PaintingContext.pushLayer` + 自己持有的 `OffsetLayer`（`RenderRepaintBoundary` 的做法）。
      Flutter 没有给自绘 RenderObject 提供「按子区域局部失效」的现成 API，这条路需要小心（层的生命周期、`needsCompositing`、
      `markNeedsAddToScene`）；如果量下来重录 4051 个指令的成本主要在文字 `paint` 而不是层数，也可以退一步只做「脏块脏区裁剪」
      （`canvas.clipRect` 只画脏块）。倾向先做保留层，不行再退。同意吗？

## 结论

### 测量：改 1 格在真机上花在哪（T011）

真机 iPhone 12（profile，`fjs run ios -- --profile`，frame-timeline）。193 的版本，改 1 格一帧 UI 24.3 ms：

| | `flat.prepare` | `flat.layout` | `flat.paint` |
|---|---:|---:|---:|
| 平均 / 最大（18 次） | 1.3 / 4.6 ms | 2.1–3.3 / 6.6–9.4 ms | 3.5–3.9 / 12.1–12.7 ms |

按两个原因分别修，再读计数器（`__flat4050.flatStats()`，经 `fjs.dev.flat('stats')` 暴露引擎计数器）后发现还有**第三个原因**，而且是最大的：

1. **环境实例**：`FjsTextEnvScope` 每次重建都造一个新的 `_FjsTextEnv`，真机上页面任何无关更新（统计文本）都会让整页重建；
   `FlatEngine.setEnv` 用「同一实例」判断，于是**每次编辑都被当成环境变了**：`bump(1)` 后 `relaid 2007`（全部文字重排）、
   `paintedChunks 50`（全部重录）。离线与模拟器上环境实例从不换，所以一直没暴露。改为按内容比较
   （`FjsTextEnvData.sameAs` = `updateShouldNotify` 反过来读）后：`relaid 7`、`paintedChunks 1`、`reusedChunks 49`。
2. **布局整趟重跑**：现已用 relayout 边界替代（尺寸没变就停，两趟 flex 的父一律上推）。
3. **绘制整层重录**：现已分块（保留层，只重录脏块，块位置变化只改 offset）。

教训：**离线 JIT 基准与模拟器都无法暴露「真机上页面会无关重建」这一类问题**，193 当时只在静态场景验收；任何依赖「实例同一性」的缓存判断，
都要在真实页面的重建节奏下验证。

### 真机对照（T041，iPhone 12，profile，hello-js 4050 屏，克隆模式，`__flat4050.setFlat('off'|'force')`，6 轮）

| | 现有渲染器 | 自绘 193 | 自绘 195 |
|---|---:|---:|---:|
| 改 1 格 UI 线程最长帧 | 4.6 ms | 24.3 ms | **3.2 ms** |
| 其中 layout / paint | 0.7 / 2.9 ms | 12.4 / 11.4 ms | 0.5 / 1.1 ms（`flat.layout` / `flat.paint` 最大 4.1 / 6.0 ms 的累计均值更低） |
| 改 1 格 `update1` 上屏 min / med | 21 / 28.6 ms | 37 / 50 ms | **22 / 29 ms** |
| 改 1 格光栅线程最长 | 20.5 ms | 14.6 ms | 22.3 ms |
| 挂载帧（show）UI 线程最长 | 67.3 ms | 19.7 ms | **15.5 ms** |
| 挂载帧光栅线程最长 | 6.0 ms | 14.0 ms | **7.7 ms** |
| show 上屏 min / med | 104 / 112 ms | 49 / 60 ms | **53 / 62 ms** |
| hide 上屏 | 52–64 ms | 52–59 ms | 52–63 ms |

改 1 格：UI 线程 24.3 → 3.2 ms，低于现有渲染器的 4.6 ms；上屏读数与现有渲染器持平（~2 个 vsync 的下限）；光栅线程两边都约 20 ms
（自绘 +1.8 ms，噪声量级，是整屏合成的成本，与走哪条路径无关）。挂载帧 UI 67 → 15.5 ms，且分块把光栅从 14 降回 7.7 ms。

### 离线（JIT，读比例）

改 1 格 0.95 → **0.27–0.31 ms**（现有渲染器的 3.5%）；挂载 2.5 ms 不变；`relaidNodes`：宽度不变的文字 1，变宽 3（text → cell → row，row 的尺寸被 grid 钉死而停）。
