# Plan: C++ 驱动排版探针

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不触发 | 探针不新增面向用户的能力，不进发布产物（spec §4）。探针模式只存在于分支，`__flat4050.setMode('probe')` 在 web 上不存在也不应存在。若结论为「做」，spec 193 起逐条回答（C++ flex 与 `flex.dart` / `stretch_flex.dart` / 浏览器的语义对齐） |
| II 边界即契约 | 不动三张表 | 探针经新增的**实验** C 符号（`fjs_probe_*`）被 Dart 调用，不进 `natives.cpp`、不进 `fjs.h`、不进 op 协议；JS 侧只用现有的 `repaintBoundary`/props 通道传一个标记 prop `probe: true`（走既有 SET_PROPS，不新增 op）。探针符号不稳定、不并入主线 |
| III 同步单线程零序列化 | 满足 | C++ 布局由 Dart 同线程同步调用（FFI），文字测量由 C++ 同线程回调 Dart（`Pointer.fromFunction`），无线程、无 JSON |
| IV 外观照 WeUI | 不涉及 | 探针只画 4050 屏的 cell / 文字，不新增组件外观 |
| V 静默失效是 bug | 探针内要守 | 探针遇到不支持的样式键（子集之外）要 `debugPrint` 一次并在对照表里标注「探针未覆盖」，不能悄悄丢；否则对照表会虚高 |
| VI 注释记录权衡 | 要做 | C++ 与 Dart 探针文件头写明：为什么是 pod `Classes/` 里编译而不是进 xcframework；为什么打包耗时单列；为什么回调而不是预测尺寸表 |
| VII JS 能包就不要下 Dart | 例外且已论证 | 本探针的目的就是验证 Flutter 渲染/布局层本身的性能上限，JS 包不了（瓶颈在 Dart 的 build/layout/paint）。符合宪法 VII 的「有实测的性能理由」，且需要的就是实测 |
| VIII 变更落到文档 | 只在结论为「做」时 | 探针期不动 `docs/`；结论写在 spec.md「结论」一节。若定为「做」，立 spec 193 时同步 `docs/architecture.md` / `docs/performance.md` / `docs/roadmap.md` |

