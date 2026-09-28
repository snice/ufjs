# Plan: flush 重算的同形兄弟共享

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 纯 Flutter 端样式引擎内部；web / 小程序不经过 `css/style.ts` |
| II 边界即契约 | 否 | op 协议、natives、事件类型不动；`StyleEngine` 公开 API 不变；chain key 字符串格式不变（构建期快照 specs/119 依赖它） |
| III 同步单线程零序列化 | 是（维持） | 仍在同一次 `flushPending` 里完成 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 共享错了 = 元素拿到兄弟的样式、不报错。靠对拍单测（参照组关掉共享）+ 变异验证兜住 |
| VI 注释记录权衡 | 是 | 每个共享条件写清它对应 match / compute 的哪一项输入 |
| VII JS 能包就不要下 Dart | 否 | — |
| VIII 变更落到文档 | 是 | `docs/performance.md` 4050 元素一节 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · 样式引擎 | `packages/fjs-runtime/src/css/style.ts` | `flushPending` 加 pass 序号；`matchRules` 兄弟共享；`structuralBits` / `prevElementSibling` / `prevSiblingSig` 降本 |
| 测试 | `packages/fjs-runtime/test/style-sibling-sharing.test.ts`（新） | 对拍 + 变异 |
| Bench | `examples/bench/src/flat-bench.ts` | 不改（已有两个变体） |
| 文档 | `docs/performance.md` | 4050 元素一节补结果 |

## 3. 方案

引擎支持的位置相关选择器只有 `:first-child` / `:last-child`（及其 `:not()`）与相邻兄弟 `+`
（`hasStructural` / `hasSiblingRules` 两个开关，`style.ts` 781–811）。`:nth-child` / `~` / `:empty`
解析时就跳过，所以一个元素的匹配只取决于：自身签名（tag、classes、scopes、attrs）、首尾位（structBits）、
前一个兄弟的签名（prevSig）、父链（parentChainId）。compute 再取决于父 computed style 与 inline。

### 0. pass 序号

`flushPending` 每进一次 `while` 循环体（即每个 dirtyEpoch）就是一轮；元素在 `recompute` 里记下
`s.pass = this.dirtyEpoch`（重算开始时的值）。「本轮已算过」= `s.pass === 当前轮`。下面所有复用都
**只复用本轮算过的兄弟**，因为同一轮里树结构不变（flush 同步执行，期间不会 insert / remove），而
上一轮的值可能已经被移动 / 插入作废。

### 1. 位置下标：每轮每个父节点建一次（spec Q1(b)）

`prevElementSibling` 与 `structuralBits` 都在父节点的 child list 里线性找自己，一行 N 个是 O(N²)。
改为 `siblingIndex(pid)`：返回本轮缓存的 `Map<id, index>`（键：父 id；失效：轮次变化）。本轮树不变，
所以一轮一建是准确的；一行只建一次 O(N)。

`structuralBits` 改为 O(1)：用下标加「前 / 后第一个参与位置的兄弟」判断——等价于现有两次扫描
（跳过无 state 与 rawText 的节点）。为保持完全相同的语义，实现时直接复用现有扫描逻辑但从下标起步，
不改判定规则。

### 2. 一次重算只算一次 structuralBits（spec Q1(b)）

现在三处各算一次：`matchRules` 的开关检查、`buildChainKey` 拼 selfSig、`prevSiblingSig` 算前一个兄弟。
- `buildChainKey` 在 `matchRules` 之后调用，此时 `s.structBits` 就是本轮刚算的值 → 直接读。
- `prevSiblingSig(prev)`：前一个兄弟**本轮已算过**时读它的 `structBits`；否则照旧现算。

### 3. prevSiblingSig 复用（spec Q1(b)）

前一个兄弟本轮已算过时，它的 `tag + classes + scopes + structBits` 字符串已经在它自己的
`buildChainKey` 里拼过一次（selfSig 的前缀，不含 attrs 部分）。给 state 加一个 `sibSig` 字段存这个
**不含 attrs** 的串（和今天 `prevSiblingSig` 拼的完全相同），本轮算过就直接取。chain key 的字符串
格式与今天逐字节相同。

### 4. 同形兄弟共享 match 结果（spec Q1(a)）

在 `matchRules` 里，位置 / 兄弟检查之后、自身缓存命中检查之后、`buildChainKey` 之前：设 `p` 为前一个
参与位置的兄弟。满足以下全部条件时，直接用 `p` 的结果：

