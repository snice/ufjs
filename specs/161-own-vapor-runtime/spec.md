# Spec: 自研 Vapor 运行时（fjs/vapor 直连 element API，脱离 runtime-vapor）

- **ID**: 161-own-vapor-runtime
- **状态**: ready（Q1–Q4 已拍板，见 §7）
- **日期**: 2026-09-30

## 1. 要解决什么

specs/148 落地的 Vapor 路径是「官方 runtime-vapor + 一层 DOM 外壳」：
CLI 把编译产物里的 `from 'vue'` 改写到 `fjs/vapor`（= vue-shim + `export * from '@vue/runtime-vapor'`），
runtime-vapor 以为自己在操作 DOM，每个节点其实是一个外壳对象（`src/vapor/dom.ts`，767 行），
CLI 再把 `document` / `Node` 等全局注入 runtime-vapor 模块。三个代价：

1. **性能**（specs/148 §8.3 拆账）：Vapor 挂载比 VDOM 慢——离线 14.2 ms（32.2 vs 18.0）、真机
   ~32 ms（120 vs 88）。差值的三分之二来自外壳逐节点对象（~10 ms）与 runtime-vapor 自身的
   per-item 记账（~22 ms：块对象、effect scope、key 表）；宿主工作反而比 VDOM 便宜（3.3 vs 9.5，
   模板克隆的功劳）。外壳是纯粹的转译层，自研运行时可以让编译产物直接调 element API，这 10 ms
   整层消失，per-item 记账也能按我们的树形重新设计。
2. **版本被钉死**：Vapor 只在 Vue 3.6（当前 `3.6.0-rc.9`），于是整个 workspace 的运行时依赖从
   3.5.42 升到了 rc——`fjs-runtime` 的 dependencies 钉着 `vue: 3.6.0-rc.9`，所有应用跟着用 rc，
   等 3.6 stable 才能脱。
3. **双份心智**：web 端 Vapor 走真 vue（runtime-vapor + 真 DOM + vaporInteropPlugin），Flutter 端
   走外壳，两条路径的行为差异要在两处维护（specs/148 的 `web.ts` / `dom.ts`）。

编译产物本身的依赖面很小（本 spec 调研过）：compiler-vapor 生成的代码只从 `'vue'` import 一组
运行时函数，本仓库页面用到的全部 face 是 26 个 helper——`template / child / next / nthChild / txt /
setText / setClass / setClassName / setStyle / setAttr / setProp / on / once / show / renderEffect /
createIf / createFor / createForSlots / createSlot / createComponent(+WithFallback) /
createDynamicComponent / setInsertionState / delegateEvents / toDisplayString / v-model 指令` 加
`defineVaporComponent`。这层完全可以由我们自己实现，顶在 CLI 已有的改写缝上（`fjs/vapor`）。

## 2. 不做什么（Non-goals）

- **不用 Rust/C++ 实现响应式或效果图**。判据是宪法 VII 与实测拆账：
  - 拿得走的部分（模板克隆、样式引擎、op 编码）已经在 C++（specs/150/152），Vapor 路径没有
    第二块「native 擅长」的工作；
  - 剩下的 per-item 成本是响应式对象与闭包的 JS 分配——effect 的依赖收集靠 Proxy trap，
    effect 体就是编译产物生成的 JS 闭包，native 化意味着把 reactivity 引擎整体下沉并对
    QuickJS-ng 的 Proxy 做引擎级 hook，还要为效果回调新开一条 C ABI（宪法 II 明确不批）；
  - 收益无实测依据：148 的 PROFILE 显示 native 侧每个 clone 调用 0.2–0.3 ms，瓶颈不在跨界，
    在 JS 对象分配——那正是跨不过去的那一层。
  - 若运行时落地后量化发现「块树/效果调度」仍有单项大头，另开 spec 评估，不在本 spec 范围。
- **不自写 Vapor 编译器**。继续用 `@vue/compiler-vapor`（随 `@vue/compiler-sfc@3.6`）生成产物；
  它是构建期 devDependency，不进应用包，运行时对它零依赖。3.6 转 stable 后顺手升级，无运行时影响。
- **不改 op 协议、natives、事件类型**（宪法 II 三张表都不动；element API 之上的事）。
- Vapor 内的 `<Transition>` / `<Teleport>` / `<KeepAlive>` 维持 specs/148 的不支持（显式报错）。
- 不删 VDOM 路径：`vue/renderer.ts` 照旧，vant / NutUI 继续以 VDOM 身份进 Vapor 页。

## 3. 用户可见的行为

页面源码一字不改：

```vue
<script setup vapor lang="ts">
defineProps<{ show: boolean }>();
</script>
<template>
  <view v-if="show"><view v-for="r in 50" :key="r" class="row">…</view></view>
</template>
```

变的是包面：

- `fjs/vapor` 不再 re-export `@vue/runtime-vapor`，改为自研 helpers（导出名与官方一致，
  CLI 的改写逻辑不变）；`src/vapor/dom.ts` 外壳删除。
