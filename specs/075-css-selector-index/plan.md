# Plan: CSS 匹配按最右复合选择器建规则索引

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不涉及（行为不变） | 只改 App 侧引擎内部的候选集选择，不改匹配结果；web 用浏览器原生 CSS 不经过此引擎；两端对拍由既有测试保证 |
| II 边界即契约 | 不涉及 | op 协议 / natives 表 / 事件类型零改动 |
| III 同步单线程零序列化 | 不涉及 | 索引是同步路径上的纯内存 Map，注册时增量建、匹配时查；无新异步、无序列化 |
| IV 外观照 WeUI | 不涉及 | 不改任何默认样式数值 |
| V 静默失效是 bug | **涉及（核心风险）** | 索引必须保守：候选集只能是真匹配集的**超集**。凡主体（最右复合）拿不出确定 key 的选择器（无 class 无 tag、`[class*=…]` 等）一律进兜底桶恒扫。专项测试覆盖"最怪的选择器仍然生效" |
| VI 注释记录权衡 | 涉及 | `style.ts` 索引处写明"为什么按主体第一个 class 入桶是安全的"（主体要求全部 subject classes → 用第一个做 key 是必要条件的无损下钻）与兜底桶的存在理由 |
| VII JS 能包就不要下 Dart | 不涉及 | 纯 JS 层（fjs-runtime）优化，根本不下 Dart |
| VIII 变更落到文档 | 涉及 | `docs/vant-mount-perf.md` 补实测结果、`docs/performance.md` 已知热点更新；`css-compat.md` 支持矩阵无语义变化，不动 |

无破例。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/css/style.ts` | 新增规则分桶索引（class 桶 / tag 桶 / 兜底桶，plain 与 pseudo 各一套）；`register()` 增量入桶；`matchRules()` 与伪元素扫描从全量 `for…of this.rules` 换成候选桶遍历 |
| JS runtime（测试） | `packages/fjs-runtime/test/css-selector-index.test.ts` | 新增专项用例（spec 第 6 节第 3 条清单） |
| 文档 | `docs/vant-mount-perf.md`、`docs/performance.md` | 落实测数字，热点清单更新 |

CLI/构建、web 适配层、C++ 引擎、Dart 宿主：**零改动**。

## 3. 方案

### 数据结构

```ts
/** One kind of candidate index (plain rules and pseudo rules each get one). */
interface RuleBuckets {
  byClass: Map<string, CssRule[]>; // key = the SUBJECT compound's first class
  byTag: Map<string, CssRule[]>;   // key = the SUBJECT compound's tag
  catchAll: CssRule[];             // subject has neither class nor tag
}
```

- **入桶规则（保守方向）**：对选择器的主语复合（`compounds[compounds.length-1]`）：
  - 有 class → 入 `byClass[第一个 class]`。安全性：主体匹配要求元素持有主体的
    **全部** class（`matchCompoundFrom` 对 `c.classes` 是 every-has），所以"元素
    有第一个 class"是"该选择器可能匹配"的必要条件——漏桶不可能漏掉真匹配。
  - 无 class 有 tag → `byTag[tag]`。
  - 都没有（`*`、`[class*=…]` 主体）→ `catchAll`，恒扫。
- **一条规则多个选择器**：按每个选择器各入一次桶（可能进多个桶）。匹配时的
  去重用规则对象上的一个内部 stamp 字段（`type IndexedRule = CssRule & {
  bucketStamp?: number }`，定义在 style.ts 内部，parser.ts 不动）：每次
  `matchRules` cache-miss 自增一个 epoch，候选遍历时跳过 stamp 已等于当前
  epoch 的规则。重复访问本身也是语义无害的（同一规则同 spec 重复入 cascades、
  折叠声明是幂等覆盖），stamp 只是省时间。
- **增量维护**：`register()` 在现有 `this.rules.push(...parsed)` /
  `pseudoRules.push(r)` 的同一处把新规则入桶。规则只有追加、没有删除
  （`matchEpoch++` + `matchCache.clear()` 照旧），无需重建。
- **匹配侧**：`matchRules()` 未命中时，候选遍历顺序 = 元素每个 class 查
  `byClass` → 元素 tag 查 `byTag` → `catchAll`；桶内循环体与现在的全量循环体
  逐字相同（media 过滤、scope 检查、`matchSelector`、plain/active/hover
  分装、spec+order 排序）。pseudo 扫描对 pseudo 桶做同样替换。
- **复用现有 scratch 惯例**：plain/active/hover 收集数组提升为实例字段
  （照 `walkStack` 的先例），避免每次 miss 分配。

### 被否掉的备选

- **链缓存跨卸载保留**（LRU）：只治重开不治首开，且引入内存驻留的取舍，
  另立 spec（见 Non-goals）。
- **按需注册样式**：应用层改造，miss 单价没变，vant 场景规则集也缩不下来。
- **倒排索引到"祖先链"或做成预编译 matcher**：复杂度数量级上升，收益边际；
  先用最简单的"必要条件下钻"，量不够再升级。
- **给 `matchCache` 换键/扩键以减少 miss**：spec 075 的验收明确 miss 数不变，
  这是另一类改动（属于 002-style-slots 那条线）。

## 4. 风险

- **级联顺序静默改变**（最高风险）：候选集必须稳定覆盖全部真匹配。防线：
  (a) 保守入桶 + 兜底桶；(b) 既有 `css.test.ts` 的级联/覆盖测试原样全过；
  (c) 专项测试里放"同一元素同时命中多个桶、按 specificity + 源顺序折叠"的
  断言；(d) 验收里对比 `matchMiss` 总数不变——漏桶会直接表现为样式丢失，
  在 demo 对拍和既有用例里都会炸。
- **重复入桶导致重复匹配**：stamp 去重；即使失效也只是幂等重复，语义不坏。
- **性能回退（小规则集页面）**：索引查询是 1–3 次 Map.get；`examples/bench`
  小规模基准对照（spec 验收 5）兜底。

## 5. 验证路径

```bash
# 1. 单测 + 类型
pnpm test                                   # fjs-runtime + cli 全量
pnpm --filter @ufjs/runtime run typecheck   # 或仓库根 pnpm run typecheck

# 2. 小规则集不回退（examples/bench，fjsrun 需先编 native）
cd packages/flutter_fjs/native
cmake --build build-native -j
cd ../../../examples/bench && pnpm run build
../../packages/flutter_fjs/native/build-native/fjsrun --pump 8000 dist/app/bundle.js

# 3. demo 实测（docs/vant-mount-perf.md 附录流程，iPhone 17 模拟器 + fjs go）
cd demo && pnpm run dev
# fjs-go 连接后依次打开 vant-basic/form/more/nav，
# 记录 [nav] mounted 与 CSS flush 数字，与优化前表格对读
```
