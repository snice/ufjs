# Tasks: 纯展示子树自绘（flat display surface）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。
分支 `193-flat-display-surface`（基于 `192-cpp-layout-probe`）。

## 契约层

- [x] T001 确认不动三张表：`git diff --stat main` 里没有 `ops.ts` / `ui_ops.dart` / `natives.cpp` / `native-global.d.ts` / `fjs.h` / `element.ts`

## 阶段零 · 排版引擎先行 + 归因

- [x] T010 通读 `render/flex.dart`、`render/stretch_flex.dart`、`render/box.dart`、`widgets/text.dart`，在 `plan.md` §3.2 下追加「排版语义清单」：每个受支持样式键的现有行为（默认值、无界约束下的处理、取整），作为 `flat_layout.dart` 的移植依据
- [x] T011 `render/paragraph.dart`：暴露共享 painter 句柄 API（acquire / release，`_paragraphCache` 保持私有），不改现有行为；`widgets/text.dart`：新增 `FjsTextEnvScope.maybeOf` 与 `fjsPlainTextSpec`（与 `_FjsText.build` 同源）；`test/shared_paragraph_test.dart` 仍绿
- [x] T012a `lib/src/flat/flat_style.dart`：interned 样式 → 引擎模板（`Expando` 缓存）+ 受支持键白名单 + 拒绝原因（门控与引擎共用，见 plan §6）
- [x] T012 `lib/src/flat/flat_layout.dart`：SoA「虚拟约束布局」引擎（全量版本，镜像 margin→定宽高→padding→RenderFlex + FjsShrinkStretchFlex 两趟 + Flexible），语义按 T010 / plan §6；纯 Dart 单测 `test/flat_layout_test.dart`（单列 / 单行 / grow 与 shrink / margin padding gap / align justify / 行默认 align-center / 主轴无界 / 嵌套 / 文字回调 / 多行换行）
- [x] T013 `lib/src/flat/flat_text.dart`：文字叶子的 painter 获取与测量（走 T011），取整与 `RenderFjsParagraph` 同源
- [x] T014 `lib/src/flat/flat_surface.dart`（最小版）：`RenderFlatSurface` 的 pack / layout / paint，无门控、无增量、无几何，仅供基准；强制通过 `FjsFlatMode.force` 与测试夹具接入（用一个测试专用入口，不碰 `renderer.dart`）
- [x] T015 `test/flat_bench_test.dart`：4050 树，对比现有渲染器 / 192 C++ 探针 / Dart 自绘（mount、改 1 格、unmount、分项），min of 12，两次独立运行；Dart 版同时给「关增量」一行（此时尚未实现增量，两行相同，T041 后补）
- [x] T016 跑 T015，把并排表写入 spec.md「结论」，按 §6.2 判据（Dart ≤ C++ × 1.5，mount 与改 1 格都要满足）写出结论：「C++ 排版不进主线」或「C++ 进主线（另立 spec）」；**若结论是后者，先向用户汇报再继续**

## 阶段一 · 镜像树与门控

- [x] T020 `mirror_tree.dart`：`MirrorNode.flatVerdict` / `flatSize` / `flatHost` 字段；`_touch` / insert / remove / setProps / setStyle 沿父链清缓存；`probeRoots` 换成 `flatRoots` 并在 `flushDirty` 转发（保留语义：集合为空时零开销）；`test/mirror_tree_test.dart` 新增缓存失效用例
- [x] T021 `lib/src/flat/flat_gate.dart`：局部判定、样式白名单（`Expando<bool>`）、纯度与节点数（读写 T020 缓存）、语义开关、`FjsFlatMode { auto, off, force }`（`--dart-define=FJS_FLAT` 初始化）、`FjsFlatStats.rejected`（按键计数 + debug 打印一次）；`test/flat_gate_test.dart`（局部拒绝各类、白名单拒绝、动态变不纯回退、阈值、语义开 / 关 / force）
- [x] T022 `render/renderer.dart`：`_FjsNodeViewState.build` 接入 `accept`，通过则 `FjsFlatSurface`；删除 192 的 `probe` 分支；`FjsNodeRenderer` 现有测试全绿（`node_widget_count_test`、`node_rebuild_test` 等）
- [x] T023 `fjs_view.dart`：监听 `semanticsEnabled`，变化时 microtask 后广播重走门控（仅 `auto`）；测试：开关语义切换时自绘根回退 / 恢复，内容不丢

## 阶段一 · 增量、几何、裁剪

