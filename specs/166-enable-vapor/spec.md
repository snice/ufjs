# Spec: createFjsApp 全局 enableVapor(vapor-only 应用不打 vdom / runtime-dom)

- **ID**: 166-enable-vapor
- **状态**: implementing
- **日期**: 2026-09-30
- **分支**: 161-own-vapor-runtime

## 1. 要解决什么

specs/161 之后 vapor 页仍由 VDOM 侧「编译期 wrapper + 渲染器收养」挂载(specs/165 补齐三类
导入点),每个 vapor 应用都拖着 wrapper、adopt 机制和每页一个 Vue app;web 侧整个应用跑在
runtime-dom 上。对纯 vapor 应用,这些都是纯开销。同时 specs/161 落地时 toolchain 里还留着
rc 依赖:CLI 的 `@vue/compiler-sfc/core/shared@3.6.0-rc.9`、create 模板的 `vue: 3.6.0-rc.9`、
demo/hello-fjs/racing/fjs-webview 的 `vue@3.6.0-rc.9`。

两个诉求:

1. **运行时与工具链彻底回 stable**:vapor 是自研运行时,只欠 3.6 一件东西——模板代码生成器
   (`@vue/compiler-vapor`),它是纯构建期依赖,不进任何运行包。其余 vue 依赖全部回 `3.5.43`。
2. **`createFjsApp` 增加全局 `enableVapor`**:声明「本应用全部页面都是 Vapor SFC」。开启后
   路由直接经自研 vapor 运行时挂页(无 wrapper、无收养、无 per-page Vue app);web 端壳层
   本身也换成 vapor(`createVaporApp` 起根),`vue` 别名到 runtime-core 壳——**runtime-dom
   整个不进包**。

## 2. 编译器拆分(specs/161 Q2 的收尾)

- CLI 依赖:`@vue/compiler-sfc` / `@vue/compiler-core` / `@vue/shared` → `3.5.43`;
  新增 `@vue/compiler-vapor@3.6.0-rc.9`——**树里唯一剩下的 3.6 产物,构建期 only**。
- vapor SFC 编排从 compiler-sfc@3.6 收归自研:`fjs-runtime/src/vapor/sfc-compiler.ts`
  (与 once-inline 同层——它定义的是运行时消费的模块契约):
  - parse + script-setup 用 3.5 的 compiler-sfc(vapor 属性从 `scriptSetup.attrs` 读,
    3.5 不认识它);
  - 模板直调 `@vue/compiler-vapor` 的 `compile()`(`inline: true` + bindingMetadata +
    isNativeTag + scopeId),产物是 setup 尾巴形状(自带 `return` 根块);
  - 对 3.5 compileScript 的输出做五处拼接:换掉 `__returned__` 尾巴、`_defineComponent` →
    `_defineVaporComponent`(只换编译器下划线别名,不碰用户自己的 import)、
    `__sfc__.__vapor = true` 统一戳(三种产物形状都覆盖)、cssVars 的 `useCssVars` →
    `useVaporCssVars`(变量名去 `data-v-` 前缀)、模板 preamble 前置。
- `useVaporCssVars` 由 fjs/vapor 实现(css-vars 注册栈 + 挂载期应用到块根元素 + renderEffect
  响应),补上 3.6 时代 vapor 页 v-bind() CSS import 不存在的洞。

## 3. enableVapor 语义

`createFjsApp({ enableVapor: true })`,两端同形(宪法 I):

| | Flutter | Web |
|---|---|---|
| 页面挂载 | 路由 `mount()` 的 vapor 分支:`createVaporApp(page, ctx)` 挂进 `flutterRoot`,不经 vue 渲染器 | 纯 vapor 壳(`createVaporApp(shellComp)` 起根),页 host 由壳管理 |
| `useRouter` / `useRoute` | 模块级回退已存在(flutter.ts `injectOr`);补 `activeNativeRoute` 使 mount 期间读到当页 route | `useRoute` 从 vue-router 直导改为带「无组件实例」回退(读 `vueRouter.currentRoute.value`,同一份 reactivity) |
| shell | `options.shell` 需为 vapor 组件或省略 | 壳即本实现 |
| 全局组件 | `resolveComponent` 走 `VaporAppContext.components` = 内置 fjs 组件(canvas/list-view/form/picker/rich-text/textarea/defer)+ `options.components` | 同左 |
| 插件 / setup | `options.setup?.(app)` 与 `applyPlugins`(vue App 面)不生效——没有 vue app | 同左 |
| vdom 组件进 vapor 页 | interop(`backend-flutter.mountVdomComponent`)仍可用,vant 类库照旧——代价是 vdom 渲染器进包 | **不可用**:web 的 vdom interop 依赖 runtime-dom 的渲染器;纯 vapor 应用页内组件需自行 vapor 化 |

