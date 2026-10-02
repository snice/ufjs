# Plan: 179-flutter-vdom-transition-group

`vue/vue-shim.ts`：按 runtime-dom 的 TransitionGroup（3.5）重写，替换透传版：
- render：给上一轮的子节点挂 hooks 并记录位置（`boundingRectOf`），本轮子节点 `resolveTransitionHooks` /
  `setTransitionHooks`（hooks 来自现有的 `resolveTransitionProps`，即 Flutter 版 Transition 的类名与计时），
  返回 `createVNode(tag || Fragment, null, children)`；
- onUpdated：取新位置，位置变了的元素 `el.style.transform = translate(dx,dy)`、`transitionDuration = '0s'`；
  `nextFrame` 后加 move 类、清掉内联值；再一帧后 `whenTransitionEnds` 摘 move 类（计算样式要等类生效后才含过渡时长）；
  进行中的 move 被下一次更新打断时先收尾。
- 元素判断：fjs Element（有数字 id）。
单测在 `test/flutter-transition-group.test.ts`；iOS 用 vapor-app `enableVapor: false` 验证。
