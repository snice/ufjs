# Spec: 首开剩余——FjsStyleEntry 解析驻留 + compute miss 再瘦

- **ID**: 084-first-open-resolved-cache
- **状态**: done
- **日期**: 2026-09-20
- **前身**: [075-css-selector-index](../075-css-selector-index/spec.md)、
  [076-css-compute-diet](../076-css-compute-diet/spec.md)
- **相关**: [001-restyle-performance](../001-restyle-performance/spec.md)
  （GC 阈值已否决，本 spec 不重开）

## 1. 要解决什么

`485cab`（specs/075–076）把 vant 页首开的 **CSS 匹配**从全表扫描改成主体分桶
之后，转场仍然会冻一下。2026-09-20 iPhone 17 模拟器、`fjs run ios`（debug）、
页面 chunk 已预热，临时打点拆开 `[nav] mounted` 与下一帧 first-paint：

| 页面 | mounted | Vue mount | CSS flush | Dart applyFrame | first-paint | 镜像节点 |
|---|---:|---:|---:|---:|---:|---:|
| /about | 8 ms | 2 ms | — | — | 11 ms | 51 |
| vant-form **首开** | **259 ms** | 40 ms | **37.4 ms** | **7.5 ms / 87 KB** | **57 ms** | **598** |
| vant-form 重开 | 132 ms | 41 ms | 16.7 ms（match miss 0） | 1.3 ms | 28 ms | 598 |

vant-form 首开 CSS 计数：`recompute 360`，compute hit/miss `74/286`，
match hit/miss `85/275`，`rules=639`。**miss 次数与 075 逐页相等**——匹配
语义没退，匹配也不再是主因。

对得上账的三段是：

1. **Vue 建树 ~40 ms**（每次 `app.mount` 都付，重开也是 41 ms）。
2. **CSS flush ~37 ms**，几乎全是 **compute miss**（286 次），不是 match。
   076 已经砍掉 custom 表整份拷贝和 `resolveVars` 无 `var()` 的快路径；
   miss 路径还在付继承表、四层 spread、`Object.keys`、`:active`/`:hover`/
   伪元素再走一遍、360 次 `applyStyle` 编码。
3. **下一帧 Flutter 首建 ~57 ms / 598 节点。** `[nav] mounted` 不含这一段。
   `FjsStyleEntry` 的注释已经写了「widget 层把解析过的 Flutter 值缓存在它
   上面」，但类上只有 `id` + `map`——解析缓存在 `style_parse.dart` 按**值**
   记忆，每次 build 每个节点仍 `FjsStyle.of` 再跑一遍 getter →
   `decorateNode` 包装。重开 57 → 28 ms，说明值缓存热了，**按 styleId 驻留
   的派生对象还没有**。

`applyFrame` 首开 7.5 ms（`utf8.decode + jsonDecode` 每种 interned 样式一次）
重开掉到 1.3 ms，已经是「每种样式一次」；再压要动 op 协议，不在本 spec。

mounted 里对不上的 ~170 ms 是 QuickJS 全堆 GC（工作量固定、耗时抖，和
`docs/performance.md` / 001 同一签名）。**本 spec 不碰它。**

## 2. 不做什么（Non-goals）

- **不动 QuickJS GC 阈值 / 空闲回收 / 宿主可配堆策略。** 001 待澄清已否决，
  保持引擎默认。
- **不做 style-slots（002）。** 那条把重排规模从节点数换成样式数，治的是
  「主题切换算 3330 遍」；vant 首开本来就是 miss，槽稳定不了。
- **不改 op 协议。** 不为 `DEFINE_STYLE` 换二进制编码，不升 `uiOpsVersion`。
- **不改 Vue 挂载路径**（每次 push 仍 `app.mount`）。40 ms 是框架账，另立项。
- **不让 `scroll-view` 变懒。** 001 已登记：会改 `justify-content` /
  `align-items` / intrinsic / `gap` 语义，单独立项。vant-form 也不是
  「一屏十几行」的长列表，懒构建对首屏帮助有限。
