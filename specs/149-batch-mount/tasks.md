# Tasks: 批量挂载 + class 字段保留原生

对应 plan：`./plan.md`

## 0. 基线
- [x] T0 离线基线：floor（patch 32 / flush 18.2 / 29.2）、`pnpm run vapor`（vdom 66 / vapor 83）、flat-bench（flush 18.9 / 30.4）

## 1. 对拍测试先行
- [x] T1 `test/style-batch-mount.test.ts`：两套样式表（含 / 不含 `+` 规则）× 9 个场景，比样式、推送顺序、
  每元素位置位 / 前兄弟签名 / chain key、recompute 次数；变异检查见 spec §8

## 2. 实现（每项做完量一次，没收益就回滚）
- [x] T2 W1 op 写入器合并写（帧不变）：元素层 12 → 9.5 ms
- [x] T3 W2 样式引擎登记快路径：`ensure` 内联入队 −1.3 ms，`queuedAlone` −0.7 ms；ElementState 一次成形试过无净收益，回滚
- [x] T4 W3 渲染器逐元素冗余：`contains` 上原型、`trackInsert` push、不预建空 children、class 先判 −2.5 ms；
  按标签合并查表试过无收益，回滚
- [x] T5 W4 flush 顺序游标（首尾位 / 前兄弟）：结构规则 flush −2.2 ms；chain 引用计数改按 id 试过无收益，回滚
- [x] T6 W4 同形复用整份 compute 结果 → **不做**：只省 byParent 一次查找（~0.2 µs/元素），见 spec §8 偏差
- [x] T7 W5 esbuild `supported` 保留原生 class 字段 + CLI 单测 + 两个 flavor 的 fjsrun 验证；
  真机发现 PrimJS 静态字段自引用缺陷，静态字段改回降级

## 3. 验收
- [x] T8 `pnpm run typecheck`、`pnpm test`
- [x] T9 `examples/bench`：帧字节不变，其余项不回退 > 5%；§3 目标部分未达，见 spec §8
- [x] T10 `pnpm --filter demo run bench:mount`（prewarm）CSS 段不回退、miss 不变（vant-feedback 冷启动 +3 ms 为 GC 时机，已用 gc() 排除）
- [x] T11 `flutter test`
- [x] T12 真机 flat-4050 显示 3 次；spine 页不再报错
- [x] T13 文档：performance.md、toolchain.md；spec §8 结果
