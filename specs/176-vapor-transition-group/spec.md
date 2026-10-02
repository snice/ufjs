# Spec: vapor 下的 TransitionGroup

- **ID**: 176-vapor-transition-group
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

vapor 组件里 `<TransitionGroup>` 仍是降级实现（specs/170）：列表照常渲染，但增删不播
enter / leave、重排没有 move 动画，告警一次。这是 vapor 缺口清单（specs/170–175）里最后一项。

compiler-vapor 的产物是 `createComponent(VaporTransitionGroup, { name, tag }, () => createFor(...))`，
没有额外标记，同 specs/174 一样要在运行时接。

## 2. 不做什么（Non-goals）

- VDOM 下的 TransitionGroup 不动（Flutter 的 vue-shim 仍是纯透传，web 是 runtime-dom）。
- 非 `v-for` 子节点（静态的多个子元素）不做逐个动画：告警一次，原样渲染。

## 3. 用户可见的行为

```vue
<TransitionGroup name="list" tag="view" class="list">
  <view v-for="item in items" :key="item.id" class="row">{{ item.text }}</view>
</TransitionGroup>
<style>
.list-enter-active, .list-leave-active { transition: opacity .3s, transform .3s; }
.list-enter-from, .list-leave-to { opacity: 0; transform: translateX(30px); }
.list-move { transition: transform .3s; }
</style>
```

- **enter / leave**：新条目插入后按 Transition 的类名时序进场（`appear` 时首屏也进场）；
  删掉的条目先 dispose（组件立即卸载，与 Vue 一致），节点播完 leave 再移除。
- **move**（FLIP）：每次列表更新前记下现存条目的位置，更新后对位置变了的条目先用
  `transform` 放回原处，下一帧加 `*-move`（或 `move-class`）并撤掉 transform，由 CSS 过渡滑到新位置。
- `tag`：渲染一个该标签的容器元素包住条目（class 等 attrs 落在它上面）；不给 `tag` 则无容器。
- 其余 props 同 `<Transition>`（`name`、`duration`、`css`、各类名、JS 钩子），`mode` 不适用。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| enter / leave | 与 Transition 同（样式引擎类名 + 计算时长） | 与 Transition 同 |
| move 读位置 | `ui/geometry` 的同步 `boundingRectOf`（先刷新再布局，与 vant 读 rect 同一通道） | `getBoundingClientRect` |
| 已知差异 | 无新增 | 无新增 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（`TransitionBackend` 新增 `rectOf`，runtime 内部接口）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测（web）：新增条目的 enter 类名、删除条目
   leave 结束才移除、重排时被移动的条目拿到 move 类与反向 transform 后再清掉、`tag` 容器、
   非 v-for 子节点告警；Flutter：enter / leave 类名进样式引擎。
2. vapor-app 演示页加一个可增删、打乱的列表：web 浏览器与 iOS 模拟器上看到进出场和滑动，无报错。
3. 未使用 TransitionGroup 的包里没有它；vapor-app Flutter check 通过。

## 7. 待澄清

无。
