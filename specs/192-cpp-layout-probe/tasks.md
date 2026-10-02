# Tasks: C++ 驱动排版探针

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。
探针代码不并入 main，也未保留（见 spec.md 结论末尾）；main 只收 spec 文件。

## 契约层（本 spec 无稳定契约变更）

- [x] T001 确认不动三张表：`ops.ts` / `ui_ops.dart`、`natives.cpp` / `native-global.d.ts`、`fjs.h` 均无 diff（`git diff --stat main` 只含探针文件与 spec）。探针符号 `fjs_probe_*` 声明在 `packages/flutter_fjs/ios/Classes/fjs_probe_layout.h`，不进 `fjs.h`

## 阶段 0 · 占比数据

- [x] T010 新增 `packages/flutter_fjs/test/phase_bench_test.dart`：复用 `mount_bench_test.dart` 的 4050 树，量 `pumpWidget` 内 build / layout / paint 各自耗时（`buildScope`、`flushLayout`、`flushPaint`），min-of-N，输出占比表；`--dart-define=FJS_BENCH=true` 才跑
- [x] T011 跑 T010，记录离线占比（JIT+assert，读比例）到 spec.md「结论」草稿
- [x] T012 模拟器取数：`examples/hello-js` 在 iPhone 17 Pro（端口 38901）上，`tool/frame-timeline.mjs` 抓 4050 屏 show / 改 1 格 / hide 各 ≥4 轮，按 BUILD / LAYOUT / PAINT / RASTER 求和
- [x] T013 模拟器取数：同上抓主题屏 4000 节点切主题（点屏幕触发，`fjs eval` 取不到返回值）
- [x] T014 `tool/cpu-profile.mjs` 对 show 挂载帧与切主题各采一次，记函数级 self / inclusive 前 15
- [x] T015 汇成「占比表」写入 spec.md「结论」，并按判据第三档（layout 占比 < 20%）预判探针是否值得做；占比表显示 layout 占比极低时**先向用户汇报再决定是否继续阶段 1**

## 阶段 1 · 探针实现

- [x] T020 `packages/flutter_fjs/ios/Classes/fjs_probe_layout.h` + `fjs_probe_layout.cpp`：C ABI，输入 SoA（父下标、种类、样式数值数组），输出每节点 `x,y,w,h`；flex 子集（direction / grow / shrink / width / height / margin / padding / gap / align-items / justify-content），文字叶子走 measure 回调；文件头写明 plan §1 VI 的三条权衡
- [x] T021 `packages/flutter_fjs/native/CMakeLists.txt`：`FJS_BUILD_TESTS` 下加 `fjs-probe-layout-test` 目标，源文件 include `ios/Classes/fjs_probe_layout.cpp`（只有一份）；并把它编进 `libfjs.dylib` 供 `flutter test` 取符号
- [x] T022 `packages/flutter_fjs/native/probe/test/probe_layout_test.cpp`：布局单测——单列、单行、grow 分配、margin/padding/gap、嵌套、文字回调次数；再加一条 4050 树（50 行 × 40 格）的矩形断言（格宽、行高、总高）
- [x] T023 编译并跑 `./native/build-native/fjs-probe-layout-test`，全绿后才进 Dart 侧
- [x] T024 `packages/flutter_fjs/lib/src/probe/probe_bindings.dart`：`DynamicLibrary` 查 `fjs_probe_layout`；measure 回调用 `Pointer.fromFunction`（异常返回值 0），复用 specs/190 的共享 TextPainter key；记回调次数 / 耗时计数器
- [x] T025 `packages/flutter_fjs/lib/src/probe/probe_surface.dart`：`RenderProbeSurface` + widget。打包（mirror 子树 → SoA，**计时单列**）、`performLayout` 调 C++、`paint` 直接画矩形 / 圆角 / 文字；分段计时（pack / C++ layout / paint）暴露给 bench；样式子集之外的键 `debugPrint` 一次并计数（plan §1 V）
- [x] T026 `packages/flutter_fjs/lib/src/node/node_adapters.dart`：`_ViewNodeAdapter` 对 `props['probe'] == true` 走 `ProbeSurface`，子节点不物化 widget
- [x] T027 `examples/hello-js/src/flat4050.ts`：加 `probe` 挂载模式（同一份 `defineCloneTemplate`/`cloneMany`，grid 根 `setProps({probe:true})`），`setMode` 类型与模式按钮加一格；保持 `node` / `clone` 行为不变

## 两端对齐

- [x] T030 Web 侧：**不适用**——浏览器自带排版，探针不进发布产物（spec §4）。在 `flat4050.ts` 的 `probe` 分支用 `hasNativeHost` 守卫，web 下回退 `clone` 并 `console.warn` 一次，避免页面在 web 上静默失效
- [x] T031 对拍（部分：画面与节点结构一致，列宽差约 6%，见 spec 结论第 6 条）— 原文：：模拟器上 `clone` 与 `probe` 并排截图（同一状态：初始、bump 一格后），逐项核对文字、背景色、0.5px 外边距、行高；不一致先修探针再测数

## 测试

- [x] T040 `packages/flutter_fjs/test/probe_bench_test.dart`：同一棵 4050 树，`clone`（现有渲染器）vs `probe`，量 mount、改一格、unmount、Element / RenderObject 数量；输出 pack / C++ layout / paint 分项，及「扣除 pack」「不扣除 pack」两种总和（plan §3 阶段 1）；`FJS_BENCH=true` 才跑
- [x] T041 模拟器对照：`__flat4050.setMode('clone'|'probe')` 各 ≥4 轮 show / 改 1 格 / hide，取挂载帧（frame-timeline）与 show 上屏、最慢帧（`[flat-4050]` 日志），报 min / med / max
- [x] T042 （跳过：4050 屏网格不在滚动容器内，见 spec 结论第 7 条）— 原文： 补充一行对照：探针「画全部」vs 「只画可见」（视口裁剪），仅在 4050 grid 位于滚动容器内时测
- [x] T043 `flutter test` 与 `pnpm test` 在探针分支不回退（native 已编译，避免「No tests ran」）

## 文档

- [x] T050 探针期不改 `docs/`；结论写入 `specs/192-cpp-layout-probe/spec.md`「结论」节（三张表、判据命中档位、下一步）
- [x] T051 若结论为「做」：在结论里列出 spec 193 起的阶段（C++ 读矩形 → 纯展示子树自绘 → 岛屿）与要同步的 `docs/architecture.md` / `docs/performance.md` / `docs/roadmap.md` 条目；若「不做」：把占比表指出的瓶颈记入 `docs/performance.md`（单独小改，不属探针）

## 验收

- [x] T060 `pnpm run typecheck`
- [x] T061 `pnpm test`；`flutter test`（native 已编译）
- [x] T062 `git diff --stat main` 确认探针代码只在预期路径（plan §2 表），main 不含探针
- [x] T063 spec.md 第 6 节逐条核对：占比数据 / 并排截图 / 对照表 / 判据命中 / 测试不回退 / 「结论」节
- [x] T064 （由 specs/193 接续：真机复核并入 193 的待办） 告知用户模拟器结论与可信度降级说明，等用户通知真机就绪后按同口径回归一轮
