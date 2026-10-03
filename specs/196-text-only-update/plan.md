# Plan: 「只改文字内容」的更新快路径

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不触发 | Dart 渲染器内部更新路径，画面逐像素不变（对拍） |
| II 边界即契约 | 不涉及 | 不动 op / natives / 事件；`SET_TEXT` 已带新文本 |
| III 同步单线程零序列化 | 满足 | `flushDirty` 里同步完成 |
| IV 外观照 WeUI | 不涉及 | |
| V 静默失效是 bug | 要守 | 只在能证明等价时走；其余一律回退并按原因计数（`FjsPaintOnlyStats.textFallbacks`），测试断言各回退原因真的触发 |
| VI 注释记录权衡 | 要做 | 注释写清：为什么走正常 `text` setter（度量与语义真的变了，和 194 的换色不同）；为什么 transition / `:active` 按下态回退（builder 闭包捕获旧文本 / 按下态样式）；为什么父节点不用标脏 |
| VII JS 能包就不要下 Dart | 例外 | 瓶颈在 Dart 重建（BUILD 77–88% of LAYOUT 阶段） |
| VIII 变更落到文档 | 要做 | architecture / performance / roadmap |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 镜像树 | `lib/src/mirror_tree.dart` | `SET_TEXT`：记旧文本，`classifyTextOnly(node, old, new, tree)` 通过则入 `_textOnly` 集合（不 `_touch`），否则 `_touch`；`flushDirty` 里在 `_flushPaintOnly` 之后处理 `_textOnly`：已在 `_dirty` 里的跳过，其余 `applyTextOnly`，失败回退 `_touch` |
| 快路径 | `lib/src/render/paint_only.dart` | `classifyTextOnly`（回退原因枚举）、`applyTextOnly`（下探找段落、`fjsPlainTextSpec`、正常 setter）；把 194 里「沿自己包装链下探」抽成共用函数 `_ownChain`；`FjsPaintOnlyStats.textApplied / textFallbacks`；开关 `fjsTextOnlyEnabled`（`FJS_TEXT_ONLY=off`）与 dev 宿主函数 `fjs.dev.textOnly` |
| 引擎注册 | `lib/src/engine.dart` | 注册 `fjs.dev.textOnly` |
| 示例 | `examples/hello-js/src/flat4050.ts` | `__flat4050.setTextOnly('on'\|'off')` |
| 测试（新） | `test/text_only_test.dart` | 对拍、build 计数、各回退原因、语义、父级布局 |
| 基准 | `test/text_bump_bench_test.dart`（新） | 4050 同构负载改 200 / 2000 格文字，开 / 关两臂，含 semantics 阶段 |
| 文档 | `docs/architecture.md`、`docs/performance.md`、`docs/roadmap.md` | |

## 3. 方案

沿用 194 的结构：解码时分类、`flushDirty` 里在放信号前就地改、失败回退；父节点不标脏。区别是文字变了度量会变，所以**走 `RenderFjsParagraph` 正常的 `text` setter**
（`markNeedsLayout` + `markNeedsSemanticsUpdate`），由 Flutter 自己沿 RenderObject 链传播重排，不需要像换色那样绕开它们。

回退条件见 spec §3。注意与 194 的差异：194 对「按下中」回退是因为画的是按下态的**颜色**；这里文字节点按下中画的是按下态**样式**（例如 `:active` 改色），
`fjsPlainTextSpec` 用基础样式得到的 span 会把颜色画错，所以按下中同样回退（`node.pressed`）。

### 被否掉的备选

| 备选 | 否掉原因 |
|------|---------|
| 让 `_touch` 对 text 节点不标父节点（不分类） | 空 ↔ 非空要父节点重建（isHidden 过滤）、button 标签与 span 段落要祖先重建；不分类就会静默丢更新 |
| 把文字内容也放进 194 的 paint-only 判定 | 换色可以绕开 `markNeedsLayout` / `markNeedsSemanticsUpdate`，换字不行；混在一起会让 194 的「不触发语义更新」语义变得含糊 |
| 在 `_FjsNodeViewState.build` 里改 RO | build 阶段改 RO 不安全（同 194） |

## 4. 风险

- **静默丢更新**：回退条件漏一个，就会出现「文字没变」。对策：每个回退一例 + 对拍随机序列（空 ↔ 非空 / 多行 / 变宽混在一起）。
- **共享段落缓存的引用计数**：`text` setter 走 `performLayout` 的 acquire / release，与现有路径同一机制，无新增生命周期。
- **与 194 的相互作用**：同一帧里既改色又改字（`SET_STYLE` 与 `SET_TEXT` 都到同一节点）：两个集合都可能含该节点；`_flushPaintOnly` 先于 `_flushTextOnly`，且 194 的换色走惰性 `_recolored`，随后文字的 setter 会清掉 `_recolored`（新 span 来自当前样式，已含新颜色）。对拍覆盖。
- **文本环境**：`fjsPlainTextSpec` 返回 null（选择区、`overflow: fade`）→ 回退。

## 5. 验证路径

```bash
cd packages/flutter_fjs
flutter test test/text_only_test.dart test/paint_only_test.dart test/shared_paragraph_test.dart
flutter test
flutter test --dart-define=FJS_BENCH=true test/text_bump_bench_test.dart test/theme_switch_bench_test.dart test/mount_bench_test.dart
pnpm run typecheck && pnpm test

# 真机（iPhone 12，profile，连 dev server）
cd examples/hello-js
npx fjs run ios --device 00008101-000978E201FA001E --port 38903 -- --profile
npx fjs eval --port 38903 "__helloTab(0)"; "__flat4050.setMode('clone')"; "__flat4050.setFlat('off')"; "__flat4050.show()"
npx fjs eval --port 38903 "__flat4050.setTextOnly('off'|'on')"; "__flat4050.bump(200)" / "bump(2000)"
node ../../packages/flutter_fjs/tool/frame-timeline.mjs <VM URL> 12
```
