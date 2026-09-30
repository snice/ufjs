# Spec: Vapor SFC 的 wrapper 覆盖路由表/分 chunk entry 等生成导入点

- **ID**: 165-vapor-wrapper-entry-sites
- **状态**: done（2026-09-30，web + iOS 模拟器双端验证通过）
- **日期**: 2026-09-30
- **分支**: 161-own-vapor-runtime

## 1. 要解决什么

demo 的 `src/pages/vant/vapor.vue`（specs/148 的 Vapor + vant 互操作页）在
web（vite dev）和 iOS 模拟器（`fjs run ios` → `fjs dev` split 构建）上白屏。

根因是一个：specs/161 的编译期 wrapper（VDOM 模块 import 一个 Vapor SFC 时
重定向到 `vaporWrapperModule`，由它 adopt Vapor block 并渲染 `fjs-vapor-root`
占位）只覆盖了「真实模块的相对导入」。而 vapor 页面真正被挂载的三条路径全是
**生成模块 + 绝对路径导入**，全部绕过了重定向：

| 构建面 | 导入点 | 症状 |
|---|---|---|
| `fjs build`（inline，release 走这里） | `routeTableSource` inline 分支：`definePageLoader(path, () => require(<绝对路径>).default)`，所在路由表是 generatedEntry stdin 模块（无 importer） | 裸 vapor 组件经 `definePageLoader` 注册，被 shim renderer（runtime-core 3.5，无 vapor 感知）当 VDOM 组件挂载 |
| `fjs build --pages` / `fjs dev`（split） | `pageChunkSource`：`import Page from <绝对路径>`，同为 stdin entry | 同上；页面 setup 第一处 `resolveComponent('van-button')` 因无人注入 appContext 直接抛错（iOS 实测 `[fjs vapor] component <van-button> is not registered`）→ 白屏 |
| vite（web dev/build） | `routeTableSource` web 分支：`component: () => import(<绝对路径>)` | 真实 vue（3.6，有 vapor 感知）`processComponent` 走 `getVaporInterface`，`appContext.vapor` 未装 → `Cannot read properties of undefined (reading 'mount')` → 白屏（浏览器实测复现） |

vite 面还有第二个独立缺陷：`fjs build --web`（esbuild）对 vapor SFC 做了
`from 'vue'` → `from 'fjs/vapor'` 改写（vue-plugin.ts:355），vite 路径没有任何
等价物——即使 wrapper 覆盖了，页面模块的 helpers 仍来自官方 runtime-vapor，
与 wrapper 的自研 runtime 混用，vant 互操作仍会崩。

对照组：hello-fjs 的 `flat-4050.vue`（VDOM 页，相对导入 GridVapor.vue）在 iOS
能加载——它的 vapor 组件走「真实模块的相对导入」，恰是现有判定覆盖的唯一一类
导入点；路由表挂载的 vapor 页（demo vant/vapor）才暴露缺口。

验收标准：

1. `fjs build` 与 `fjs build --pages` 的产物里，vapor 页面的路由项注册的是
   wrapper（产物含 `fjs-vapor-root` 占位逻辑）而非裸 `__vapor` 组件；
2. `fjs dev`（split）+ iOS 模拟器：vant/vapor 页正常渲染，button/cell/
   stepper/switch 可交互；
3. vite dev（web）：同页正常渲染、无 console 报错；
4. vapor-check / nav-vapor（bench 直挂路径）回归通过；
5. `pnpm run typecheck`、`pnpm test`（runtime + cli）通过。

## 2. 不做什么

- 不动 op 协议、不动 wrapper 的生成内容本身（`vaporWrapperModule` 语义不变）。
- 不处理 vapor-check harness 的帧解析器落后于 specs/162 op 集的问题
  （测试工具，非本 spec）。
- 不给 vite 路径补 SFC style 的 registerStyles 化（web 走原生 CSS，现状即设计）。

## 3. 方案概要

wrapper 重定向的判定从「相对导入 + 有 importer」放宽为「解析到的文件是 vapor
SFC」，三类导入点自然落网：

1. esbuild `vaporWrapperPlugin.onResolve`：importer 为空时用 `args.resolveDir`
   （generatedEntry 的 StdinOptions.resolveDir）；绝对路径直接取自身；guard
   wrapper 虚拟模块自身的 `import __vapor` 防递归。
2. vite `resolveId`：新增绝对路径分支（路由表动态 import），同样的防递归 guard。
3. vite 新增虚拟模块 `\0fjs-vapor-sfc:`，由 `compileVaporSfcModule`（CLI 自己
   的 vapor 编译 + esbuild ts 转译）出码——plugin-vue 不再编译 vapor SFC，
   其产物面向官方 runtime-vapor 契约（setup 返回 bindings、独立 render、
   expose），自研 runtime 不实现。

## 4. 二次修复（首验后用户实测暴露）

1. **wrapper 生命周期不可靠**：web 端页面在 `<KeepAlive>` + `<Transition>` +
   router-view 的 vnode 克隆链下，wrapper 的 onMounted 可能整个不触发
   （实测 setup 跑了、mounted 钩子数组为空、placeholder 空壳）→ 挂载改用
   **提交期 ref 回调**（`ref: el => __mountAdopt(id, el)`），不依赖生命周期
   flush；`mountAdoptNodes` 改收元素、幂等。
2. **vite 预打包的 runtime-core 版本塌缩**：`@vue/runtime-core` 被优化成单份
   dep，vue 3.6（demo 版本）与 fjs-runtime 的 3.5.42 谁先加载谁占坑——实例跨
   版本串门（`instance.scope.on is not a function`，unmount 中断、adopt 泄漏）
   、反应系统分裂。修法：vite alias `vue` → fjs-runtime 内链接的
   vue@3.5.42 runtime dist——整个 web 应用（app/shell/vant/vue-router/pinia/
   wrapper）与自研 runtime 统一到 **3.5 单一世界**，与 esbuild --web 的
   vuePinPlugin 完全对齐；pnpm realpath 使 @vue/* 各只有一份。

验收补充：home→vapor 直达、home→form→back→vapor（用户失败流）、连续往返、
全新标签冷导航全部通过且 0 console 报错；vant:basic（纯 VDOM 页）在统一
runtime 下回归正常；vapor-check / nav-vapor fjsrun 不回退。
