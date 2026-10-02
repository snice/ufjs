# Plan: 纯展示子树自绘（flat display surface）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不新增能力，但**画面等价是硬约束** | 页面源码不变；web / 小程序走各自排版，不动。等价性用「两路径同树对拍」守住（§5）：逐节点矩形相等 + 渲染成图逐像素相同。任何差异要么修，要么把对应样式键移出受支持子集 |
| II 边界即契约 | 不涉及 | 不动 op 协议 / natives 表 / 事件类型；自绘表面只读现有 `MirrorTree`。若阶段零判定 C++ 排版进主线，`fjs_layout_*` 符号是新契约，另立 spec，不在本 plan |
| III 同步单线程零序列化 | 满足 | 布局与绘制都在 UI isolate 同步完成；无 JSON、无线程 |
| IV 外观照 WeUI | 不涉及 | 不新增组件外观；自绘必须与现有路径的外观完全一致 |
| V 静默失效是 bug | 要守 | 门控**拒绝**而不是**近似**：子集之外的样式键 → 该子树回退现有渲染器。拒绝原因按键计数，`debugPrint` 每个键一次（debug 构建），并暴露 `FjsFlatStats.rejected` 给测试，避免「悄悄没进自绘」被当成性能没提升 |
| VI 注释记录权衡 | 要做 | 文件头写：为什么是单 RenderObject 而不是 render-object-only 子树；为什么门控按「最顶层可进入节点」；为什么语义开启时回退；为什么 Dart 排版（或 C++，视阶段零结论）；行内 flex 的 quirk（行默认 `align-items: center`）来自 flex.dart 并在测试里钉住 |
| VII JS 能包就不要下 Dart | 例外且已论证 | 瓶颈在 Flutter 渲染层本身（build 约 75%，specs/192 占比表），JS 包不了；属于「有实测性能理由」（192 离线 mount 3%、模拟器 show 21–25%） |
| VIII 变更落到文档 | 要做 | `docs/architecture.md`（新增「自绘表面」一节：门控、回退、几何）、`docs/performance.md`（192/193 数据与方法）、`docs/roadmap.md`（打勾）、`docs/css-compat.md`（注明自绘子集与回退规则）。见 §2 末行 |

