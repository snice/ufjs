# Spec: Vapor 绑定 effect 懒创建（先可行性验证）

- **ID**: 197-lazy-binding-effect
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

Vapor 挂载没有比 VDOM 快（specs/161、`docs/performance.md`「4050 元素同屏」）。
离线 flat-4050（`examples/bench`，`pnpm run vapor`，中位数 ms）：

| | 挂载 |
|---|---:|
| 元素 API 底线（无框架） | 6.9 |
| VDOM | 19.0 |
| Vapor 静态格子（`repeatTemplate`，不建 effect） | **10.8** |
| Vapor 读响应式数据的格子（`repeatTemplateLive`，真实页面形状） | 28.7 |

差额来自每个绑定一个 `renderEffect` + scope：`__vaporMicro` 的分层是
host 12 → +text 15 → +effect 19 → +scope 23（2000 格，约 4 µs/格）；
`fxEmpty` 3.0（建 effect 不订阅）→ `fxTrack` 7.0（订阅 1 个依赖），即**订阅本身
约占一半**。真机（iPhone 12，profile）Vapor 挂载中位 ~87–92 ms，与 VDOM 持平。

想法：挂载时只写初值、不建 effect（不订阅），等到依赖真的变了再建。

**核心难点（spec 必须先回答）**：依赖在第一次执行表达式之前是未知的。
不订阅就跑一遍，就不知道该监听谁；之后谁变了也没人通知——
「懒」不能是「首跑不追踪」，否则漏更新。所以本 spec 的第一阶段是**量化 +
选型**，不是直接实现。

## 2. 不做什么（Non-goals）

- 不改 VDOM 路径，不改 op 协议，不改 Dart 侧。
- 不牺牲更新路径：改 1 格 0.0 / 200 格 1.7 / 2000 格 17 ms（离线）不得回退。
- 不 fork / patch `@vue/reactivity`（若选型 E 需要，另开 spec 评估后再说）。
- 不新增依赖。

## 3. 用户可见的行为

页面源码不变。`flat-4050` 页（`GridVapor`，格子读 `vals` prop）的 Vapor 挂载变快，
改 1 格 / 200 格 / 2000 格的更新语义与读数不变。`vals[k] = x`、`vals.splice`、
整个替换 `vals` 都必须照常更新对应格子。

## 4. 候选方案

| | 做法 | 能省 | 风险 |
|---|---|---|---|
| A 懒订阅 | 首跑不追踪，变更时再建 effect | 订阅 + effect 全省 | **不可行（原样）**：不知道依赖，漏更新。除非能证明只依赖一个已知源 |
| A' 首跑追踪、延迟建 scope / 拆 effect 对象 | 订阅照做，只省 scope 与每格闭包 | scope ~4 ms | 订阅（大头）还在 |
| B 每行一个 effect + 按依赖分发 | 50 个 effect 代替 2000 个，行内格子在 effect 里自己 diff | 估 13–16 ms | 改 1 格要重算整行表达式（更新换挂载） |
| C 编译期静态依赖 | 表达式形如 `src[expr]`，编译器识别「读源 + 下标」，运行时直接对 `(target, key)` 挂最小订阅 | 订阅 + effect | 只覆盖该形状；`vals` 是 prop 时 target 是 reactive 代理，需确认能不经 effect 订阅 |
| D 版本戳 | 源数组带版本，列表级一个 effect 订阅「任何变更」，变更时对比各格值 | 挂载接近静态 | 2000 格的更新退化为全表对比，更新回退 |
| E 引擎级惰性链接 | 首跑记录读到的 Dep、延迟建 Link，Dep 被写时先补链 | 订阅 | 要改 reactivity 引擎，超出 Non-goals |

**推广边界（用户提问）**：class / style / attr / prop 绑定与文本绑定是同一个问题——
「首跑不知依赖」对它们完全一样，所以：

- A / A' / B / D 是形状无关的，理论上可推广到全部绑定，但收益取决于「绑定数量 ×
  每个绑定的订阅成本」，只有**大量重复、同构**的绑定（v-for 里的格子）才值得；
- C 只对「读源 + 下标 / 属性」这类可静态识别的表达式成立，推广到 `:class="{ a: x.y }"`
  之类要看表达式形状白名单；
- 单个、非循环的绑定不值得（一次性成本本来就小）。

## 5. 契约变更（宪法 II）

- [x] 都不涉及（纯 JS 运行时内部；Vapor 宿主层 web / Flutter 共用一套，宪法 I 自动满足，
  但验收仍要在两端各跑一次）

## 6. 验收标准

阶段 1（量化，产出数字再选型，不改生产代码）：

1. 在 `examples/bench/vapor/main.ts` 的 `__vaporMicro` 里加分层：
   「只跑表达式不订阅」「订阅但不建 scope」「A' / B / C / D 各自的原型」，
   `pnpm --filter bench run vapor` 输出各项 ms（2000 格）。
