# Spec: Vapor host contract 抽离（中立核心 + 框架绑定）与 Solid signals 接缝验证

- **ID**: 163-host-contract
- **状态**: ready
- **日期**: 2026-09-30

## 1. 要解决什么

specs/161 落地的自研 Vapor 运行时（`src/vapor/runtime.ts`，约 1550 行）把两类东西混在一个
文件里：

1. **框架中立的核心**——模板解析/克隆、walker、writer、block 记账、insertion state、
   createIf/createFor/repeatTemplate[Live]、效果队列、backend seam（Flutter/web）。这一层
   就是「vapor host contract」：任何框架的编译产物只要发这组调用，就落在同一套元素 API 上。
2. **Vue 专属的绑定**——@vue/reactivity（effect/EffectScope/shallowRef）与组件层
   （createComponent/props/slots/defineVaporComponent/createVaporApp）。

分层是口头约定，没有形态约束：核心直接 import Vue 的反应式，下一个框架（React/Solid）想接
只能整文件抄一遍。需要把 contract 变成**物理边界**：中立核心独立成模块，反应式定义成接缝
接口，Vue 降级为一个绑定实现。

第二交付物：用 **Solid signals 实现同一个接缝**做验证——证明接缝是真的可插拔，不是为 Vue
量身定做的。按用户决策，Solid 只做到测试验证，不做完整框架接入。

## 2. 方案

### 2.1 文件拆分（行为零变化）

```
src/vapor/host.ts      新增：中立核心 + HostReactivity 接缝
src/vapor/runtime.ts   变为 Vue 绑定：注入反应式实现 + 组件层 + export * from './host'
```

`HostReactivity`（接缝的全部）：

```ts
export interface HostReactivity<S = unknown, R = unknown> {
  createScope(): S;                       // 新 scope：拥有在其内创建的效果
  runInScope<T>(scope: S, fn: () => T): T; // 在 scope 下执行 fn（效果归它）
  stopScope(scope: S): void;              // 停 scope 及其全部效果
  effect(fn: () => unknown, opts: { scheduler: () => void; onStop: () => void }): R;
  stopEffect(runner: R): void;
  box<T>(value: T): { value: T };         // 可写盒子：读追踪、写触发
}
```

`scheduler`/`onStop` 形状即 Vue `effect()` 的子集：**刷屏队列归核心**（`enqueue` 微任务
队列留在 host.ts），反应式引擎只负责追踪与触发。`withScope` 的 slots 变体随组件层留在
runtime.ts，包着核心的两参 `withScope`。

归属迁移：

- **host.ts**：profiling 区、backend seam、Block/insertion state、模板解析与 `template()`、
  walker、writer、效果队列与 `renderEffect`、`createIf`/`createFor`/
  `repeatTextIndex`/`repeatTemplate`/`repeatTemplateLive`/`createForSlots`、
  `disposeBlock`、`__vaporMicro`。`Block.scopes` 类型 `EffectScope[]` → `unknown[]`。
  `@vue/shared` 的 `normalizeClass`/`camelize`/`toHandlerKey`/`toDisplayString` 是纯字符串
  工具，留在核心（注释声明：绑定方可在上游归一化，不经过这层）。
- **runtime.ts（Vue 绑定）**：`setHostReactivity` 的 @vue/reactivity 实现 + 组件层
  （VaporComponent/createComponent(+WithFallback/Dynamic)/props/slots/resolveComponent/
  createVaporApp/mountVaporComponentForAdopt）+ `export * from './host'`。

对外表面不变：编译产物与两个 backend 继续从 `fjs/vapor` / `./runtime` 导入同名导出，
行为与性能零变化（验收见 §4）。

### 2.2 接口文档

`docs/vapor-contract.md`（中文）：三层结构（element API / host contract / 框架绑定）、
contract 函数面（约 20 个）、`HostReactivity` 语义（scope 所有权、效果调度归核心、
box 追踪语义）、新框架接入步骤（绑定反应式 → 适配 backend → 编译器发 contract 调用）、
分层纪律（框架假设不得下沉进 contract 与 element API——宪法既定规则的延伸）。
docs/README.md 加索引。

### 2.3 Solid signals 验证（只做测试）

`packages/fjs-runtime` 新增 devDependency `solid-js`（仅测试用，理由：本 spec 的验证
对象就是「接缝可被非 Vue 反应式驱动」，没有第二个实现就没有验证）。测试
`test/vapor-solid-host.test.ts`：

- `HostReactivity` 的 Solid 实现：scope = `createRoot` 拿 owner + dispose，
  `runInScope` = `runWithOwner`，effect = `createEffect`（调度归 Solid 自身），box =
  `createSignal` 的 getter/setter 包装。
- 自建一个 ~30 行的**记录型 backend**（不依赖 nodeOps），在纯 host.ts 上：
  `template()` 建格子 → `createFor`（非 ONCE，per-item scope + effect）→ 格子文本读
  Solid signal；断言挂载文本、signal 触发全量更新、`disposeBlock`（→ stopScope → Solid
  dispose）后 signal 再变**不再**触发写——scope 生命周期经接缝语义成立。

不做：Solid JSX 编译器接入、universal renderer 适配（那是 element API 层的适配，与
custom-renderer.md 同型，不在本 spec）。

## 3. 约束遵循

- **AGENTS #0**：本 spec 即授权。
- **新增依赖**（宪法允许须写明理由）：`solid-js` 仅进 `fjs-runtime` devDependencies，
  不进任何发布产物的 dependencies；运行时对它零依赖（测试文件专属）。
- **不新增/修改 op 协议、native**；`fjs/vapor` 导出面与行为不变。

## 4. 验收标准

1. `pnpm --filter @ufjs-runtime typecheck` 与全 workspace vitest（876+）全绿——即行为零
   变化的第一证据（所有既有测试不改断言地通过）。
2. bench（`fjsrun --frames`，flat-4050）数字与拆分前一致（静态 ~10.2 / Live ~26.4 ms，
   容差为运行噪声）——性能零回退。
3. Solid 验证测试通过：挂载文本正确、signal 更新全量生效、scope 停止后信号变更不再触发。
4. docs/vapor-contract.md 成文并进 docs/README.md 索引。

## 5. 不做什么

- 不做 React/Solid 的编译器接入与 universal renderer 适配（React 路径的判断见 2026-09-30
  的讨论：难点在编译器；Solid 完整接入另立 spec）。
- 不改 element API、op 协议、backend 行为、compiled 产物形状。
- 不把 once-inline / cli 的任何逻辑卷进来。