没有破例条款。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | — | 不动 |
| Web 适配层 | — | 不动 |
| C++ 引擎 | — | 本 spec 不动（阶段零若判 C++ 进主线，另立 spec） |
| 镜像树 | `packages/flutter_fjs/lib/src/mirror_tree.dart` | ① `MirrorNode` 加两个惰性缓存字段：`flatVerdict`（0 未知 / 1 纯 / 2 不纯）与 `flatSize`（子树节点数）；② `_touch` / insert / remove / setProps / setStyle 沿父链清缓存（遇到已清除的祖先即停，O(深度)）；③ 把 192 的 `probeRoots` 换成 `flatRoots`：`flushDirty` 把子孙的脏标记沿父链转给自绘根的信号（非自绘运行时该集合为空）；④ `MirrorNode.flatHost`：自绘表面写入，几何模块读取 |
| 自绘（新） | `packages/flutter_fjs/lib/src/flat/flat_gate.dart` | 门控：局部判定（tag、`on*` prop、`id`、`htmlBlock`、`:active`/`:hover`、transition/animation）+ 受支持样式键白名单（按 interned 样式 `Expando<bool>` 缓存一次）+ 子树纯度（读/写 `flatVerdict`）+ 节点数阈值 + 语义开关 + 调试开关 `FjsFlatMode { auto, off, force }`（`--dart-define=FJS_FLAT=off\|force` 初始化，测试可直接赋值）；`FjsFlatStats.rejected` 按键计数 |
| 自绘（新） | `lib/src/flat/flat_layout.dart` | Dart 排版引擎：`Float64List` SoA（前序，父下标）；语义**移植自 `render/flex.dart` / `stretch_flex.dart`**（含行默认 `align-items: center`、`flex-shrink` 默认 1 且 `_noShrinkTags` 除外、主轴无界时 `flex-grow` 不分配）；**增量**：每节点缓存 natural 尺寸（key：可用宽度）与相对父节点的矩形，脏标记沿祖先链向上；place 阶段只重排「脏节点 + 尺寸/位置变化的子树」，矩形存**相对父节点**坐标，未变子树不需重排；计数器 `relaidNodes` |
| 自绘（新） | `lib/src/flat/flat_surface.dart` | `FjsFlatSurface`（`LeafRenderObjectWidget`）与 `RenderFlatSurface`：持有自绘根与节点数组，`performLayout` 调引擎、`paint` 遍历可见矩形（背景 / 圆角 / 均匀边框 / 透明度 / 文字）；`attach/detach` 注册 `flatRoots`；`isRepaintBoundary: true`；视口裁剪（复用 `render/cull.dart` 的 `RenderAbstractViewport.maybeOf` 查询思路，见 §3）；`hitTestSelf` 为 false（门控已排除一切事件节点） |
| 自绘（新） | `lib/src/flat/flat_text.dart` | 文字：用 `fjsTextStyle` 建 `TextPainter`，走 specs/190 的共享段落缓存（`render/paragraph.dart` 暴露一个窄接口 `fjsSharedPainter(span, settings, minW, maxW)` → 共享 painter，保持 `_paragraphCache` 私有）；盒子取整**与 `RenderFjsParagraph.performLayout` 同一规则**（直接用 `painter.size`，不另取整；192 的偏差来自没走这条路） |
| 渲染入口 | `lib/src/render/renderer.dart` | `_FjsNodeViewState.build`：节点通过 `FjsFlatGate.accept(node, tree, context)` 则返回 `FjsFlatSurface`，否则原路径。门控在**每次该节点 view 重建**时重判，节点变不纯即当帧回退（内部节点各自成为新的自绘根候选）。**删除 192 的 `probe` 分支** |
| 几何 | `lib/src/geometry.dart` | `fjs.ui.rect` 与 `reflow` 里读 `node.element` 的两处，先看 `node.flatHost`：命中则返回 `surface.localToGlobal(rect.topLeft)` + 尺寸（与现有路径同一坐标系）；`measureTextBlock` 不动 |
| 语义开关 | `lib/src/fjs_view.dart` | 监听 `SemanticsBinding.instance.addSemanticsEnabledListener`，变化时 `tree` 广播以重走门控（仅 `FjsFlatMode.auto` 下需要） |
| 清理 192 | `lib/src/probe/`、`ios/Classes/fjs_probe_layout.{h,cpp}`、`FlutterFjsPlugin.m` 的 keep-alive 行、`native/CMakeLists.txt` 的 probe 目标、`native/probe/`、`test/probe_bench_test.dart` 的 C++ 引用、`examples/hello-js` 的 `probe` 模式 | **阶段零结论落定后**删除（保留在 192 分支留档）。若结论是「C++ 进主线」则 C++ 文件留给后续 spec，本 spec 仍删掉 probe 命名的探针入口 |
| 示例 | `examples/hello-js/src/flat4050.ts` | 去掉 `probe` 模式；`clone` 模式即走默认自绘路径。新增脚本手柄 `__flat4050.setFlat('auto'\|'off')`（走 `invokeHost` 到一个仅 dev 注册的宿主函数，切换 `FjsFlatMode`），模拟器对照时一键开 / 关，免重编 |
| 测试（新） | `test/flat_gate_test.dart`、`test/flat_parity_test.dart`、`test/flat_layout_test.dart`、`test/flat_geometry_test.dart`、`test/flat_cull_test.dart`、`test/flat_bench_test.dart`（阶段零：Dart 版 vs 192 C++ 版并排） | 见 §5 |
| 文档 | `docs/architecture.md`、`docs/performance.md`、`docs/roadmap.md`、`docs/css-compat.md`、`specs/193-.../spec.md` 的「结论」 | 新增小节 / 打勾 / 登记自绘子集与回退规则 |

## 3. 方案

### 3.1 为什么是「单 RenderObject + 自己的布局」

192 已经把两种形态量过的上限摆在这里：现有渲染器 10053 个 RenderObject / 16315 个 Element，mount 58 ms；探针 2 个 RenderObject，1.9 ms。中间形态「不要 widget / element，但每节点一个 RenderObject（直接用 `RenderFlex` 等挂在一个宿主 RenderObject 下）」没有量过，但每节点仍有 RenderObject 分配 + Flutter 布局 + 绘制记录，离线 `phase_bench` 里这三块（layout 约 11 ms + paint 约 3 ms）本身就是探针总量的 7 倍，所以放弃。

