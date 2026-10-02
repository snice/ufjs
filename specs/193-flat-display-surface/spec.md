# Spec: 纯展示子树自绘（flat display surface）

- **ID**: 193-flat-display-surface
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

specs/192 的探针证明：同一棵 4050 节点的纯展示树，不再「每节点一个 widget +
element + render object」，改由一个自绘 RenderObject 排版并绘制后，
离线 mount 58 → 2 ms（3%）、改 1 格 8.7 → 2 ms（23%）；iOS 模拟器 debug 下
show 上屏 218 → 47 ms、最长 UI 帧 208 → 9.4 ms，光栅线程持平。
现有渲染器的成本随节点数线性增长，且 build 占 mount 帧约 75%（specs/192
占比表），此前 specs/186–191 的逐点削减每轮只得 20–40 ms。

但探针是**可丢弃的**：没有门控、没有增量布局、没有几何查询、没有回退，
列宽与现有渲染器差约 6%，也没有真机数据。现在的问题是把它变成主线里
**行为不变、只是更快**的一条渲染路径。

另有一个 192 留下的未决问题：收益来自「不建 widget」，还是来自「C++ 排版」？
探针没有拆开，不能断言 C++ 排版必要。

## 2. 不做什么（Non-goals）

- 不做手势、`:active` / `:hover`、transition / animation、文字输入、选区、
  platform-view 等需要交互或 widget 的节点（含这些节点的子树**不进**自绘，
  回退现有渲染器；「岛屿」机制是后续 spec）。
- 不做完整无障碍树（见 §3 的门控：语义开启时回退，不做自绘语义）。
- 不改 op 协议、natives 表、事件类型；JS 与页面作者无感知，不新增 prop / 标签。
- 不改 web 与小程序：它们用浏览器 / Skyline 自己的排版。
- 不做 CSS 全集：只覆盖 §3 的子集，子集之外一律回退，不「近似」。
- 不并入 192 的探针代码：它从未提交，清理后只剩 192 spec 里的数据；本 spec 重写主线版本。
- 阶段零若判定需要 C++ 排版进主线，**C++ 部分另立 spec**（要动 `native/`、重建预编译
  xcframework，见 AGENTS.md 4.8），本 spec 只交付 Dart 排版版本与决策依据。

## 3. 用户可见的行为

页面源码**不变**。同一份 Vue / element API 代码，在 Flutter 上：

- 满足门控的纯展示子树由一个自绘表面渲染，画面与现有渲染器一致（见 §6 的视觉对拍）；
- 不满足门控的子树照旧走现有渲染器，页面不会因此坏掉；
- `getBoundingClientRect` / 测量 / `scroll-into-view` 对自绘子树内的节点仍然给出正确答案。

### 门控（一个子树进自绘必须同时满足）

以子树的**最顶层可进入节点**为自绘根；任一条不满足则该节点不作根、继续检查其子节点：

1. 子树内 tag 只有 `view`、`text`。
2. 无任何事件 prop（`onTap` / `onLongPress` / 触摸 / 滚动等 `on*`）、无 `id`（
   `scroll-into-view`、`<label for>` 要靠 GlobalKey 找到它）、非 `htmlBlock`。
3. 样式无 `:active` / `:hover` 变体，无 transition / animation。
4. 样式键全部落在受支持子集内（逐个 interned 样式缓存判定，一次）：
   - 布局：`flex-direction`、`flex-grow`、`flex-shrink`、`width` / `height`（px）、
     `margin` / `padding`（px）、`gap`、`align-items`、`justify-content`、`display:none`；
   - 绘制：`background-color`、`border-radius`、均匀 `border`（宽度 + 实色）、`opacity`；
   - 文字：`font-size`、`color`、`font-weight`、`font-style`、`line-height`、
     `letter-spacing`、`text-align`、`white-space`、`font-family`（含多行换行）。
   - 具体清单在 plan 阶段对着 `docs/css-compat.md` 逐键核对后定稿；拿不准的键默认**不进**子集。
5. 子树节点数 ≥ 阈值（见待澄清 3）：很小的子树建一个表面不划算。
6. 语义树未开启（见待澄清 2）。

门控在节点增删 / 样式变化 / props 变化时**重新判定**：自绘子树里某节点后来被加上
`onTap`，该子树当帧切回现有渲染器，状态（滚动位置之外的展示状态）不丢。

### 自绘表面的行为

- 增量布局：一次变更只重排脏节点所在的路径与受影响的兄弟，不整树重排。
- 视口裁剪：位于滚动容器内时，只记录可见矩形的绘制指令（复用 `render/cull.dart` 的
  视口查询思路），布局仍全量，滚动范围不变。
