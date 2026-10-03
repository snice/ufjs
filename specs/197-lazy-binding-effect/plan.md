# Plan: Vapor 绑定 effect 懒创建（先可行性验证）

对应 spec：`./spec.md`。本轮只做 spec 阶段 1：**量化 + 选型**，不改生产代码路径。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否（本轮） | 只动 Vapor 宿主层的 bench 辅助函数 `__vaporMicro`，该层 web / Flutter 共用。阶段 2 若落地，在 `vapor-helpers-web.test.ts` 与 `vapor-helpers-flutter.test.ts` 各加用例 |
| II 边界即契约 | 否 | 不碰 op 协议、natives、事件类型 |
| III 同步单线程零序列化 | 否 | 纯 JS 内部 |
| IV 外观照 WeUI | 否 | 无 UI 变化 |
| V 静默失效是 bug | **是** | 懒方案的失效模式就是静默漏更新；阶段 2 必须有「首次变更前依赖已改」「unmount 后不再触发」用例；阶段 1 的原型都要带一条更新正确性断言，错的方案不进结论表 |
| VI 注释记录权衡 | 是 | 结论落到 `host.ts` 里 `repeatTemplateLive` 的注释（为什么没有懒） |
| VII JS 能包就不要下 Dart | 否 | 全在 JS |
| VIII 变更落到文档 | 是 | `docs/performance.md`「4050 元素同屏」追加结论；阶段 2 才动 `docs/vapor-contract.md` |

无需破例。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| bench 原型 | `examples/bench/vapor/proto.ts`（新） | 原型分层：见 §3。**偏离**：原计划放 `host.ts` 的 `__vaporMicro`，但 host.ts 按设计不 import 引擎（`ReactiveEffect` 够不着），原型改在 bench 侧，用 element API + `vue` 的 `reactive / effect / ReactiveEffect` 搭同一棵 50×40 树 |
| bench 输出 | `examples/bench/vapor/main.ts` | 调用 proto 并打印 |
| 文档 | `docs/performance.md`（「4050 元素同屏」章节末） | 结论与数字 |
| spec | `specs/197-lazy-binding-effect/spec.md` 末尾「结论」 | 选型与否决理由 |

阶段 1 不动：`packages/fjs-runtime/src/vapor/runtime.ts`（`effect: (fn, opts) => effect(fn, opts)`，第 200 行）、`once-inline.ts`、Dart、C++。
`@vue/reactivity` 为 3.5.43（`node_modules/@vue/reactivity`），阶段 1 只用它的公开 API。

## 3. 方案

阶段 1 在 `__vaporMicro` 里对同一棵 50×40 格子树（`layer()` 的写法：节点在计时器内创建）
逐层加原型，N = 2000，每项各自带一条更新正确性断言：

| 原型 | 量什么 | 对应候选 |
|------|--------|---------|
| `evalOnly` | 只跑表达式并写文本，不建 effect | 方案 A 的上限（本身不可行，只作地板） |
| `fxReal` | **照 `renderEffect` 形状复刻**（job / opts / pending 闭包 + 微任务队列）与 `NO_SCHED` effect 之差；复刻与真实 `renderEffect` 的偏差靠整体挂载数交叉核对 | 看 3.0 的 fxEmpty 地板之外，我们自己的包装花了多少 |
| `fxLite` | `new ReactiveEffect(fn)`，调度器挂在原型 / 共享函数上，一格只一个对象，无 per-cell 闭包 | **候选 G（新增）**：语义与现在完全相同（首跑追踪、变更时重跑），只削包装成本，更新路径不变 |
| `rowFx` | 每行一个 effect，行内 40 格在一个 effect 里写 | 方案 B |
| `staticDep` | 对 `(vals, index)` 直接用最小订阅，不经 effect | 方案 C；若 3.5 的公开 API 做不到（需 `Dep` 内部），记为「不可行」 |
| `versionFx` | 列表级一个 effect + 版本戳对比 | 方案 D |

选型规则（写进结论）：

1. 更新三档（改 1 / 200 / 2000 格）必须在原型里同口径测出；改 1 格 > 0.5 ms 的直接淘汰（B、D 预期在此被排除，仍要量出数字，免得凭推断拍板）。
2. 剩下的按「挂载省多少 ms」排序；省 < 5 ms 的不值得改生产代码。
3. 全部淘汰则以「不可行」结案，只写文档。

**被否掉的备选**

- **A 原样（首跑不追踪）**：不知依赖，首次变更前的写入全部漏掉——宪法 V 的静默失效，且无法靠测试穷举。只保留 `evalOnly` 作地板数字。
- **E 改 reactivity 引擎 / 打补丁**：spec 已排除（版本升级即失效、维护成本、AGENTS 约束不新增依赖）。
- **直接在 `repeatTemplateLive` 上改了再测**：先量再改；改了才发现不行要回滚一个已被 specs/161、162 调过的热路径。

## 4. 风险

- **原型与真实路径不同口径**：micro 里的格子用 `NO_SCHED` 且不走 `enqueue`，会低估真实 `renderEffect`。所以专门加了 `fxReal`，并在最后用 `pnpm run vapor` 的整体挂载数交叉核对（FlatLiveVapor 28.7）。
- **测量噪声**：离线中位数波动约 ±0.5 ms，结论里的「≥ 5 ms」门槛已留余量；每项跑 3 轮取中位。
- **GC 落进某一层**：`docs/performance.md` 记过 GC 停顿会让某层读数偏高；原型之间交错顺序跑两遍。
- **TEMP 代码残留**：原型全在 bench 的 `proto.ts`，不进 runtime 包，无残留风险。

## 5. 验证路径

```bash
cd examples/bench
pnpm run vapor            # 看 [micro] 新增分层 + FlatLiveVapor 挂载 / 更新三档
pnpm run vapor            # 再跑一遍取中位
cd ../.. && pnpm --filter @ufjs/runtime run typecheck
pnpm test                 # __vaporMicro 改动不应影响任何用例
```

阶段 2（仅当有可行方案）：另补 `pnpm --filter hello-fjs run build:pages`、
`fjs dev --web` 的 flat-4050 页手测，以及 iOS 真机 profile 复测
（`fjs run ios -- --profile` + `fjs eval`，口径同 `docs/performance.md`）。