### 3.2 排版语义的来源（风险最高的一环）

现有路径不是 CSS flexbox 的直译，而是 CSS → Flutter widget 的映射，有一批「历史决定」：行默认 `align-items: center`（flex.dart 约 128 行）、`flex-shrink` 默认 1 但对部分 tag 为 0、`flex-grow` 映射为 `Expanded`（主轴无界时不生效以免崩溃）、margin 走 `FjsBox`、文字盒子来自 `RenderFjsParagraph`。192 的 C++ 探针按 CSS 默认写（行 `stretch`），**与现有路径不同**，只是 4050 树里所有 cell 等高才没暴露。

因此排版必须**从 flex.dart / stretch_flex.dart 移植语义，而不是从 CSS 规范重写**，并用 §5 的对拍测试逐条钉住：

- 每个受支持的样式键，至少一个「两路径矩形相等」的 fixture；
- 对拍用例由**生成器**批量产出（方向 × align × justify × grow/shrink × margin/padding/gap 的小规模笛卡尔积，节点数 3–8），不靠手写，避免漏象限。
- 门控的样式白名单只放**对拍已覆盖**的键：键进白名单当且仅当有对拍用例。

### 3.3 门控与回退

- 以「最顶层可进入节点」为自绘根。每个节点 view 构建时调用 `accept`，O(1) 局部判定先行；通过局部判定才查 `flatVerdict`（子树纯度）。
- 纯度缓存使整体成本不会随深度二次增长：脏标记沿父链清缓存，重算时每个节点只看自己和子节点的缓存。
- 子树内后来变不纯（加了 `onTap` 等）：该节点脏标记 → 自绘根信号 → 根重建 → `accept` 失败 → 当帧回退；内部节点各自的 `_FjsNodeView` 创建，其中纯的子树成为新的自绘根。
- 语义开启：`FjsFlatMode.auto` 下整体回退（用户已定）；`force` 忽略语义（基准、测试用）；`off` 全部走原路径。
- 阈值：`flatSize ≥ kFlatMinNodes`，初值 32，阶段一用 bench 在 3 个规模上定（见 tasks）。

### 3.4 增量布局

- 脏来源：`MirrorTree.flushDirty` 转发的 id 集合（text 变化、style 变化、增删节点）。表面在 `performLayout` 开头把这批 id 映射到数组下标并标脏；结构变化（增删节点）重新 pack 并重排（O(n)，仍远小于现状）；纯文字 / 样式变化走增量。
- natural 尺寸缓存失效：沿祖先链向上清（到根）；place 阶段自顶向下，**子树的赋值尺寸和相对父的位置都没变且自身未脏则整棵跳过**（矩形存相对父坐标，父平移不影响子）。
- 计数器 `relaidNodes`，§5 的测试断言「改 1 格 ≤ 脏路径节点 + 兄弟」。

### 3.5 视口裁剪

paint 时把表面自己的包围盒与所有祖先 `RenderAbstractViewport` 的可见窗口求交（做法同 `cull.dart` 开头那段长注释，包括「每个祖先视口都要问、滚动不会重绘表面所以必须自己失效」这条坑），只遍历相交的行。表面自己是 repaint boundary，滚动只改偏移；`cull.dart` 里的 `fjsScrollerMoved` 失效机制若适用则复用，否则表面自己监听滚动位置并 `markNeedsPaint`。

### 3.6 阶段零：归因

`test/flat_bench_test.dart` 在同一棵 4050 树上对比：现有渲染器 / 192 C++ 探针 / Dart 自绘表面（本 spec 的 `flat_layout.dart`，**先写它，再写门控等外围**）。口径同 `probe_bench_test`（离线 min of 12，两次运行）。判据（用户已定 1.5 倍）：Dart 版 mount 与改 1 格都 ≤ C++ 版的 1.5 倍 → C++ 排版不进主线。结果写入 spec.md「结论」，再继续阶段一。

注意 192 的 C++ 版没有增量，Dart 版有；对比表同时给出 Dart 版「关增量」一行，保证「改 1 格」比的是同类。

### 3.7 被否掉的备选