- 几何：自绘根注册自己的节点映射，`geometry.dart` 对子树内任意节点返回其矩形
  （与现有路径同一坐标系、同一取整规则）。
- 文字：测量与绘制走 specs/190 的共享段落缓存，盒子取整与 `RenderParagraph` 规则一致
  （192 的探针没做到，列宽差 6%；本 spec 必须做到逐盒一致）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 门控内的子树自绘；其余照旧 | 不适用：浏览器自带排版，行为本就是「同一份源码、同一画面」 |
| 事件载荷 | 不涉及（门控排除一切带事件的节点） | 不涉及 |
| 已知差异 | 无画面差异是验收条件（§6.3）；任何差异都算 bug，要么修，要么把对应样式键移出子集 | — |

不新增用户可写的能力，故不触发「两端同时实现」；但**画面等价**是本 spec 的硬约束，
等价性用对拍保证，不靠「差不多」。

## 5. 契约变更（宪法 II）

- [x] 都不涉及（不动 op 协议 / natives 表 / 事件类型；自绘表面读现有 MirrorTree）

阶段零若选定 C++ 排版，则 natives / `fjs.h` 之外新增一组 `fjs_layout_*` C 符号，属于
**新契约**，由后续 spec 按宪法 II 处理，不在本 spec 内。

## 6. 验收标准

### 阶段零：归因（决定 C++ 排版去留）

1. 在 `test/` 新增 Dart 排版版本的自绘表面基准，与 192 的 C++ 版同一棵 4050 树、同一口径
   （`flutter test --dart-define=FJS_BENCH=true`），输出并排表：mount、改 1 格、pack /
   layout / paint 分项。
2. **判据事先定死**：Dart 排版 mount 与改 1 格都 ≤ C++ 版的 **1.5 倍** → 结论「C++ 排版
   不进主线」（省掉 native 改动与预编译产物重建）；任一项超过 → 结论「C++ 排版进主线」，
   另立 spec 处理 native 部分，本 spec 的阶段一仍先用 Dart 版落地。
3. 结论与两张表写进 spec.md「结论」节。

### 阶段一：主线落地

4. **门控正确性**（widget 测试）：纯展示子树 → Element / RenderObject 数是常数（与节点数
   无关）；给子树内一个节点加 `onTap` / `id` / `:active` 样式 / 不支持的样式键 / 语义开启，
   该子树各自回退并画面不变；节点动态加上又去掉事件时来回切换不丢内容。
5. **视觉对拍**：为 §3 子集里每类样式各写一个 fixture，同一 MirrorTree 分别用现有渲染器与
   自绘表面渲染，`matchesGoldenFile` 同图（或像素差 0）；含多行文字换行、`gap` /
   `justify` / `align` / `flex-grow` / `flex-shrink`、嵌套 3 层以上、`display:none` 子节点。
6. **几何**：自绘子树内节点的 `getBoundingClientRect` 与现有路径逐节点相等
   （测试里同一树两条路径各量一遍）。
7. **增量布局**：4050 树改 1 格，离线 bench 的整帧 ≤ 192 非增量探针（≈2 ms）的 **50%**
   （目标值，plan 阶段按实测校准后写回）；重排节点数计数器 ≤ 脏路径节点数 + 兄弟数。
8. **视口裁剪**：4050 网格放进 `scroll-view`，只画可见行；记录的绘制指令数随可见区而非
   总节点数变化（计数器断言）。
9. **主线不退化**：`flutter test` 全量通过（native 已编译，避免 `No tests ran`）；
   `pnpm run typecheck`、`pnpm test` 通过；现有 bench（`mount_bench_test`、
   `render_bench_test`）数字不回退。
10. **模拟器对照**（iPhone 17 Pro，debug，相对比值）：hello-js 4050 屏在**默认路径**
    （不再需要 `probe` 模式开关）与关闭自绘时对比，show 上屏、改 1 格上屏都 ≤ 关闭时的
    **50%**，hello-fjs 的 `flat-4050` 页同口径一并量（Vue 路径）。
11. 回归抽查：`examples/hello-fjs` 组件画廊与 `demo` 在模拟器上逐页对比开 / 关自绘的截图，
    无差异（按 `mp-visual-compare-workflow` 的逐页方式，不批量）。
12. 真机 profile 复核：待用户通知真机就绪后补一轮（不阻塞本 spec 状态转 done，但在
    「结论」节标注「真机待复核」并列出要复测的读数）。

## 7. 待澄清

