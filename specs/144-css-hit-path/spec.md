# Spec: 样式引擎命中路径瘦身

- **ID**: 144-css-hit-path
- **状态**: done
- **日期**: 2026-09-28

## 1. 要解决什么

specs/119（构建期样式预热）之后，vant 页首开时 match miss 只剩 0–2 次，也就是规则匹配基本都
命中了缓存，但样式引擎这一段仍然不便宜：

- 离线 bench（`pnpm --filter demo run bench:mount`，prewarm 模式，本机 Mac）：vant-form 首帧 CSS
  **9.1 ms**、vant-basic 4.7 ms。
- 真机（iPhone，`fjs run ios --profile`，specs/143 的分段探针，3 轮平均）：CSS 段 vant-basic 17.3 ms、
  vant-nav 16.5、vant-watermark 11.1、nutui-basic 20.3、nutui-button 17.0 ms（preload 关）。
  它是打开页面时仅次于 Vue 挂载的第二大块。

在 fjsrun 里对 prewarm 冷挂载做了自耗时剖析（临时插桩，未提交），vant-form（180 次 recompute，
match 命中 179、miss 1；compute 命中 138、miss 42；flush 共 11.4 ms）：

| 环节 | 自耗时 | 说明 |
|---|---:|---|
| `applyStyle`（renderer 回调：编码 SetStyle / DefineStyle 等） | **4.25 ms** | 每元素约 24 µs |
| `compute`（级联合成） | **3.65 ms** | 基本都是那 42 次 compute miss |
| `matchRules` + `buildChainKey` + `prevSiblingSig` + `structuralBits` | 2.5 ms | 命中路径的固定开销 |
| `markDirty` / `recomputeSubtree` / `retainChain` / `releaseChain` / `recompute` / `flushPending` | 1.8 ms | 记账 |

进一步拆开：

1. **编码：`DefineStyle` 的 UTF-8 编码走纯 JS 慢路径。** 设备和 fjsrun 的引擎都没有 `TextEncoder`，
   `utf8Encode` 退回到两遍逐字符的 JS 循环，实测约 **0.17 µs / 字符**。vant-form 首开要定义 243 份样式、
   共 20 K 字符的 JSON，约 3.4 ms，占 `applyStyle` 的大头。`JSON.stringify` 本身是原生的，只占 0.36 ms。
   specs/118 已经给 SetText / SetProps 做了"ASCII 直接写进帧缓冲"（`OpWriter.str`），`DefineStyle`
   （`ui/ops.ts` `styleId()`）没有用上。
2. **计算：带 inline 样式的元素永远不走缓存。** `compute()` 只对 `s.inline === undefined &&
   s.inlineCustom === undefined` 的元素用 `byParent` 记忆，构建期快照也只导出这类元素的结果。
   vant 的 Slider / Rate / Field 等组件大量写 `:style`，vant-form 的 42 次 compute miss 就是它们，
   每次都完整跑一遍级联（继承、变量解析、em / calc 折算）。
3. **命中路径的固定开销**：每个元素仍要拼 chain key 字符串、查两张 Map、算 sibling / structural
   签名，约 14 µs / 元素（本机）。

## 2. 不做什么（Non-goals）

- 不改 CSS 语义：选择器、级联、继承、变量、`:active` / `:hover` / 伪元素的结果一律不变；
  match miss / compute 结果是回归哨。
- 不把样式引擎搬进 C / Dart（上一轮讨论过的大方向，另议）。
- 不改 Vue 挂载与元素层（spec 118 已做）、不改快照导入 / 预执行（spec 119 / 143）。
- 不做 IFR / 首帧快照。
- 不处理"每页关闭后堆增长约 1.5 MB"（已单独立项）。

## 3. 用户可见的行为

页面代码零改动，渲染结果逐像素不变（两端）。可观察的只有耗时：

```text
# bench:mount prewarm 模式，vant-form 冷挂载同步段
改前  css   9.1   ...
改后  css ≤ 5.0
```

`[nav] mounted` 相应下降；op 帧里 `DefineStyle` 的字节内容不变（只是生成方式变了）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 样式引擎（`css/style.ts`）与 op 编码（`ui/ops.ts`）内部优化，结果不变 | 不涉及：web 用浏览器自己的 CSS，不经过本引擎和 op 协议 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无新增 | 无新增 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——`DefineStyle` 的字节格式不变（u32 id + u32 长度 + UTF-8
  JSON），只改 JS 侧的写法；若 plan 阶段决定改格式（例如样式二进制编码），需同时改两端并升 `uiOpsVersion`
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（按当前设想）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；`packages/fjs-runtime` 现有样式 / 快照 / ops 单测全部不改期望值
   即通过（语义不变的证据）。
2. 新增单测：`DefineStyle` 对 ASCII 与非 ASCII（CJK、emoji）样式写出的字节与改前逐字节一致；inline 样式元素
   的计算结果在命中缓存与重新计算时相同（含 inline `--x` 变量、em、calc）。
3. `pnpm --filter demo run bench:mount`（prewarm 模式）：vant-form 首帧 CSS 从 9.1 ms 降到 **≤ 5 ms**，
   其余四页不回退；五页 match miss 数与改前一致（1 / 0 / 1 / 1 / 20）。
4. `cd packages/flutter_fjs && flutter test` 通过（先编 native，确认不是 `No tests ran`）。
5. 真机 `fjs run ios --profile`：vant-basic / nav / watermark / nutui-basic / nutui-button 首开 `[nav] mounted`
   与 specs/143 的数据相比下降，且页面外观与改前一致（逐页截图对比）。
6. `docs/vant-mount-perf.md` 补一节：剖析表、改动、前后对比。

## 7. 待澄清

- [x] **Q1 范围** → 先做 (a) `DefineStyle` ASCII 直写 + (b) inline 样式元素的结果进缓存 / 快照；量完再决定 (c)。
- [x] **Q2 目标值** → vant-form 首帧 CSS（bench prewarm，本机）9.1 → **≤ 5 ms**。
- [x] **Q3 分支基线** → 从 main 切 `144-css-hit-path`。