| 备选 | 否掉原因 |
|------|---------|
| 每节点一个 RenderObject、无 widget/element（render-object-only 子树） | 仍要付 10k 级 RenderObject 的分配、布局与绘制记录，离线 phase 数据里这部分约 14 ms，探针总量 2 ms；收益只拿到一半 |
| 要求页面显式标记（新 prop） | 页面作者要改代码，两端要同步，文档要写；门控能自动判定，且回退是安全的（用户已定自动） |
| 自绘里内联生成语义 | 本 spec 体量会翻倍，且语义与手势一起才有意义；语义开启时回退已保证零回归（用户已定） |
| 直接把 192 探针代码搬进主线 | 它没有门控、没有增量、没有几何、文字取整不一致，行默认对齐与现有路径不同；重写比修补风险小 |
| 阶段零之前先写门控和几何 | 若阶段零判定需要 C++ 排版，外围代码与排版引擎的接口会变；先出引擎和对比数据再搭外围 |
| 按 CSS 规范重写 flex 算法 | 与现有路径的历史语义不同（§3.2），会造成两条路径画面不一致 |

## 4. 风险

- **画面不一致（最大风险）**：现有路径的 flex 语义散落在 1700 行 flex.dart + 385 行 stretch_flex.dart。对策：白名单只放对拍覆盖的键；生成式对拍；不一致的组合直接让门控拒绝（例如某个 align × justify 的交叉如果难对齐，就把该键组合移出子集），而不是追求全覆盖。
- **门控漏判**：自动开启使漏判波及所有页面。对策：`FjsFlatMode.off` 一键回退；全量 `flutter test` + hello-fjs / demo 逐页截图对比（spec §6.11）；`FjsFlatStats` 记录每个进入自绘的根的原因，便于线上排查（debug 构建）。
- **门控本身的开销**：每个 view 构建都跑一次。对策：局部判定 O(1) 先行；纯度 / 节点数缓存；用 `mount_bench` 与 `render_bench` 确认非自绘页面不回退。
- **文字取整**：192 的 6% 列宽差根因未完全查清（`RenderParagraph` 与 `TextPainter.width` 的差）。对策：走 specs/190 共享 painter 的 `size`，与 `RenderFjsParagraph` 同一来源；对拍的文字 fixture 包含 1 位 / 2 位数字、中英混排、多行换行。
- **模拟器上语义似乎常开**：自动模式下模拟器会走回退，所以所有模拟器对照必须用 `force`；plan 里明确，验收时在读数表里标注模式。
- **语义监听时序**：语义开关在运行中切换时，自绘根要当帧回退，需要保证不在 build 中途触发重建。对策：监听回调里 `scheduleMicrotask` 后广播。
- **增量布局的正确性**：缓存失效漏一处就是静默错位。对策：对拍测试里对每个 fixture 追加「随机改一批节点后增量结果 == 全量重排结果」的属性测试（固定种子）。
- **与 `display: contents`、`position`、overflow 的交互**：门控白名单不含它们，遇到即回退；`display: none` 子节点在 pack 时跳过（与 `FjsNodeRenderer.isHidden` 同一函数）。
- **iOS 上的 Dart AOT 性能**：离线数据是 JIT；真机 profile 待用户通知后复核（spec §6.12）。

## 5. 验证路径

```bash
# 阶段零：Dart 版 vs C++ 版（需要 native 已编译，同 192）
cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
cd .. && flutter test --dart-define=FJS_BENCH=true test/flat_bench_test.dart

# 阶段一：正确性
flutter test test/flat_gate_test.dart test/flat_parity_test.dart \
  test/flat_layout_test.dart test/flat_geometry_test.dart test/flat_cull_test.dart

# 主线不退化
flutter test                      # 全量，native 已编译
flutter test --dart-define=FJS_BENCH=true test/mount_bench_test.dart test/render_bench_test.dart
pnpm run typecheck && pnpm test

# 模拟器对照（iPhone 17 Pro，端口 38901；自动模式在模拟器上会因语义回退，必须 force）
cd examples/hello-js
npx fjs run ios --device 76B1D996-6521-4370-9A11-2A14234A6567 --port 38901 \
  -- --dart-define=FJS_FLAT=force
npx fjs eval --port 38901 "__flat4050.setFlat('off')"   # 对照：关
npx fjs eval --port 38901 "__flat4050.setFlat('auto')"  # 开（实际 force）
```

### 对拍测试的做法（不靠 golden 文件）

同一棵 `MirrorTree` 在两个 `pumpWidget` 里各渲染一次（`FjsFlatMode.off` / `force`），然后：

