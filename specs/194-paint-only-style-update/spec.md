# Spec: 「只改绘制」的样式更新快路径

- **ID**: 194-paint-only-style-update
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

hello-js 的「主题压测」屏在 4000 节点（3332 个元素）切一次主题：JS 重算 + 编码 0.03 ms、过桥 + 应用 1.07 ms，
**最慢帧 283 ms**（iPhone 17 Pro 模拟器，debug，`scroll-view` 容器）。JS 与桥已经到底，全部成本在 Dart：
`docs/performance.md`「拆掉 Vue」一节的结论是「JS 侧优化到零，这一页仍然会掉十几帧」。

现状：主题切换时 JS 对每个变了的节点发一条 `SET_STYLE`（`applied 3176`）。Dart 侧每条都走同一条路——
`MirrorTree._touch` 标脏节点和它的父节点 → `flushDirty` 放信号 → `_FjsNodeView.setState` → `_buildNode`
重造这个节点的整条 widget 链（`decorateNode` 的 margin / 定宽高 / 装饰 / padding 包装、文字的 `_FjsText`……）→
Flutter 对每个 element 做 update、对每个 RenderObject 调 setter。**这是对的，但对「只换了颜色」的节点来说做多了**：
主题切换改的几乎全是 `background-color` / `color` / `border-color`，布局属性一个没变，widget 链的形状也一个没变，
唯一需要发生的事是「这个节点画的颜色换了、重画」。

`docs/performance.md`「Flutter 侧的重建粒度」已经说明：每个节点只监听自己的信号，粒度本身是对的，
「主题切换不在此列：每个节点确实都变了，1200 次重建一次不少，这是对的」。本 spec 要质疑的是下一层：
**「节点变了」不等于「节点的 widget 链需要重建」**。

目前缺一份数据：这 283 ms 里 build / layout / paint 各占多少、每个节点实际重建几次、有多少是父节点被连带重建的。
没有它就不知道快路径该放在哪一层（见 §6 第 1 条）。

## 2. 不做什么（Non-goals）

- 不改 JS 侧、op 协议、natives 表、事件类型（`SET_STYLE` 已经带着完整的新样式，Dart 侧自己比较新旧）。
- 不改任何会影响**布局**的更新（尺寸、边距、字号、显示、定位……）：这些仍然走现有的整链重建。
- 不碰 transition / animation：带过渡的属性变化仍走原路径（它们依赖 widget 链里的 `TweenAnimationBuilder`）。
- 不改自绘表面（specs/193）：它已经是单对象、增量布局；本 spec 优化的是**现有渲染器**里带事件 /
  `:active` / 子集外样式的节点，那些进不了自绘表面。
- 不改 `scroll-view` 不裁剪构建的问题（懒构建 sliver 是单独的话题，见 performance.md「没有做、但下一步该评估的」）。
- 不追求覆盖所有「绘制属性」：先做主题切换里实际出现的那几类，拿不准的键默认走原路径。

## 3. 用户可见的行为

页面源码与画面**不变**：快路径的结果必须与整链重建逐像素一致。可观察的差别只有速度——4000 节点切主题的
最慢帧下降，以及 `FjsNodeRenderer.buildCount`（节点 build 计数器，`render_bench_test` 已有）在
「只改颜色」的更新里远小于节点数。

「只改绘制」的判定在 Dart 侧、`SET_STYLE` 解码时做：比较节点旧的 [`FjsStyleEntry`] 与新的
[`FjsStyleEntry`] 的差集。差集里的键**全部**属于绘制类集合（暂定：`backgroundColor`、`color`、
`borderColor`，具体清单在 plan 阶段按实测与对拍定稿），且节点没有 transition / `:active` 变体需要重新求值 /
别的依赖这些键的包装（例如 `transitionNode` 的透明度包装），才走快路径；否则照旧。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | Dart 渲染器内部的更新路径，页面语义不变 | 不适用：浏览器自己决定重绘范围，本就只重绘变了的节点 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无（逐像素一致是验收条件） | — |

不新增用户可写的能力，不触发两端同步；与 specs/193 同理，约束是「画面等价」而非「两端实现」。

## 5. 契约变更（宪法 II）

- [x] 都不涉及（只读现有 `SET_STYLE` 解出的新旧样式 entry；不新增 op、natives、事件）

## 6. 验收标准

