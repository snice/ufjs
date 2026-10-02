# Spec: Vue Vapor 渲染路径（先量 4050 元素）

- **ID**: 148-vue-vapor
- **状态**: done（阶段 1：Vapor 可选，用户选定）
- **日期**: 2026-09-28

## 1. 要解决什么

specs/145–147 之后，4050 元素同屏页（`example/interaction/flat-4050`）在 iPhone 12 `--profile` 上显示时
JS 为 152–166 ms，其中样式 flush 约 36 ms，其余大头是 Vue + 渲染器 + 元素层。离线拆分
（`examples/bench` flat-bench，fjsrun，Mac，页面规则，min）：

| 环节 | ms |
|---|---:|
| 挂载总计（扣掉包装计时开销后） | ≈ 68 |
| 样式登记（`style.patch.net`） | 7.8 |
| 样式 flush | 18.9 |
| 元素层（同一棵树直接调 element API） | 12.0 |
| **Vue runtime-core + 渲染器胶水**（差值） | **≈ 29** |

VDOM 路径下每个元素都要创建 vnode、走 `mountChildren` / `patch`，v-for 的 2000 个格子还要各建
一次 vnode 子树。Vue 3.6 的 Vapor 模式把模板编译成直接操作节点的代码，不建 vnode。问题是：**换成
Vapor 能从这 29 ms（真机约 2 倍）里拿回多少，以及代价是什么。**

调研到的事实（本 spec 的前提）：

1. **版本**：仓库用 Vue 3.5.42。Vapor 只在 3.6 里（npm 当前 `rc: 3.6.0-rc.9`，`latest` 仍是 3.5.43）。
   Vapor 与 VDOM 互操作要求 runtime-core / reactivity 同版本，所以是**整个 workspace 升到 3.6 rc**。
2. **`@vue/runtime-vapor` 没有自定义渲染器入口**。它不像 `createRenderer` 那样收一组 nodeOps，而是直接
   调 DOM：`parentNode`（52 处）、`nextSibling`（30）、`insertBefore`（17）、`cloneNode`、
   `template()` 里 `innerHTML` 解析模板串、`document.createElement` / `createTextNode` / `createComment`、
   `addEventListener` 与挂在 `document` 上的事件委托；并从 `@vue/runtime-dom` 引 `patchClass` /
   `patchStyle` / `ensureRenderer`（VDOM 互操作用 runtime-dom 自己的渲染器）。
3. **编译产物**（4050 页用 `compileScript(..., { vapor: true })` 编出来）是：
   `template("<view data-v-x class=cell><text data-v-x class=tiny> ")` 克隆 + `child` / `txt` 取节点 +
   `createFor` / `createIf` + `renderEffect(() => setText(...))`。模板是 HTML 字符串，靠克隆出节点。
4. **三方 UI 库发的是编译后的 JS，不是 SFC**：仓库里的 vant 4.10.2（源码是 TSX）只有 `.js` / `.mjs`，
   NutUI 4.3.14 同样。Vapor 编译器只编 SFC 模板，**这类库没法「自动按 Vapor 编译」**，只能通过
   `vaporInteropPlugin` 以 VDOM 组件身份跑在 Vapor 页面里。

## 2. 不做什么（Non-goals）

- 不去掉 VDOM 路径：现有页面、vant / NutUI 继续走 `vue/renderer.ts`。
- 不改 op 协议、natives、Dart 侧：Vapor 最终仍落到 element API。
- 不给 TSX / 渲染函数写的库做 Vapor 化（技术上不可行，见 §1 第 4 条）。
- 小程序端不做 Vapor（小程序走 WXML 编译，不经过 Vue runtime）。

## 3. 用户可见的行为

页面按组件选择：

```vue
<script setup vapor lang="ts">
defineProps<{ show: boolean }>();
</script>
<template>
  <view>
    <view v-if="show">
      <view v-for="r in 50" :key="r" class="row">
        <view v-for="(_, i) in 40" :key="i" class="cell"><text class="tiny">{{ i }}</text></view>
      </view>
    </view>
  </view>
</template>
```

flat-4050 页多一个 Vapor 版本，两版并排量：

