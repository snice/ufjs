# Vapor host contract：框架中立核心与绑定接缝

> specs/163。`src/vapor/host.ts` 是 contract 本体；`src/vapor/runtime.ts` 是 Vue 绑定。
> 本文是接缝的接口文档——接第二个框架时读这一篇就够。

## 三层结构

```
框架编译产物（compiler-vapor / 未来的 solid-babel 等）
        │  发 contract 调用：template / child / txt / setText / createFor / renderEffect …
        ▼
host contract（src/vapor/host.ts，框架中立）
        │  HostReactivity 接缝（effect/scope/box 由绑定注入）
        │  VaporBackend 接缝（instantiate / cloneList / attach… 由渲染端实现）
        ▼
element API + op 协议（src/ui/*，specs/161 之前就有）
        ▼
libfjs（C++）+ libfjs-style → Dart mirror tree → Flutter widgets
```

- **element API 层**不知道任何框架（宪法规则：框架假设不得写进 element API 与 op 协议）。
- **host contract 层**不知道任何框架的组件模型；它唯一的外部依赖是字符串工具
  （`@vue/shared` 的 `normalizeClass`/`camelize` 等，纯函数——绑定方也可以在上游归一化，
  不经过这层）。
- **绑定层**（今天的 `runtime.ts`）做两件事：注入一个 `HostReactivity` 实现；提供该框架的
  组件模型（Vue 的 createComponent/props/slots）。

## contract 函数面

模板：`template(html, flags?, ns?) → CompiledTemplate`（`.def` 供批量克隆、`.html` 供 web
cloneNode）；walker `child / nthChild / next / txt`；writer
`setText / setClass / setClassName / setStyle / setAttr(=setProp) / show / on / off / once /
delegateEvents`。

结构与控制流：`setInsertionState`（编译器在 createIf/createFor/createComponent 前设置落点）、
`createIf / createFor / repeatTemplate / repeatTemplateLive / createForSlots`、
`renderEffect`、块记账 `blockOf / insertBlock / removeBlock / disposeBlock / blockRoot`。

VDOM 组件的 mounted 时机（specs/199）：Vapor 树里的 VDOM 组件经 `mountVdomComponent` 渲染进游离容器，
首次挂载的 post 回调（`onMounted`、模板 ref、post watcher）由 Suspense 形状的 hold 攒住，等 Vapor 的
mounted flush（节点已接进页面）再放行，与 VDOM 父组件下「整棵树挂好之后才 mounted」一致；后端经
`ctx.afterMount` 注册放行点（父节点已在页面里时不提供，即不 hold）。放行后更新产生的回调走正常队列。

批量执行（specs/162）：`repeatTemplate`（静态文本，texts 随 CLONE_MANY op）与
`repeatTemplateLive`（读 prop/ref 的格子，每格 effect），都走 `VaporBackend.cloneList`。

## HostReactivity：反应式接缝

```ts
export interface HostReactivity<S = unknown, R = unknown> {
  createScope(): S;                        // 新 scope：拥有其内创建的效果
  runInScope<T>(scope: S, fn: () => T): T; // 在 scope 下执行（效果归它）
  stopScope(scope: S): void;               // 停 scope 及其全部效果
  effect(fn: () => unknown, opts: { scheduler: () => void; onStop: () => void }): R;
  stopEffect(runner: R): void;
  box<T>(value: T): { value: T };          // 可写盒子：读追踪、写触发
  beforeStopScope?(scope: S): void;        // specs/167：scope 将停、宿主尚未移除（beforeUnmount 点）
}
```

语义约定（绑定必须遵守，核心依赖它们）：

1. **调度归核心**：`effect` 的 `scheduler` 是核心微任务队列的入队回调——引擎在依赖变化时
   只调它，绝不自行写宿主。`onStop` 在效果被停止时置活性行（队列 flush 前检查，防止写已删
   宿主）。Solid 这类自带批量的引擎可以忽略 scheduler 语义差异（首次运行仍是同步的，
   这一点是硬约定：挂载路径依赖首跑即写）。
2. **scope 所有权**：`runInScope` 期间创建的效果必须被该 scope 收集；`stopScope` 后这些
   效果永不重跑。核心用它做 v-if 分支销毁、v-for 逐项销毁与整表销毁。
3. **box 是最小追踪单元**：v-for 的 item/key 惰性盒子经它创建；效果读 `box.value` 必须建立
   依赖。
4. **去重与隔离归核心（specs/167）**：同一效果在一次 flush 前多次触发只入队一次（运行前清
   标记，运行中的新触发可再入队）；flush 中单个 job 抛错交给 `setVaporErrorReporter` 注入的
   上报函数，同批其余 job 照跑。
