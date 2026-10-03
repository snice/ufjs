# Plan: 自绘表面的增量更新路径

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不触发 | 只改 `lib/src/flat/` 内部实现；画面逐像素不变，对拍守住 |
| II 边界即契约 | 不涉及 | 不动 op / natives / 事件 |
| III 同步单线程零序列化 | 满足 | 全在 UI isolate 的 layout / paint 里 |
| IV 外观照 WeUI | 不涉及 | |
| V 静默失效是 bug | 要守 | 增量判定拿不准就整趟重排（尺寸变、两趟 flex 的父、结构变化）；随机编辑序列的「增量 == 全量」属性测试是缓存失效漏判的唯一防线 |
| VI 注释记录权衡 | 要做 | `flat_layout.dart` 头注释补「relayout 边界」的规则与两趟 flex 的例外；`flat_surface.dart` 写清保留层的生命周期与为什么块内不做视口裁剪 |
| VII JS 能包就不要下 Dart | 例外 | 瓶颈在 Dart 渲染层本身（真机 flat.layout / flat.paint） |
| VIII 变更落到文档 | 要做 | architecture / performance / roadmap |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 排版 | `lib/src/flat/flat_layout.dart` | ① `markDirty` 只标节点自己并入 `_dirtyList`；② `layoutRoot` 自底向上处理脏节点：用节点上次约束重排自己，**尺寸没变就停**（只沿父链重算 `bounds`），尺寸变了才把父节点标脏重排；③ 父节点用了两趟 flex（`usedTwoPass`）时一律上推（measuring 与 final 两趟里孩子的尺寸可能不同）；④ 节点记所属块 `chunk`，真正重算过的节点把所属块标脏；⑤ `FlatStats.relaidNodes` / 新增 `paintedChunks` / `reusedChunks` |
| 表面 | `lib/src/flat/flat_surface.dart` | 分块绘制：根的「脊柱」（沿单孩子链下探到第一个有 ≥ 4 个可见孩子的节点）自身与祖先的背景画进表面自己的层，其孩子各占一块，每块一个自己持有的 `OffsetLayer`（`LayerHandle`）；脏块 `pushLayer` 重录，干净块 `addLayer` 复用；块不在可见窗口则不加入也不录制；块内不做视口裁剪（滚动不使任何块失效）；孩子 < 4 个退化为单层（现状） |
| 测试 | `test/flat_layout_test.dart`（新）、`test/flat_chunk_test.dart`（新）、已有的对拍 / 增量 / 几何 / 裁剪 | 见 §5 |
| 基准 | `test/flat_bench_test.dart` | 记录改 1 格的块数与重排节点数 |
| 文档 | `docs/architecture.md`、`docs/performance.md`、`docs/roadmap.md` | |

## 3. 方案

### 3.1 增量布局：把 Flutter 的 relayout boundary 精确化

现在 `markDirty` 把整条祖先链标脏，`_layout(n, c)` 只要 `dirty` 就整趟重跑。真机上改一个数字（宽度不变）：4 个节点 relaid，
`flat.layout` 平均 3.3 / 最大 9.4 ms——grid 的 50 个孩子、row 的 80 个 item 各被重新分配、重新问约束。

新规则（`_dirtyList` 按深度从深到浅处理）：

1. 脏节点 `n`：`old = n.size`；用 `n.lastC`（它上次被父节点排版时的约束）重排 `n` 自己；
2. `n.size == old`：祖先的 flex 位置与尺寸都不受影响，**停**；只沿父链重算 `bounds`（裁剪与块判定要用）；
3. `n.size != old`：父节点标脏、入列（深度更浅，稍后处理），继续同样的判断；
4. **例外（上推）**：父节点上次走了两趟 flex（`usedTwoPass`），或父节点 `justify` 不是 start（孩子尺寸不变时位置也不变，这条其实不需要），
   或 `n` 是 `flex-grow` 项（grow 分配依赖兄弟，但兄弟没变、n 的 size 没变时分配也不变）——只有第一条真是例外：两趟 flex 的 measuring 约束与 final
   约束下孩子尺寸可能不同，final 尺寸不变不代表 measuring 尺寸不变。
5. 根自己：`layoutRoot` 的约束与上次不同（`lastC`）→ 整体重排（孩子按各自约束命中缓存）。

这与 Flutter 的 `RenderObject.layout` 行为一致（`parentUsesSize` 为真的孩子尺寸变了才让父节点重排），是同一个算法的显式版本。

### 3.2 分块绘制：保留层

- **脊柱**：从根沿「恰好一个可见孩子」的链下探，直到第一个有 ≥ 4 个可见孩子的节点 `P`（找不到则无块，退化为单层）。脊柱上每个节点的背景（含根）
  画进表面自己的层；`P` 的每个可见孩子的子树是一块。
