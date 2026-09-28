# Tasks: flush 重算的同形兄弟共享

对应 plan：`./plan.md`

## 0. 基线

- [x] main 上跑 `examples/bench` 记下 `[flat]` / `[bench]` 与 `bench:mount`（146 合入后的值）

## 1. 契约层

- [x] 确认不涉及：op 协议 / natives / 事件类型不动；chain key 字符串格式不变

## 2. 实现

- [x] `packages/fjs-runtime/src/css/style.ts`：`recompute` 记 `s.pass`；本轮 `siblingIndex(pid)` 下标缓存
- [x] `packages/fjs-runtime/src/css/style.ts`：`structuralBits` / `prevElementSibling` 从下标起步
- [x] `packages/fjs-runtime/src/css/style.ts`：`buildChainKey` 读本轮 `s.structBits`；`prevSiblingSig` 对本轮已算的兄弟复用 `structBits` 与新增的 `sibSig`
- [x] `packages/fjs-runtime/src/css/style.ts`：`matchRules` 同形兄弟共享（plan §3.4 条件表）

## 3. 两端对齐

- [x] 确认 web / 小程序不经过 `StyleEngine`

## 4. 测试

- [x] 新增 `packages/fjs-runtime/test/style-sibling-sharing.test.ts`：同形行（首尾、`:not(:first-child)`、`+`、`:active`、`:hover`、伪元素、scoped、继承与变量、inline 混入、class 不同的兄弟、带属性选择器的兄弟），挂载 / 中间插入 / keyed move / 改一个的 class / 删首尾，样式与参照一致；参照组关掉共享
- [x] 变异验证：逐条去掉共享条件，确认对拍失败
- [x] 现有样式 / 快照 / 渲染器单测不改期望值通过

## 5. 文档

- [x] `docs/performance.md` 4050 元素一节补本次结果

## 6. 验收

- [x] `pnpm run typecheck`
- [x] `pnpm test`
- [x] `examples/bench`：`style.flush` page-rules ≤ 19 ms、with-structural ≤ 31 ms（修订后目标），帧字节不变，`[bench]` 不回退超过 5%
- [x] `pnpm --filter demo run bench:mount`：CSS 段不回退，match miss 数不变
- [x] `cd packages/flutter_fjs && flutter test`
- [x] 真机：flat-4050 显示 flush 35.5–37 ms、JS 152–166 ms（按实测记录）；theme / vant 页外观未逐页截图
- [x] 核对 spec §6，更新状态
