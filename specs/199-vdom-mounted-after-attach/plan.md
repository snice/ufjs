# Plan: VDOM mounted 推迟到接入页面之后

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter：`vapor/backend-flutter-interop.ts`；Web：`vapor/web-interop.ts`；共用 `vapor/vdom-context.ts` 里的 hold 逻辑；两端各一条用例（已写） |
| II | 否 | — |
| III | 否 | 全同步，无新异步 |
| V 静默失效是 bug | 是 | hold 不放行 = mounted 永不触发，是静默失效。兜底：父节点已连接时不 hold；其余情况放行点有二——Vapor mounted flush，和一个微任务兜底 |
| VI 注释记录权衡 | 是 | hold 的实现里写明为什么用 Suspense 形状的对象、为什么不触发 activated |
| VII | 否 | — |
| VIII | 是 | `docs/vapor-contract.md` 补一句 VDOM 互操作的 mounted 时机 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/vapor/vdom-context.ts` | `VdomMountContext` 加 `afterMount?(cb)`；新增 `createMountHold()`：Suspense 形状的对象（`pendingBranch` 非空、`effects` 数组），`release()` 清 `pendingBranch` 并把攒下的 effects 交给 Vue 的 post flush |
| JS runtime | `packages/fjs-runtime/src/vapor/runtime.ts`（`createComponent` 里调 `interop` 处，约 690 行） | 提供 `ctx.afterMount`：往 `pendingMounted` 塞一个只带 `m` 钩子的伪实例，Vapor 的 mounted flush 时顺带放行；父节点已连接时不提供（不 hold） |
| Flutter 互操作 | `packages/fjs-runtime/src/vapor/backend-flutter-interop.ts` | 首次渲染改走 patch（3.5 的 `createRenderer` 不返回 `internals`，经 KeepAlive 的 `ctx.renderer` 探针取 `p`，`probePatch`）`(null, vnode, container, null, null, hold)`；hold 放行后调 `render(vnode, container)`（同 vnode，patch 为空操作）让 Vue 冲刷 post 队列 |
| Web 互操作 | `packages/fjs-runtime/src/vapor/web-interop.ts` | `render` 换成 `createRenderer({ ...nodeOps, patchProp })` 的 `render`，patch 同样经 `probePatch` 取，其余同上 |
| 测试 | `test/vapor-own.test.ts`、`test/vapor-interop-web.test.ts`（已加失败用例）+ 新增边界用例 | 见 spec §6 |
| 文档 | `docs/vapor-contract.md` | mounted 时机一句话 |

## 3. 方案

`queuePostRenderEffect` 在 runtime-core 里是 `queueEffectWithSuspense(fn, instance.suspense)`：
`suspense.pendingBranch` 非空时 fn 进 `suspense.effects`，否则进全局 post 队列。mounted 钩子、
模板 ref、post watcher、vnode 钩子、Transition 的 enter 都走它。首次挂载时把一个带
`pendingBranch` 的对象当 `parentSuspense` 传给 patch，整棵子树（`instance.suspense` 向下继承）的
post 回调都落进 `effects`；`release()` 时清掉 `pendingBranch`（之后更新产生的回调回到全局队列，
不会被永久攒住），再把 `effects` 交给 `queuePostFlushCb`，并用一次 no-op `render` 触发同步冲刷。

**被否掉的备选**
- **放行时补一次 `activated`**：vant 的 TextEllipsis 恰好靠它兜底，但普通挂载下 `activated` 不该触发，
  用户写的 `onActivated(fetch)` 会多跑一次。
- **把 VDOM 的首次 render 推迟到 Vapor mounted flush**：block 创建时没有 nodes，
  fallthrough 属性、scope id、兄弟锚点都拿不到节点。
- **让 `isConnected` 在构建期报 true**：量布局的代码会读到未排版的尺寸。
- **用真 Suspense + 异步依赖**：内容在 hiddenContainer 里直到 resolve，互操作需要同步拿到根节点。
- **在 demo 的 dom-env 里改 TextEllipsis**：绕过，框架时机仍不对，且其他依赖 mounted 的组件照样中招。

## 4. 风险

- Suspense 形状的对象要满足 runtime-core 的用法：`pendingBranch`、`effects`、`isInFallback`、
  `isUnmounted`、`deps`；只在异步依赖路径才碰 `registerDep`——互操作的 VDOM 组件若有 async setup
  会走这条，用例里覆盖「async setup 不抛错」。
- `release()` 之前被卸载：`effects` 里的回调作废（`unmounted` 后不应再跑 mounted），release 对已卸载的
  hold 直接丢弃。
- 微任务兜底会让「根本没有 Vapor flush」的路径也放行；那时 `isConnected` 仍可能为 false，
  与现状同，不比现在更坏。

## 5. 验证路径

```bash
cd packages/fjs-runtime
pnpm exec vitest run test/vapor-own.test.ts test/vapor-interop-web.test.ts
pnpm run typecheck && pnpm test
# iOS 模拟器：demo → Vant → vant: more 拉到底，点展开 / 收起
```
