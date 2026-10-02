# Tasks: 自研 Vapor 运行时

对应 plan：`./plan.md`

## 0. 基线

- [x] T0 改前基线：`examples/bench` `pnpm run vapor`（TS 模式 VDOM 18.0 / 官方 Vapor 32–35 ms）；
  native:on 对拍 hash（page 48142bbd，specs/152）；真机读数见 specs/145 §5（Vapor 显示 JS
  119.5–122.7 ms）

## 1. 运行时核心

- [x] T1 `src/vapor/runtime.ts`：模板解析（walker 形状 + inline fold）+ 平台后端 seam
  （VaporBackend：instantiate / attach / childAt / 文本·类·样式·事件原语）
- [x] T2 `runtime.ts`：renderEffect（`effect()` + 微任务队列 + onStop 存活检查）、块模型
  （nodes/scopes/cleanups）与卸载
- [x] T3 `runtime.ts`：createIf / createFor（keyed diff、item/key 记账、FAST_CHANGE 兼容）、
  setInsertionState（含编译器的 appendIndex 数字形式 → backend.childAt）
- [x] T4 `runtime.ts`：on / once / setAttr / setProp / setClass（normalizeClass）/ setStyle /
  show / delegateEvents（no-op）/ toDisplayString 复用 vue-shim
- [x] T5 `runtime.ts`：defineVaporComponent（`__fjsVapor` 标记；编译产物自带 `__vapor`）、
  createComponent（props getter 代理 + 静态值直传 + 裸函数 slot 归一化）、
  resolveComponent / createAssetComponent / createComponentWithFallback /
  createDynamicComponent（静态求值）、createSlot / useSlots、createVaporApp
- [x] T6 `backend-flutter.ts`：nodeOps/patchProp 底座 + libfjs-style 原生克隆（planOf 的
  def→plan 索引映射与根 parent=-1）+ VDOM 组件 interop（自有渲染器 render + props 快照
  effect + slot 桥 fjs-vapor-slot）
- [x] T7 `web.ts`：DOM 底座（cloneNode(true) 实例化 + 手势 tap/longPress）+ 真 vue 渲染器
  interop；`src/vapor/dom.ts` / `web-apps.ts` / `runtime-dom-shim.ts` 删除；`enableVapor` no-op

## 2. VDOM 页嵌 Vapor（编译期包装 + 收养）

- [x] T8 `renderer.ts`：adopt hook 链（adoptCreateElement / adoptIsMarked）——
  `fjs-vapor-root` 收养已建宿主、patchProp 对收养宿主 no-op
- [x] T9 CLI：`vaporWrapperPlugin` + `vaporWrapperModule`（非 vapor 文件 import vapor SFC 时
  重定向包装）；vite.ts 同步（resolveId + load）
- [x] T10 hello-fjs flat-4050 页不改源码构建通过（GridVapor 经包装），demo vant/vapor 页
  fjsrun 检查全通（button 3 / cell 2 / switch 1 / stepper 1、点击与 v-model 生效）

## 3. CLI 与版本

- [x] T11 vue-plugin.ts：删 runtime-vapor / runtime-dom 钉扎与 vaporDomInjectPlugin、
  enableVapor 注入；`fjs/vapor`（自研运行时）作为 vapor 模块的 import 目标（两端一致）；
  **SFC parse 统一带 templateParseOptions.isNativeTag**（tagType 由 parse 决定——scroll-view
  等带组件孩子的 fjs 标签否则被当组件 resolve）
- [x] T12 版本回退：fjs-runtime `vue@^3.5.42`、删 `@vue/runtime-vapor`、删 devDep
  `@vue/runtime-dom`、加 devDep `@vue/compiler-sfc@3.6.0-rc.9`（测试编 vapor SFC 用）；
  mp watch 改回 3.5 `scheduler` 选项；create 模板钉 ^3.5.42
- [x] T13 web：`fjs/vapor` 单实现（web.ts = 共享 runtime + DOM 后端）；vite alias 指向它；
  dev 侧 prepareVaporSfcSource 删除（wrapper 由 resolveId/load 承担）

## 4. 测试

- [x] T14 `test/vapor-own.test.ts`（7 条）：同树对拍（样式/文本）、v-if + keyed v-for 八轮
  变更对拍、事件含 .stop 对拍、vapor 嵌 VDOM（interop + prop 响应）、VDOM 嵌 vapor（包装 +
  收养 + prop 响应）、vant 式全局注册解析、卸载无残留
- [x] T15 `fjs/test/vue-plugin-vapor.test.ts`（10 条）：vapor 编译、fjs/vapor 导入改写、
  单物理 vue 副本（无 runtime-vapor/runtime-dom）、wrapper 重定向与生成模块、isVaporSfcFile、
  --pages 共享判定
- [x] T16 对拍：bench `native:on/ts/verify` 三模式 vapor hash **一致（91e5c776）**，page 与
  specs/152 的 48142bbd 一致；TS 模式 vapor 帧字节 74 KB（官方路径 120 KB→克隆 49 KB 同口径）

## 5. 验收

- [x] T17 `pnpm run typecheck`（fjs/fjs-runtime）；`pnpm test`（runtime 865 / cli 446 /
  webview 36 / webgl 30）；`flutter test` 561 通过
- [x] T18 bench：自研 Vapor 挂载 **46.5 ms**（TS 模式；官方 runtime-vapor 同口径 32–35 ms——
  见 spec §8 的差距分析）、卸载 4.2、改 1 格 **0.0 ms**、200 格 1.9 ms；demo bench:mount
  vant-nav 冷 8–20 ms 与基线持平（VDOM 不回退）
- [x] T19 web 路径与 Flutter 同一份 runtime.ts（DOM 后端），`fjs build --web` 可编 Vapor SFC；
  浏览器冒烟并入 T14/T15 的对拍与单测（web.ts 的 slot 桥/手势按同契约实现）
- [x] T20 真机 flat-4050 复测：显示 129.3–154.5 / 隐藏 21.3 / 改 1 格 1.0–5.8 / 200 格
  8.9–26.1 / 2000 格 59.4 ms（详见 spec §8；挂载超 Q4 门槛 ~20 ms 的分析见「读法」）
- [x] T21 文档：vue3.md（自研运行时章节重写）、toolchain.md（fjs/vapor 共享判定）、
  performance.md（数字）；包体：不再携带 runtime-vapor 与外壳
