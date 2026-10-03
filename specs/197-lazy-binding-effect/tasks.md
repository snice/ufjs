# Tasks: 197-lazy-binding-effect

阶段 1：量化 + 选型，不改生产路径。阶段 2 视结论另列。

## 契约层

- [x] 1. 确认不涉及：op 协议 / natives / 事件类型三张表均不动（见 plan §1 II）

## 实现（原型，放 bench 侧 `proto.ts`，见 plan §2 偏离说明）

- [x] 2. `examples/bench/vapor/proto.ts`（新）：搭框架与 `evalOnly` 与 `fxReal` 分层（真实 `renderEffect` 对 `NO_SCHED` effect 之差），各带更新断言
- [x] 3. 同文件：加 `fxLite`（候选 G，`new ReactiveEffect(fn)` + 共享调度器），含更新断言
- [x] 4. 同文件：加 `rowFx`（B）、`versionFx`（D），并量改 1 / 200 / 2000 格
- [x] 5. 同文件：评估 `staticDep`（C）；`@vue/reactivity` 3.5.43 公开 API 做不到就在结论里记「不可行」，不碰内部
- [x] 6. `examples/bench/vapor/main.ts` + `package.json`：调用 proto，新增 `pnpm run proto`

## 两端对齐（宪法 I）

- [x] 7. 确认原型只在 `examples/bench`，未进任何 runtime 包（`git diff --stat packages/` 为空）

## 测试

- [x] 8. `pnpm run vapor` 跑两遍，取中位数，记录各原型的挂载与更新三档
- [x] 9. `pnpm test` 确认既有用例不受影响

## 结论与文档（宪法 VIII）

- [x] 10. `specs/197-lazy-binding-effect/spec.md` 末尾写「结论」：每个候选的数字、选型 / 淘汰理由、是否进阶段 2
- [x] 11. `docs/performance.md`「4050 元素同屏」末尾追加结论；若不可行，也写明（避免重复探索）
- [x] 12. `packages/fjs-runtime/src/vapor/host.ts` 的（仅注释） `repeatTemplateLive` 注释补一句「为什么没有懒创建」

## 验收

- [x] 13. `pnpm run typecheck` 与 `pnpm test` 通过
- [x] 14. 逐条核对 spec 第 6 节阶段 1（条目 1、2）；阶段 2 条目标注「视结论」
