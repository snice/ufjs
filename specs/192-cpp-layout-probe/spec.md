# Spec: C++ 驱动排版探针（先量占比，再做可丢弃探针，以数据定去留）

- **ID**: 192-cpp-layout-probe
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

specs/186–191 之后，hello-js 上 JS 侧与过桥已经到底：模拟器 debug 实测，
主题屏 4000 节点切主题 JS 0.03 ms、过桥+应用 1.07 ms，最慢帧却 283 ms；
4050 屏克隆挂载 JS 10–22 ms，上屏 230 ms 以上。**剩下的账全在 Dart 侧**
（widget build / element / layout / paint）。

此前几轮是在 Dart 渲染器里逐点削（共享段落、盒子融合、样式缓存），每轮
降 20–40 ms，但每个节点一个 RenderObject 加 Stateful 包装的结构没变，
成本仍随节点数线性增长。需要判断：**让 C++ 排版、Dart 只画**这条结构性
路线是否值得做，而不是继续修补。

目前缺两样数据：

1. Dart 帧里 build / layout / paint 各占多少（决定 C++ 排版能吃掉哪一块）。
2. 「C++ 出布局 + 单个自绘 RenderObject」的上限收益（决定值不值得为它重写
   节点渲染、手势、滚动、语义）。

## 2. 不做什么（Non-goals）

- 不交付生产可用的 C++ 排版引擎；探针是**可丢弃**的，结论出来后代码不并入
  主线（留在分支 / 以 spec 附录记录数据），除非结论是「做」并另立 spec。
- 不改 op 协议、natives 表、事件类型；不改 web / 小程序（它们用浏览器 /
  Skyline 自己的排版）。
- 不处理手势、滚动物理、文字输入、无障碍、原生控件（岛屿机制）——这些是
  完整方案的阶段三，本探针只验证「纯展示子树」的上限。
- 不追求探针的 CSS 完整度：只覆盖 hello-js 4050 屏用到的 flex 子集。

## 3. 用户可见的行为

对页面作者**无可见变化**。产出物是三样：

1. **占比数据**：hello-js 的 4050 屏（克隆挂载 show / 改 1 格 / hide）与
   主题屏（4000 节点切主题）上，一帧里 build / layout / paint（及
   光栅化）的耗时占比。
2. **探针对照表**：同一棵 4050 树，现有渲染路径 vs 探针路径，挂载帧、
   show 上屏、切主题耗时并排。
3. **去 / 留结论**：写进本 spec 的「结论」一节，并给出完整方案是否立项
   （阶段：C++ 布局读矩形 → 纯展示子树自绘 → 岛屿机制）及各阶段预期收益。

探针入口：hello-js 的 4050 屏新增一个模式开关（`__flat4050.setMode('probe')`，
与现有 `node` / `clone` 并列），仅在探针分支存在。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 探针只在 Flutter 渲染路径上实验 | 不适用：浏览器自带排版 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 探针模式下无手势 / 语义（Non-goals） | — |

宪法 I 针对「面向用户的能力」；本 spec 不新增用户能力，探针模式不进入
任何发布产物，故不触发两端同步要求。若结论为「做」，完整方案的 spec
再逐条回答这一节（尤其 C++ flex 与 `flex.dart` / `stretch_flex.dart` /
浏览器的语义对齐）。

## 5. 契约变更（宪法 II）

- [x] 都不涉及（探针复用现有 JSI / FFI 通道；探针内部的 C++↔Dart 文字
      测量回调属于实验代码，不构成稳定契约，不并入主线）

## 6. 验收标准

1. 占比数据：用 `packages/flutter_fjs/tool/frame-timeline.mjs` 与
   `cpu-profile.mjs` 在 iOS 模拟器（debug，仅作比例参考）上给出 4050 屏三个
   动作与主题屏切主题的 build / layout / paint 占比表；若有真机可用，
   补一份 profile 真机数据，并在表里标注数据来源。
2. 探针：`__flat4050.setMode('probe')` 后 show / hide / 改 1 格能跑通，
   画面与 `clone` 模式在视觉上一致（模拟器截图并排，纯展示节点：文字、
   背景、圆角、边距）。
3. 对照表：同一台设备、同一份 JS、同一轮次，`clone` 与 `probe` 的
   挂载帧、show 上屏、改 1 格上屏、最慢帧各取 ≥4 轮读数（报 min/med/max，
   与 specs/191 同口径）。
4. 结论判据**事先定死**（避免事后挑数据）：
   - 探针 show 上屏与挂载帧都降到 `clone` 的 **50% 以下** → 结论「做」，
     另立 spec 193 起走阶段一。
   - 降幅在 50%–80% → 结论「部分做」：只取收益最大的一段（由占比表决定，
     如仅阶段二的纯展示子树自绘）。
   - 降幅不足 20%，或占比表显示 layout 占比 < 20% 且探针未显著改善
     → 结论「不做」，把瓶颈转向占比表指出的段落。