1. 逐节点比较矩形（现有路径经 `node.element` 的 render box，自绘路径经 `flatHost`），容差 0.01；
2. 两路径各 `RepaintBoundary.toImage` 并逐像素比较字节（0 差异）。

生成器产出 fixture：方向 × align-items × justify-content × grow/shrink × margin/padding/gap 的小规模组合，节点数 3–8；另有手写的 4050 缩小版（5×8）、多行文字、嵌套 4 层、`display: none` 子节点。

## 6. 实施中的修订（2026-10-03，T010 读完现有排版后）

**发现**：现有路径的排版不是 CSS flex 直译，而是 Flutter 约束协议加一串包装的叠加。一个 `view` 节点的
链是 `Padding(margin) → ConstrainedBox(tightFor(w,h)，仅有 width/height 时) → FjsBox(装饰，只画)
→ Padding(padding) → FjsFlex`；flex 项外面还有 `FjsShrinkCross` 标记、`Flexible`（grow）、间距用
`SizedBox` 当子项；`FjsFlex` 自带两趟排版（`_shrinkToFit` 沿渲染树父链找标记、`startWhenUnbounded`、
行向 stretch 在交叉轴无界时先测量再拉伸）。文字走 `RenderFjsParagraph`，键里含 strut、`textScaler`、
`textWidthBasis` 等环境量（192 探针的 6% 宽度差就来自没带 strut）。

**修订**：

1. **做法**：引擎实现为「**虚拟约束布局**」——在 SoA 上逐函数镜像上述包装与 `RenderFlex.performLayout`
   的算法（`BoxConstraints` 传递，`deflate` / `enforce` / `constrain` 语义与 Flutter 一致），而不是按 CSS
   规范写。`FjsShrinkStretchFlex` 的两趟逻辑、`startsNow`、标记激活规则（父的有效对齐非 stretch 且该项无
   交叉轴尺寸）一并移植。
2. **首版子集 S1 收窄**（门控拒绝其余，回退现有路径；扩子集是后续增量，不阻塞本 spec）：
   - 布局：`view` / 纯 `text` 叶子；`flex-direction`、`justify-content`（含 space-*）、`align-items`、
     `flex-grow`（Flexible，主轴有界为 tight）、px 的 `width` / `height` / `margin` / `padding` / `gap`、
     `display:none`。
   - **拒绝**：`flex-shrink` 显式值、`flex-basis`、`flex-wrap`、`align-self`、auto margin、百分比 / calc、
     min / max、`position`、`overflow`、`border`、`opacity`、阴影 / 渐变 / 背景图、transform、
     transition、`box-sizing: content-box`、`fit-content`、`display` 其余取值、text 带子节点 / `richSpans`。
   - **拒绝（v1 的已知限制）**：在 **stretch 的父**里带**交叉轴显式尺寸**的项（现有路径给它套
     `Align` / `FjsUncappedCross`），例如默认列布局里 `width: 100px` 的子盒子；这类先回退。
   - 绘制：`background-color`、`border-radius`；文字全样式族经 `fjsTextStyle`。
3. **文字**：通过 `render/paragraph.dart` 暴露的共享 painter 句柄（acquire / release）取 painter，键由与
   `_FjsText.build` 同源的 helper 构造（`widgets/text.dart` 新增 `FjsTextEnvScope.maybeOf` 与
   `fjsPlainTextSpec`），环境（direction / scaler / locale / ambient `DefaultTextStyle`）在表面 widget
   的 build 里依赖读取；`env.selectable` 或缺 env 时拒绝。
4. **新文件**：`lib/src/flat/flat_style.dart`（interned 样式 → 引擎用的不可变模板 + 白名单，门控与
   引擎共用，保证「门控认的键」与「引擎读的键」同一份清单）。
5. **阶段零的实施顺序**：先 `flat_style` + `flat_layout`（全量）+ 最小 `flat_surface`，用 `force` 模式经现有
   渲染器入口接入（探针分支暂留到 T016 结论），在 `flat_bench_test` 里对比；再继续门控与外围。
6. **风险补充**：虚拟约束布局的正确性完全由对拍测试担保，所以 T040 的生成式对拍要**先于**增量、几何、
   裁剪落地；子集的扩展一律「先加对拍用例，再放进白名单」。
