# Tasks: 原生模板克隆（Vapor 路径）

对应 plan：`./plan.md`

- [x] C1 C++：`W_TEMPLATE` / `W_CLONE`、模板表、展开与样式登记；`fjs-style-test` 覆盖（展开的帧 = 逐节点建的帧的结构 + 同样的样式）
- [x] C2 JS：`ops.ts` 写入、`element.ts` `allocIds` / `adoptElement`、`renderer.ts` `cloneTemplate`、native-style 原子
- [x] C3 Vapor 外壳：可克隆判定 + 模板编码缓存 + `instantiate` 走克隆
- [x] C4 对拍：flat-4050 Vapor TS / native hash、verify 模式 0 不一致、卸载不泄漏
- [x] C5 测量：clone-floor 24.6 → 10.6、Vapor 挂载 49.4 → ~36；另外两刀（外壳构造瘦身、草稿数组复用）；写 spec §8、performance.md、architecture.md
- [x] C6 验收：typecheck / pnpm test / 两 flavor fjs-test、fjs-style-test / flutter test / 预编译产物重新生成 / 模拟器冒烟（hello-fjs 4050 Vapor 显示 + 改 2000 格；demo vant Vapor 页按钮、stepper）
