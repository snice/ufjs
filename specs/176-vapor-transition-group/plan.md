# Plan: 176-vapor-transition-group

1. `host.ts`：`createFor` 注册 `listOf(block)`（以 `nodes` 数组为键，同 `switchOf`），挂点
   `{ enter, leave, beforeUpdate, afterUpdate }`：
   - 每次非首轮更新前 `beforeUpdate(现存条目的节点)`；重排结束后 `afterUpdate(…)`；
   - 新建条目（非首轮）插入后 `enter`；删除条目：dispose 后 `leave`，结束再移除节点；
     离场中的节点在列表整体移除时一并清掉。
2. `TransitionBackend.rectOf`：web `getBoundingClientRect`，Flutter `boundingRectOf(id)`。
3. `transition.ts`：`createMoveHooks(props)`——记录位置、FLIP（`setStyleHost` 写 transform /
   transitionDuration，下一帧加 move 类并撤掉，结束后摘类）。
4. `runtime.ts`：`VaporTransitionGroup`（`/* @__PURE__ */`）：渲染 slot → 挂 list 钩子；
   `tag` 时建容器元素；`appear` 在 onMounted 进场；非列表告警。
5. 单测、演示页、文档。