5. **`beforeStopScope` 可选**：核心在移除宿主**之前**对将停的 scope 调它（removeBlock、v-if
   切分支、disposeBlock），绑定据此跑 beforeUnmount。没有组件层的绑定（Solid 验证）不实现。
   `setVaporJobHook` 是每个 job 跑完后的回调——Vue 绑定用它触发「更新中新建组件」的
   onMounted。

Vue 绑定（`runtime.ts`）的实现即 `@vue/reactivity`：
`createScope = () => new EffectScope()`、`runInScope = scope.run`、`effect = effect(fn, opts)`、
`box = shallowRef`；组件实例、生命周期与 provide/inject 在 `vapor/instance.ts`（无 host /
渲染器依赖，vue-shim 与 `vapor/vue-pure.ts` 也导出它的双模函数）。Solid 绑定的参考实现见 `test/vapor-solid-host.test.ts`
（`createRoot` + `runWithOwner` + `createSignal`）。

## VaporBackend：渲染接缝

由渲染端实现（Flutter：`vapor/index.ts` + `backend-flutter.ts`；web：`vapor/web.ts`），
与框架无关，见 `VaporBackend` 接口注释（`host.ts`）。静态形状列表的批量克隆
（`cloneList`，specs/162）两端各有等价实现。

**render-host（specs/171）**：纯 vapor 入口里，`createComponent` 遇到非 vapor 组件且后端没有
VDOM 互操作时，交给 `vapor/render-host.ts`：组件包成 vapor 组件（props / attrs / 生命周期 /
provide-inject 走 vapor 组件层），render 函数在 renderEffect 里重算、vnode 树与上次比对后增量写宿主
（元素 / 文本 / Fragment / 组件 / Teleport / keyed 子节点）。vapor 父组件的插槽 Block 以「宿主节点
vnode」交给 render 函数（`__fjsTag` 标出原标签），按调用序号缓存、插槽参数原地更新。它由
`fjs/tag/<tag>` 注册模块引入，入口本身不加载。

另外两条 specs/171 的组件层规则：vapor 模板的**静态属性**在 Flutter 端随克隆补写（此前只带
class）；父组件的 scoped `__scopeId` 落到子组件唯一的根元素上（Vue 的规则）。

specs/170 起的可选成员（缺了由 `vapor/helpers.ts` 降级或告警，绝不 ReferenceError）：
`setValue`（`:value`）、`setDOMProp`、`setHtml`（v-html；Flutter 无）、`classOf`（透传 class 合并时读模板静态
class）、`textModel`（文本 v-model 的事件名与取值）、`applyChoiceModel`（checkbox / radio / select；仅 DOM）、
`createElement`（`<component :is="tag">`）。事件注册经 host 层的 `addListener` 多路分发：每个
(宿主, 事件键) 只向后端 `on` 一次，后端可以只支持单 handler。

## 接第二个框架的步骤

1. **绑定反应式**：实现 `HostReactivity`（≤40 行，参照 Solid 测试），模块 init 时
   `setHostReactivity(impl)`。
2. **组件模型**：按该框架的组件语义实现组件层（Vue 的在 runtime.ts；Solid 对应
   createComponent/props 的自有实现），消费 contract 的块与 insertion state。
3. **编译器**：让该框架的编译器发 contract 调用（Vue 由 compiler-vapor 产出 + CLI 的
   `vue → fjs/vapor` 改写 + `once-inline` 静态收编；其它框架各自等价物）。
4. **两端同源**：宿主能力（标签/样式/事件）仍按宪法在 Flutter 与 web 两侧同时落地。

纪律：contract 与 element API 两层不得出现框架名；绑定层不得绕过 backend seam 直接摸
op 编码。

## 分支切换：Transition / KeepAlive 的挂点（specs/174）

`createIf`、`createKeyedFragment`（`:key` 与 `<component :is>`）共用 host.ts 的 `createSwitch`：
每次切换 = 旧分支退场 + 新分支进场。compiler-vapor 不给 `<Transition>` / `<KeepAlive>` 任何标记，
外层组件在 slot 渲染完之后用 `switchOf(block)` 找到 switch（以 frag 的 `nodes` 数组为键，`blockOf`
的拷贝共享它），事后挂上 `transition` / `keepAlive`：

- `transition`：旧分支先 dispose（与 Vue 一致），节点等 leave 结束再移除；`out-in` 等 leave 完才渲染
  新分支；`in-out` 新分支 enter 完再 leave 旧的。类名时序在 `vapor/transition.ts`，平台落地走
  `VaporBackend.transition`（`addClass` / `removeClass` / `nextFrame` / `whenEnds` / `isElement`）。
