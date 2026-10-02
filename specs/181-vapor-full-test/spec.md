# Spec: vapor 全面回归测试（hello-fjs 开关对比 + demo 三方库）

- **ID**: 181-vapor-full-test
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

specs/161–180 把 vapor 运行时补齐（Transition / KeepAlive / Teleport / TransitionGroup / 无 vue-router 的 web
路由 / enableVapor 默认编译方式……），但验证一直在 `examples/vapor-app` 这个小样本上做。真实项目还没在
`enableVapor: true` 下完整跑过：

- `examples/hello-fjs`：74 个 SFC，覆盖全部内置标签、样式、动画、canvas / three / echarts / 游戏，
  是两端同源的组件画廊。需要在 `enableVapor: true` 和 `false` 下逐页对比，找出 vapor 下的差异与报错。
- `demo`：vant / nutui / pinia 等三方 VDOM 组件库。`enableVapor: true` 下这些库要经 render-host
  （specs/171）或 VDOM 互操作挂进 vapor 页面，需要验证它们能用。

测试中发现的问题在本 spec 内修复（每条记在下面「发现与修复」里），最后产出 vapor / vdom 对比总结。

## 2. 不做什么（Non-goals）

- 不做性能基准（bench 另有 specs）；总结里只引用已有数据。
- 不改示例的业务逻辑；测试用的 `enableVapor` 开关改动不进提交（示例默认值保持现状）。
- 小程序端不在本轮范围。

## 3. 测试方法

1. **web 对比**：hello-fjs 起 vite dev，`enableVapor` 分别为 false / true，脚本遍历每个路由，记录：
   控制台报错、页面文本、元素数、关键交互（点击 / 输入）后的状态；两边逐页 diff。
2. **Flutter 对比**：iOS 模拟器 `fjs run ios`，两种模式各抽查画廊主要页面（基础组件、表单、容器、动画、
   交互、canvas），看日志里的 `[vue-error]` / 异常与画面。
3. **demo 三方库**：demo 加 `enableVapor: true`，web + iOS 遍历 vant / nutui / pinia 页面。

## 4. 两端约定（宪法 I）

修复按问题各自落地，两端都要验；结论写进总结。

## 5. 契约变更（宪法 II）

- [x] 预计都不涉及（若某个修复涉及，在「发现与修复」里注明）

## 6. 验收标准

1. hello-fjs web：`enableVapor` true / false 每个路由都能打开、无新增控制台报错，逐页 diff 中的差异要么修掉、要么记为已知差异。
2. hello-fjs iOS：两种模式抽查页面无 `[vue-error]`，画面一致。
3. demo（vant / nutui / pinia）在 `enableVapor: true` 下 web 与 iOS 页面可用。
4. `pnpm run typecheck`、`pnpm test` 通过。
5. 产出 `specs/181-vapor-full-test/summary.md`：vapor vs vdom 对比总结（能力、差异、包体、已知限制、建议）。

## 7. 待澄清

- 无

## 8. 发现与修复

hello-fjs web，`enableVapor: true` 首轮：首页就白屏，其余 66 个路由里 27 个白屏（`expected a single-root block`），
多页内容缺失 / 错乱。逐条修复如下（单测在 `packages/fjs-runtime/test/vapor-real-app.test.ts`）：

