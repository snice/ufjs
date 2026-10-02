# Spec: vapor 下的 Transition 与 KeepAlive

- **ID**: 174-vapor-transition-keepalive
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

vapor 组件里 `<Transition>` / `<KeepAlive>` 现在是降级实现（specs/170）：内容照常渲染，
但 Transition 不播动画、KeepAlive 不缓存，各打一次告警。另外查出一个前置缺口：
`<component :is="cur">` 在 vapor 下**只在创建时求值一次**（`createDynamicComponent`），
`cur` 变了页面不变——KeepAlive 和 `mode="out-in"` 的典型用法都建立在它上面。

compiler-vapor 对这两个组件不做任何特殊编译：子块就是普通的 `createIf` /
`createDynamicComponent` / `applyVShow`，所以全部要在运行时实现。

## 2. 不做什么（Non-goals）

- `<TransitionGroup>`（列表 enter/leave/move 的 FLIP）：保持降级，另立 spec。
- Teleport、swiper 循环：下一个 spec（175）。
- VDOM 组件里的 Transition / KeepAlive：照旧走 runtime-core（Flutter 是 vue-shim 的
  Transition，web 是 runtime-dom），不动。
- KeepAlive 里的 `onActivated` / `onDeactivated` 之外的生命周期语义变化。

## 3. 用户可见的行为

```vue
<script setup vapor>
import { ref, onActivated, onDeactivated } from 'vue'
const ok = ref(true)
const cur = ref(TabA)
</script>
<template>
  <Transition name="fade"><view v-if="ok" class="box">x</view></Transition>
  <Transition name="fade"><view v-show="ok">y</view></Transition>
  <Transition name="slide" mode="out-in"><component :is="cur" /></Transition>
  <KeepAlive :max="3" include="TabA,TabB"><component :is="cur" /></KeepAlive>
</template>
<style>
.fade-enter-active, .fade-leave-active { transition: opacity .3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
```

- **动态组件**：`<component :is>` 跟着 `is` 切换（组件身份变了才重建）。
- **Transition**：v-if / v-else / 动态组件 / v-show 的切换按 Vue 的类名时序走：
  `*-enter-from` + `*-enter-active` → 下一帧换成 `*-enter-to` → 动画/过渡结束后摘掉；
  leave 同理，结束后才移除节点（v-show 是结束后才 `display: none`）。
  支持 `name`、`appear`、`mode`（`out-in` / `in-out` / 默认同时）、`duration`、
  `css: false`、各 `*-class` 自定义类名、JS 钩子 `onBeforeEnter` / `onEnter` /
  `onAfterEnter` / `onEnterCancelled` / `onBeforeLeave` / `onLeave` / `onAfterLeave` /
  `onLeaveCancelled`（带 `done` 参数的 `onEnter` / `onLeave` 由用户调用 done）。
  动画中途反向切换会取消正在进行的那一半（与 Vue 一致）。
- **KeepAlive**：切走的组件不销毁，节点挪进不挂在树上的容器、状态和 effect 保留；切回来
  原样插回，触发 `onActivated`，切走触发 `onDeactivated`（子组件里注册的也触发）。
  `include` / `exclude`（字符串、逗号分隔、正则、数组，按组件 `name` / `__name`）、
  `max`（LRU，超出的彻底销毁）。
- 告警：Transition / KeepAlive 不再告警；TransitionGroup 照旧告警。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 类名 | 写进样式引擎的 class 列表（与 vue-shim 的 Transition 同一套：`trackTransitionClass` 保证模板的 class 补丁不冲掉它们） | `classList`，同样登记，vapor 的 class 写入合并保留 |
| 结束判定 | 计算样式里 animation / transition 的时长 + 延迟（与 vue-shim 同一函数），无 DOM 事件 | `transitionend` / `animationend`，按 `getComputedStyle` 时长兜底超时（runtime-dom 的做法） |
| 下一帧 | 两次 rAF（无 rAF 时 16ms） | 两次 rAF |
| KeepAlive 存储 | 不挂树的 `view` 容器（insert 进去，不 remove——Flutter 的 remove 会销毁元素） | 游离的 `div` |
| 已知差异 | 无新增 | 无新增 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（`VaporBackend` 新增可选的 transition 原语，属 runtime 内部接口）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测：
   - 动态组件切换（两端）；
   - Transition：v-if / v-show / 动态组件的 enter / leave 类名时序、结束后才移除、
     out-in 顺序、中途反向取消、appear、JS 钩子与 done、`css: false`（web 用 happy-dom +
     假定时器；Flutter 用样式引擎的 `classesOf` 断言）；
   - KeepAlive：切回保留状态、activated/deactivated（含子组件）、include/exclude、max 淘汰。
2. `examples/vapor-app` 加一页演示（fade v-if、v-show、out-in 动态组件、KeepAlive 计数器
   切回不清零），web 浏览器与 iOS 模拟器上目测动画播放、切回状态保留，无报错。
3. `examples/vapor-app` 的 Flutter check（fjsrun）通过。

## 7. 待澄清

无（TransitionGroup 明确不在本 spec）。