5. `pnpm test` 与 `flutter test`（native 已编译）在探针分支上不回退；
   主线（main）不含探针代码。
6. 本 spec「结论」一节写入：三张表、判据命中哪一档、下一步。

## 7. 待澄清

已决（2026-10-03）：

- 真机：先用 iOS 模拟器（debug）出相对比值并下结论；真机由用户准备好后通知，
  届时按 §6 同口径回归，结论若与模拟器档位不同以真机为准。
- C++ flex 放 `packages/flutter_fjs/native/` 的实验目录，仅探针分支。
- 文字测量走 C++ 同线程回调 Dart（`dart:ffi` 回调）。

## 结论

### 占比表 · 离线（flutter test，JIT+assert，读比例；`test/phase_bench_test.dart`）

4050 网格 mount 帧，min of 12，两次独立运行：

| 阶段 | 耗时 | 占比 |
|---|---:|---:|
| build（含嵌在 layout 内的 widget/element 创建） | ≈44 ms | **≈75–76%** |
| layout（纯，所有节点标脏重排） | ≈10.6–11.6 ms | ≈18–20% |
| paint（首帧） | ≈3 ms | ≈5% |
| 合计 | ≈58 ms | |

含义：C++ 只出布局（方案 A）理论上限 ≈19%；build 是主因。探针要验证的是方案 B
（不建 widget，单个自绘 RenderObject），同时去掉 build 与 layout 两块。

### 占比表 · iOS 模拟器（iPhone 17 Pro，debug，frame-timeline，仅比例参考）

| 场景 | 最长 UI 帧 | BUILD（含嵌套） | LAYOUT 总（含 BUILD） | PAINT | 光栅线程最长 |
|---|---:|---:|---:|---:|---:|
| 4050 屏 show/hide ×3（14 s 窗口） | 199 / 193 / 93 ms | 最长 77.7 ms，合计 210 ms（148 次） | 最长 100.5 ms，合计 217 ms | 最长 5.9 ms | 4.6 ms |
| 主题屏 4000 节点切主题 ×3 | 54.5 ms | 合计 84 ms（726 次，≈28 ms/次） | 合计 89 ms，最长 42 ms | — | 1.5 ms |

- 与离线 bench 一致：**BUILD 占 LAYOUT 阶段的 ~95%**（BUILD 在 layout 内嵌套执行），
  纯 layout 与 paint 很小；光栅线程不是瓶颈（≤4.6 ms）。
- 主题屏一次切换 BUILD 被拆成 ~240 次小重建（逐节点 setState），印证上一轮的 dirty 粒度判断。
- cpu-profile（4050 show/hide，8 s）自身耗时榜里出现 `_SemanticsGeometry.computeChildGeometry`、
  `_RenderObjectSemantics._getNonBlockedChildren`、`objc_msgSend` / `CFNumberGetValue`：
  **模拟器上语义树是开着的**（辅助功能桥在算 4000 节点的几何），真机默认关，
  所以模拟器的绝对值含一块真机没有的成本；完整方案若自绘，语义必须自己生成（风险项）。

### T015 预判

layout 占比 ≈19%（边界），但 build 占 ≈75%。判据第三档（「layout 占比 < 20% 且探针未显著改善」）
对**方案 A**成立，对**方案 B** 不成立：B 同时去掉 build 与 layout。结论：继续阶段 1，
探针按方案 B（单个自绘 RenderObject，不建 widget）做；方案 A 单独不值得做。

### 对照表 · 离线（flutter test，JIT+assert，读比例；`test/probe_bench_test.dart`，min of 12，两次独立运行）

| | clone（现有渲染器） | probe（C++ 排版 + 单个自绘 RenderObject） | probe / clone |
|---|---:|---:|---:|
| mount（build+layout+paint） | 58.1–61.8 ms | 1.92–2.01 ms | **3%** |
| 改 1 格（整帧 pump） | 8.7 ms | 1.93–1.99 ms | **22–23%** |
| unmount | 2.65–2.88 ms | 0.03 ms | ~1% |
| Element / RenderObject 数 | 16315 / 10053 | 6 / 2 | |

probe mount 内部分项（min）：pack 0.43 ms、C++ 排版（含 4000 次文字回调）0.69 ms、paint 0.60 ms。
文字回调 Dart 侧耗时≈0（段落缓存命中，每叶 2 次回调，C++ 里按 natural 尺寸记忆后已是下限）。
「扣除 pack」与「不扣除」两种口径的 mount 比值都是 2–3%。

### 对照表 · iOS 模拟器（iPhone 17 Pro，debug，hello-js `__flat4050.setMode('clone'|'probe')`）

每模式 5 轮 show / 改 1 格 / hide（clone 首轮冷启动 483 ms 不计入 min/med，仅列出）：