- `keepAlive`：被要走的分支不 dispose，节点 attach 进存储容器；新分支先问缓存要。分支里直属外层组件的
  子实例记在 `branch.insts`（`setBranchOwnerResolver` 由组件层注入），供按名字匹配和触发 activated。

作为组件 / slot 根的分支，切换时父节点用 `be().parentNode(anchor)` 兜底。

## 根节点位置的 v-for 与 Teleport（specs/175）

- 作为 slot / 组件根的 `v-for`（`createFor` 没有插入点）：`nodes` 列出全部条目再加锚点，后续运行用
  `be().parentNode(anchor)` 找父节点。此前这种列表的条目根本不进树（纯 vapor 下 swiper 的
  `v-for` 页面因此为空）。
- `VaporTeleport`：slot 照常渲染，节点再 attach 到 `be().querySelector(to)`（`VaporBackend` 可选成员）
  或传入的元素；`disabled` 时放回占位锚点之前。传送出去的节点不在任何祖先的子树里，所以随组件
  作用域销毁时移除（`onScopeDispose`），而不是靠祖先移除。

## 列表转场：TransitionGroup 的挂点（specs/176）

`createFor` 用 `listOf(block)`（同样以 `nodes` 数组为键）暴露一个 `transition` 挂点，由
`VaporTransitionGroup` 在 slot 渲染完后挂上：非首轮更新前 `beforeUpdate`（记录现存条目位置），
重排后 `afterUpdate`（只给保留下来的条目做 FLIP），新条目 `enter`；删除的条目先 dispose，
`leave` 结束再移除节点。离场中的节点在根位置列表里仍列进 `nodes`，整体移除时一并清掉。
位置读取走 `TransitionBackend.rectOf`（web `getBoundingClientRect`，Flutter `boundingRectOf`）。

## 活节点列表：多根块（specs/181）

`blockOf([...])` 的各部分里有多节点块（组件、v-if / v-for 片段、render-host 块）时，返回的块的
`nodes` 是各部分节点拼起来的**活列表**：片段原地改自己的 `nodes`（切分支、增删项、render-host 重渲染）
后调 `nodesChanged(nodes)`，派生它的块跟着重拼并继续向上通知。v-if 分支的 `nodes` 直接共享内容块的
数组（不再拷贝），所以「分支内容本身是片段」也能跟上。只有一项的数组就是那一项（共享 `nodes`，
`switchOf` / `listOf` 仍能按数组找到片段）。各部分的 scope 不并入（与之前一样归各自的所有者）。

插槽 `<slot>` 按模板的所有者取插槽：插槽内容里是插槽作者，组件自己的模板里是该组件——不是「正在渲染
的组件」（specs/181：写在组件型标签里的 `<slot/>` 曾取到那个标签自己的插槽、无限递归）。

## VDOM 互操作：enableVapor 按需带 interop（specs/182）

`VaporBackend.mountVdomComponent(comp, props, slots, parent, anchor, ctx)` 是可选成员：纯 vapor 面
（`web-pure.ts` / `flutter-pure.ts`）没有它，三方 VDOM 组件库在场时 CLI 改用带它的面（`web.ts` /
`index.ts`）。`ctx` 由组件层传入：

- `provides` / `appContext`：vapor 父组件的 provides 与 app 上下文。后端据此给 VDOM 根 vnode 设
  `appContext`（`vapor/vdom-context.ts`），runtime-core 的 inject 从这里取值，`components` /
  `directives` 是 app 的注册。
- `onKeepAlive(run)`：后端把「对整棵 VDOM 子树跑 activated / deactivated 钩子」的函数交回组件层，
  组件层挂到 vapor 父实例的 `a` / `da` 上——KeepAlive 和 web 壳的页面缓存都经它走到 VDOM 组件。

插槽桥接：vapor 插槽给 VDOM 组件时，每次调用渲染一个 `fjs-vapor-slot` 占位元素（`display: contents`，
两端都不生成盒），挂载后把插槽块的节点放进去。桥接用的 effect scope 记下调用插槽的 VDOM 组件实例
（`markVdomOwner`），插槽内容里再挂的 VDOM 组件以它为父取 provides——`<van-grid><van-grid-item>`
写在 vapor 模板里仍是父子。插槽在没有 vapor 当前实例时运行（由 VDOM 组件调用），内容归插槽作者，
其中的 vapor 组件挂在作者的实例树上。

块形状：VDOM 子树的顶层宿主沿组件 `subTree` 一路下钻取（组件套组件、根是 Fragment / Teleport 时取
起止锚点之间的全部节点），重渲染后变化经 `nodesChanged` 通知包含它的块（specs/181 的活节点列表）。

