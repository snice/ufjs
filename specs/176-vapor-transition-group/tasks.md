# Tasks: 176-vapor-transition-group

- [x] T1 host.ts：listOf + createFor 的 enter / leave / beforeUpdate / afterUpdate
- [x] T2 TransitionBackend.rectOf（web / Flutter）
- [x] T3 transition.ts：move（FLIP）
- [x] T4 VaporTransitionGroup
- [x] T5 单测（web + Flutter）；typecheck + pnpm test；未使用不进包
- [x] T6 vapor-app 演示；浏览器 + iOS；check
- [x] T7 文档

## 结果
- 单测：web 4 条（tag 容器 + fallthrough class、enter / leave、FLIP 反向 transform → move 类 → 摘除、非 v-for 告警），Flutter 1 条（enter / leave 类名进样式引擎、离场后移除）
- 未使用 TransitionGroup 的包里没有它
- 浏览器：插入行进场、被它挤下去的行拿到 FLIP transform；打乱后被移动的行 `list-move` 滑动；点删的行离场后移除；无报错
- iOS 模拟器（dev）：添加 / 打乱 / 点删，截到离场中的帧（淡出并右移），结束后移除；演示页改成 scroll-view（内容超出一屏）
- vapor-app Flutter check 通过