- **不做页面级 vant 样式注册。** 改变 miss 数量不是单价；demo 插件组织另立项。
- **不改任何匹配 / 级联 / 继承 / 绘制语义。** 每个节点的最终样式和 widget
  外观逐位不变。`css.test.ts` 与现有 widget 对拍一个不改。
- **不动 web / 小程序。** 浏览器和 Skyline 有自己的样式与布局，本 spec 的
  两刀都在 App 管线上。

## 3. 用户可见的行为

页面代码零变化。可观察的只有速度：vant 页 push 转场少冻一截，首帧内容更快
画完。写法仍是现在这样：

```vue
<route>
{"title": "vant: form"}
</route>
<template>
  <scroll-view class="page" scroll-y>
    <van-cell-group inset>
      <van-field v-model="name" label="姓名" placeholder="请输入" />
    </van-cell-group>
  </scroll-view>
</template>
```

引擎内部两处变化（对页面不可见）：

1. **Dart**：`FjsStyleEntry` 成为解析驻留点。共享同一份 interned style 的
   节点，padding / 边框 / 圆角 / 背景等已解析的 Flutter 值只派生一次，
   后续 `FjsStyle.of` / `decorateNode` 读驻留结果。`DEFINE_STYLE` 换掉
   entry 时驻留作废（今天换的是整个对象，天然失效）。
2. **JS**：`compute()` 的 miss 路径少分配——继承表不再每次 new + 扫
   `INHERITABLE` 拷进新对象（能引用就引用）、折叠 merge 少四层 spread、
   无 active/hover/伪元素时跳过那几条再算。命中路径（`byParent`）不动。

## 4. 两端约定（宪法 I）

| | Flutter（App） | Web |
|---|---|---|
| 行为 | 首开更快，节点最终样式与外观不变 | 浏览器原生 CSS / 布局，不受影响 |
| 事件载荷 | 无变化 | 无变化 |
| 已知差异 | 无新增。对拍口径仍是 specs/069–073 | 同左 |

这不是「只做一端」：web 没有镜像树、没有 `FjsStyleEntry`、没有 JS CSS
引擎的 compute miss。001 / 075 / 076 同一条登记。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm test` 全绿；`packages/fjs-runtime` 既有 `css.test.ts` /
   `css-compute-diet.test.ts` 一个不改、全过。
2. `pnpm run typecheck` 通过。
3. `cd packages/flutter_fjs && flutter test` 通过。`resolved_style_test.dart`
   继续钉住「解析次数不随节点数涨」；新增（或扩）用例钉住：
   - N 个节点共享同一个 `styleId`，第一次 build 之后再 build，
     `FjsStyle` 的派生对象（padding / `boxBorders` / `borderRadius` 等）
     **按 entry 复用**，不是按节点新建；
   - `DEFINE_STYLE` 换掉该 id 后，读到的是新值（驻留没有脏读）；
   - `:active` / `:hover` 叠在另一份 entry 上，不污染 base entry。
4. `flutter test --dart-define=FJS_BENCH=true test/render_bench_test.dart`
   不回退（对照组仍是绕过缓存，不是清空）。
5. `examples/bench` 样式基准（fjsrun）不回退。
6. 同机同口径复测（iPhone 17 模拟器、`fjs run ios` debug、chunk 已预热，
   附录打点见 [vant-mount-perf.md](../../docs/vant-mount-perf.md)）：
   - vant-form 首开 **first-paint 57 → ≤ 30 ms**（598 节点，debug）；
   - vant-form 首开 CSS flush **attributed 段不差于 076**（≤ 15 ms）；
     flush 总量含 GC 运气，只看 attributed / 计数，不把 mounted 259 ms
     当硬门槛；
   - match miss 仍为 275（索引语义哨）。
7. demo 五个 vant 页与 /about 外观不变（现有对拍与 specs/069–073 落账）。
8. `docs/vant-mount-perf.md`、`docs/performance.md` 补上本轮数字。

## 7. 待澄清

- 无。GC 阈值已否决（001）；本 spec 两刀都在已量过的引擎内部，页面 API 不变。
