# Tasks: 样式引擎下沉 C++（libfjs-style）— 阶段 0 spike

对应 plan：`./plan.md`

## 阶段 0：门控 spike（过门条件：离线 VDOM 挂载 ≤ 40 ms，native 侧耗时单独报告）
- [x] S1 TS 重构：抽出 `buildMatch` / `computeResult`（公开方法），TS 引擎走它们（850 通过，期望未改）
- [x] S2 libfjs-style 骨架：`fjs_style.h`、CMake target `fjs_style`、`fjs-style-test`
- [x] S3 libfjs-style：原子、样式表、元素树（读结构 op）、签名 / chain 缓存、选择器匹配、首尾位、`+`
- [x] S4 libfjs-style：flush、match / compute 缓存、回调、style 表与 SetStyle / DefineStyle 输出
- [x] S5 libfjs 绑定：`styleAttach` / `styleDetach` / `styleResult` / `styleClasses` / `styleStats`、`uiOps` 经 libfjs-style；`native-global.d.ts`；两个 flavor 编译、`fjs-test` 通过
- [x] S6 JS：样式输入 op（`ops.ts`）、`css/native-style.ts`（`NativeStyleBackend`，挂在 StyleEngine 的 `native` 分支上）、渲染器开关 `__fjsNativeStyle`
- [x] S7 对拍：`examples/bench` `pnpm run native:ts` / `native:on`，flat-4050 页面规则 / +结构规则，两种模式、两个引擎每元素样式 hash 一致，match / compute / applied 计数一致
- [x] S8 测量：结果见 spec §8——PrimJS 42.5 ms（门槛 40，差 2.5）、quickjs-ng 34–36 ms；**过门与否待用户定**

## 阶段 1：全量
- [x] P1 C++：属性选择器（源顺序 class 列表 + `ATTR` op + 签名）、`RULES_APPEND`、hits 记录与查询、坏帧仍输出结构；单测
- [x] P2 libfjs：`styleMatchedRules` 绑定 + d.ts
- [x] P3 JS：属性输入与表编码、追加快路径、match 按 hit 集合复用、结果分代回收、NOTIFY 不重复 SetStyle、`matchedRulesOf`、坏帧回落
- [x] P4 verify 双跑模式 + 渲染器默认开启（`__fjsNativeStyle` = false 关 / 'verify' 对拍）
- [x] P5 对拍：bench flat-4050、demo `bench:mount` 五页、hello-fjs 页面在 verify 模式下无差异
- [x] P6 `tool/build-apple.sh` 带上 libfjs_style
- [x] P7 验收：typecheck、pnpm test、fjs-test / fjs-style-test（两 flavor）、flutter test 通过，bench 数字写 §9 / performance.md
- [ ] P9 真机：iOS / Android flat-4050 显示耗时、theme / vant / nutui / 动画页截图对比（用户）
- [x] P8 文档：architecture.md、css-compat.md、performance.md
