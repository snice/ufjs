# Spec: flush 重算的同形兄弟共享

- **ID**: 147-style-sibling-sharing
- **状态**: done（目标按实测修订，见 §7 Q2）
- **日期**: 2026-09-28

## 1. 要解决什么

specs/146 之后，4050 元素同屏页（`examples/hello-fjs` 的 `example/interaction/flat-4050`）在 iPhone 12
`--profile` 上显示时 JS 为 163–175 ms，其中样式引擎的 flush 重算约 **45.5 ms**，是 Vue 之外最大的一块。
这 4150 个元素只有 3 种样式，重算基本都命中缓存，但**每个元素仍各自把命中路径走一遍**。

离线（`examples/bench` 的 `flat-bench`，fjsrun，Mac）对 flush 内部做了临时计时（嵌套包装，绝对值虚高，
看占比）：

| 环节 | 仅页面规则 | +结构伪类 / 兄弟规则 |
|---|---:|---:|
| flush 总计（不含包装） | 24 ms | 42 ms |
| `matchRules`（含下列三项） | 18.7 | 51.8 |
| ├ `buildChainKey`（每元素拼一次签名字符串 + 父链 key） | 6.2 | 21.7 |
| ├ `structuralBits`（每元素调 **3 次**） | — | 11.5 |
| └ `prevSiblingSig`（每元素调 **2 次**，每次现拼前一个兄弟的签名，`prevElementSibling` 从头找下标） | — | 17.7 |
| `compute` 里 `matchRules` 之外（byParent 命中后拷字段） | ~6 | ~6 |
| `applyStyle`（编码 SetStyle op） | 9.2 | 9.7 |

现象：

1. **同一父节点下签名相同的兄弟重复做同一件事。** 一行 40 个 `.cell`，每个都要算 selfSig、拼 chain key、
   查 `chainIds` / `matchCache` / `byParent`，得到的是同一个 MatchResult 和同一个 computed style。
2. **开了结构 / 兄弟规则后命中路径贵一倍。** app 只要注册了任何 `:first-child` / `+` 规则（hello-fjs、
   vant 都会），每个元素的 `prevSiblingSig` 就要现拼字符串、`prevElementSibling` 线性找自己的下标
   （一行 40 个是 O(n²)），`structuralBits` 被同一次重算调三次。

## 2. 不做什么（Non-goals）

- 不改 CSS 语义：每个元素最终的 computed style、`:active` / `:hover` / 伪元素样式与发出的 op 帧必须与改前
  逐字节一致。
- 不改 Vue、渲染器挂载顺序、元素层与 op 协议；不改 `applyStyle` 的编码（op 编码另议）。
- 不做 uni-app x 式拍平，不把样式引擎下沉到 C / Dart。
- 不改构建期样式快照的格式（specs/119）。

## 3. 用户可见的行为

页面代码零改动，渲染结果不变。可观察的只有耗时：

```text
# examples/bench flat-bench（fjsrun，Mac，min）
page-rules             style.flush  24 → ≤ 12 ms
with-structural-rules  style.flush  42 → ≤ 20 ms

# 真机 flat-4050 页，显示
样式 flush 45.5ms → ≤ 25ms；js 170ms → ≤ 150ms
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `css/style.ts` 内部优化，结果不变 | 不涉及：web 用浏览器 CSS |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无新增 | 无新增 |

小程序端不经过本引擎。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及；`StyleEngine` 公开方法与 `stats` 字段保持兼容（计数口径若变，写进文档）。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；现有样式 / 快照 / 渲染器单测不改期望值。
2. 新增对拍单测：同形兄弟构成的行（含 `:first-child` / `:last-child` / `:not(:first-child)` / `+`——引擎只支持这几种位置相关选择器，`:nth-child` / `~` / `:empty` 在解析时就被跳过、
   `:active`、`:hover`、伪元素、scoped、继承与变量、inline style 混入其中、兄弟之间 class 不同），
   按挂载、插入到中间、keyed move、改其中一个的 class、删首尾几种变化，每个元素的样式与 op 帧与
   「逐元素完整计算」的参照一致；参照组不走被测的共享路径。
3. `examples/bench`：`style.flush` 两个变体达到 §3 目标，帧字节数不变；其余 `[bench]` 各项 min 不回退超过 5%。
4. `pnpm --filter demo run bench:mount`（prewarm）：五页 CSS 段不回退，match miss 数不变。
5. `cd packages/flutter_fjs && flutter test` 通过。
6. 真机 `fjs run ios --profile -d 00008101-000978E201FA001E`：flat-4050 显示 3 次达到 §3 目标；
   theme 页、vant 页外观与改前一致（截图对比）。
7. `docs/performance.md` 的 4050 元素一节补上本次结果。

## 7. 待澄清

- [x] **Q1 范围** → (a) 同父同形兄弟直接复用前一个兄弟的结果 + (b) 结构 / 兄弟规则下的签名计算做便宜
  （`prevSiblingSig` 复用兄弟已缓存的签名、`prevElementSibling` 不再线性找下标、一次重算只算一次
  `structuralBits`）。
- [x] **Q2 目标值** → 离线 `style.flush` 页面规则 24 → ≤ 12 ms、+结构规则 42 → ≤ 20 ms；
  真机 flush 45.5 → ≤ 25 ms，显示 JS 170 → ≤ 150 ms。
  - **实现中修订（用户确认）**：逐方法计时后，页面规则下 flush 的地板是 `applyStyle`（op 编码，
    Non-goal）6.5 ms + compute 3.4 ms + recompute 自身 2.8 ms ≈ 13 ms，≤ 12 ms 在本范围内不可达。
    离线目标改为按实测收尾：页面规则 **≤ 19 ms**、+结构规则 **≤ 31 ms**；真机按实测记录。
    op 编码另立 spec。

## 8. 结果（2026-09-28）

离线（`examples/bench`，fjsrun，Mac，min）：

| | 146 后 | 147 |
|---|---:|---:|
| flat-4050 `style.flush`，页面规则 | 23.7 ms | **18.7 ms** |
| flat-4050 `style.flush`，+结构 / 兄弟规则 | 42.9 ms | **30.2 ms** |
| flat-4050 挂载总计（页面规则 / +结构） | 87 / 108 ms | 81 / 94 ms |
| `style-mount-1000-rows` | 50.6 ms | **43.2 ms** |
| `theme-switch-class` | 20.6 ms | **18.0 ms** |
| `theme-switch-cascade-only` | 15.3 ms | **12.9 ms** |
| 其余 `[bench]` | — | 噪声内 |
| 帧字节 | 175166 B | 175166 B |

`bench:mount`（prewarm）五页 CSS 段 3.8/2.1/4.5/2.5/3.5 ms，match miss 1/0/1/1/20，与 146 后一致。

真机（iPhone 12，`--profile`，flat-4050 显示 3 次）：

| | 146 后 | 147 |
|---|---:|---:|
| 样式 flush | 45.5 ms | **35.5–37.0 ms** |
| JS | 163–175 ms | **152–166 ms** |
| 点击→上屏 | 298–332 ms | 282–316 ms |

对拍单测 `style-sibling-sharing.test.ts` 5 条；逐条去掉共享条件（classes / scopes / 首尾位 / `+` 邻居 /
tag / attrs）各自至少一条失败。`matchedParentChainId` 条件与 memo 的分桶键重复，属防御性冗余。
