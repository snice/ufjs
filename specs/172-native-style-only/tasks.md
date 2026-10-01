# Tasks: 172-native-style-only

## A. 删除构建期样式快照
- [x] A1 runtime：StyleEngine 快照 API 与 sheet 追踪；native-style seed；ops writer seed 编码
- [x] A2 runtime：router captureStyles / importPageStyleSnapshot；app capture 钩子；registerStyles hash 参数
- [x] A3 CLI：style-snapshot.ts、build.ts / run.ts / config.ts、vue-plugin styleSheetHash
- [x] A4 示例与 bench：package.json 配置、demo/bench/mount-core.ts
- [x] A5 测试：删/改快照用例，`pnpm test` 绿

## B. TS 逐元素引擎出包
- [x] B1 拆 `css/style-core.ts`，`StyleEngine extends StyleCore`，`pnpm test` 绿
- [x] B2 `css/style-native.ts` NativeStyleEngine；NativeStyleHost.engine → StyleCore
- [x] B3 host-ops 按 `__FJS_TS_STYLE__` 选择引擎；`__fjsNativeStyle` 误用告警；无 styleAttach 报错
- [x] B4 CLI：`__FJS_TS_STYLE__` define + `--ts-style`；需要 TS 引擎的 harness 脚本加标志
- [x] B5 单测：`--ts-style` 解析 + 按 define 打包 host-ops，断言 TS 引擎被摇掉（native 委托由 fjsrun / iOS 实跑覆盖，未写 mock 单测）

## C. 验证
- [x] C1 `pnpm run typecheck`、`pnpm test`
- [x] C2 vapor-app / demo release `--pages` 体积对比，产物无 TS 逐元素标识符
- [x] C3 fjsrun：vapor-app check（--ts-style）、bench native:verify、demo vapor-check / nav-vapor
- [x] C4 iOS 模拟器 vapor-app：首页、表单页、返回（about 页未单独点）

## D. 文档
- [x] D1 toolchain / architecture / performance / css-compat / roadmap

## 结果
- vapor-app release `--pages` shared.js：235,132 B（`--ts-style`）→ 214,699 B（−20.4 KB，gz 81.3 → 75.6 KB）
- demo release `--pages` shared.js：675,343 B → 654,906 B（−20.4 KB）
- bench native:verify 131,273 次比对 0 不一致；vapor-app check、demo vapor-check 通过
- iOS 模拟器（dev，native-only 包）：首页 / 表单页样式正常，返回正常
- 留待后续：native 侧 SEED_CHAIN / SEED_COMPUTE 与 `fjs_style_subject.seeded`（删要重出预编译库）
