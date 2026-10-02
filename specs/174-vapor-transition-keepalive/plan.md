# Plan: 174-vapor-transition-keepalive

## 1. 分支切换统一（host.ts）

`createIf` / `createKeyedFragment` 现在各写一遍「锚点 + teardown + 新分支」。抽成一个
`createSwitch`：每次切换 = 旧分支退场 + 新分支进场，两头各留一个挂点：

- `state.transition`：`{ mode, enter(nodes, done), leave(nodes, done) }`——有它时旧分支
  先 dispose（与 Vue 一致：组件立即卸载），节点等 leave 结束才移除；`out-in` 等 leave 完
  再渲染新分支（期间又切换则只记最新的一次）；`in-out` 新分支 enter 完再 leave 旧的。
- `state.keepAlive`：`{ wants, deactivate, store, take, activate }`——旧分支被它要走时
  不 dispose、节点挪进存储容器；新分支先问它要缓存。

两个挂点都由外层组件在 slot 渲染完之后**事后**挂上（compiler-vapor 不给任何标记）：
`switchOf(block)` 用 frag 的 `nodes` 数组作 WeakMap 键——`blockOf` 拷贝 Block 时共享同一个
数组，所以穿过 createSlot 仍找得到。

顺带修：切换时父节点用 `be().parentNode(anchor)` 兜底——作为组件 / slot 根的 v-if
创建时没有插入点，原来后续切换的分支根本不插进树。

分支渲染期间记录「直属于外层组件」的子实例（`setBranchOwnerResolver` 由 runtime 注入），
供 KeepAlive 按名字匹配、触发 activated 钩子。

## 2. 动态组件（runtime.ts）

`createDynamicComponent` 改成在 `createKeyedFragment` 上：键是解析出的组件，变了才重建。

## 3. Transition

- `vapor/transition.ts`（新）：平台无关的类名时序（Vue 的 resolveTransitionProps 语义），
  每个元素一份状态（取消正在进行的另一半），经 `be().transition` 原语落地。
- `VaporBackend.transition?`：`addClass` / `removeClass` / `nextFrame` / `whenEnds` / `isElement`。
  - Flutter：vue-shim 里的类名/计时函数挪到 `vue/transition-timing.ts`，两边共用。
  - Web：`classList` + 登记 `trackTransitionClass`（web-dom 的 class 写入合并保留），
    `transitionend` / `animationend` + `getComputedStyle` 时长兜底。
- `VaporTransition`：渲染 slot → 有 switch 就挂 transition；否则把元素登记给 v-show
  （`applyVShow` 切换时查表）；`appear` 在 onMounted 跑一次 enter。

## 4. KeepAlive

`VaporKeepAlive`（runtime.ts）：LRU Map、存储容器（`be().createElement('view')`，不挂树）、
include/exclude/max；`instance.ts` 的 `onActivated` / `onDeactivated` 改成真注册
（实例加 `children` 集合，激活时按子树触发，子先父后）；卸载时把缓存全部销毁。

## 5. 体积

`VaporTransition` / `VaporKeepAlive` 定义加 `/* @__PURE__ */`，没用到的包摇掉。

## 6. 验证

单测（web happy-dom + Flutter 样式引擎）；vapor-app 新增 `/motion` 演示页；浏览器 + iOS 目测；
vapor-app check。