| 条件 | 对应的匹配输入 |
|---|---|
| `p.pass === 当前轮` 且 `p.matched` 存在、`p.matchedEpoch === matchEpoch` | p 的结果是本轮、本样式表世代的 |
| `p.matchedParentChainId === parentChainId` | 同一父链（同父节点天然满足，写出来防御） |
| `p.tag === s.tag`、`p.classes === s.classes`、`p.scopes === s.scopes`（**对象同一性**） | 自身签名。classes 来自 `parseClassValue` 的共享缓存、scopes 来自 146 的驻留表，同一性成立就是内容相同；内容相同但对象不同时不共享（退回正常路径，不出错） |
| `p.attrs === undefined && s.attrs === undefined` 或 `attrNames.size === 0` | 属性选择器输入 |
| `!hasStructural` 或 `p.structBits === s.structBits` | 首尾位 |
| `!hasSiblingRules` 或 `p.prevSig === s.prevSig` | 相邻兄弟签名 |

共享时：`s.selfSig = p.selfSig; s.sibSig = p.sibSig; retainChain(s, p.chainKey, p.chainId); remember(p.matched)`。
chain key 与 id 和 s 自己去拼会得到的完全相同（输入逐项相同），所以子孙的 chain key 不受影响。
`stats.matchHit` 照常 +1。

compute 那一半不另做共享：`byParent` 命中本来就是一次 Map 查找 + 字段拷贝，量完不够再说。

### 被否掉的备选

- **把 chain key 换成数字 / 嵌套 Map，彻底不拼字符串**：收益可能更大，但改变 chain key 格式会连带构建期
  快照（specs/119 导出 / 导入按字符串重放），属于契约级改动。否掉，留作后续。
- **Blink 式跨父节点的「表亲」共享**：不同父节点的同形元素已经靠 chain key + `byParent` 共享结果，瓶颈在
  拼 key 本身而不是 rule scan；跨父节点共享要比较父链，条件更多、收益与本方案重叠。否掉。
- **把 structBits / prevSig 放进渲染器维护的增量索引**：要改渲染器与引擎的分工，改面大。否掉。

## 4. 风险

- **共享条件漏一项 = 静默拿错样式。** 表里每一项都对应 `buildChainKey` / `matchRules` 读的一个输入；
  新增匹配输入时必须同步加进来——在 `buildChainKey` 旁写注释指向这张表。对拍单测参照组关掉共享与缓存复用，
  变异验证逐条去掉条件确认会失败。
- **本轮 / 上一轮的混淆**：只信 `pass === 当前轮` 的兄弟。keyed insert 让新元素（id 大）排在旧元素（id 小）
  前面时，旧元素先算、它的前一个兄弟本轮还没算 → 走正常路径，不共享。
- **下标缓存在 flush 中途失效**：flush 期间 `markDirty` 只标脏不改树，树结构不变；下标缓存按轮次失效。
  单测覆盖 flush 中触发第二轮（结构位变化导致 `markDirty(id, true)`）。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
cd examples/bench && npx fjs build && \
  ../../packages/flutter_fjs/native/build-native/fjsrun --pump 20000 dist/app/bundle.js | grep -E '\[flat\]|\[bench\]'
pnpm --filter demo run bench:mount
cd packages/flutter_fjs && flutter test
cd examples/hello-fjs && npx fjs run ios --profile -d 00008101-000978E201FA001E
```

## 附：实现与本 plan 的偏差

1. **§3.4 从「前一个兄弟」扩成「本轮同形缓存」**。实测只看前一个兄弟时，2000 个格子共享了，但每个格子里
   唯一的 text 没有兄弟可比；逐方法计时显示 text 的 key 构建才是剩下的大头。改为 `shapeMemo`：
   `Map<parentChainId, ElementState[]>`（每桶最多 8 个样本、每轮清空），比较条件与 §3.4 的表相同。
   同形的表亲（父节点共享了 chain id）也能命中，挂载一个整齐的 40 格行只拼约十次 key。
2. **去掉「仅限还没有 chain key 的元素」这个前提**。保留时，根节点翻 class 后全体后代重建 key 的场景
   一次都共享不到，还要为每个元素登记样本，`theme-switch-cascade-only` 回退 6%；去掉后
   `retainChain` 负责换掉旧 key，该用例反而 15.1 → 12.9 ms。
3. **§1 下标缓存**：child list ≤ 16 时直接 `indexOf`，不建 Map（一格一个孩子时 Map 分配比扫描贵）。
4. **§2「读本轮已算的 structBits」只用于自身**；前一个兄弟的首尾位照旧现算（有下标后很便宜），因为
   flush 中途 hoist 会挪动兄弟而不重新标脏它。`sibBase` 以集合同一性自校验，四种首尾位后缀各拼一次。