2. 在 spec 末尾「结论」一节写明：每种候选的挂载 ms、改 1 / 200 / 2000 格 ms，
   并给出选型与不选的理由。**若没有任一方案在挂载上省 ≥ 5 ms 且更新不回退，
   本 spec 以「不可行」结案**，只更新 `docs/performance.md`。

阶段 2（仅当阶段 1 有可行方案）：

3. `pnpm run vapor`：FlatLiveVapor 挂载 ≤ 22 ms（现 28.7），更新三档不回退（±10%）。
4. `pnpm test` 与 `pnpm run typecheck` 通过；新增用例覆盖 `vals[k]=x`、`splice`、
   整体替换、依赖在首次变更前被销毁（unmount 后不再触发）。
5. `pnpm --filter hello-fjs run build:pages` 通过，`fjs dev --web` 的 flat-4050 页切
   Vapor 后改 1 / 200 / 2000 格显示正确；iOS 真机（profile）Vapor 挂载中位相对 ~87–92 ms
   有可见下降，写进 `docs/performance.md`。
6. 推广范围（若做）：class / style / attr 绑定各有一条对照用例，行为与非懒版一致。

## 7. 待澄清（已定）

- [x] 本轮只做阶段 1（量化选型），出数后再决定要不要实现。
- [x] 方案 E（改 reactivity 引擎）排除。（未单独答复，按建议默认）
- [x] 更新不回退：改 1 格 ≤ 0.5 ms，B / D 因此被排除。（同上，按建议默认）
- [x] 推广到非文本绑定：文本跑通后另开。（同上，按建议默认）

## 8. 结论（阶段 1，2026-10-03）

`examples/bench` `pnpm run proto`（`vapor/proto.ts`，fjsrun / PrimJS，Mac，中位数 ms，
两次独立运行读数相差 ≤ 0.6）。同一棵 50×40 树、同一个元素 API，格子文本读自己的
`vals[k]`；能更新的方案每档更新后都逐格校验显示值。

| | 挂载 | 改 1 格 | 改 200 格 | 改 2000 格 | 正确 |
|---|---:|---:|---:|---:|---|
| host（无文本，地板） | 7.0 | — | — | — | — |
| eval（写一次、不订阅） | 10.1 | — | — | — | **漏更新，不可行** |
| fxBare（effect、空调度器） | 17.5 | — | — | — | 无法更新 |
| fxReal（照 `renderEffect` 形状复刻） | 22.2 | 0.0 | 1.4 | 13.6 | ✓ |
| **fxLite（G：`ReactiveEffect` + 共享调度器）** | **16.9** | 0.0 | 1.4 | 13.3 | ✓ |
| rowFx（B：每行一个 effect） | 14.8 | 0.1 | **5.0** | 12.2 | ✓ |
| listFx（D：整表一个 effect） | 14.6 | **4.3** | 5.1 | 12.4 | ✓ |

读数的含义：

- **订阅本身有一条下限**：listFx 只有 1 个 effect，仍比 eval 慢 4.5 ms（2000 条依赖链接）。
  任何「还会更新」的方案挂载都不可能低于 ~14.6；只有真的不订阅（eval 10.1）才更低，
  而那一档会漏更新。
- **A（懒订阅）不可行**：eval 之所以快，正是因为没有订阅；要补订阅就得再跑一遍表达式，
  等于没省。
- **C（编译期静态依赖）不可行**：`@vue/reactivity` 3.5 的 `track` 需要 `activeSub`，
  没有「无 sub 订阅」的公开 API；有 sub 就是 fxLite 的成本，且依赖链接下限同上，
  不会比 rowFx 更好。
- **fxReal → fxLite 省 5.3 ms**（22.2 → 16.9），语义与更新路径完全不变（0.0 / 1.4 / 13.3）。
  省的是我们自己的包装：每个 effect 的 job / opts / pending / alive / onStop 闭包与对象。
- **B 省 7.4 ms，改 1 格 0.1 ms 也达标**，但改 200 格（每行都被碰到）1.4 → 5.0，
  3.6 倍回退；是否可接受取决于业务里「稀疏更新」与「成片更新」哪个更常见。
- **D 淘汰**：改 1 格 4.3 ms，破 ≤ 0.5 ms 的约束。

### 选型

- **G 值得进阶段 2**：挂载 −5.3 ms（相对复刻的 renderEffect），更新零回退，
  语义不变，不碰引擎。达到「≥ 5 ms 且更新不回退」的门槛，但余量很小，
  且 fxReal 是复刻而非真实 `renderEffect`——阶段 2 第一步是在 `repeatTemplateLive`
  里实装后，用 `pnpm run vapor` 的 FlatLiveVapor 挂载（现 28.7）验证真实收益。
- **B 作为可选项记录，不做**：与「更新是 Vapor 的主场」冲突（200 格回退 3.6 倍）。
- 「懒创建」这个原始想法本身**不成立**；真正有效的是**让每个绑定的 effect 更轻**。
- 推广到 class / style / attr：G 是形状无关的（只换 effect 的实现），可以推广；
  但只有 v-for 里大量同构绑定才值得，单个绑定省不出可测的时间。另开 spec。