没有破例条款。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | 无 | 不动 |
| 示例 | `examples/hello-js/src/flat4050.ts` | 第三种挂载模式 `probe`：与 `clone` 同一份 `defineCloneTemplate` / `cloneMany`（保证 mirror 树和 JS 成本完全相同），区别只是给 grid 根节点 `setProps({ probe: true })`；`setMode` 类型加 `'probe'`；模式按钮多一格 |
| C++（探针） | `packages/flutter_fjs/ios/Classes/fjs_probe_layout.cpp`、`fjs_probe_layout.h`（新增，仅探针分支） | C ABI：`fjs_probe_layout(nodes*, n, width, measure_cb, out_rects*)`。flex 子集：`flexDirection`、`flexGrow`、`flexShrink`、`width/height`、`margin`、`padding`、`gap`、`alignItems`、`justifyContent`；叶子文字走 measure 回调。输入为 SoA（struct-of-arrays：父下标、种类、样式数值数组），输出为每节点 `x,y,w,h` 的 float 数组 |
| C++（探针，host 测试） | `packages/flutter_fjs/native/CMakeLists.txt`、`native/probe/test/probe_layout_test.cpp`（新增） | `-DFJS_BUILD_TESTS=ON` 下编同一份 `fjs_probe_layout.cpp`（从 `ios/Classes` include，源文件只有一份），加布局单测：4050 树 / 嵌套 flex / 回调计数；并编进 `libfjs.dylib` 供 `flutter test` 用 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/probe/probe_bindings.dart`（新增） | `DynamicLibrary` 查符号（iOS 用 `process()`，host 测试用已有 dylib 路径逻辑，复用 `engine.dart` 的加载）；measure 回调 `Pointer.fromFunction` + 段落缓存复用 specs/190 的 key |
| Dart 宿主 | `packages/flutter_fjs/lib/src/probe/probe_surface.dart`（新增） | `RenderProbeSurface`（`RenderBox`）：持有子树快照，`performLayout` 调 C++ 取矩形并 `size = constraints.constrain(..)`；`paint` 遍历矩形，`drawRRect`/`drawRect` 画背景、`TextPainter.paint`（共享painter）画文字；带分段计时钩子（pack / C++ layout / paint）。子树打包在 `markNeedsLayout` 时做，打包耗时**单独记录** |
| Dart 宿主 | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | `_ViewNodeAdapter` 对 `props['probe'] == true` 的节点走 `ProbeSurface`，子节点不再物化为 widget（探针分支内的几行判断） |
| Dart 测试/基准 | `packages/flutter_fjs/test/probe_bench_test.dart`（新增） | 仿 `mount_bench_test.dart`：同一棵 4050 树，`clone`（现有路径）vs `probe`，分别量 mount（build+layout+paint）、改一格、unmount；`--dart-define=FJS_BENCH=true` 才跑，min-of-N；并给出 Element / RenderObject 数量对照 |
| 工具 | `packages/flutter_fjs/tool/frame-timeline.mjs`、`cpu-profile.mjs` | 不改，用于模拟器占比数据 |
| 文档 | `specs/192-cpp-layout-probe/spec.md`「结论」节 | 写入三张表与判据命中档位 |

## 3. 方案

### 阶段 0：占比数据（不写探针也能完成）

两条互补的取数路径，**互相印证**：

1. **离线（flutter test，不依赖模拟器）**：`test/mount_bench_test.dart` 已经在量 4050 树的整帧；扩展它（或新 `phase_bench_test.dart`）在 `pumpWidget` 里分别包 `buildScope`、`flushLayout`、`flushCompositingBits`+`flushPaint` 的耗时，得到 build/layout/paint 占比。JIT+assert 使绝对值失真，读比例。
2. **模拟器**：`frame-timeline.mjs` 抓 4050 屏 show / hide / 改 1 格和主题屏切主题，按 phase（BUILD/LAYOUT/PAINT/RASTER）求和；`cpu-profile.mjs` 给函数级 self/inclusive。模拟器 debug 只作比例参考（spec §7 已决）。

### 阶段 1：探针

- **数据来源**：探针**不另造节点**。JS 仍用 `cloneMany` 建同一棵树，mirror 树里节点照常存在（`applyFrame` 的成本两边相同，对照里不计入差异）；探针只替换 mirror 树之上的 widget/RenderObject 层。这样量到的差额就是「Dart 渲染层」的价钱，与完整方案里去掉的那一层一致。
- **布局在 C++，打包在 Dart（探针的已知失真）**：Dart 把 mirror 子树打成 SoA 交给 C++。完整方案里这一步不存在（libfjs-style 已经持有树与样式，可直接排版）。所以对照表里**三项分开列**：pack、C++ layout、paint，并给出「扣除 pack」与「不扣除」两种总和；判据取**不扣除**的（保守），扣除值作上限参考。
- **文字测量**：C++ 对每个文字叶子回调 Dart `measure(textIndex, maxWidth) → w,h`；Dart 用 specs/190 的共享 TextPainter 缓存，命中即零成本。回调次数与耗时单独计数，直接回答「方案 A 的文字测量成本」。
- **绘制**：单个 `RenderProbeSurface` 一次 `paint` 遍历矩形，用 `Canvas` 直接画；复用 `render/cull.dart` 的视口裁剪思路（探针先不做，4050 grid 在 scroll 里时再比较「画全部」与「只画可见」两档，作为对照的补充行）。
- **改 1 格**：JS `setText` 到 mirror → `RenderProbeSurface.markNeedsLayout`（探针不做增量，整树重排一遍），量出「不增量」的上限成本；若该项成为瓶颈，在结论里标注增量布局是阶段一必须做的。
- **范围外节点**：tab 壳、按钮、统计行、模式栏仍是现有 widget；只有 `probe: true` 的 grid 子树走探针。

### 被否掉的备选

| 备选 | 否掉原因 |
|------|---------|
| 直接把 C++ 布局挂在 libfjs-style 输出帧上（完整方案的形态） | 工作量大（要解码 DefineStyle JSON、对齐增量更新），而探针的目的是花最少代价判断去留；pack 单列已能把这一项的误差量化出来 |
| 探针 C++ 进 xcframework（`tool/build-apple.sh`） | 每次改动重建多切片 xcframework，迭代慢；探针在 pod `Classes/` 里随 Xcode 增量编译即可。若结论为「做」再进 native 主构建 |
| 预先在 Dart 测好段落尺寸表交给 C++ | 低估回调成本，对「方案 A 文字测量」无结论力（spec §7 已决） |
| 先不量占比，直接做探针 | 若 layout 占比很低，探针的降幅解释不了原因；占比是判据的第二支柱（spec §6.4） |
| 只用模拟器 | 模拟器无 profile，绝对值失真；因此加离线 bench 做比例印证，并保留真机回归位（用户通知后） |

## 4. 风险

- **探针样式子集漏项导致对照虚高**：4050 的 cell 用到 `margin: 0.5px`、`background-color`、`font-size/line-height`、`flex-direction: row`、行 `repaintBoundary`。漏支持任何一项（如 0.5px 的亚像素取整）会让画面不一致。验收 §6.2 的并排截图是闸门。
- **Pod `Classes/` 里放 `.cpp`**：podspec 注释说「只有插件 shim 在这里编译」；加 C++ 需要 `s.libraries='c++'`（已有）。若 pod 把它当 ObjC 编译失败，退路是改 `build-apple.sh`。
- **回调开销在 debug 下被放大**：FFI 回调在 debug/JIT 模拟器上比 release AOT 慢得多；对照表里回调次数与段落缓存命中率一起报，避免把 debug 开销当结论。
- **探针的 pack 把 4000 个 `MirrorNode` 读一遍**：成本可能不小，单列即可；若 pack > 探针总耗时的 30%，在结论里标注「完整方案必须让 C++ 直接持有树」作为阶段一的前置条件。
- **探针不含手势、滚动、语义**：对照表只代表纯展示上限；结论里明确「上限」不等于最终收益（阶段三的岛屿会吃掉一部分）。
- **与主线隔离**：分支 `192-cpp-layout-probe`；探针文件放 `lib/src/probe/` 与 `ios/Classes/fjs_probe_*`，不改 op 协议、不改 `natives.cpp`，合并回 main 的只有 spec 文件（结论落定后）。

## 5. 验证路径

```bash
# 阶段 0：离线占比
cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
cd .. && flutter test --dart-define=FJS_BENCH=true test/phase_bench_test.dart

