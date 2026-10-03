# Spec: Vapor 里的 VDOM 组件，mounted 要在节点接进页面之后

- **ID**: 199-vdom-mounted-after-attach
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

demo 开 `enableVapor: true` 后，`pages/vant/more.vue` 的 `<van-text-ellipsis :rows="2">` 不再截断，
整段三行全显示、也没有「展开」按钮（iOS 模拟器复现；VDOM 模式正常）。

根因：Vapor 模板里的 VDOM 组件经互操作用 `render(vnode, 游离容器)` 挂载，`render` 结尾同步触发
`onMounted`；此时节点还没接进页面（`reposition()` 在后面，而 Vapor 父树本身自下而上构建，更晚才挂到
页面根），`isConnected` 为 false。vant 的 `TextEllipsis` 在 `onMounted` 里量文字，
`root.isConnected` 为 false 就置 `needRecalculate` 直接返回，只等 `onActivated` 重算——普通挂载不会
触发，文字就永远不截断。VDOM 父组件下 `onMounted` 在整棵树挂到页面之后才跑，所以没有这个问题。

已用两条失败用例确认两端都中招：
`vapor-own.test.ts`（Flutter 后端）与 `vapor-interop-web.test.ts`（web）里 VDOM 组件
`onMounted` 读到的 `root.isConnected` 都是 false。

## 2. 不做什么（Non-goals）

- 不改 vant、不改 `dom-env.ts`。
- 不触发假的 `activated`（会让只想在 KeepAlive 里跑的 `onActivated` 逻辑在普通挂载时多跑一次）。
- 不改 VDOM 组件之后的更新路径（props 变化重渲染照旧）。
- 不改 Vapor 自己组件的 mounted 时机。

## 3. 用户可见的行为

```vue
<!-- vapor 页面 -->
<van-text-ellipsis :content="long" :rows="2" expand-text="展开" collapse-text="收起" />
```

文字按两行截断，末尾带「展开」，与 VDOM 模式一致。任何依赖 `onMounted` 时 `isConnected` / 布局的
VDOM 组件都同样受益。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `backend-flutter-interop.ts`：首次挂载把 VDOM 子树的 post 回调（mounted、ref、post watcher）攒起来，Vapor 的 mounted flush 时放行 | `web-interop.ts` 同 |
| 事件载荷 | 无 | 无 |
| 已知差异 | 无 | web 端改用 `createRenderer({ ...nodeOps, patchProp })`（与 runtime-dom 的 `render` 同配置）；3.5 的 createRenderer 不返回 `internals`，patch 经 KeepAlive 的 `ctx.renderer` 探针取；行为与 runtime-dom 的 `render` 一致 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（`VdomMountContext` 加一个可选的 `afterMount`，是 JS 内部接口）

## 6. 验收标准

1. 上述两条失败用例通过（去掉修复必挂）。
2. 新增用例：父节点本来就已连接（v-if 之后切出）时 `onMounted` 立即执行，不被攒住；
   子树在 hold 期间被卸载不抛错；放行后重渲染产生的 `onUpdated` 照常触发。
3. `pnpm test`、`pnpm run typecheck` 通过。
4. iOS 模拟器 `demo`（`enableVapor: true`）→ vant: more 拉到底：TextEllipsis 两行截断、带「展开」，
   点「展开」展开全文、点「收起」收回。
5. `fjs dev --web` 同页同样（若本机可跑）。

## 7. 待澄清

无