| # | 现象 | 原因 | 修复 |
|---|------|------|------|
| 1 | dev 起不来：`fjs/data/icons.json` 解析失败 | 模块里的 SFC 编成 vapor 后 importer 是虚拟 id（`\0fjs-vapor-sfc:`），找不到所属模块 | `vite.ts` 解析 `fjs/data/` 前剥掉虚拟前缀 |
| 2 | dev 依赖预构建失败：`TransitionGroup` 不是 `vue` 的导出 | `@vueuse/core` 从 `vue` 导入 runtime-dom 才有的名字；enableVapor web 的 `vue` 是 runtime-core | `vapor/vue-pure.ts` 补 `Transition` / `TransitionGroup`（vapor 实现）与 `withKeys` / `withModifiers` |
| 3 | 首页栈溢出 | Shell 的 `<slot/>` 写在组件型标签（web 的 scroll-view）里，`<slot>` 按「正在渲染的组件」取插槽 → 取到 scroll-view 自己的插槽，无限递归 | `<slot>` 按模板作者（插槽作者，或当前实例）取插槽（`runtime.ts` 的 `slotsOf`） |
| 4 | 27 页白屏 `expected a single-root block` | 插槽 / 模板返回多个根、其中有多节点块（组件、v-if 片段、render-host 块）时 `blockOf` 直接抛错；多根模板里 v-if 为真也会中招 | `blockOf` 支持嵌套块：多段拼成一个「活」节点列表，片段原地变化（v-if 切换、列表增删、render-host 重渲染）通过 `nodesChanged` 通知上层；v-if 分支的 nodes 不再拷贝 |
| 5 | scroll-view / sticky / swiper 页 v-for 内容缺失 | 静态 v-for 走批量克隆 `repeatTemplate[Live]`，处在插槽根位置（无插入点）时格子没进 block | 根位置时格子列入 `nodes` |
| 6 | swiper 页按钮文字「第 轮播第 1 屏1 屏」、dnd 编号 +1 | `createFor` 把 `:key` 的值当成模板第二个别名传入：`v-for="(s, i) in list" :key="s"` 里 `i === s` | 第二别名是下标（对象源为属性名），第三别名是序号；源支持对象 / Map / Set / 字符串（Vue 语义） |
| 7 | three-gltf / spine 的「加载中」遮罩不消失 | canvas 把页面插槽交给内层 FjsView 的插槽懒调用；内层对 VDOM 形状结果开的临时 scope 停掉时把外层插槽缓存的 scope 一起停了，v-if 的 effect 死掉 | render-host 插槽缓存的 scope 挂在组件自己的 scope 下 |
| 8 | rich-text 字符串模式 103 个 span 全丢 | vapor web 里 `<text>` 是原生元素，rich-text 交给它的内部 prop `richSpans` 被当属性写掉（VDOM web 由 FjsText 组件渲染，Flutter 由 Dart 处理） | web vapor 后端的 `setAttr` 处理 `richSpans`，渲染成 span |
| 9 | `v-motion` 无效（对象式 VDOM 指令被忽略） | vapor 只支持函数式指令；`app.directive` 被丢弃，没有 `resolveDirective` | `app.directive` 注册进 vapor app context；`resolveDirective`；对象式指令经适配层跑 created / beforeMount / mounted / beforeUpdate / updated / beforeUnmount / unmounted，`vnode.props` 提供元素上绑定的值（`:initial` 等） |
| 10 | sticky 页「到 B 组」不滚动 | Vue 在任意 prop 变化时更新组件（触发 onUpdated）；render-host 只在 render 读过的 prop 变化时重渲染，FjsScrollView 在 onUpdated 里处理 scroll-into-view | render-host 的渲染依赖全部 props |
| 11 | rich-text 重渲染时 `[Vue warn] resolveComponent can only be used in render()` | render-host 重渲染时没有 vapor 当前实例，落到 runtime-core 的解析 | 两种实例都没有时走 vapor 的解析 |
| 12 | list-view 页报 canvas `arc` 负半径（来自上一页 canvas） | vapor web 壳把离开的页面留在 DOM 里 `display:none`（LRU 缓存，specs/166/178；VDOM 壳是 KeepAlive 摘出 DOM），canvas 量到 0×0 仍派 `@resize`；Flutter 上被盖住的页面尺寸不变 | web canvas 未渲染时不上报尺寸 |
| 13 | demo dart-objects 页 setup 抛错时整页（连导航栏）白屏；VDOM 下只是该组件为空 | 组件 setup 的异常一路抛到页面挂载的 effect | 非根组件 setup 抛错交给 errorHandler，该组件渲染为空块，父组件照常 |
| 14 | web 壳缓存的页面离开 / 回来不触发 onDeactivated / onActivated（VDOM 壳的 KeepAlive 会） | 壳只做 display:none | `createVaporApp` 提供 `deactivate` / `activate`，壳在切页时调用（interop 里的 VDOM 组件一起，见 specs/182） |

Flutter 端（iOS 模拟器，hello-fjs 66 个路由 `router.replace` 遍历 + 抽查截图）：两种模式均无报错；上面 #4–#8 是
两端共用的运行时代码，修复同时作用于 Flutter（swiper 受控页码、motion 弹簧小球已在 iOS 复核）。元素统计上 vapor 多出的
`view` 是 vapor 的锚点（Flutter 端为零尺寸 view），少掉的 `text` 是 vapor 把内联文本折叠进元素本身，画面无差异。

demo（vant / NutUI / pinia）在 `enableVapor: true` 下的测试需要 VDOM 互操作，按用户选择拆到 specs/182（按需带 interop）。

对比总结见 [summary.md](summary.md)。

