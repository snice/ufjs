# Tasks: 189-mount-frame-cpu-profile

- [x] 1. `tool/cpu-profile.mjs`：窗口期 CPU 采样按函数聚合（leaf-first 栈、
  timestamp 过滤、Map/Hash 内部帧向最近 Dart 调用者归因）
- [x] 2. 按归因下刀：
  - `FjsStyle.transitions` / `backgroundLayers` / `gradient` memoize（此前
    每节点每次 build 重 parse 2–3 次）
  - `decorateNode` 的 BoxDecoration 按 interned style 缓存
    （`style.cachedDecoration`；% 圆角走 `fractionRadius` 逐尺寸解析、内置
    控件带默认色——两类保持每次新建）
- [x] 3. 真机验证 + flutter test 562 通过

# 结果（iPhone，profile，克隆模式）

| 动作 | specs/188 | specs/189 |
|---|---:|---:|
| show-clone JS | 29.9–33.6 ms | 30–31.2 ms（未动 JS，持平 ✓） |
| **show-clone 上屏** | 152.1–152.7 ms | **132.3–136.1 ms（三次采样一致）** |
| 改 1 格上屏 | 32.2–36.6 ms | 31.9–32.3 ms |
| 改 200 格上屏 | 65–70 ms | 48.5 / 69.6 ms（样本波动） |
| PAINT (root) max | 25.2 ms | 11.1 ms（188 已带 boundary） |

## 归因与认识（比数字更有价值的部分）

- build 期（buildScope）的 self 时间分布：**Map/HashSet 操作 ~20%**（其中
  `FjsStyle._v` 37ms、parseTransitions 14ms、isHidden 10ms——前两项已修，
  isHidden 注释表明已被调优过，保留）；**GC 旧代标记 ~40ms**（存活对象：
  2050 节点 × 9 个 Element/RenderObject 的创建与晋升，缓存装饰救不了它）；
  Inherited 依赖机制 ~46ms（大头在 hide 卸载期的 Element 反注册，非 per-build
  查找，三处 FjsPercentBase 查找本就有相对值门控）。
- 克隆节点的样式**确实跨节点共享**（离线展开帧只有 21 条 defineStyle，格子零
  新增）——decoration 缓存在挂载时命中，2050 次 BoxDecoration 分配降到 ~5。
- 挂载帧剩余 ~85–95ms 的构成 = Element/RenderObject 创建 + 布局，与
  hello-fjs 的 VDOM/Vapor 持平，是三条渲染路径的共同前沿。再往下是结构性的
  「克隆子树的 widget/Element 复用」（widget 携带 nodeId 的信号接线是主要
  障碍），另立 spec。

# 工具注记

- getCpuSamples 的栈是 **leaf-first**（head=叶子）；ProfileFunction 的
  inclusive/exclusive ticks 覆盖整个 buffer，窗口过滤要按 sample.timestamp
  自己做。iOS profile 构建的 Dart 符号可用（非 Native 帧有函数名）。
- fjsrun 需 `--pump <ms>`；离线克隆展开帧 defineStyle 仅 21 条。
