# Spec: CSS 匹配按最右复合选择器建规则索引

- **ID**: 075-css-selector-index
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

demo 加了 vant 演示后，App 端每次打开 vant 页面都卡 200–400 ms（`[nav] mounted`
日志），转场动画冻在半路。分析（docs/vant-mount-perf.md）定位到：App 侧 CSS
引擎对每个"链签名没见过"的元素做**全量规则线性扫描**——demo 全局注册了 639 条
vant 规则，vant-form 一次首开 ~275 个未命中 ≈ 17.6 万次规则访问 ≈ 299 ms，
占整个挂载耗时的 75%。QuickJS 无 JIT，~1.7 µs/规则访问；页面卸载还会把匹配
缓存逐出，重开同一页照样重付。

普通页面（/about，11 个未命中）无感——问题的本质是**未命中的单价**（每 miss
扫全部规则），vant 只是"一次挂载产生大量新元素签名"的放大器。

## 2. 不做什么（Non-goals）

- **不做**链缓存跨卸载保留（vant-mount-perf.md 优化方向②）：治的是重开，
  不治首开，另立 spec。
- **不做**应用层的按需样式注册（方向③）：改变的是 miss 数量不是单价，
  且是 demo 侧的取舍。
- **不改**任何匹配语义：级联顺序、specificity、scope/:deep、`:active`/`:hover`
  三 Cascade、`::before/::after` 分桶、`@media` 过滤、`:first-child` 等结构位——
  全部维持现状。这是纯性能优化，可观察行为（每个元素的最终样式）必须逐位不变。
- **不动** op 协议、natives 表、事件类型（宪法 II 三张表零变更）。
- **不动** web 侧（浏览器原生 CSS，本来就有索引）与小程序端（Skyline 自己的
  样式系统）。

## 3. 用户可见的行为

页面代码零变化。可观察的变化只有速度：

```vue
<!-- 现状与改后写法完全一致，无需任何迁移 -->
<van-cell-group inset>
  <van-cell title="单元格" value="值" is-link />
</van-cell-group>
```

预期（iPhone 17 模拟器、fjs go、dev 单 bundle，与 docs/vant-mount-perf.md
同口径）：vant 页首开的 CSS 匹配段从 ~140–300 ms 降到 ≤ 30 ms；`[nav] mounted`
总量按页面降到 Vue render + 少量的水平（vant-form ~400 ms → ~100 ms 以内）。
`styleEngine.stats` 的 `matchMiss` 数量**不变**（索引改变 miss 的单价，
不改变 miss 的个数），`rules` 数量不变。

## 4. 两端约定（宪法 I）

| | Flutter（App） | Web |
|---|---|---|
| 行为 | CSS 引擎内部索引，样式结果逐位不变 | 浏览器原生 CSS，不受影响 |
| 事件载荷 | 无变化 | 无变化 |
| 已知差异 | 无新增。两端样式对拍口径不变，由现有对拍测试与 specs/069–073 的落账保证 | 同左 |

本改动不引入任何新的两端差异；`docs/css-compat.md` 的支持矩阵不变。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm test` 全绿（重点：`packages/fjs-runtime` 的 `css.test.ts` 既有级联
   用例一个不改、全过——它们就是"语义逐位不变"的回归网）。
2. `pnpm run typecheck` 通过。
3. 新增索引专项测试（`css-selector-index.test.ts`）通过，覆盖：
   - 多 class 主体按第一个 class 入桶：`.a.b` 对只有 `b` 的元素**不**匹配、
     对 `a b` 都有的元素匹配；
   - 裸标签主体走标签桶：`div` 命中 div、不命中 view；
   - 无 class 无标签主体（`[class*=x]`、`*`）走兜底桶，仍然生效（宪法 V：
     索引必须保守，不允许任何规则变得不可达）；
   - 一条规则多个选择器（`.x, div, [class*=y] { … }`）从三条路都能被找到，
     且跨桶级联顺序与源顺序一致；
   - 跨桶 specificity：`.a`（10）压过 `view`（1），与线性扫一致；
   - 桶内规则照常受 `@media`、scope、`:deep` 约束；
   - 伪元素规则（独立桶）照常只产 `::before/::after`，不样式化元素本身；
   - `:disabled` 主体（解析成 `:disabled` 类）照常工作。
4. demo 实测复跑 docs/vant-mount-perf.md 附录流程：vant-form 的 CSS flush
   从 ~299 ms 降到 ≤ 30 ms，`matchMiss` 总数与改前同量级（±10%）。
   **落地修订**：`matchMiss` 逐页相等（275/276/185 分毫不差）✓；"≤ 30 ms"
   当初写的是整段 flush，实测整段 70 ms——其中**匹配段 7.2 ms**（改前
   ~240 ms，33×），剩余 ~62 ms 是 recompute 计算段（继承/缓存键/比较），
   属于 specs/001/002 那条线的既知热点，不在本 spec 射程内。目标按本意
   （匹配段 ≤ 30 ms）判定达成；整段 flush 的下一刀在计算段，另立 spec。
5. `examples/bench` 样式基准（fjsrun）不回归：挂载/切主题与 performance.md
   记录同量级（小规则集下索引开销应≈0）。

## 7. 待澄清

- 无（用户已明确：自动推进，不问）。