已决（2026-10-03，用户「按推荐」）：

1. 触发方式：门控满足即**自动**进自绘，页面零改动；另加仅 Dart 侧的调试开关
   （`FjsView` 参数 / dart-define）用于一键关闭与对拍，不新增用户可写 prop。
2. 无障碍：语义树开启时整体回退现有渲染器（VoiceOver / TalkBack 零回归）；
   测试 / 基准另有「强制自绘」开关，不受语义状态影响。本 spec 不做自绘语义。
3. 最小节点阈值：plan 阶段由 bench 数据定（暂定 ≥ 32），写进结论节。
4. 阶段零判据：Dart 版 mount 与改 1 格都 ≤ C++ 版 1.5 倍 → C++ 排版不进主线。
5. 分支：在 `192-cpp-layout-probe` 之上新开 `193-flat-display-surface`；探针文件在 193 里
   重写为主线版本，不搬运。

## 结论

### 阶段零：C++ 排版去留（T015 / T016）

`test/flat_bench_test.dart`（离线，JIT+assert，读比例；同一棵 4050 树；min of 12，两次独立运行）：

| | mount | 改 1 格 | unmount | 改 1 格重排节点 |
|---|---:|---:|---:|---:|
| 现有渲染器（clone） | 58.3–58.6 ms | 8.3–9.5 ms | 2.8–3.0 ms | — |
| 192 C++ 探针（无增量） | 1.94–2.02 ms | 1.92–1.98 ms | 0.04 ms | 4051（整树） |
| Dart 自绘，首版 | 3.83–3.87 ms | 0.99–1.00 ms | 0.13–0.16 ms | 4 |
| **Dart 自绘，文字 spec / painter 按样式与文本共享后** | **2.46–2.67 ms** | **0.95–0.96 ms** | 0.12–0.13 ms | **4** |

判据（spec §6.2）：Dart 版 mount 与改 1 格都 ≤ C++ 版的 1.5 倍。

- 首版：mount 是 C++ 的 189–199%（未过）。最大的一项是 2000 个文字节点各自构造 span / strut 与共享段落缓存的键
  （4050 树只有 40 种不同段落）。
- 共享后：mount **132–136%**、改 1 格 **48–51%**，两项都过 → **结论：C++ 排版不进主线**，省掉 `native/`
  改动与预编译产物重建。C++ 版没有增量，改 1 格的比较对它不利；但即使把增量也算上，mount 一项 Dart 版
  只慢 0.5–0.7 ms（JIT；AOT 下差距预计更小，待真机复核）。
- Dart 自绘 / 现有渲染器：mount **4.0–4.4%**，改 1 格 **11–12%**。

本结论只对**纯展示子树**成立；增量布局是 Dart 版的优势来源（改 1 格重排 4 个节点），也是后续「增量」验收的基线。

### 阈值（T042）

`test/flat_threshold_bench_test.dart`（离线 min of 20，两次一致），N 节点纯子树的 mount：

| 节点数 | 现有渲染器 | 自绘 | 自绘 / 现有 |
|---:|---:|---:|---:|
| 4 | 0.51–0.53 ms | 0.25 ms | 48% |
| 8 | 0.70–0.76 ms | 0.24 ms | 32–35% |
| 16 | 1.04 ms | 0.24 ms | 23–24% |
| 32 | 1.36–1.42 ms | 0.25 ms | 17–18% |
| 64 | 1.51–1.58 ms | 0.23–0.24 ms | 15% |
| 128 | 1.79–1.83 ms | 0.22 ms | 12% |
| 512 | 7.4–7.6 ms | 0.59–0.61 ms | 8% |

自绘在所有规模上 mount 都更便宜（固定成本 ≈0.24 ms），所以下限不是为 mount 设的，而是为**层数**：每个表面是独立
repaint boundary，一页几百个小纯子树会给合成器几百层，离线 bench 量不到。取 `fjsFlatMinNodes = 16`（实测范围里
保守的一端）；要再降，需要真机 profile 一页这样的列表。**真机待复核项之一。**

### 模拟器对照（T082，iPhone 17 Pro，debug，hello-js 4050 屏，`__flat4050.setFlat('off' | 'force')`）

5 轮 show / 改 1 格 / hide（同一进程 A/B）：