```text
[flat-4050] vdom  show=... js=...
[flat-4050] vapor show=... js=...
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | Vapor 组件经 element API 渲染，样式 / 事件与 VDOM 版一致 | web 端本来就是 DOM，直接用官方 runtime-vapor |
| 事件载荷 | 仍是字符串 | 同左 |
| 已知差异 | 待 plan 确定（取决于 Q2） | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及；新增 `@ufjs/runtime` 的 Vapor 入口与 CLI 的 `vapor` 编译开关，属公开 API，写进文档

## 6. 验收标准

**阶段 0（量收益，决定做不做）**

1. `examples/bench` 的 flat-bench 增加 Vapor 变体，fjsrun 离线给出与 VDOM 版同口径的挂载 / 卸载拆分，
   帧字节与 VDOM 版一致（同一棵树、同样的样式）。
2. 若 Vapor 挂载总计比 VDOM 少不到 **Q4 定的门槛**，停在这里，写结论，不进入阶段 1。

**阶段 1（落地，过了门槛才做）**

3. `pnpm run typecheck`、`pnpm test`、`cd packages/flutter_fjs && flutter test` 通过；Vue 升级后现有
   单测不改期望值。
4. hello-fjs 的 flat-4050 Vapor 版在真机 `fjs run ios --profile -d 00008101-000978E201FA001E` 显示 3 次，
   与 VDOM 版并排记录 JS / 点击→上屏。
5. 同一页在 `fjs dev --web` 上表现一致。
6. Vapor 页面里嵌一个 vant 组件（interop）能正常显示和点击。
7. `pnpm --filter demo run bench:mount`：VDOM 路径不因升级回退超过 5%。
8. `docs/vue3.md` 写 Vapor 用法与限制，`docs/performance.md` 记结果。

## 7. 待澄清

- [x] **Q1 Vue 升级**：Vapor 只在 3.6 rc，接受整个 workspace 升到 `3.6.0-rc.9` 吗？
- [x] **Q2 运行时怎么接 element API**：
  (A) 写一层「够 Vue 用的 DOM 外壳」（节点对象带 `parentNode` / `nextSibling` / `insertBefore` /
  `cloneNode`，模板串解析），落到 element API，官方 runtime-vapor / runtime-dom 原样跑；
  (B) 自己实现编译产物调用的约 60 个运行时函数，直接调 element API。B 等于重写 runtime-vapor（组件、
  slots、props 透传、KeepAlive、Teleport、互操作），还要跟 rc 的改动。
- [x] **Q3 三方库**：vant / NutUI 只能以 VDOM 身份跑在 Vapor 页面里；「自动 Vapor 编译」只能覆盖
  在 node_modules 里以 `.vue` 源码发布的库。按这个口径可以吗？
- [x] **Q4 阶段 0 的门槛**：Vapor 挂载总计至少比 VDOM 少多少才进入阶段 1？
  → 答：Q1 阶段 0 只在 bench 里用 3.6 rc；Q2 选 A；Q3 按此口径；Q4 少 ≥ 15 ms。

## 8. 结果（2026-09-28）：不进入阶段 1

`examples/bench/vapor/`（`node vapor/build.mjs && fjsrun --pump 20000 dist/vapor.js`），fjsrun，Mac，
页面规则，7 轮 min/med/max，两个变体交替跑两轮，数值一致：

| | VDOM（fjs 渲染器，3.6 runtime-core） | Vapor（runtime-vapor + DOM 外壳） |
|---|---:|---:|
| 挂载总计 | 65.0 / 65.5 / 66.8 ms | **80.8 / 81.5 / 92.6 ms** |
| 其中样式 flush | 18.1 / 18.5 / 18.9 | 18.2 / 18.4 / 29.9 |
| 卸载总计 | 7.9 / 8.2 / 8.4 | 9.0 / 9.5 / 10.3 |
| 样式元素数 | 4156 | 4105（v-for 少了 fragment 锚点） |
| 挂载帧字节 | 175166 B | 173274 B |

**Vapor 慢 16 ms，门槛是快 15 ms，不过。**

打开逐调用计时（`PROFILE = true`，会抬高总数）拆 Vapor 这一侧：

| 环节 | 估算（扣掉包装开销） |
|---|---:|
| 宿主工作：nodeOps.createElement / setScopeId / insert / setElementText + class patchProp | ≈ 32 ms（与 VDOM 路径相同） |
| DOM 外壳（节点对象、模板克隆、链表维护） | ≈ 13 ms |
| runtime-vapor 自身（每个 v-for 项：effect scope、item / key 两个 shallowRef、renderEffect、块对象） | ≈ 17 ms |

同口径下 VDOM 的 runtime-core 只占约 **15 ms**（65.5 − 18.5 flush − 32 宿主）。

结论：

1. **这个场景的瓶颈不在 vnode。** 4050 元素的挂载 JS 里，宿主工作（元素层 + 样式登记）和样式 flush 合计约
   50 ms，Vue 框架层约 15 ms。即便框架层整个拿掉，离线上限也只省约 15 ms（真机约 30 ms），刚好够到门槛，
   而 Vapor 本身并不比 VDOM 便宜：一次性挂载一个嵌套 v-for，它每项要建的响应式对象不比一个元素 vnode 少。
   Vapor 的收益在更新（不重跑 render、不 diff），不在首次挂载。
2. 方案 B（自己写运行时直接调 element API）能省掉外壳的约 13 ms，但 runtime-vapor 自身那约 17 ms 还在，
   仍然不比 VDOM 快，而且要重写并追 rc。
3. 顺带：esbuild 在 es2019 目标下把 class 字段降级成 `Object.defineProperty`，在 QuickJS 里很贵（外壳改成
   构造函数赋值后，模板克隆从 68 ms 降到 49 ms，计时开着）。运行时源码里的 class 字段值得查一遍，另立 spec。

保留的东西：`examples/bench/vapor/`（3.6 正式版出来后可以直接重量）、bench 的 `vue36` devDependency、
`vue/renderer.ts` 导出 `nodeOps`（只多一个导出）。VDOM 路径、CLI、主线 Vue 版本都没动。

下一步仍是 145 以来的方向：宿主工作与样式——op 编码（`applyStyle`）和元素层每次调用的开销。

### 8.1 补充：更新场景与原生克隆上限（用户追问 Vue 官方说 Vapor 更快）

**更新**（`vapor/FlatLive.vue`：同一棵 4050 元素树，每格文本读响应式数组的一格；改 N 格后 flush，
7 轮 min/med/max，两轮交替结果一致；两边帧字节逐轮相同）：

| 改动格数 | VDOM | Vapor |
|---:|---:|---:|
| 1 | 15.7 / 16.0 / 16.2 ms | **0.0 / 0.0 / 0.0 ms** |
| 200 | 17.0 / 17.1 / 17.2 ms | **2.1 / 2.1 / 2.2 ms** |
| 2000 | 27.6 / 27.8 / 28.3 ms | **21.1 / 21.4 / 21.6 ms** |

VDOM 哪怕只改一格，也要重跑整个组件的 render、重建 4050 个 vnode 再 diff（约 16 ms 的固定成本）；
Vapor 只跑那一格的 renderEffect。**Vue 官方说的「Vapor 更快」在这里成立——快在更新，而且是数量级的差距。**

**原生克隆上限**（`PROFILE=1` 构建，逐调用计时并扣掉嵌套的计时开销）：

| Vapor 挂载的组成 | ms |
|---|---:|
| 宿主工作（nodeOps + class 写入） | 30.6 |
| 其中 element API 的 create / insert 编码（同一棵树裸调，单独量） | 8.6 |
| DOM 外壳自身（节点对象、克隆、链表） | 14.2 |
| 样式 flush | 18.5 |
| runtime-vapor 自身（差值） | ≈ 18 |

浏览器里 Vapor 挂载快，是因为 `cloneNode(true)` 一次原生调用建好整棵模板子树。如果给 op 协议加一个
「按模板克隆子树」的原生 op：外壳的 14.2 ms 与逐元素 create / insert 编码的 8.6 ms 可以省掉，Vapor 挂载
估算 81.5 − 14.2 − 8.6 ≈ **59 ms**，比 VDOM 的 66 ms 快约 7 ms——仍不到 15 ms 的门槛。剩下的宿主工作约
22 ms 是 JS 侧逐元素的渲染器登记和样式引擎登记（ensure / addScope / setClasses / recomputeSubtree），
原生克隆省不掉它，除非样式引擎也能「按模板复制元素状态」；这一步是推算，没有量。

**更新后的结论**：

- 挂载：Vapor 在我们这里不快（81.5 vs 66 ms）；有原生克隆 op 也只是略快（估算 59 ms）。
- 更新：Vapor 快一个数量级（改 1 格 16 → 0 ms，改 200 格 17 → 2 ms）。列表里改一项、计数器、表单、
  实时数据这类页面，Vapor 的收益是实打实的。
- 引入的代价：Vue 升到 3.6（目前 rc）；DOM 外壳让挂载多出约 14 ms，可以用原生克隆 op 或更瘦的外壳收回。

### 8.2 阶段 1 结果（Vapor 做成可选）

真机（iPhone 12，`--profile`，hello-fjs「4050 元素同屏」，网格是子组件，VDOM / Vapor 只差 `vapor`）：

| | VDOM | Vapor |
|---|---:|---:|
| 显示 · JS | 177–196 ms | 212–216 ms |
| 显示 · 点击→上屏 | 298 ms | 316–349 ms |
| 隐藏 · JS | 38–51 ms | 54–57 ms |
| **改 1 格 · JS** | 52–68 ms | **5.4–6.0 ms** |
| 改 1 格 · 点击→上屏 | 82–99 ms | **49 ms** |
| **改 200 格 · JS** | 55–66 ms | **17–22 ms** |
| 改 200 格 · 点击→上屏 | 82–99 ms | **49–66 ms** |

与离线一致：更新快 3–10 倍（改 1 格上屏时间减半），首次挂载慢约 25 ms（外壳 + 逐元素建模板）。日志里没有
`[fjs vapor]` 报错。

验证：

- Vue 升到 3.6.0-rc.9 后 VDOM 路径不回退：`[bench]` / flat-bench / `bench:mount` 三组与 3.5 在噪声内，
  miss 数一致。小程序 `watch` 的 `scheduler` 选项在 3.6 被移除，改为继承 `WatcherEffect` 覆写 `notify`。
- 单测：`fjs-runtime/test/vapor.test.ts`（独立 vitest project）4 条，VDOM / Vapor 对拍挂载、v-if、keyed v-for、
  绑定更新、事件冒泡与 `.stop`、Vapor ⇄ VDOM 互相嵌套；`fjs/test/vue-plugin-vapor.test.ts` 9 条，编译、库自动
  Vapor、`fjs/vapor` 导入改写、分包共享、Vite 源码准备。全量 runtime 832 / CLI 404 / flutter 545 通过。
- vant 互操作：demo `vant/vapor` 页在 fjsrun 下（`demo/bench/vapor-check.ts`）按钮 / 单元格点击、Switch 与
  Stepper 的 v-model、Vapor v-if 都正确，卸载后样式元素清零。真机上未单独点这一页。
- web：`dev:web` 下 Vapor 模式 4050 格显示、scoped 样式、改 200 格正确。
- 包体：无 Vapor 组件的应用不带 runtime-vapor 与外壳（bench 单包比 3.5 大 4.8 KB，是 Vue 3.6 本身）；`--pages`
  构建只在用到 Vapor 时把 `fjs/vapor` 放进共享 chunk（racing 共享 chunk 无 Vapor；hello-fjs 页面 chunk 无重复
  runtime-vapor）。

与 plan 的偏差：

1. Vapor 模块的 `vue` 导入由 CLI 改写到 `fjs/vapor`（vue-shim + runtime-vapor），vue-shim 本身不导出
   runtime-vapor——否则 `--pages` 共享 chunk 的 `import * as vue` 会让所有应用带上它。
2. 外壳模块做成无顶层副作用（委托事件访问器在 enableVapor 时安装，顶层调用标 `/*@__PURE__*/`），否则被注入
   runtime-vapor 的 import 牵进所有包。
3. Vapor 组件内的 `<Transition>` / `<TransitionGroup>` 未接（抛错说明），留作后续。

### 8.3 挂载差值的最终拆账（2026-09-30，specs/149–158 之后）

§8.2 的「首次挂载慢约 25 ms」是模板克隆（specs/152）之前量的。今天在所有挂载优化落地后重新拆，
离线 fjsrun（PrimJS，Mac，`examples/bench` `pnpm run vapor`，7 轮 min/med/max，两变体交替两轮）：

| | VDOM | Vapor |
|---|---:|---:|
| 挂载 total | 17.6 / 18.0 / 18.7 | 31.1 / 35.2 / 42.8（次轮 31.7 / 32.2 / 41.7） |
| 卸载 total | 4.0 / 4.2 / 4.2 | 5.4 / 6.2 / 7.7 |
| 样式 flush | 0.3 | 0.2–0.3 |
| element API 裸 create+insert 同树 | 5.9 / 6.1 / 6.3 | —（格子已并入 C++ 克隆，specs/152） |

打开逐调用计时（`__VAPOR_PROFILE__`，抬高总数，`.net` 已扣包装开销）拆 Vapor 的 rest（35.6）：

| 环节 | ms | 说明 |
|---|---:|---|
| host.net（nodeOps：行/外框的 create / insert、每格 setElementText） | 3.3 | VDOM 路径同一项约 9.5——模板克隆把格子的宿主工作搬进了 C++，反而是 Vapor 便宜 |
| shell.net（外壳 cloneNode / insertBefore 净值） | 9.7–10.2 | `cloneTemplate` host 调用 + `instantiateCloned` 的外壳对象：每格一个 Element + 一个 Text + linkChild，全页 ~8300 个（`new Element` 0.67 µs，specs/152 量过） |
| 样式 flush | 0.3 | 在 libfjs-style |
| **runtime-vapor 自身（差值）** | **~22** | 每个 v-for 项：块对象 + effect scope + key 记账；每格文字绑定一个 renderEffect + 依赖收集 + 首跑 |

静态文字差分（把格子的 `{{ i }}` 换成常量，两边各跑一轮，同口径）：

| | 动态 | 静态 | 差值 |
|---|---:|---:|---:|
| VDOM mount | 21.0 | 16.7 | −4.3（每格 ~2.1 µs：text vnode 创建 + diff） |
| Vapor mount | 35.9 | 27.9 | −8.0（每格 ~4 µs：renderEffect + scope + setText） |

即 Vapor 的逐格绑定单价是 VDOM 的 2 倍，但总量上它只占 8 ms；**差值的大头是 runtime-vapor 的
per-item 块/scope（~15 ms，静态化也省不掉）和外壳对象（~10 ms）**。

真机（iPhone 12，`--profile`，页面自报）：VDOM 显示 87.9–91.4 ms，Vapor 119.5–122.7 ms，差 ~32 ms
≈ 离线差值 14.2 × 解释器 ~2.2 的放大；`frame-timeline` 录的显示帧 VDOM 83.6 / Vapor 82.8 ms——
**Flutter 侧两路径一致，慢全部在 JS**（specs/145 §5）。

结论：模板克隆之后，外壳的宿主工作不再是 Vapor 的问题（3.3 vs VDOM 9.5 ms）；剩下的差值按大小是
① runtime-vapor 每 v-for 项的块对象 + effect scope（~15 ms，在 runtime-vapor 的路径里，外壳侧改不掉；
只有「纯静态、无绑定」的项可以特化，flat-4050 这种带绑定的不在其列）；② 外壳逐节点对象（~10 ms，
字段已瘦身过一轮，再压要把外壳对象做成单形并复用，估 ~5 ms）；③ 逐格绑定贵一倍（~8 ms，来源是
renderEffect 的固定成本，vapor 的官方语义，绑定在就得付）。所以外壳侧能削的只有 ②（和 ① 里跟着
外壳对象走的部分），估离线 ~5–8 ms；**要抹平剩下的一半差值得动 runtime-vapor 本身，不属于外壳能
解决的范围**。不立项：挂载差值真机 32 ms 在总上屏 215 ms 里占 15%，且 Vapor 的价值在更新路径
（改 1 格 2.4–2.9 ms vs VDOM 30.8–61.4，真机）。
