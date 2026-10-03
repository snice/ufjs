# Spec: 「只改文字内容」的更新快路径

- **ID**: 196-text-only-update
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

specs/194 证明：成批更新里最贵的往往不是布局或绘制，而是**为了表达一个没有改变形状的变化而重建整条 widget 链**。194 修了
「只改颜色」。真机上还有另一类同形状的更新——**成批文字内容变化**（列表里一排数字、计时器、行情、分数……，Vue 的插值更新到
element 层就是 `setText`）：

hello-js 4050 网格（iPhone 12，profile，现有渲染器，`bump(n)` = 改 n 格文字）：

| 改的格数 | UI 线程最长帧 | LAYOUT（含嵌套 BUILD） | 其中 BUILD | PAINT |
|---:|---:|---:|---:|---:|
| 1 | 4.5 ms | 1.1 ms | 0.3 ms | 2.9 ms |
| 200 | **29 ms** | 14.5 ms | 11.2 ms | 14.6 ms |
| 2000 | **49.6 ms** | 44.7 ms | 39.5 ms | 4.3 ms |

BUILD 占 LAYOUT 阶段的 77–88%。200 格就已掉两帧。

现状（`mirror_tree.dart` 的 `SET_TEXT`）：`node.text = text; _touch(id)` —— 标节点**和父节点**（以及沿祖先链找 `button`）脏，节点视图
`setState` → `_buildNode` 重造这个文字节点的整条 widget 链（margin / 尺寸 / 装饰 / padding 包装 + `_FjsText`）→ Flutter 对每个
element 做 update。**文字节点自己的 widget 链形状在内容变化前后完全一样**，要变的只有那一个 `RenderFjsParagraph` 的 span。

和 194 一样，需要的是：知道「只是文字变了」，直接去改那个已挂载的 `RenderFjsParagraph`，别重建。

## 2. 不做什么（Non-goals）

- 不改 JS 侧、op 协议、natives、事件类型（`SET_TEXT` 本来就带着新文本，Dart 侧自己判断）。
- 不处理**让节点可见性变化**的更新：空 ↔ 非空（空文本节点会被 `FjsNodeRenderer.isHidden` 过滤，父节点的 build 读它）。
- 不处理富文本（`richSpans`）、嵌套 text（span）、htmlBlock 段落（子节点文字拼成一个段落）、`view` 自带的裸文本（由 `view` 合成 text 孩子）、
  `button` 标签子树里的文字（按钮把子树文字收成一个标签）、`display: contents` 的父。
- 不处理带 `transition` 的文字节点（`_animatedParagraphColor` 的 builder 闭包捕获了旧文本，之后动画 tick 会把旧文字刷回来）。
- 不改自绘表面（specs/193）：其中的节点没有 widget 链，增量路径已有。
- 不改文字的**度量**语义：新文字照旧经过 `_FjsText.build` 同源的 `fjsPlainTextSpec`（含 `text-transform`、行首尾空白裁剪、共享段落缓存），
  尺寸变了就让 Flutter 自己的 `markNeedsLayout` 沿链重排。

## 3. 用户可见的行为

页面源码与画面**不变**：快路径的结果必须与整链重建逐像素一致、每个节点矩形一致。可观察的差别只有速度——成批改文字时 UI 线程帧下降，
`FjsNodeRenderer.buildCount` 在「只改文字内容」的更新里远小于被改的节点数。

### 判定（SET_TEXT 解码时，全部满足才走快路径）

1. 节点 tag 是 `text`，无子节点，无 `richSpans` prop；
2. 新旧文本**都非空**（可见性不变）；`trim` 之后是否为空也要一致（`_lineEdgesTrimmed` 会裁行首尾空白，纯空白文本的可见性按现有规则）；
3. 节点样式无 `transition` / `animation*`（取 `FjsStyle.of(node).transitions == null` 且无 `animation*` 键）；
4. 父节点是**非 htmlBlock 的 `view`**，且不是 `display: contents`；节点的祖先链上**没有 `button`**（`_markButtonLabel` 的范围）；
5. 同一帧里没有别的 op 把该节点放进 `_dirty`（`flushDirty` 里再判一次，与 194 同）。