- **每块一个 `OffsetLayer`**（`LayerHandle` 持有，表面 detach 时释放）；块内节点坐标以**块左上角（外框）**为原点，块的位置变化只改 `layer.offset`。
- **脏块重录**：`context.pushLayer(layer, painter, offset)`（它会清掉层里旧的孩子再让 painter 重新录）；**干净块**：`context.addLayer(layer)`（层对象原样接回树，
  引擎保留渲染复用上次的场景缓存）。
- **块脏的来源**：块内有节点真的重算过（`_layout` 非缓存命中）、`refresh` / `setEnv` 触碰过、块尺寸变了。块的位置变了不算脏。
- **视口裁剪改成块粒度**：窗口之外的块既不加入层树也不录制（层保留，回来时若仍干净直接复用）；块内**不**按窗口裁剪，所以滚动不会让任何块的录制过期
  （现在整层单图时才需要「滚动时 `markNeedsPaint` 重录」，分块后只需重新加入层，O(块数)）。
- **块太大**：单块节点数 ≥ 2048 时仍是一块（先不做嵌套块）；hello-js 的 4050 网格是 50 块 × 81 节点，数据驱动再调。

### 3.3 被否掉的备选

| 备选 | 否掉原因 |
|------|---------|
| 保持单层，改成脏区裁剪（`clipRect` 只画脏块） | 光栅线程仍要重栅整张 Picture，且 `PictureRecorder` 里的指令仍要全部重录一遍才能被裁剪掉；保留层才能让**引擎**复用 |
| 每个节点一个层 | 4051 层的合成开销远大于 4051 条绘制指令 |
| 嵌套块（任意子树都能成块） | 先做一层，真机数据说不够再做；嵌套意味着层的所有权和脏传播都要递归 |
| 把整条祖先链标脏换成「版本号」比较 | 与「尺寸没变就停」是同一个判定，版本号只是换个存储形式，不解决整趟重排 |
| 用 `RepaintBoundary` 子 RenderObject 每行一个 | 回到「每节点（行）一个 RenderObject」的老路，行内不省 widget 以外的成本，且几何查询等要重做 |

## 4. 风险

- **缓存失效漏判**（静默错位）：对策——随机编辑序列的增量 == 全量属性测试（5 个种子，扩到 12 个、每个 100 步），并新增「只改文字、只改颜色、改宽度、改孩子数、改 grow」各自的定向用例。
- **保留层的生命周期**：`OffsetLayer` 必须在表面 detach / dispose 时释放（`LayerHandle.layer = null`）；表面被移出再挂回时层可能已失效，需重录。对策：`detach` 清空所有块，`attach` 后首帧全录；测试覆盖挂载 / 卸载 / 再挂载。
- **`addLayer` 复用的前提**：该层此刻没有父亲。表面自己的层每次 paint 都会被框架清空孩子（`removeAllChildren` 解除父子），块层随之脱离，再 `addLayer` 才合法；对拍与滚动测试覆盖。
- **两趟 flex 的上推漏掉**：随机序列的父节点包含「stretch 在 shrink-to-fit 里」的结构（生成式对拍里已有）。
- **分块后 raster 变重或变轻**：真机上单层 raster 14.6 ms vs 现有渲染器 20.1 ms；分块后要看 raster 是否上升（层数 50）。真机数据决定块的粒度。
- **模拟器与离线数据不能代替真机**：本 spec 的验收以真机为准（iPhone 12 已连接）。

## 5. 验证路径

```bash
cd packages/flutter_fjs
flutter test test/flat_layout_test.dart test/flat_chunk_test.dart \
  test/flat_parity_test.dart test/flat_incremental_test.dart test/flat_geometry_test.dart \
  test/flat_cull_test.dart test/flat_gate_test.dart
flutter test                                  # 全量
flutter test --dart-define=FJS_BENCH=true test/flat_bench_test.dart
pnpm run typecheck && pnpm test

# 真机（iPhone 12，profile，连 dev server）
cd examples/hello-js
npx fjs run ios --device 00008101-000978E201FA001E --port 38903 -- --profile
npx fjs eval --port 38903 "__helloTab(0)"
npx fjs eval --port 38903 "__flat4050.setMode('clone')"
npx fjs eval --port 38903 "__flat4050.setFlat('off')"     # 对照 / 'force'
npx fjs eval --port 38903 "__flat4050.show()"; npx fjs eval --port 38903 "__flat4050.bump(1)"
node ../../packages/flutter_fjs/tool/frame-timeline.mjs <VM service URL> 14   # 期间 bump(1) × 6
```
