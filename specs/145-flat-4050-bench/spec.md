# Spec: 4050 元素同屏压测页（对标 uni-app x）

- **ID**: 145-flat-4050-bench
- **状态**: in-progress
- **日期**: 2026-09-28

## 1. 要解决什么

uni-app x 的 vapor benchmark（https://doc.dcloud.net.cn/uni-app-x/benchmark/vapor-benchmark-android.html）
用一页「点按钮同屏挂 4050 个元素」量「点击 → 渲染结束」。我们没有同构的页面，无法在真机上横向对比。

## 2. 做什么

在 `examples/hello-fjs` 加一页 `example/interaction/flat-4050`，模板照搬原例（5×10 常驻格 + 50×40
按需格，每格 view + text），分三段报数：

- **JS**：tap → `nextTick`（Vue patch + 样式引擎 + op 编码 + 同步 applyFrame）
- **点击→上屏**：tap → 挂载后第二个 rAF，对应 uni-app x 的 total duration
- **最慢帧 / 30**：挂载后 30 帧里最长的一帧

原例的 `flatten`（uni-app x 拍平）没有对应物，去掉。页面不调用 `gc()`。

## 3. 验收

- [x] 页面在 iOS 真机 `fjs run ios --profile` 下可打开，显示/隐藏都出数
- [x] 真机读数（多次显示/隐藏）记进本 spec
- [ ] web 端能打开（两端同源）

## 4. 真机读数（2026-09-28，iPhone 12 / A14，`--profile`，PrimJS）

| | JS | 点击→上屏 | 最慢帧/30 |
|---|---:|---:|---:|
| 显示 #1 | 195.1 ms | 349.8 ms | 25.7 ms |
| 显示 #2 | 191.4 ms | 316.1 ms | 33.8 ms |
| 显示 #3 | 184.5 ms | 333.1 ms | 33.2 ms |
| 隐藏 #1 | 128.3 ms | 149.2 ms | 17.2 ms |
| 隐藏 #2 | 129.2 ms | 149.5 ms | 17.1 ms |

uni-app x 官方 iOS 数字（release）：iPhone SE2（A13）vapor 160.6 ms / UIKit 328.75 ms；iPhone XR
vapor 185.8 / UIKit 339.7 / SwiftUI 610.6 ms。它的终点是「渲染指令交给系统渲染进程」，不含最后
一帧 GPU；本页「上屏」多含约一帧。

### JS 段拆账

真机（页面内：op sink 计时 + `styleEngine.stats`，3 轮稳定在 ±2 ms）：

| | JS | 过桥（含 Dart applyFrame） | 样式 flush | 样式 mark | 其余 |
|---|---:|---:|---:|---:|---:|
| 显示 | 190–195 ms | **2 ms** / 171 KB | 45.5 ms | 10 ms | 133 ms |
| 隐藏 | 109–136 ms | **78–84 ms** / 66 B | 0 | 0 | 30–53 ms |

离线（`examples/bench` 的 `flat-bench.ts`，fjsrun，Mac，min）把「其余」再拆开：

| 挂载 93.2 ms | ms | 真机按 ×2.1 折算 |
|---|---:|---:|
| 样式引擎·patch 期登记（ensure 5.8 / addScope 7.9 / setClasses 6.4 / noteStructureChange 1.9 / recomputeSubtree 4.3） | 26.0 | ~55 |
| 样式引擎·flush 重算 | 23.6 | ~46（实测 45.5） |
| 元素层（create / insert / setText + op 编码，裸 API 同树） | 11.9 | ~25 |
| Vue runtime-core + 渲染器胶水 | ~31 | ~65 |

（×2.1 = 真机 flush 45.5 / 离线 flush 23.6；真机「其余」133 ≈ 登记 45 + 元素 25 + Vue 65，对得上。）

读法：

1. **样式引擎占挂载的一半多（~100 ms）**，而这 4000 个元素只有 3 种样式。flush 是 4150 次
   compute 命中缓存；patch 期的登记是每元素 5 次方法调用（ensure / addScope / setClasses /
   recomputeSubtree / noteStructureChange），每次都是 Map 查找 + 分配。
2. **Vue ~65 ms（1/3）**：vnode + mountChildren + 渲染器每节点的 shadow 树记账。
3. **元素层 ~25 ms**、**过桥 2 ms**——不是瓶颈。
4. **卸载的 80 ms 在 Dart 侧**：`mirror_tree.dart` 的 `_removeDeep` 对每个被删节点都
   `for (final other in _nodes.values) other.children.remove(id)` 扫一遍全表，O(删除数 × 总节点数)，
   4150 × 数千，二次方。