| 读数 | clone | probe | probe / clone |
|---|---:|---:|---:|
| show 上屏 min / med / max | 218 / 239 / 302 ms（冷 483） | 47 / 59 / 62 ms | **≈21% / 25%** |
| 改 1 格上屏 min / med / max | 89 / 109 / 117 ms | 21 / 34 / 35 ms | **≈24% / 31%** |
| hide 上屏 min / med | 45 / 54 ms | 46 / 57 ms | ≈100%（vsync 受限，两边持平） |
| show 最慢帧 | 32.6–32.9 ms | 16.8–17.1 ms | 少一帧 |

frame-timeline（同一 14 s 窗口，show/hide ×3）：

| | clone | probe |
|---|---:|---:|
| 最长 UI 帧（前 4） | 208 / 191 / 89 / 86 ms | 9.4 / 9.3 / 7.5 / 5.7 ms |
| LAYOUT（root）最长 | 106.6 ms | 5.0 ms |
| 其中 BUILD 最长 | 89.7 ms | 1.0 ms |
| PAINT（root）最长 | 6.5 ms | 2.4 ms |
| 光栅线程最长 | 5.3 ms | 4.7 ms |

光栅线程两边持平（≈5 ms）——probe 把 4000 次绘制画进一张 Picture，没有把成本转嫁给光栅。

### 判据命中

spec §6.4：挂载帧与 show 上屏**都**降到 clone 的 50% 以下 → 「做」。
离线 3%、模拟器 show 上屏 21–25%、最长 UI 帧 208 → 9.4 ms，**命中第一档（做）**。

### 可信度与保留意见（必须随结论一起读）

1. **模拟器是 debug**，绝对值不可信；且模拟器上**语义树是开着的**（cpu-profile 里有
   `_SemanticsGeometry`），clone 为此多付一块，probe 没有语义，所以模拟器比值偏乐观。
   离线 bench 没有语义，仍是 3% / 23%，**方向稳健，幅度待真机 profile 复核**（用户已说真机后补）。
2. **归因没拆开**：收益来自「不再每节点一个 widget / element / render object」（方案 B），
   C++ 排版本身只占 probe mount 的 0.69 ms / 1.9 ms。探针没有测「同样的单 RenderObject 设计，
   但排版用 Dart 实现」，所以**不能断言 C++ 排版是必要的**；它是 B 的一个自然配套（可同步给
   `getBoundingClientRect`、不跨线程），但优先级低于自绘本身。spec 193 的第一步应做这个对照。
3. **上限而非终态**：探针没有手势、滚动、文字输入、无障碍、选区、`:active`、transition、
   overflow 裁剪、百分比/min/max/position；这些都要在阶段三补回，会吃掉一部分收益。
4. **没有增量布局**：改 1 格仍重排全部 4051 节点（≈2 ms）。节点数再翻 10 倍这条线性成本会显现，
   完整方案需要增量。
5. **pack 0.43 ms** 占 probe mount 的 ~20%：完整方案必须让 C++ 直接持有树与样式（libfjs-style 已有），
   不能每次从 Dart mirror 重新打包。
6. **宽度差**：probe 的网格比 clone 窄约 6%（`RenderParagraph` 对文字框的取整规则无法用
   `TextPainter.width` 复刻，试过 ceil 到逻辑像素反而宽 5%）。节点数、文字数、绘制数完全一致，
   所以不影响耗时结论；但完整方案必须复刻该规则，否则两端排版会漂移。
7. 未测 T042（视口裁剪对照）：4050 屏的网格并不在滚动容器内，裁剪与否不影响本结论。

### 下一步（建议）

立 **spec 193**，按风险从低到高分阶段，每阶段独立验收：

1. **193 阶段零（先隔离归因）**：同一个「纯展示子树 → 单个自绘 RenderObject」设计，排版先用 Dart 写
   （复用 `flex.dart` 的子集语义），与本探针的 C++ 版对比；决定 C++ 排版是否进主线、还是只做自绘。
2. **阶段一**：纯展示子树自绘进主线（门控：子树内全是 view/text 且样式落在受支持子集，
   否则回退现有渲染器；启用开关 `repaintBoundary`-like 标记），含增量布局与视口裁剪。
3. **阶段二**：语义 / 手势 / `:active` / transition 补齐，岛屿机制（输入、swiper、platform-view 等
   保持 widget，由自绘表面给占位矩形）。
4. 真机 profile 复核（用户准备好后）；若真机比值显著弱于 21–25%，在阶段零前重新评估。

**探针代码没有保留**：它从未提交，specs/193 清理主线时已删除（C++ 排版经 193 阶段零判定不进主线）。留下的只有本节与 193 里的数据和结论；要复现可按 plan.md §2 的文件清单重写（约 300 行 C++ + 300 行 Dart）。