| | off | force | force / off |
|---|---:|---:|---:|
| show 上屏 min / med / max | 218 / 246 / 277 ms（首轮冷 467） | 43 / 50 / 61 ms | **20%** |
| 改 1 格上屏 min / med / max | 106 / 116 / 117 ms | 25 / 30 / 34 ms | **24–26%** |
| hide 上屏 med | 55 ms | 58 ms | 持平（vsync 受限） |
| 最长 UI 帧（frame-timeline） | 196 / 190 / 88 / 79 ms | 8.1 / 7.6 / 7.4 / 7.3 ms | — |
| LAYOUT 最长 / BUILD 最长 | 95.6 / 76.5 ms | 4.2 / 0.8 ms | — |
| 光栅线程最长 | 4.7 ms | 5.5 ms | 持平 |

### 画面抽查（T083，模拟器，同一进程 off → force，裁掉状态栏逐字节比 PNG）

- hello-js 4050 网格：**逐字节一致**；
- hello-js 组件总览：仅进度条一处不同（它是动画，95% vs 35%），其余逐像素一致；
- hello-fjs 画廊与 demo 的逐页对比**未做**：本会话没有跑它们（hello-fjs 在另一个会话的模拟器上占着）。覆盖用
  生成式 / 手写 / 随机序列对拍代替（133 + 5 个用例，全绿），页面级回归留给真机复核时一并做。

### 验收核对（spec §6，2026-10-03）

| # | 条目 | 结果 |
|---|---|---|
| 1–3 | 阶段零：Dart vs C++ 并排表、判据、结论 | ✅ mount 132–136% / 改 1 格 48–51%，未超 1.5 倍 → C++ 排版不进主线 |
| 4 | 门控正确性 | ✅ `flat_gate_test.dart` 14 例（局部拒绝、白名单拒绝、动态回退与恢复、阈值、语义、页面根、判定缓存失效） |
| 5 | 视觉对拍 | ✅ `flat_parity_test.dart` 133 例（生成式 120 + 手写 13），逐节点矩形 + 逐像素 |
| 6 | 几何 | ✅ `flat_geometry_test.dart`：真实 `fjs.ui.rect` 宿主函数两路径逐节点相等；被移除节点返回 null |
| 7 | 增量布局 | ⚠️ 重排 4 个节点（计数器断言 < 40 且 > 0）；改 1 格整帧 0.95–1.00 ms，是 192 非增量探针（1.92–2.02 ms）的 **47–52%**，在「≤50%」目标线上而非明显低于它；剩下的主要是整帧框架开销与 4051 个绘制命令的重录（网格不在滚动容器里，没有裁剪）。`flat_incremental_test.dart`：5 个种子 × 60 步随机编辑，增量 == 全量，**测试中发现并修复 1 个真 bug**（根节点自身子节点列表变化没转发给表面） |
| 8 | 视口裁剪 | ✅ `flat_cull_test.dart`：300 行列表只记录可见行；关闭裁剪则全部；真实滚动后与现有路径逐像素一致 |
| 9 | 主线不退化 | ✅ `flutter test` 720 通过（原 564）；`pnpm run typecheck`、`pnpm test` exit 0；`mount_bench` 与 main 同机对照在噪声内（74.6 vs 75.1 ms min）；ordinary 路径的门控开销见 performance.md |
| 10 | 模拟器对照 | ✅ hello-js 4050 屏 show 上屏 20%、改 1 格 24–26%；⚠️ hello-fjs `flat-4050` 页**未量**（它在另一个会话的模拟器上占着） |
| 11 | 回归抽查 | ⚠️ 部分：hello-js 网格逐字节一致、组件总览仅进度条动画不同；hello-fjs 画廊与 demo 逐页对比未做，由 133 + 5 个对拍用例代替 |
| 12 | 真机复核 | ⏳ 待用户通知；要复测：show 上屏、改 1 格上屏、最长 UI 帧；`auto` 在无语义客户端时是否真的走自绘；**一页几百个小纯子树的合成成本**（决定能否把 `fjsFlatMinNodes` 降到 16 以下）；hello-fjs 画廊 / demo 逐页开 / 关对比 |

### 已知限制与后续（各自立 spec）

- 子集只有 §3 那一份；`border` / `opacity` / `overflow` / 百分比 / min-max / 阴影 / 渐变 / `position` 等都回退（见
  `docs/css-compat.md`）。扩子集的流程：先加对拍用例，再放进白名单。
- stretch 的父里带交叉轴显式尺寸的项回退（现有路径给它套 `Align` / `FjsUncappedCross`，未建模）。
- 没有手势 / `:active` / transition / 自绘语义（语义开启时整体回退）；「岛屿」机制是下一个 spec。
- 门控判定只在节点视图构建时发生；`fjs.dev.flat` 与 `FjsFlatMode` 是 dev 开关，release 构建不注册前者。
