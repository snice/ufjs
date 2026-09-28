# Plan: Vue Vapor 渲染路径（阶段 0：bench 量收益）

对应 spec：`./spec.md`。澄清结论：Q1 阶段 0 只在 bench 里用 3.6 rc；Q2 选 A（DOM 外壳）；
Q3 `.vue` 源码库自动 Vapor 编译，编译后的 JS 库走 interop；Q4 门槛为离线挂载总计少 ≥ 15 ms。

本 plan 只覆盖阶段 0。过门槛后再补阶段 1 的 plan。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否（阶段 0） | 只在 fjsrun 里量；web 端阶段 1 再做 |
| II 边界即契约 | 否 | op 协议、natives、事件类型不动；运行时与 CLI 公开 API 不动 |
| III 同步单线程零序列化 | 是（维持） | 外壳是同步的 JS 对象，直接调现有 nodeOps |
| V 静默失效是 bug | 是 | Vapor 版与 VDOM 版发出的帧字节数必须相同，不同就是外壳漏了东西 |
| VI 注释记录权衡 | 是 | 外壳每个 DOM 成员写清它落到哪个 nodeOp |
| VIII 变更落到文档 | 是 | 结论写进 spec §8 与 `docs/performance.md` |
| 不新增依赖 | 是 | bench 加 `vue@3.6.0-rc.9`（npm 别名 `vue36`），理由见 spec Q1；运行时与 CLI 不加 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Bench 依赖 | `examples/bench/package.json` | devDependency `vue36: npm:vue@3.6.0-rc.9` |
| Bench · Vapor 构建 | `examples/bench/vapor/build.mjs`（新） | 独立 esbuild 构建：3.6 编译器编 SFC（VDOM / Vapor 两种），`@vue/*` 全部钉到 3.6 一份，`fjs` / `fjs/vue` 指向运行时源码 |
| Bench · DOM 外壳 | `examples/bench/vapor/dom-shell.ts`（新） | 够 runtime-vapor 用的 `document` / 节点成员，全部落到 `vue/renderer.ts` 的 nodeOps / patchProp |
| Bench · 用例 | `examples/bench/vapor/main.ts`（新） | 同一个 `Flat4050.vue` 分别以 VDOM（我们的渲染器，3.6 runtime-core）和 Vapor 挂载 / 卸载，与 flat-bench 同口径 |
| 运行时 | `packages/fjs-runtime/src/vue/renderer.ts` | 只加一个供外壳使用的导出（nodeOps），不改行为 |

## 3. 方案

### 3.1 为什么在 bench 里单独构建

CLI 的 `vuePinPlugin` 把 `vue` / `@vue/runtime-core` 钉在运行时自己的 3.5。阶段 0 不动主线，
所以 Vapor 版用自己的 esbuild 脚本：同一个 bundle 里 VDOM 版和 Vapor 版共用 3.6 的
runtime-core / reactivity，两者只差渲染路径。另外照常跑一次 3.5 的 flat-bench，看升级本身的影响。

### 3.2 DOM 外壳

runtime-vapor 用到的 DOM 面（§1 统计）：节点的 `parentNode` / `nextSibling` / `firstChild` /
`previousSibling` / `childNodes` / `nodeType` / `insertBefore` / `appendChild` / `removeChild` /
`remove` / `cloneNode` / `textContent` / `nodeValue` / `setAttribute` / `removeAttribute` /
`className` / `style` / `addEventListener`；`document.createElement` / `createTextNode` /
`createComment` / `createDocumentFragment`；`template()` 用 `<template>` 的 `innerHTML` 解析。

做法：给渲染器的 HostNode 挂一个原型，原型上的 getter / 方法转到 nodeOps（`insert` / `remove` /
`parentNode` / `nextSibling` / `setText` / `setScopeId`）与 `patchProp`（`class` / `style` / 属性 /
事件），不另建包装对象。`<template>.innerHTML` 只解析编译器产出的模板串（标签、无引号属性、省略的
结束标签、文本），解析结果存成一棵描述树，`cloneNode(true)` 按描述树走 nodeOps 建节点。

外壳只做到 flat-4050 用到的范围；不认识的 DOM 成员访问时抛错，免得静默走错。

### 3.3 口径

与 `flat-bench.ts` 相同：7 轮 min/med/max；挂载 = 设 `show` 为 true 到 `flush()` 之后；拆分
`style.patch.net` / `style.flush` / 其余；另报帧字节。

## 4. 风险