### 已知边界(有意不做,文档写明)

- **flutter 包体的 vdom 渲染器还在**:backend-flutter 的 nodeOps/patchProp/克隆机制、路由的
  `flutterRoot/releaseRoot` 都从 `vue/renderer` 拿,该模块与 runtime-core 渲染器同体——
  抽出「renderer 无关的 element 原语层」才能让纯 vapor 的 flutter 包真正摇掉渲染器,另立
  spec。本 spec 拿到的实际收益:无 wrapper、无收养、无 per-page Vue app、页面不再走 vdom
  patch 路径。
- web `enableVapor` 壳是简化版:visited 页面常驻缓存(LRU 16,不按历史栈销毁)、无 tab 停靠、
  过场只有进场的 `fjs-page-enter`。滚动快照保留。
- 小程序面(`--mp`)不支持 enableVapor(wx 壳独立)。

## 4. CLI

- `usesEnableVapor(root, entry)`:读入口源码,匹配 `createFjsApp` 调用里的
  `enableVapor: true`(与 usesVapor 同款静态扫描,缓存)。
- 开启后:`vaporWrapperPlugin` 不再进插件列表(vite 的 `resolveId` wrapper 重定向同样关);
  vueSfcPlugin 对非 vapor SFC 打一次警告(enableVapor 声明下出现 VDOM 页 = 配置错误,
  静默会白屏);web 构建别名 `vue` → vue-shim(runtime-core,无 runtime-dom),
  `webPinPlugin` 的 vue 钉扎让位。
- `--pages` 共享判定不变(`fjs/vapor` 照旧按 usesVapor 共享)。

## 5. 契约变更(宪法 II)

