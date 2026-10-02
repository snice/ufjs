# Plan: 163-host-contract

## 顺序

1. **host.ts 抽取**（一次机械搬移 + 缝替换）
   - 新建 `src/vapor/host.ts`，从 runtime.ts 迁入中立核心（清单见 spec §2.1）。
   - 顶部定义 `HostReactivity` + `setHostReactivity` + 私有 `rx`；所有
     `new EffectScope()` → `rx.createScope()`、`scope.run(fn)` → `rx.runInScope`、
     `scope.stop()` → `rx.stopScope`、`effect(fn, opts)` → `rx.effect`、`stopRunner` →
     `rx.stopEffect`、`shallowRef` → `rx.box`。
   - `currentScope: EffectScope | null` → `unknown`；`withScope(scope, fn)` 两参版留核心
     （`scope == null ? fn() : rx.runInScope(scope, fn)`，currentScope 由核心换入换出）；
     runtime 的三参（slots）版包着它。
   - `Block.scopes: unknown[]`；`removeBlock`/`dropItem`/`disposeBlock`/ONCE 清理走
     `rx.stopScope`。
   - `renderEffect` 结构不变（profiling 包装、enqueue 队列、fxTag），只把 `effect(...)` 换
     成 `rx.effect(...)`；`stopRunner` 同理。
2. **runtime.ts 变绑定**：`setHostReactivity(vueReactivity)`（模块顶部，先于任何 helper
   可被调用）；组件层原样搬回；`export * from './host'`；`withScope` 三参版（slots）包核心
   两参版。模块求值顺序保证：index.ts 先 import runtime（注入发生）再 backend-flutter。
3. **接口文档** `docs/vapor-contract.md` + docs/README.md 索引行。
4. **Solid 验证**：`pnpm add -D solid-js --filter @ufjs/runtime`；新测试
   `test/vapor-solid-host.test.ts`（自建记录型 backend，直接驱动 host.ts，不经 runtime 绑定）。
5. **行为零变化验证**：typecheck、全量 vitest、bench 对照（10.2 / 26.4 ms 基线）。

## 风险

- 循环导入：host.ts 禁止 import runtime.ts（唯一纪律点）；backend/interop/tests 继续从
  `./runtime` 导入，不经手改动。
- 模块求值顺序：谁先 `setHostReactivity` 谁生效——测试里 Solid 实现后注入覆盖 Vue 实现，
  依赖 import 完成后再调用的事实；在测试注释里写明。
- `Block.scopes` 类型放宽为 `unknown[]`：检查 backend/interop 对 `.scopes` 的读写点。

## 测试顺序

typecheck → vitest 全量 → Solid 验证测试 → bench 对照 → 文档。
