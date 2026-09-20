# Tasks: CSS 匹配按最右复合选择器建规则索引

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 无——本 spec 三张契约表零变更（spec 第 5 节已勾"都不涉及"）。

## 实现

- [x] T010 `packages/fjs-runtime/src/css/style.ts`：新增 `RuleBuckets`
      （byClass / byTag / catchAll）与入桶函数；`register()` 在规则路由处
      增量入桶（plain 与 pseudo 各一套）。
- [x] T011 `packages/fjs-runtime/src/css/style.ts`：`matchRules()` 的全量
      `for…of this.rules` 换成候选桶遍历（stamp 去重），循环体保持逐字等价；
      收集数组提升为实例 scratch 字段（照 `walkStack` 先例）。
- [x] T012 `packages/fjs-runtime/src/css/style.ts`：伪元素扫描对 pseudo 桶
      做同样替换。

## 两端对齐

- [x] T020 Web 侧无对应实现（浏览器原生 CSS 自带索引），行为对拍口径不变；
      既有 `css.test.ts` 84 个用例原样全过（含级联/scope/伪元素/结构位），
      demo 两端渲染对拍口径不变。

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/css-selector-index.test.ts`：
      17 个用例全过（首 class 入桶、裸 tag、兜底桶、多选择器多桶去重、
      跨桶 specificity、media/scope/:deep、伪元素分桶、`:disabled`、
      stamp 跨 miss 复用、vant 形状冒烟）。
- [x] T031 `pnpm test` 全绿：fjs-runtime 584 / fjs 287 / webgl 30 /
      webview 36，既有用例零改动。
- [x] T032 `pnpm run typecheck` 通过。
- [x] T033 `examples/bench` 基准不回归：同机 A/B（stash 对照），
      `style-mount-1000-rows` min 143.8 → 142.8 ms、切主题 34.5 → 35.0 ms。

## 文档

- [x] T040 `docs/vant-mount-perf.md`：新增「优化落地（specs/075）」一节——
      实测前后对比表、miss 数量逐页相等的对照、shared.js 的 release 形态
      与"shared 清单管不住入口依赖"的结论。
- [x] T041 `docs/performance.md`：已知热点清单里首开条目更新（匹配段已修 +
      指向 075 与剩余的计算段）。
- [x] T042 `specs/075-css-selector-index/spec.md` 状态改 `done`
      （验收第 4 条带落地修订说明，见 spec）。

## 验收

- [x] T050 spec 第 6 节逐条核对：1 ✓（584/287/30/36 全绿）、2 ✓、3 ✓（17/17）、
      4 ✓（含修订：匹配段 7.2 ms，miss 逐页相等）、5 ✓（bench A/B 无回退）。
- [x] T051 demo 实测：vant-form 匹配段 240 → 7.2 ms；`[nav] mounted`
      vant-basic 141 / form 228 / more 147 / nav 110 / about 11 ms
      （改前 236/401/364/240/16；波动部分为 GC，对照表在
      docs/vant-mount-perf.md）。