1. **先量（决定快路径放哪一层）**：离线基准（`flutter test --dart-define=FJS_BENCH=true`）搭一份主题切换负载——
   4000 节点、同样的 CSS 变量写法、对每个节点发新的 `SET_STYLE`（只换颜色）——输出：build / layout / paint 的阶段占比、
   每个节点的 build 次数（含被连带重建的父节点）、`Element` / `RenderObject` update 次数。模拟器补一份
   frame-timeline（`tool/frame-timeline.mjs`）。数据写进 spec.md「结论」，并据此在 plan 里选定快路径所在的层
   （候选：①`_FjsNodeViewState` 里跳过 build、直接改 `MirrorNode.view` 里已挂载的 RenderObject；
   ②把颜色挪成可监听的 `ValueListenable`，让 widget 链不变、只有叶子重画；③缓存 widget 链、只替换装饰对象）。
2. **快路径正确性**：对拍工具（沿用 `test/support/parity.dart` 的思路）对同一棵树、同一串「只改颜色」的 `SET_STYLE`，
   分别走快路径与关闭快路径，**逐节点矩形 + 逐像素字节相同**；至少覆盖：纯色背景、带圆角背景、文字颜色
   （含共享段落缓存的键变化）、边框颜色、同一节点多次连续变化、变化后又变回去、节点同时改了布局属性（必须回退）。
3. **只改绘制的更新不重建 widget 链**：widget 测试里 `FjsNodeRenderer.buildCount` 在「4000 节点只改颜色」后
   ≤ 节点数的 **10%**（目标值，按 §6.1 实测校准后写回）；混有布局变化的更新照旧重建。
4. **回退完整**：带 transition 的节点、改了任一非绘制键的节点、`:active` 当前生效的节点，都走原路径，画面不变
   （各有一例）。
5. **离线对照**：主题切换负载下，快路径开 / 关各取 ≥12 轮（min / med / max），整帧耗时快路径 ≤ 关闭时的
   **50%**（目标值，同上校准）。
6. **主线不退化**：`flutter test` 全量通过（native 已编译）；`pnpm run typecheck`、`pnpm test` 通过；
   `render_bench_test`（改一个叶子文本的重建次数与耗时）与 `mount_bench_test` 同机对照不回退。
7. **模拟器对照**（iPhone 17 Pro，debug，`scroll-view` 与 `list-view` 两种容器）：hello-js 主题压测屏
   4000 节点切主题的最慢帧，快路径开 / 关各 ≥4 轮（`__themeBench.toggle()` 与屏上「最慢帧」读数），
   快路径开启时 ≤ 关闭时的 **50%**（目标值）。快路径开关用 Dart 侧 dev 开关，免重编 A/B。
8. **真机 profile 复核**：待用户通知；不阻塞本 spec 转 done，但「结论」节标注并列出要复测的读数。

## 7. 待澄清

已决（2026-10-03，用户「按推荐」）：

1. 绘制属性集合：首版只放 `backgroundColor`、`color`、`borderColor`；`opacity` 不放（会改变 widget 链的形状）。
2. 快路径所在的层：量完数据（§6.1）后由数据决定，倾向候选 ①（跳过 build、直接改已挂载的 RenderObject）。
3. 开关：仅 Dart 侧（`--dart-define` + dev 宿主函数，仿 specs/193），默认开，release 不注册宿主函数。
4. 与 specs/193：互不依赖、分开交付；分支叠在 `193-flat-display-surface` 之上只是为了复用 `test/support/` 里的对拍工具，
   合并顺序 193 → 194。

## 结论（测量，§6.1 的数据）

`test/theme_switch_bench_test.dart`（离线，JIT+assert，读比例；hello-js 主题压测屏同构：1000 行 = 3287 个节点 =
23615 个 element / 13053 个 RenderObject，scroll-view 容器，每个 item 带 `:active`；一次切换 = 对每个颜色变了的
节点一条 `SET_STYLE`；min of 12，两次独立运行）：

| 阶段 | 耗时 |
|---|---:|
| 一次切换合计（flush + build + layout + paint） | **106–108 ms**（med 117–119） |
| 其中 `flushDirty` | 2.6–2.9 ms |
| 其中 `buildScope`（外面可见的 build） | 0.45–0.50 ms |
| 其中 `flushLayout`（**内含嵌套的 build**） | **102–104 ms** |
| 其中 paint（只画可见行，specs 离屏裁剪生效） | 0.7–0.8 ms |
| 对照：同一棵树「全部标脏、不重建」的纯 layout | **18.8 ms** |
| 节点视图被重建的次数 | **3144 / 3287**（96%） |
| build 之后需要 layout 的 RenderObject | **2** / 13053 |
| build 之后需要 paint 的 RenderObject | 12728 / 13053 |

读法：