# 阶段 0：模拟器占比（iPhone 17 Pro，端口 38901）
cd examples/hello-js && npx fjs run ios --device 76B1D996-6521-4370-9A11-2A14234A6567 --port 38901
node packages/flutter_fjs/tool/frame-timeline.mjs http://127.0.0.1:<vm-port>/ 8   # 期间 fjs eval 触发 show/hide/bump
node packages/flutter_fjs/tool/cpu-profile.mjs  http://127.0.0.1:<vm-port>/ 8

# 阶段 1：探针
./native/build-native/fjs-probe-layout-test                      # C++ 布局单测
flutter test --dart-define=FJS_BENCH=true test/probe_bench_test.dart
npx fjs eval --port 38901 "__flat4050.setMode('probe')"          # 模拟器并排截图 + ≥4 轮读数
pnpm test && flutter test                                        # 不回退
```

## 6. 实施中与 plan 的差异（2026-10-03）

- **挂接点**：plan 写的是 `node_adapters.dart` 的 `_ViewNodeAdapter`；实际改在
  `render/renderer.dart` 的 `_FjsNodeViewState.build`（对 `props['probe'] == true` 直接返回
  `FjsProbeSurface`）。原因：adapter 层拿到的 context 已经带着 `buildChildren`，在那里分支仍会
  先物化子 widget；在更外层截断才能做到「子树一个 widget 都不建」。
- **脏标记**：探针根没有对子孙的监听，新增 `MirrorTree.probeRoots`，`flushDirty` 把子孙的脏
  标记沿父链转给探针根的信号（`lib/src/mirror_tree.dart`，非探针运行时该集合为空，零开销）。
- **pod 编译**：新增 .cpp 后必须 `pod install`（`LANG=en_US.UTF-8`）才会进 Pods 工程；
  `FlutterFjsPlugin.m` 的 keep-alive 表加了 `fjs_probe_layout`，否则静态库符号被 strip。
- **测量口径**：clone 路径的「改 1 格」逐阶段驱动会量到 ~0（pump 之外没有脏元素），改为量整帧
  `tester.pump()`，两种模式同口径。
- **文字取整**：见 spec 结论第 6 条，探针不取整。