### 修复：`_removeDeep` 去掉全表扫描

`insert` 是唯一往 child list 加节点的地方且先 `_detach`，节点只会在一个父节点下，全表扫描是
多余的兜底（自 init 起就在，无记录的理由）。删掉后同机同页：

| 隐藏 | JS | 过桥 | 点击→上屏 |
|---|---:|---:|---:|
| 修前 | 109–136 ms | 78–84 ms | 133–166 ms |
| 修后（4 次） | 52–60 ms | **0.9–1.1 ms** | 94–99 ms |

回归：`mirror_tree_test.dart`「remove after a move leaves both parents clean」；flutter_fjs 全量 545 通过。

结论：显示约 330 ms，与原生 UIKit 同档、约为 uni-app x vapor 的 2 倍；**光 JS 段（~190 ms）
就超过了对方的总耗时**，Flutter 侧 build/layout/paint 约 140 ms。隐藏（卸载）JS 128 ms 也偏贵。

## 5. 全链路复测（2026-09-30，specs/146–158 全部落地后）

同机（iPhone 12 / A14，`fjs run ios --profile`，PrimJS，hello-fjs flat-4050），用户手点，页面自报
（`[flat-4050]` 行，多次取样）：

| | JS | 过桥 | 样式 flush | 其余 | 点击→上屏 | 最慢帧/30 |
|---|---:|---:|---:|---:|---:|---:|
| 显示 · VDOM（3 次 + 1 离群 118） | 87.9–91.4 | 3.1–4.1 / 47KB | 0.5–1.0 | 83.8–87.5 | 181.7–198.6 | 16.8 |
| 显示 · Vapor（4 次 + 1 离群 156.7） | 119.5–122.7 | 3.0–3.3 / 45KB | 0.5–0.7 | 115.6–119 | 215.1–215.7 | 16.9 |
| 隐藏 · VDOM（3 次） | 21–35.9 | 1.3–2.1 / 0KB | 0 | — | 65.6–72.3 | 17.1 |
| 隐藏 · Vapor（4 次） | 46.2–55.1 | 1.4–1.6 / 0KB | 0 | — | 81.6–98.5 | 17.0–17.4 |

145 基线 VDOM 显示 JS 187–195 → 现在 87.9–91.4（-53%），上屏 316–350 → 181.7–198.6（-43%）。
样式 flush 从 45.5 ms 到 <1 ms（引擎在 libfjs-style，specs/150）。

改格更新（JS，页面上「改 N 格」按钮）：

| | 改 1 格 | 改 200 格 | 改 2000 格 |
|---|---:|---:|---:|
| VDOM | 30.8–61.4 | 56.6–65.2 | 63.2 |
| Vapor | **2.4–2.9** | **18.3–23.3** | 81.9（单次） |

改 1 / 200 格 Vapor 仍领先一个数量级；改 2000 格两边都进 GC 噪声区（specs/153 当天是 VDOM 76 / Vapor 70，
这次反过来，单次样本不下结论）。

### 显示帧的 Flutter 侧（frame-timeline.mjs，100 s 窗口，覆盖上面两次显示两次隐藏）

| | VDOM 显示帧 | Vapor 显示帧 |
|---|---:|---:|
| UI 线程帧 | 83.6 ms | 82.8 ms |
| 　BUILD | 50.6 | 46.2 |
| 　　（内嵌 Scavenge） | 18.7（扣除后 build ~32） | 22.1（扣除后 ~24） |
| 　纯布局（LAYOUT − BUILD） | 24.5 | 28.3 |
| 　PAINT | 6.5 | 6.4 |
| 隐藏帧 | 22.7–24.7（FINALIZE TREE 14.3–15.6） | 同左 |
| raster 最长 | 17.0 ms（一个 vsync） | 同左 |

**两条路径的 Flutter 侧完全一致（差 0.8 ms）**：镜像树还原出来的 Widget 树同构，Vapor 的慢全在 JS 段
（120 vs 88，拆账见 specs/148 §8.3）。与 specs/157 的显示帧 80.5 ms 在噪声内。

渲染瓶颈的结论：JS 88 ms 之后的一帧里，build（扣 GC）~25–32、GC ~19–22、纯布局 ~25–28 三块均衡，
没有单项大头；raster 17 ms（一帧）封顶。继续压需要三线并进，单项收益都在 10 ms 级。
