# Spec: Flutter VDOM 的 TransitionGroup

- **ID**: 179-flutter-vdom-transition-group
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

Flutter 上 VDOM 组件里的 `<TransitionGroup>` 是透传（`vue/vue-shim.ts`）：列表增删、重排都没有动画，
也没有告警。web 的 VDOM（runtime-dom）和两端的 vapor（specs/176）都有。Flutter 端用不了 runtime-dom
的实现——它靠 DOM 的 `classList` 与 `transitionend`，这边都没有；单个 `<Transition>` 早已由 vue-shim
补上（类名进样式引擎、按计算时长判结束），只差 Group。

## 2. 不做什么（Non-goals）

- web、vapor 不动。
- 不改样式引擎 / Dart 端：只用现有的类名、内联样式与同步布局读取。

## 3. 用户可见的行为

Flutter 上 VDOM 组件里：

```vue
<TransitionGroup name="list" tag="view">
  <view v-for="item in items" :key="item.id">{{ item.text }}</view>
</TransitionGroup>
```

- 新条目按 `<Transition>` 的类名时序进场；删除的条目播完 leave 再移除（与单个 Transition 相同的钩子）。
- 位置变了的条目做 FLIP：先用内联 `transform` 放回原处（`transition-duration: 0s`），下一帧加 `*-move`（或
  `move-class`）并撤掉 transform，由 CSS 过渡滑到新位置，结束后摘掉 move 类。
- `tag` 渲染容器元素；props 同 `<Transition>`（`mode` 除外）。子节点必须有 key（缺失时告警，与 Vue 相同）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | vue-shim 的 TransitionGroup（本 spec） | runtime-dom（不变） |
| 读位置 | `ui/geometry` 的 `boundingRectOf`（同步，先刷新再布局） | `getBoundingClientRect` |
| 结束判定 | 计算样式里的时长（与 Transition 同） | `transitionend` |
| 已知差异 | 无新增 | — |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测：VDOM 组件在 Flutter 渲染器上用 TransitionGroup，新条目拿到
   enter 类、删除条目 leave 结束后才移除、`tag` 容器、move 类在位置变化时出现（位置读取打桩）。
2. iOS 模拟器：vapor-app 以 `enableVapor: false` 运行，动画页的 TransitionGroup 添加 / 打乱 / 删除有动画
   （与 `true` 一致）。

## 7. 待澄清

无。