- 运行时的 `vue` 依赖回到 stable（见 Q2）：helpers 的 reactivity 只用 `@vue/reactivity` 的
  公开 API（`ReactiveEffect` / `effectScope` / `proxyRefs`，3.5 与 3.6 同形），应用不再被钉 rc。
- web 端 Vapor 与 Flutter 同一份运行时，都落 element API（web 适配层把 element API 落在真 DOM
  上），`fjs/vapor` 的 web 特例（`web.ts`，官方 runtime-vapor on DOM）删除——两端同源升级（宪法 I）。
- 日志：Vapor 挂载 / 更新的帧字节与现路径相同（同一棵树、同一样式），verify 对拍 0 不一致。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | helpers 直调 element API，样式/事件与 VDOM 页一致 | 同一份 helpers，element API 落 DOM 适配层 |
| 事件载荷 | 仍是字符串 | 同左 |
| 已知差异 | 无新增（现路径的 web/Flutter 差异本来就是外壳造成的，删除后收敛） | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 三张表都不涉及。公开 API 变化：`fjs/vapor` 导出面（自研 helpers，名字同官方）；
  `fjs-runtime` 移除 `@vue/runtime-vapor` 依赖、`vue` 钉回 stable（Q2 拍板后）；CLI 对
  `@vue/compiler-sfc@3.6` 改为构建期 devDependency。写进 `docs/vue3.md` 与 `docs/toolchain.md`。

## 6. 验收标准

1. **对拍不破**：`examples/bench` 的 `pnpm run vapor` 三方同口径（现 Vapor 路径保留在 bench 作对照，
   用 bench 自己的 devDependency `vue36`），帧字节与现路径相同，verify hash 与 specs/152 的
   `d4f26919` 一致；demo 16 页、hello-fjs 66 页 verify 0 不一致。
2. `pnpm run typecheck`、`pnpm test`（runtime / cli）通过；新增自研运行时的单测覆盖 26 个 helper
   中本仓库用到的路径：v-if、keyed v-for 增删移、文本/class/style/prop 绑定、事件（含 `.stop`）、
   slot、v-model（页面在用的那几个）、Vapor 页嵌 VDOM 组件（vant）、（若 Q3 选编译期包装）VDOM 页嵌
   Vapor 组件。
3. `cd packages/flutter_fjs && flutter test` 通过（不改 native，应无影响）。
4. 真机（iPhone 12，`fjs run ios --profile`）hello-fjs flat-4050 Vapor 版显示 3 次：JS **不劣于**
   现路径（≤ 122.7 ms），目标 ≤ VDOM（87.9–91.4 ms）——达不到目标只记录不阻塞（见 Q4）。
5. `fjs dev --web` 下 Vapor 4050 页与 demo `vant/vapor` 页表现与 Flutter 一致。
6. 包体：无 Vapor 组件的应用 bundle 不含自研运行时（tree-shake 与现状持平）；有 Vapor 组件的应用
   不再带 runtime-vapor（应小于现状）。
7. `docs/vue3.md`（自研运行时、支持面、限制）、`docs/toolchain.md`（CLI 依赖变化）、
   `docs/performance.md`（数字）更新。

## 7. 待澄清（2026-09-30 用户拍板）

- [x] **Q1 native 化的边界** → TS 实现，native 维持现状（克隆/样式/op 已在 C++）。
  「效果调度 / 块树下沉 C++」不立项；运行时落地后若量化出新的单项大头，届时另议。
- [x] **Q2 Vue 版本策略** → (A)：运行时钉回 `vue@^3.5`（stable），CLI 构建期 devDependency
  `@vue/compiler-sfc@3.6.0-rc.9` 只编 Vapor SFC；3.6 转 stable 后升级编译器，运行时不动。
- [x] **Q3 VDOM 页嵌 Vapor 组件** → 编译期包装：CLI 检测「非 vapor 文件 import 了 vapor 组件」
  时生成包装组件（自研运行时挂 Vapor 块），并给渲染器加一个元素收养机制（`vue/renderer.ts`
  自有代码）让挂好的根元素进入 VDOM 树。
- [x] **Q4 门槛** → 不劣于现 Vapor 路径（真机 JS ≤ 122.7 ms）即可，朝 VDOM（~88 ms）压、
  达不到不阻塞；版本自由是主收益。

## 8. 结果（2026-09-30）

**交付**：`fjs/vapor` 变成自研运行时——`runtime.ts`（共享机器：模板解析 + walker + 块 +
v-if/v-for + 组件/slot）加两个平台后端（`backend-flutter.ts` 走 nodeOps/patchProp + libfjs-style
原生克隆；`web.ts` 走 DOM + 适配层手势）。specs/148 的 DOM 外壳、runtime-vapor 钉扎、web 特例、
`runtime-dom-shim` 全部删除；运行时回 `vue@^3.5.42` stable，`@vue/compiler-sfc@3.6.0-rc.9`
只作 CLI/测试的构建期依赖。VDOM 页嵌 Vapor 组件 = CLI 编译期包装（`vaporWrapperModule` +
`vaporWrapperPlugin`）+ 渲染器收养钩子（`fjs-vapor-root`）；Vapor 页嵌 VDOM 组件 = 后端的
`mountVdomComponent`（自有渲染器 + props 快照 effect + slot 桥）。