运行期条件（`flushDirty` 里调钩子时判）：节点已挂载且 RenderObject 已 attach；沿节点自己的包装链找得到 `RenderFjsParagraph`
（遇多孩子容器即停，同 194）；`FjsTextEnvData.peek` 取得到环境；`fjsPlainTextSpec` 给得出 span（选择区、`overflow: fade` 返回 null → 回退）。

### 行为

- 用 `fjsPlainTextSpec(env, node.text, style)` 得到新 span，经 `RenderFjsParagraph` 的**正常 `text` setter** 换上：
  `markNeedsLayout`（文字变了，度量可能变）、`markNeedsSemanticsUpdate`（标签真的变了）照常触发——和 194 的换色不同，换色可以绕过它们，
  换文字不行。
- 不标节点，不标父节点；父节点的 widget 不重建，Flutter 的 relayout 沿 RenderObject 链自己传播。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | Dart 渲染器内部的更新路径，页面语义不变 | 不适用：浏览器自己决定重排重绘范围 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无（逐像素一致是验收条件） | — |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. **正确性（对拍）**：沿用 `test/support/parity.dart` 的 `renderSequence`：同一棵树、同一串 `SET_TEXT`，快路径开 / 关各跑一遍，**每一步**所有节点矩形相等、
   整张图逐像素相同。覆盖：同宽 / 变宽 / 变窄 / 变成多行（换行）/ 回到原文；带 `text-transform`；带 `:active` 的容器内的文字；共享段落缓存
   （多个节点同一文本）；同一帧里既改文字又改样式；同一节点连续多次改；`text-align` / `max-lines` / 省略。
2. **不重建 widget 链**：widget 测试里改 200 个文字节点后 `FjsNodeRenderer.buildCount` ≤ 被改节点数的 **10%**（目标值，按实测校准）；关闭快路径时作对照。
3. **回退完整**：每个回退条件各一例并检查回退原因计数、画面一致——空 ↔ 非空（含纯空白）、`richSpans`、嵌套 text、htmlBlock 段落、`view` 裸文本、
   `button` 子树、`display: contents` 父、带 transition、同帧别的 op 已要求重建、节点未挂载、自绘表面内的节点。
4. **语义与度量**：文字变了之后 `RenderParagraph` 的语义标签更新（`tester.getSemantics`）；变宽 / 变多行时父级布局随之正确（对拍已含，另加一例断言父节点高度变化）。
5. **离线对照**：4050 树（或同构负载）改 200 / 2000 格文字，整帧（flush + build + layout + paint + semantics）快路径开 / 关各 ≥12 轮，开启 ≤ 关闭的 **50%**（目标值）。
6. **主线不退化**：`flutter test` 全量；`pnpm run typecheck`、`pnpm test`；`mount_bench` / `render_bench` / `theme_switch_bench` 同机对照不回退。
7. **真机对照**（iPhone 12，profile，`fjs run ios -- --profile`，hello-js 4050 屏 `__flat4050.setFlat('off')`，`bump(200)` / `bump(2000)`
   各 ≥4 次，frame-timeline）：UI 线程最长帧开启 ≤ 关闭的 **50%**（目标值）。开关用 dev 宿主函数免重编。
8. 文档：`docs/architecture.md`（重建粒度一节补「只改文字内容」）、`docs/performance.md`、`docs/roadmap.md`。

## 7. 待澄清

已决（沿用 194 的做法与用户「按你的想法来」的授权）：

1. 判定与回退保守：拿不准一律回退；空 ↔ 非空一律回退（可见性要父节点重建）。
2. 开关：`--dart-define=FJS_TEXT_ONLY=off` + dev 宿主函数 `fjs.dev.textOnly`（release 不注册），与 194 的 `fjs.dev.paintOnly` 并列。
3. 实现落点：与 194 同一个文件 `render/paint_only.dart`（改名不做，注释写清两条快路径共用钩子与统计），`FjsPaintOnlyStats` 增加 `text*` 计数。
4. 与 194 / 193 的关系：194 是同一思路的前一步（叠在其分支之上，复用 `peek` / 下探 / 统计）；193 / 195 互不依赖；合并顺序 193 → 194 → 195 → 196。

## 结论

### 离线（`test/text_bump_bench_test.dart`，JIT，含 semantics 阶段，4050 网格，min of 10，两次独立运行）

| 改的格数 | 关闭 | 开启 | 开 / 关 | 节点 build |
|---:|---:|---:|---:|---:|
| 200 | 9.0–9.8 ms | 6.5 ms | 66–72% | 400 → **0** |
| 2000 | 53–57 ms | 33.5–34 ms | 59–64% | 4000 → **0** |