- [ ] UI op 协议 / natives 表 / 事件类型:均不涉及。
- 公开 API:`FjsAppOptions.enableVapor`(两端)、`FjsAppOptions.components`(flutter,
  vapor 全局组件)、fjs/vapor 新导出 `useVaporCssVars`。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`(runtime / cli)全绿;`flutter test` 无回归。
2. 版本面:全仓 grep 无 `3.6.0-rc` 运行时依赖;唯一 rc 是 CLI/fjs-runtime devDep 的
   `@vue/compiler-vapor`(构建期)。demo/hello-fjs/racing/fjs-webview/create 模板均为 3.5.43。
3. vapor 回归:bench `vapor` / `native:on`、demo `vapor-check`(button 3 / cell 2 /
   switch 1 / stepper 1,点击与 v-model)、`nav-vapor` 全通。
4. enableVapor(Flutter):一个纯 vapor 示例应用经 `createFjsApp({ enableVapor: true })`
   路由挂 vapor 页,push/back 正常,页面内 ref 响应、事件、v-for/v-if 生效(fjsrun 断言)。
5. enableVapor(Web):同一示例 `fjs build --web`,bundle 无 runtime-dom 痕迹
   (`createElement`/`runtime-dom` 检查),vite dev 页面渲染可导航。
6. 包体:enableVapor web bundle 不含 runtime-dom、wrapper(`fjs-vapor-root`)、KeepAlive。
7. 文档:`docs/vue3.md`(enableVapor 章节 + 编译器拆分)、`docs/toolchain.md`(依赖)。

## 7. 结果（2026-09-30）

**版本面**：应用侧 `vue` / `@vue/runtime-core` 全部 `3.5.43`（demo / hello-fjs / racing /
fjs-webview / create 模板）；fjs-runtime 运行时依赖 `^3.5.43`。全仓唯一的 3.6 产物是
`@vue/compiler-vapor@3.6.0-rc.9`（CLI dependency + fjs-runtime devDependency，构建期 only）。
CLI 的 `@vue/compiler-sfc/core/shared` 同步回 `3.5.43`。

**自研 SFC 编译器**：`fjs-runtime/src/vapor/sfc-compiler.ts`（parse+script=3.5，模板直调
compiler-vapor，五处拼接见 §2）+ `sfc-tags.ts`（tag 判定/解析选项，从 vue-plugin 分出，
fjs-runtime 与 CLI 共用）。`useVaporCssVars` 落在 `vapor/css-vars.ts`（挂载桶 + 后端
`setCssVars` seam），补上 vapor 页 v-bind() CSS 的洞。runtime 879 / cli 450 全绿，
typecheck（含 vapor-app 的 vue-tsc）全绿。

**enableVapor**：
- Flutter：路由 `mount()` 的 vapor 分支（`createVaporApp` 直挂 flutterRoot，`entry.app`
  收敛为 `{unmount}`），`useRoute` 的 `activeNativeRoute` 回退，内置 fjs 组件表进
  `vaporComponents`。
- Web：`app/web-vapor.ts` 纯 vapor 壳（vue-router 只当导航驱动，`fjs/app` 在 enableVapor
  下整个别名到它）；`vapor/web.ts` 拆成 `web-dom.ts`（纯 DOM 后端）+ `web-interop.ts`
  （vdom interop + adopt），enableVapor 的 `fjs/vapor` 别名到 `web-pure.ts`（只有 web-dom）。
- CLI：`usesEnableVapor(root, entry)` 扫入口；wrapper plugin / vite resolveId 关闭；
  非 vapor SFC 逐文件警告；web 双别名（vue→runtime-core dist、fjs/app、fjs/vapor）。
- 验证：`examples/vapor-app`——`pnpm run check`（fjsrun + TS 样式引擎，断言
  title/count/v-if/v-for 全过，QuickJS 引擎）；`pnpm run build:web` 后 bundle 扫描
  **runtime-dom 0 / fjs-vapor-root 0 / adoptVaporComponent 0 / createRenderer 0 /
  createApp 0**（KeepAlive 4 处为 runtime-core 内部判定函数碎片，非渲染器）；bundle
  232K→200K（interop 渲染引擎剔除）。runtime 侧 `router-vapor-mount.test.ts`（flutter
  原生挂载 + 导航 + useRoute 无实例回退）与 `web-vapor-shell.test.ts`（happy-dom：
  挂载/导航/LRU 缓存/状态存续）双绿。

**边界与后续**（如实记录）：
- Flutter 包体仍带 vue 渲染器：backend-flutter 的 nodeOps/克隆与路由的 flutterRoot 都从
  `vue/renderer` 拿，「renderer 无关的 element 原语层抽出」另立 spec 后，纯 vapor 的
  flutter 包才能摇掉它。
- runtime-core 的渲染引擎在 enableVapor web 已彻底出包；`createApp` 的 Throw、非
  enableVapor 的互操作照旧。
- 编译器拆分后 vapor 产物与 3.6 compileScript 语义对拍（既有 10 条编译测试 + demo
  vant/vapor 互操作 + bench 三方对拍）全过；sourcemap 的模板段映射不再产出（脚本段保留，
  DevTools 容忍，原 vite 路径即如此）。

## 8. 二次修复（web 实测暴露，2026-10-01）

浏览器实测 `examples/vapor-app` 抓到三个问题：

1. **vite resolveId 在 enableVapor 下放行了 plugin-vue**（真 bug）：`resolveId` 对 vapor
   SFC 返回 `null`（本意是「无 wrapper」），落进 plugin-vue 的编译——其产物从 `'vue'` import
   `useCssVars`，而 enableVapor 的 `vue` 钉在 runtime-core 上没有该导出，页面白屏。修复：
   enableVapor 分支直接路由到 `\0fjs-vapor-sfc:` 虚拟模块（自研编译器），只是不生成 wrapper。
2. **纯 vapor 壳从未启动 vue-router**：install() 才会做初始导航并注册 history 监听，纯 vapor
   应用没有 Vue app 可装——打开 `/#/about` 显示 `/`，浏览器返回键无效。修复：mount() 复刻
   install 的启动 push（`router.options.history.location`），首个导航完成即 markAsReady。
3. **example 缺 vite.config.ts 与根 index.html**（我的遗漏）：`dev:web` 无插件可用、dev server
   404。已按 racing 的形状补齐。

**顺手统一了 vapor 的 tag 判定（两端同源）**：vapor 模板里 fjs 标签（view/text/image…）在
web 上原先编成组件、走 resolveComponent——那只在「vapor 页挂在 VDOM app 里、组件表由
installFjsWeb 注册」的前提下成立，纯 vapor 壳没有组件表。改为两端一致：fjs 标签编译成
**原生元素**（web 后端 document.createElement 出的就是同一批自定义元素，样式来自
base-css、手势走后端 on()；Flutter 端规则不变），组件标签（form/picker/list-view/textarea
等）仍走组件解析。vite dev 实测：vapor-app 首页渲染/点击/v-if/v-for/导航/浏览器返回/状态
保留全通；`fjs build --web` 产物同口径全通且 runtime-dom/createRenderer 仍为 0；demo
vant/vapor 互操作页（vite）渲染与点击正常；flutter 端 vapor-check 复测全过
（runtime 879 / cli 449）。