**过程中抓到的四个坑**（都进了修复或注释）：

1. **tagType 由 SFC parse 决定**：compiler-sfc 的 `compileScript` 只把
   `templateOptions.compilerOptions` 转发给 vapor transform，**parser 不回头**——带组件孩子的
   fjs 标签（`<scroll-view>` 包 van-*）被 parse 成组件，运行时 resolveComponent 抛错。修复：
   CLI 的所有 `parse()` 统一带 `templateParseOptions.isNativeTag`（`sfcParseOptions`）。
2. **编译器的单 slot 优化**：只有一个默认 slot 时编译产物传**裸函数**而非 `{default: fn}`；
   props 里静态值与函数（getter/handler）混排——`makeProps` 两者的分派 + `normalizeSlots`。
3. **克隆 plan 的根 parent**：TemplateNodeSpec 约定根 `-1`（=C++ kNone），初版写成 0 被
   libfjs-style 拒帧（`apply_words failed`，样式引擎 detach 后整帧丢失——离线 fjsrun 全绿因为
   TS 引擎兜底，真机直接空白）。
4. **--pages 的页面 chunk 构建漏了 wrapper plugin**（`stubbed()` 插件列表），页面里的 Vapor
   组件被裸编译，runtime-core 3.5 渲染不出（真机/模拟器 GridVapor 空白）。单 bundle 构建
   （bench/demo 的 fjsrun 验证）一直有 wrapper，所以离线全绿——**--pages 与单 bundle 的
   plugin 列表从此要一起改**。

**对拍**：bench `native:on/ts/verify` 三模式 vapor hash 一致（`91e5c776`，4051 样式元素），
page 与 specs/152 的 `48142bbd` 一致；`fjs build --pages` 后页面 chunk 含 wrapper（
`fjs-vapor-root`×1）；demo `vant/vapor` 页 fjsrun 检查全通（button 3 / cell 2 / switch 1 /
stepper 1，点击与 v-model 生效）；runtime 865 / cli 446 / webview 36 / webgl 30 /
flutter 561 全过。

**数字**：

离线（fjsrun，Mac，PrimJS，`examples/bench` `pnpm run vapor`，TS 引擎模式）：

| | VDOM | 自研 Vapor | 官方 runtime-vapor（specs/148 同口径） |
|---|---:|---:|---:|
| 挂载 | 18.0 ms | 46.5 ms | 32–35 ms |
| 卸载 | 3.9 ms | 4.2 ms | 6.2 ms |
| 改 1 格 | 11.7 ms | **0.0 ms** | 0.0 ms |
| 改 200 格 | 12.7 ms | **1.9 ms** | 2.1 ms |
| 改 2000 格 | 21.3 ms | **19.1 ms** | 21.4 ms |

真机（iPhone 12，`fjs run ios --profile`，hello-fjs flat-4050，页面自报，多次取样）：

| | 自研 Vapor | 官方 runtime-vapor（specs/148/145 §5） | VDOM（同日对照） |
|---|---:|---:|---:|
| 显示 JS | 129.3–154.5 ms | 119.5–122.7 ms | 91.3–127.6 ms |
| 显示 · 点击→上屏 | 235.9–252.8 ms | 215.1–215.7 ms | 197.8–219.5 ms |
| 隐藏 JS | 21.3 ms | 46.2–55.1 ms | 13.8–30.4 ms |
| 改 1 格 | 1.0–5.8 ms | 4.7–5.9 ms | 41.2–56.4 ms |
| 改 200 格 | 8.9–26.1 ms | 16.9–26.1 ms | 47.5 ms |
| 改 2000 格 | 59.4 ms | 70 ms | 37.7 ms |

**读法**：Q4 门槛（真机显示 ≤ 122.7 ms）**差一点没过**——挂载比官方 runtime-vapor 慢约
20–25 ms，与离线差值（46.5 vs 35.2）× 解释器放大一致。差距全在 per-item 记账：每格一个
EffectScope + 两个 shallowRef + 块对象 + walker 游标，与 runtime-vapor 的同类开销相当——
官方路径有外壳（每节点一个 shell 对象）但我们省不掉自己的块记账。更新路径与官方持平
（改 1 格 1.0–5.8 vs 4.7–5.9；改 200 格重叠），隐藏反而快（21.3 vs 46–55，卸载路径更薄）。
版本自由（运行时 stable 3.5）是主收益，挂载差值不阻塞；若要追平，方向是给
「无绑定的纯静态 v-for 项」做无 scope/无 ref 特化（specs/148 §8.3 的老结论，在自研运行时里
反而更容易做），另立 spec。

**包体**：带 Vapor 组件的应用不再携带 runtime-vapor 与 DOM 外壳；无 Vapor 组件的应用不含
Vapor 运行时（`--pages` 共享判定不变，`usesVapor`）。