BUILD 阶段消掉（2.2 / 19–22 ms → 0），剩下的是这类更新固有的成本：新文字的段落排版（`layout` 16.5 ms / 2000 个新段落）与语义标签真的变了
（`semantics` 10.8 ms）。spec §6.5 的「≤ 50%」目标在离线值得校准为「≤ 70%」：BUILD 之外没有可省的了。

### 真机（iPhone 12，profile，hello-js 4050 屏，`__flat4050.setTextOnly('off'|'on')`，每种 4 次，frame-timeline）

| UI 线程最长帧 | 关闭 | 开启 | 开 / 关 |
|---|---:|---:|---:|
| `bump(200)` | 31.2 / 30.5 / 29.8 / 28.0 ms | 24.3 / 23.4 / 22.9 / 22.8 ms | **78%** |
| `bump(2000)` | 48.9 / 47.3 / 46.7 / 46.2 ms | 18.6 / 17.3 / 15.4 / 15.3 ms | **38%** |
| BUILD 最长（200 / 2000） | 12.2 / 39.0 ms | 0.3 / 0.1 ms | |
| LAYOUT 最长（200 / 2000） | 15.9 / 44.0 ms（含嵌套 BUILD） | 6.0 / 12.1 ms | |
| PAINT 最长（200 / 2000） | 14.4 / 5.2 ms | 17.6 / 7.1 ms | |
| 光栅线程最长（200 / 2000） | 11.9 / 6.5 ms | 11.8 / 9.6 ms | |

`bump(2000)`：UI 帧 48.9 → 18.6 ms，从掉三帧变成一帧；`bump(200)` 只降了 22%：这时 PAINT（14–17 ms，5 行 × 40 个段落重画）是大头，
快路径够不着——那是绘制成本，下一步要靠分块 / 保留层（自绘表面的方向），不是减重建。

### 验收核对

| # | 条目 | 结果 |
|---|---|---|
| 1 | 对拍 | ✅ `text_only_test.dart` 16 例：同宽 / 变宽 / 变窄 / 多行 / 回原文、`text-transform` / `text-align` / `max-lines` / 省略、同串共享 painter、`:active` 容器、同帧改字与改色、flat 子树内；逐步逐节点矩形 + 逐像素。变异检验：不换 span → 对拍报矩形不一致；让 button 规则失效 → 回退原因计数断言失败 |
| 2 | 不重建 widget 链 | ✅ 200 个文字节点 `buildCount` 0（目标 ≤ 10%），关闭时对照 > 200 |
| 3 | 回退完整 | ✅ 空 ↔ 非空、richSpans、span、htmlBlock、button 子树、`display: contents` 父、transition、按下中，各一例（含原因计数与画面一致） |
| 4 | 语义与度量 | ✅ 语义标签随新文字更新；变多行时父节点高度变大 |
| 5 | 离线对照 | ⚠️ 59–72%（目标 ≤ 50% 校准为 ≤ 70%，见上） |
| 6 | 主线不退化 | ✅ `flutter test` 771 通过；`pnpm run typecheck`、`pnpm test` exit 0。**4 个既有测试（`button_label_test`、`node_rebuild_test`、`nav_router_test` ×2）固定的是普通路径的标脏与「在 widget 树里能找到新文字」，已显式关掉快路径（它们的注释写明原因）** |
| 7 | 真机对照 | ⚠️ `bump(2000)` 38%（达标）；`bump(200)` 78%（未达 50%，PAINT 为大头，见上） |
| 8 | 文档 | ✅ |

### 已知差异：widget 树里的文字是旧的

快路径只改 RenderObject，element 持有的 widget 仍是旧文字。渲染、语义标签、几何（`fjs.ui.rect`）、之后任何一次重建都读 RenderObject / 当前节点，不受影响；
**但按 widget 找文字的 Flutter 测试（`find.text`）会看到旧值**。本仓库 4 个测试因此显式关掉了快路径。若某个使用 `flutter_fjs` 的宿主有这类 Dart 测试，
可以 `--dart-define=FJS_TEXT_ONLY=off`（或在测试里设 `fjsTextOnlyEnabled = false`）。194 的换色没有这个问题（颜色不在 `find` 的匹配里）。
