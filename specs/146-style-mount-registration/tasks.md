# Tasks: 样式引擎挂载期逐元素登记瘦身

对应 plan：`./plan.md`

## 0. 基线

- [x] 在 main（改动前）跑 `examples/bench` 记下 `[flat]` 与 `[bench]` 全部行，存到 plan 附录
- [x] `examples/bench/src/flat-bench.ts`：加「注册 `:first-child` 规则」变体，量 app 形状下的 `noteStructureChange`

## 1. 契约层

- [x] 确认不涉及：op 协议 / natives / 事件类型均不动（spec §5）

## 2. 实现

- [x] `packages/fjs-runtime/src/css/style.ts`：`markDirty(id, true)` 入口查根节点 `subtreeEpoch`，已盖本轮章直接 `scheduleFlush()` 返回；clock 改为模块级惰性缓存
- [x] `packages/fjs-runtime/src/css/style.ts`：`addScope` 改为驻留共享的只读 scope Set（换引用、不就地改），`seenScopes.add` 每次都做（驻留表是模块级的，跨引擎实例）
- [x] `packages/fjs-runtime/src/css/style.ts`：`noteStructureChange` 同 epoch 去重——仅当第 0 步证明值得、且能证明等价时做；否则在 plan 里记下不做的理由

## 3. 两端对齐

- [x] 确认 web（`fjs-runtime/src/web/`）与小程序（`fjs-runtime/src/wx/`）不经过 `StyleEngine`，无需对应改动

## 4. 测试

- [x] 新增 `packages/fjs-runtime/test/style-mount-registration.test.ts`：同一棵树（scoped、class、结构伪类、`+` 兄弟、`:active`、继承与变量）按「先设 class 再 insert」「insert 后改 class / scope」「keyed move」「insert 前加 Transition class」四种顺序挂载，每个元素 computed style 与整份 op 帧与参考结果一致
- [x] 同文件：两个元素共享驻留 scope Set 后，给其中一个再加 scope，另一个不受影响
- [x] `packages/fjs-runtime/test/css-mark-dedupe.test.ts` 等现有样式单测不改期望值通过

## 5. 文档

- [x] `docs/performance.md`：新增「4050 元素挂载：登记路径」一节（拆账、改动、前后对比、`markMs` 口径变化）

## 6. 验收

- [x] `pnpm run typecheck`
- [x] `pnpm test`
- [x] `examples/bench`：`style.patch` ≤ 10 ms，`style.flush` 不回退，`frame` 字节数不变；`[bench]` 各项 min 不回退超过 5%
- [x] `pnpm --filter demo run bench:mount`：五页 CSS 段不回退，match miss 数不变
- [x] `cd packages/flutter_fjs && flutter test`（确认不是 `No tests ran`）
- [x] 真机 `fjs run ios --profile -d 00008101-000978E201FA001E`：flat-4050 显示 3 次 JS ≤ 150 ms（**未达到**：163–175 ms，见 spec §8）；theme 页、vant 页外观不变（未逐页截图）
- [x] 逐条核对 spec §6，更新 spec 状态（用户决定：按现状收尾，≤150 ms 未达记入 spec §8，兄弟共享另立 spec）
