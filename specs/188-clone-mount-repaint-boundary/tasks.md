# Tasks: 188-clone-mount-repaint-boundary

- [x] 1. index.ts 导出 `adoptElement` / `allocIds`
- [x] 2. renderer.dart：`repaintBoundary` prop → RepaintBoundary 包裹
- [x] 3. flat4050.ts：模式切换 + cloneMany 挂载路径 + bump 句柄 + `__flat4050.setMode`
- [x] 4. docs/ui-api.md 登记 repaintBoundary
- [x] 5. 构建 + 离线冒烟 + 真机复测（两模式对照）

# 结果（iPhone，profile，同一组动作）

| 动作 | specs/187（native 引擎，逐个） | specs/188 | 说明 |
|---|---:|---:|---|
| show 逐个 JS | 62–73 ms | 62–73 ms | baseline 不变 |
| show 克隆 JS | — | **29.9–33.6 ms** | element 层（其余）57–66 → **17.7–21.6 ms** |
| show 克隆 过桥 | — | 10.5–10.8 ms / **0KB** | 克隆展开的 ops 在 C++ 侧生成，不过 JS 帧字节计量 |
| show 上屏 | 152–199 ms | 152–179 ms | 持平——镜像树同构，Dart 侧仍逐节点 BUILD（预期内，specs/189 候选） |
| 改 1 格上屏 | 46.5–53.3 ms | **32.2–36.6 ms** | 行级 repaintBoundary：PAINT (root) max 25.2 → **11.1 ms** |
| 改 200 格上屏 | 65–70 ms | 65–70 ms | 持平——200 格铺满全部 50 行，行层全部重录（预期内） |
| 改 2000 格上屏 | 102–119 ms | 99.6–131.6 ms | 持平——全量更新 + 2000 次 TextPainter 重排主导 |
| 最慢帧 | 16.8 ms | 16.8 ms | 无掉帧 |

timeline 佐证：挂载帧（逐个/克隆）= LAYOUT 71–99（内嵌 BUILD 73）+ PAINT ~5；
克隆模式的挂载帧与逐个完全同构（76.1/83.2 vs 87.1/77.4）。

# 过程记录

- 模板=一行 81 节点（row + 40×(cell+text)），初始内容每行相同，静态文本进模板，
  `cloneMany(count=50, texts=null)` 一条 op 挂整棵树；行节点的模板 `props` 带
  `{"repaintBoundary":true}`，克隆路径与逐个路径同样拿到 paint 隔离。
- 离线 fjsrun 冒烟：`--pump 1500` 下克隆展开为 2050 个 Create/Insert + 2000
  个 SetText（tracer 对透传帧有重复打印，SetText 数精确吻合）。
- fjsrun 需 `--pump <ms>` 才泵定时器——离线驱动脚本里 `await setTimeout(...)`
  之后才会跑后续步骤。
