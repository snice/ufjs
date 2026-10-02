# Tasks: 179-flutter-vdom-transition-group

- [x] T1 vue-shim TransitionGroup
- [x] T2 单测
- [x] T3 typecheck + pnpm test
- [x] T4 iOS（enableVapor: false）
- [x] T5 文档（vue3.md 的 TransitionGroup 行、vue-shim 头注释）

## 结果
- 单测 3 条（tag 容器、enter / leave、FLIP 反向 transform → move 类 → 摘除；位置读取打桩），对旧透传版全部失败、新实现全部通过
- 全量：runtime 957、CLI 446 通过
- iOS 模拟器（vapor-app `enableVapor: false`，即 VDOM）：删行淡出右移后移除、添加行从右淡入、打乱时各行滑到新位置（截到中间帧），日志 0 错误
