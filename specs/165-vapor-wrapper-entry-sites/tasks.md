# Tasks: 165-vapor-wrapper-entry-sites

## 1. esbuild

- [x] T1 `vaporWrapperPlugin.onResolve` 放宽：stdin entry（无 importer）用
  `resolveDir`；绝对路径分支；entry-point 本身不包、wrapper 自身 import 防递归
- [x] T2 产物验证：`fjs build`（inline）路由项 require 的是 wrapper
  （S_ 闭包含 `fjs-vapor-root`）；`fjs build --pages` 的 `pages/vant-vapor.js`
  尾部 `definePage` 注册 wrapper

## 2. vite

- [x] T3 `resolveId` 绝对路径分支 + 防递归 guard；wrapper 自身的
  `import __vapor` 落到 `\0fjs-vapor-sfc:` 虚拟模块——plugin-vue 不再编译
  vapor SFC（其产物面向官方 runtime-vapor 契约，自研 runtime 不实现），
  由 `compileVaporSfcModule`（CLI 自己的 vapor 编译 + esbuild ts 转译）出码
- [x] T4 web.ts 导出面修正：`export * from '@vue/runtime-core'`（standalone
  包，与自研 runtime 的 `@vue/reactivity` 同源——vite 预打包的 vue 内联了
  自己的 reactivity，裸 `export * from 'vue'` 会让页面 ref 与 renderEffect
  分属两套反应系统）；runtime 同名 helpers 显式遮蔽；setup ctx 补
  `attrs`/`expose`；web 后端补 slot 占位桥（`fjs-vapor-slot` +
  createElement 拦截，裸 DocumentFragment 会被 runtime-core 转成文本）与
  patchProp 事件分支（on* 此前被字符串化成 attribute，永不触发）

## 3. 验证

- [x] T5 bench 回归：vapor-check（挂载 3/2/1/1、点击生效）、nav-vapor
  （路由路径 0 error）fjsrun 全通
- [x] T6 web：vite dev 打开 /vant/vapor 渲染正常（按钮/Cell/Switch/Stepper
  + 样式），点击计数、Stepper v-model（4）、Switch（关）、v-if（大于 3）
  全部生效，console 0 报错（含截图）
- [x] T7 iOS 模拟器：真实 UI 路径（目录 → Vant 分组 → Vapor 条目 →
  router.push → Dart nav → chunk 10270 B 含 wrapper）挂载 key=1 vant-vapor
  14ms、0 js:error，页面完整渲染（含截图）；对照组修复前同路径
  `component <van-button> is not registered` 白屏
- [x] T8 `pnpm run typecheck`（examples/racing 的 TS2339 为既有问题，与本
  spec 无关——stash 验证过）；`pnpm test` runtime 877 / cli 446 / webview
  36 / webgl 30 全过
