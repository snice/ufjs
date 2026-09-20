# Spec: CSS 计算段分配瘦身 + 链缓存跨卸载保留

- **ID**: 076-css-compute-diet
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

specs/075 把 vant 页首开的 CSS 匹配段从 ~240 ms 压到 7.2 ms 之后，剩余的账
（vant-form，iPhone 17 模拟器，带子段打点实测）：

| 段 | 耗时 | 说明 |
|---|---:|---|
| compute: **custom 拷贝** | **30–35 ms** | 每次 compute miss 把父级的 custom 属性表**整个拷一遍**——vant 的 `--van-*` token 表实测 **494 个键**，286 次 miss ≈ 14 万次属性拷贝/页 |
| compute: vars+em | 6.9 ms | `resolveVars` **无论有没有 var() 都先 `Object.entries` + 整份拷贝**再判断 |
| compute: merge/keys/pseudo | ~2 ms | 四层 spread、`Object.keys` ×3 |
| 未对账（GC 等） | 82 ms/轮且**逐轮爬升** | 连续开关 4 次 vant-form，flush 总量 223→305→388→467 ms 线性涨，attributed 段恒定——分配驱动的全堆回收 |

另外重开同一页依旧全款：卸载即逐出链缓存（075 遗留的方向②）。

## 2. 不做什么（Non-goals）

- **不做** style-slots（specs/002 的设计：让计算规模跟"多少种样式"走）——那是
  结构性改造，本 spec 只做分配瘦身。
- **不做** GC 阈值宿主配置（specs/001 待澄清 b）——产品决策，单独立项。
- **不做**页面级样式注册（方向③）——应用层组织方式，另立 spec。
- **不改**任何匹配/级联/继承语义：每个元素的最终 computed style 逐位不变。

## 3. 用户可见的行为

页面代码零变化。可观察变化只有速度与 GC 抖动幅度：

- vant-form 首开的 CSS flush attributed 段（custom+merge+vars+em+pseudo+keys）
  从 ~39 ms 降到 ≤ 15 ms；
- 重开同一 vant 页的 CSS flush 从 ~39 ms 降到 ≤ 5 ms（链缓存命中）；
- 连续开关页面的 flush 总量不再逐轮线性爬升（分配少了，GC 少了）——此项
  只记录现象，不作硬性验收（GC 落点有运气成分，见 performance.md 的口径）。

## 4. 两端约定（宪法 I）

| | Flutter（App） | Web |
|---|---|---|
| 行为 | CSS 引擎内部实现优化，样式结果逐位不变 | 浏览器原生 CSS，不受影响 |
| 已知差异 | 无新增 | 同左 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm test` 全绿；`zz_leak_probe.test.ts` 原样通过（其基线取自第一轮
   循环之后，LRU 同键复用对它透明——这是设计要求，不是巧合）。
2. `pnpm run typecheck` 通过。
3. 新增测试（`css-compute-diet.test.ts`）覆盖：
   - custom 共享：元素不自带 custom 属性时与父级共享同一张表（含
     `--var` 继承链照常工作、var() 解析结果不变）；
   - 自带 `--x` 声明（规则级或内联级）的元素得到独立合并表，且父级表
     不被写穿（copy-on-write 语义）；
   - `resolveVars` 快路径：无 var() 的样式返回原对象（零分配路径），
     有 var() 的照常解析；
   - LRU：卸载后链缓存保留且重开命中（重开不再全款）；保留量超过上限
     后最老的被逐出；重新引用过的键不再被逐出；`register()` 换样式表后
     保留的缓存条目照旧整体失效。
4. 模拟器 A/B（同打点同方法，reload 后首开取 min-of-3）：vant-form 的
   custom 段 30–35 → ≤ 5 ms、attributed 总段 39 → ≤ 15 ms；重开 vant-form
   的 flush ≤ 5 ms。数字落进 docs/vant-mount-perf.md。
5. `examples/bench`（fjsrun）同机 A/B：style-mount / theme-switch 不回退，
   预期小规则集页面因 resolveVars 快路径略有改善。

## 7. 待澄清

- 无（延续 075 的授权：自动推进）。
