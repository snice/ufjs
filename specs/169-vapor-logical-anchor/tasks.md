# Tasks: 169-vapor-logical-anchor

- [x] T1 共享用例 + web 测试 + Flutter 测试，确认修复前失败
- [x] T2 host.ts 数字锚点按 append 解析
- [x] T3 删除 VaporBackend.childAt 及两端实现
- [x] T4 `pnpm --filter @ufjs/runtime test` + typecheck
- [x] T5 `pnpm --filter fjs-bench run vapor` 对比修复前后挂载耗时

## 结果

- 修复前 web / Flutter 新用例各 5/6 失败（如 `T0HabS0N`），修复后全过；VDOM 快照一致。
- `@ufjs/runtime`：103 files / 891 tests 通过，`tsc --noEmit` 通过。
- bench（fjsrun，各 3 轮）vapor mount min/med：修复前 10.2–10.4 / 10.4–10.6 ms，
  修复后 10.3–10.5 / 10.5–11.3 ms（最后一轮 vdom 同步变慢，机器抖动），无回退。