- **成本几乎全是重建 widget 链**：嵌套在 layout 里的 build ≈ 102 − 纯 layout 的一部分 ≈ **80–100 ms，占 80% 以上**。
  （带 `flex-grow` 的行走 LayoutBuilder 路径，孩子在 layout 回调里才 build，所以 `buildScope` 阶段看起来几乎为 0。）
- **这次更新在语义上就是「重画」**：重建之后真正需要重新排版的 RenderObject 只有 2 个，需要重绘的有 12728 个——
  布局一点没变，只是 3144 个节点各自重造了一遍 widget 链来表达「换个颜色」。
- paint 不是问题（裁剪），纯 layout 18.8 ms 也只是上界的一小块。**所以 §6.1 的结论：快路径放在「跳过 build、
  直接改已挂载 RenderObject」这一层（候选 ①）**，而且连父节点的连带重建也要一并跳过（`_touch` 现在会把父节点一起标脏，
  对「只改绘制」的子节点没必要）。
- 文字颜色有一个坑：`RenderFjsParagraph.text` 的 setter 对任何 span 变化都 `markNeedsLayout`（specs/191 为修「只改颜色
  时共享 painter 不换」引入），这会让祖先链跟着重排。快路径要给它一个不触发 layout 的换色入口。

### 快路径落地后的数据（2026-10-03）

离线 `test/theme_switch_bench_test.dart`（含 `flushSemantics` 阶段，min of 12，两次独立运行）：

| | 关闭 | 开启 | 开 / 关 |
|---|---:|---:|---:|
| 一次切换 min / med | 139–149 / 148–165 ms | 6.4–7.6 / 7.8–10.2 ms | **4.6–5.1%**（med 5.3–6.2%） |
| 节点视图重建 | 3144 / 3287 | **0** | |

模拟器（iPhone 17 Pro，debug，4000 节点，frame-timeline，4 次切换，最长 UI 帧）：`scroll-view` 265 / 261 / 250 / 250 → 92 / 91 / 90 / 88 ms
（剩余 ≈ 90 ms 几乎全是 SEMANTICS 阶段，开 89 / 关 99，与快路径无关：模拟器语义树常开，`scroll-view` 把 4000 行都放进去）；
`list-view` 10.4 → 8.8 ms（本来就只建可见行）。LAYOUT 最长 167 → 1.8 ms。画面：两种容器 × 亮 / 暗，开 / 关逐字节一致。

### 验收核对（spec §6）

| # | 条目 | 结果 |
|---|---|---|
| 1 | 先量（选层） | ✅ 见上一节「结论（测量）」：嵌套 build 80–100 / 107 ms，重建后只有 2 个 RO 需要 layout → 选候选 ① |
| 2 | 快路径正确性（对拍） | ✅ `paint_only_test.dart`：亮暗往返、有 / 无 `:active`、4 种包装链、共享 painter、flat 子树内；逐步逐节点矩形 + 逐像素。**变异检验**：让快路径不换背景色 / 不换 painter，对拍分别报 28 万 / 2.4 万个像素字节不同 |
| 3 | 不重建 widget 链 | ✅ `FjsNodeRenderer.buildCount` 0（目标 ≤ 10%）；关闭时对照 > 节点数 |
| 4 | 回退完整 | ✅ 8 个回退原因各一例（非绘制键、键出现、transition、可见边框、背景图、view 裸文本、htmlBlock、其他标签）+ 按下中 + 同帧改文本不丢；全部画面一致 |
| 5 | 离线对照 | ✅ 4.6–5.1%（目标 ≤ 50%） |
| 6 | 主线不退化 | ✅ `flutter test` 736 通过；`pnpm run typecheck`、`pnpm test` exit 0；`mount_bench` 72.7 / 74.4 ms（main 同机 75.1） |
| 7 | 模拟器对照 | ✅ `scroll-view` 265 → 92 ms（35%，且剩余几乎全是与快路径无关的语义阶段）；`list-view` 10.4 → 8.8 ms。⚠️ 「≤ 50%」对 `list-view` 不成立（本来就小），已在 performance.md 如实记录 |
| 8 | 真机复核 | ⏳ 待用户通知；要复测：`scroll-view` 与 `list-view` 下切主题的最长帧、无语义客户端时的 UI 工作量 |

### 已知限制与后续

- 只覆盖 `backgroundColor` / `color`（`borderColor` 仅在没有可见边框时无影响）；`opacity`、可见边框换色、有 transition 的节点仍走原路径。
- 自绘表面（specs/193）里的节点没有 widget 链，不经此路径。
- 模拟器上 `scroll-view` 的 SEMANTICS 阶段 ≈ 90 ms 是独立问题（4000 行全进语义树），值得单独看。
