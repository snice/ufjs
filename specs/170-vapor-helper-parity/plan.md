# Plan: vapor 运行时补齐 compiler-vapor 的 helper 与组件层能力

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | helper 实现在共享的 `vapor/host.ts` / `vapor/helpers.ts` / `vapor/runtime.ts`；平台差异只经 VaporBackend 可选成员（Flutter `backend-flutter.ts`，web `web-dom.ts`） |
| II 边界即契约 | 否 | op / natives / 事件类型不动；VaporBackend 是 JS 内部 seam（`docs/vapor-contract.md` 同步） |
| III | 否 | — |
| IV | 否 | — |
| V 静默失效是 bug | 是（主题） | 守护单测对照 compiler-vapor helper 全集；做不到的 helper warnOnce 降级 |
| VI 注释记录权衡 | 是 | 监听多路分发（Flutter 单 handler/键）、class 分层、selector 不做 O(1) 切换、内置组件降级 |
| VII | 否 | 纯 JS |
| VIII 文档 | 是 | `docs/vue3.md`（vapor 支持矩阵）、`docs/vapor-contract.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 核心 | `vapor/host.ts` | VaporBackend 可选成员（setValue / setDOMProp / setHtml / classOf / textModel / applyChoiceModel / createElement）；监听多路分发 `addListener`；class 分层（own / fallthrough）；`showHost` / `setStyleHost`；`withOnce`；`createKeyedFragment` / `setBlockKey`；`createForSlots` 实现；列表块 `onReset`；锚点登记 `makeAnchor` / `isAnchorHost` |
| 中立 helper | `vapor/helpers.ts`（新） | setValue / setDOMProp / setElementText / setHtml / applyVShow / apply*Model / onBinding / setDynamicEvents / setDynamicProps / createInvoker / createSelector / insert / getDefaultValue / getRestElement / extend |
| Vue 绑定 | `vapor/runtime.ts`、`vapor/instance.ts` | props/attrs 拆分 + emits、attrs 透传、expose、作用域插槽参数、动态插槽 `$`、模板 ref 三件套、withVaporDirectives、createPlainElement + 原生标签动态组件、四个内置组件降级、useAttrs 双模 |
| 后端 | `vapor/backend-flutter.ts`、`vapor/web-dom.ts` | 上述可选成员；web 的 DOM choice model 与 withModifiers / withKeys |
| 入口 | `vapor/index.ts`、`flutter-pure.ts`、`web-dom.ts` 导出表、`vue/vue-shim.ts`、`vapor/vue-pure.ts` | 新 helper、withVaporModifiers / withVaporKeys、useAttrs |
| 编译 | `vapor/sfc-compiler.ts` | 空 `<script setup vapor>` 不再被重注 `vapor`（Duplicate attribute） |
| 测试 | `vapor-helper-parity(.web).test.ts`、`vapor-helpers-web.test.ts`、`vapor-helpers-flutter.test.ts` | spec §6 |

## 3. 方案要点与否掉的备选

- **监听多路分发**：Flutter 后端 `patchProp` 每个事件键只留一个 handler；放在 host 层统一分发
  而不是改 Flutter 后端，两端语义一样（registration 顺序叠加）。否：只在 Flutter 后端做——web 的
  addEventListener 天然叠加，但 v-on="obj" 重跑时会重复注册，host 层的稳定 invoker 两端都需要。
- **selector**：每个注册的操作是独立 renderEffect，正确但不做 O(1) 切换。否：照搬 runtime-vapor
  的 operMap——依赖 queuePostFlushCb（runtime-core 调度器），自研队列里另起一套不值得，列表项的
  class 切换在 bench 之外不是热点。
- **内置组件降级**：直接渲染默认插槽 + warnOnce。否：完整实现 Transition / KeepAlive——各自另立。
- **v-model（Flutter）**：只做 text（fjs input 的 textChanged + value 契约）；checkbox / radio /
  select 在 Flutter 没有对应原生元素，warnOnce。

## 4. 风险

- props/attrs 拆分改变了「未声明的键也进 props」的旧行为：仓库内收 props 的 vapor 组件都已
  `defineProps`（调研确认），页面不收 props。
- class 分层只在发生透传 / setClass 后接管该节点的 class 写入；模板静态 class 首次透传时从后端读一次。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime test
pnpm --filter fjs-bench run vapor
cd demo && vapor-check / nav-vapor（fjsrun）
cd examples/vapor-app && pnpm run check && pnpm run build:web（浏览器冒烟）
```