- [x] T030 `flat_layout.dart`：增量版本（natural 缓存 + 脏链 + 相对父坐标 + 跳过未变子树），`relaidNodes` 计数器；属性测试（固定种子随机改一批节点后增量 == 全量重排）
- [x] T031 `flat_surface.dart`：接入增量（`flushDirty` 的 id → 下标标脏；结构变化重新 pack）
- [x] T032 几何：`geometry.dart` 的 `fjs.ui.rect` 与 reflow 两处读 `flatHost`；`test/flat_geometry_test.dart`（两路径逐节点 `getBoundingClientRect` 相等、滚动后坐标、forced reflow 后）
- [x] T033 视口裁剪：`RenderFlatSurface.paint` 与祖先视口求交，只画相交行；表面自己在滚动时失效；`test/flat_cull_test.dart`（4050 放进 `scroll-view`，绘制指令数随可见区变化、滚到别处后新行出现、嵌套视口）

## 对拍

- [x] T040 `test/flat_parity_test.dart`：对拍工具（同树两路径：逐节点矩形 + 逐像素），生成式 fixture（方向 × align × justify × grow/shrink × margin/padding/gap，节点数 3–8），手写 fixture（5×8 网格、多行文字与中英混排、嵌套 4 层、`display:none` 子节点、背景 / 圆角 / 均匀边框 / opacity、文字样式族）
- [x] T041 对拍失败项处理：每个不一致二选一——修引擎，或把对应样式键 / 组合移出白名单（并在 plan.md「风险」下登记）；白名单与对拍覆盖一一对应；补完后重跑 T015，把「关增量」一行写进结论表
- [x] T042 阈值：在 8 / 32 / 128 / 512 节点四个规模上量自绘 vs 现有路径的 mount，定 `kFlatMinNodes`，写进结论

## 主线接入与清理

- [x] T050 `examples/hello-js`：去掉 `probe` 模式；加 `__flat4050.setFlat('auto'|'off')`（dev 宿主函数，仅 Flutter dev 构建注册）；`typecheck` 通过
- [x] T051 清理 192：删除 `lib/src/probe/`、`ios/Classes/fjs_probe_layout.{h,cpp}`、`FlutterFjsPlugin.m` 的 keep-alive 行、`native/CMakeLists.txt` 的 probe 目标、`native/probe/`、`test/probe_bench_test.dart`（保留在 192 分支留档）；`flutter test` 与 `cmake --build` 通过。若 T016 结论为「C++ 进主线」则本条改为只删 `probe` 命名的入口，C++ 文件留给后续 spec

## 两端对齐（宪法 I）

- [x] T060 Web 侧：**无需改动**——页面源码不变，浏览器自带排版。在 spec.md「两端约定」下补一句验证记录：`fjs dev --web` 跑 `examples/hello-js` 4050 屏与 `hello-fjs` 的 `flat-4050` 页，画面与改动前一致
- [x] T061 两端行为对拍：同一页面在 Flutter（自绘开）/ Flutter（关）/ Web 三处截图并排，确认三者结构一致（自绘与关闭差异为 0，与 web 的差异不因本次改动变大）

## 文档（宪法 VIII）

- [x] T070 `docs/architecture.md`：新增「自绘表面」一节（门控规则、回退、几何、语义开关、调试开关、关键文件索引）
- [x] T071 `docs/performance.md`：192 / 193 的占比表、对照表与方法（离线 bench + 模拟器 `force`），明确标注「真机待复核」
- [x] T072 `docs/css-compat.md`：登记自绘受支持子集与「子集外回退」规则，说明回退不改变画面
- [x] T073 `docs/roadmap.md` 打勾

## 验收

- [x] T080 `pnpm run typecheck`、`pnpm test`
- [x] T081 `flutter test` 全量（native 已编译）；`mount_bench_test` / `render_bench_test` 数字不回退
- [x] T082 模拟器对照（iPhone 17 Pro，debug，`force`）：hello-js 4050 屏与 hello-fjs `flat-4050` 页，开 / 关各 ≥4 轮 show / 改 1 格 / hide，报 min / med / max；写入结论
- [x] T083 回归抽查：hello-fjs 组件画廊与 demo 逐页（`mp-visual-compare-workflow` 方式，不批量）开 / 关自绘截图对比，无差异
- [x] T084 `git diff --stat main` 确认只含本 spec 预期路径（plan §2 表），192 探针文件已清走
- [x] T085 spec.md 第 6 节逐条核对，把「状态」改 `done`；「结论」节标注「真机待复核」并列出要复测的读数