- runtime-vapor 用到外壳没实现的 DOM 成员 → 抛错暴露，不会静默。
- 3.6 rc 的 runtime-core 与我们渲染器不兼容 → 构建或运行时报错；阶段 0 记录下来就是结论的一部分。
- 外壳本身的开销算在 Vapor 头上。这正是阶段 1 的真实成本，不扣除。

---

# 阶段 1 plan（用户选「进阶段 1，Vapor 做成可选」）

## 5. 决定

| 问题 | 决定 | 理由 |
|---|---|---|
| Vue 版本 | workspace 与 `fjs create` 模板统一钉 `3.6.0-rc.9`（精确版本，不用 `^`） | Vapor 与 VDOM 互操作要求同版本；rc 之间 API 还在变 |
| 页面怎么选 Vapor | `<script setup vapor>` | Vue 官方语法 |
| 三方库（Q3） | node_modules 里以 `.vue` 发布、且只有 `<script setup>` 的组件自动按 Vapor 编译；`package.json` 的 `fjs.vapor.libs: false` 可关；编译后的 JS 库（vant、NutUI）走互操作 | Vapor 只支持 `<script setup>`；带 Options API 的 SFC 编不了 |
| `@vue/runtime-dom` | Flutter 构建钉到 fjs 自己的 `vue/runtime-dom-shim.ts`：`runtime-core` 全量 + runtime-vapor 用到的约 30 个 DOM 专属导出的 fjs 实现；`ensureRenderer()` 返回 fjs 渲染器 | 真 runtime-dom 一加载就要全局 `document`，而全局 `document` 会让三方库（vant 等按 `typeof document` 分支的）改走浏览器分支 |
| runtime-vapor 的 DOM 全局 | 构建期只给 runtime-vapor 这一个模块注入 `import { document, Node, Element, … } from 'fjs/vapor-dom'`，不设全局 | 同上，不污染其他库 |
| DOM 外壳 | 从 bench 挪进 `packages/fjs-runtime/src/vapor/dom.ts`，补齐事件（`on` / 委托 `$evtXxx`）、`style`、属性、`v-show`、模板 ref 转发到 fjs Element 的方法 | 阶段 0 只覆盖了 4050 页 |
| VDOM ⇄ Vapor | fjs `createApp` 自动装官方 `vaporInteropPlugin`，并把它 mount / move 收到的 fjs 宿主节点换成对应的外壳节点；fjs 渲染器 nodeOps 收到外壳节点时取其宿主 | 两边节点类型不同，在边界上各自转换 |
| Web | 用真 vue 3.6（含 runtime-vapor）；fjs 标签在 web 上是组件，Vapor 模板里的 `<view>` 经 `resolveComponent` 走互操作 | web 端 fjs 标签本来就是 VDOM 组件（DOM 适配层） |
| 小程序 | 不涉及（WXML 编译，不经过 Vue runtime），带 `vapor` 的 SFC 照常按模板编译 | spec Non-goal |

## 6. 涉及的层

| 层 | 文件 |
|---|---|
| 依赖 | 各 `package.json`、`packages/fjs/src/commands/create.ts`、`pnpm-lock.yaml` |
| CLI 编译 | `packages/fjs/src/bundler/vue-plugin.ts`（vapor 判定与编译、runtime-dom 钉扎、runtime-vapor 注入）、Vite 插件同步 |
| 运行时 | `src/vapor/dom.ts`（新）、`src/vue/runtime-dom-shim.ts`（新）、`src/vue/vue-shim.ts`（导出 runtime-vapor）、`src/vue/renderer.ts`（外壳节点解包、装互操作插件）、web 的 createApp |
| Bench | `examples/bench/vapor/` 改用运行时里的外壳 |
| 示例 | hello-fjs 的 flat-4050 页加 Vapor 版；一个 Vapor 页嵌 vant 组件 |
| 测试 | `packages/fjs-runtime/test/vapor-*.test.ts`：外壳、编译产物挂载与更新、事件、互操作 |
| 文档 | `docs/vue3.md`、`docs/performance.md`、`docs/toolchain.md`（配置项） |

## 7. 顺序

1. 升级 Vue，全量 typecheck / test / flutter test，先保证 VDOM 路径不回退。
2. 外壳进运行时 + runtime-dom-shim + 构建期注入，fjsrun 跑通 bench 的 Vapor 变体。
3. 互操作两个方向。
4. CLI：vapor 判定、库自动 Vapor、web 构建。
5. hello-fjs 页面、真机、web、vant 互操作验证。
6. 文档。
