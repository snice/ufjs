# Spec: render 函数组件在纯 vapor 下运行（web 标签 + 内置组件）

- **ID**: 171-vapor-render-host
- **状态**: done
- **日期**: 2026-10-01
- **分支**: 171-vapor-render-host（从 170-vapor-helper-parity 切出）
- **方案选择**：用户在两条路线中选定「小型 render 函数适配器」（2026-10-01）。

## 1. 要解决什么

enableVapor（纯 vapor，无 VDOM 渲染器）下两端都缺一整类能力：

- **web**：fjs 的标签由 web 适配层的 30+ 个 VDOM 组件实现（input / image / scroll-view / swiper /
  switch / checkbox / radio / slider / progress / picker-view / modal / refresh / page-container /
  sticky-* / form / label / *-group / canvas / list-view / rich-text / textarea / picker / defer …）。
  纯 vapor web 把它们编成同名空元素：`<input @text-changed>` 不触发、`<image>` 不显示、
  `<scroll-view @scroll>` 载荷是 DOM Event 而不是约定的字符串、`<switch>` 无反应（2026-10-01 探针）。
- **Flutter**：内置 7 组件（canvas / defer / form / list-view / picker / rich-text / textarea）是 VDOM
  组件，specs/169 把它们从 enableVapor 包里拿掉了，vapor 页用不了。

这些组件形状统一：`setup` 里用 ref / watch / computed / 生命周期 / provide-inject（表单控件登记），
返回一个 render 函数 `h(tag, props, slots)`。specs/167/170 之后除「执行 render 函数」外都已就绪。

## 2. 不做什么

- 不重写这些组件（每个组件仍只有一份实现，VDOM 与 vapor 共用）。
- 不在非 enableVapor 应用里替换现有互操作（有 VDOM 渲染器时仍走它，保真度最高）。
- 不支持 vant 等完整三方 VDOM 库在纯 vapor 下运行（它们需要完整渲染器语义：KeepAlive、
  Suspense、指令、动态组件……）。适配器只承诺本仓库内置组件用到的子集，遇到不支持的 vnode
  类型明确报错。
- swiper 的 `circular`（克隆首尾页）在纯 vapor 下不可用：vapor 插槽内容是活节点，不能复制——
  告警并按非循环处理。

## 3. 方案与用户可见的行为

1. **render-host（适配器，`vapor/render-host.ts`）**：在纯 vapor 入口里，`createComponent` 遇到
   非 vapor 组件且后端没有互操作时，用它挂载：
   - 组件包成一个 vapor 组件（复用 vapor 组件层：props/attrs 拆分、生命周期、provide/inject、
     expose）；`setup` 返回的 render 函数在 renderEffect 里重算，产出的 vnode 树（runtime-core 的
     `h` 创建）与上次比对后增量写宿主：同类型元素改 props、子节点按 key / 位置复用、类型变了重建。
   - 支持的 vnode：元素、文本、注释、Fragment、组件（vapor 组件走 vapor；render 函数组件递归走
     render-host）、Teleport（`to` 选择器 / 元素，web）、以及 vapor 插槽返回的 Block。
   - vapor 父组件传来的插槽返回 Block：适配器把它转成「宿主节点 vnode」，`cloneVNode` 加 class / key
     也能用（swiper 的轨道单元）；同一插槽按调用序号缓存 Block、插槽参数原地更新，重渲染不重建。
   - `inheritAttrs` 默认的组件，attrs 合并进根 vnode（与 Vue 一致）；`onUpdated` / `onBeforeUpdate`
     在 render-host 组件里生效（每次比对前后）。
2. **props 归一化（Vue 语义）**：vapor 组件层补上 Boolean 转换（缺省为 false、`""` / 同名字符串
   为 true）与带类型的默认值工厂——render 函数组件依赖它（`disabled: { type: Boolean }`）。
3. **标签组件按需注册（两端）**：编译器在 vapor 模式下发现模板用到「组件型 fjs 标签」时，给模块
   注入 `import 'fjs/tag/<tag>'`；该模块把组件注册进运行时的标签表，`resolveComponent` 查不到 app
   组件时回落到标签表。只打包页面实际用到的标签组件（specs/168 的包体收益不丢）。
   - web 的「组件型标签」= web 适配层里有行为的标签；`view` / `text` / `safe-area` / `swiper-item`
     等只有手势与样式的标签保持原生元素（4050 网格这类热路径不经适配器）。
   - Flutter 的「组件型标签」= 内置 7 组件（其余标签是 Dart 原生 widget）。
4. **组件小修**：`nodeIdGetter` 改用 `useAttrs()`（`getCurrentInstance` 在 vapor 下为 null）；
   rich-text 的页面 scopeId 在 vapor 下取不到时降级（不带页面 scoped 样式，告警一次）。

## 4. 两端约定（宪法 I）

| | Flutter（enableVapor） | Web（enableVapor） |
|---|---|---|
| 内置 7 组件 | 恢复可用（render-host） | 恢复可用（render-host） |
| web 标签组件 | —（Dart widget） | 恢复可用（render-host） |
| 事件载荷 | 字符串（不变） | 字符串（组件实现本来如此） |
| swiper circular | Dart 实现，可用 | 告警，按非循环 |

## 5. 契约变更

- [x] op / natives / 事件类型不涉及。新增内部说明符 `fjs/tag/<tag>`（编译器生成）。

## 6. 验收标准

1. typecheck / test 全绿。
2. render-host 单测：元素 / 文本 / Fragment / 组件嵌套 / keyed 子节点重排 / 类型切换 / Teleport /
   vapor 插槽 Block（含缓存不重建）/ attrs 合并进根 / onUpdated / ref。
3. 纯 vapor web（happy-dom，web-pure 入口 + 标签注册）：input 的 text-changed / value、image 出
   `<img>`、scroll-view 的 scroll 载荷是字符串、switch 点击切换并发 change、checkbox-group、
   picker-view、form 提交收集字段、list-view 作用域插槽、textarea、canvas ref getContext、defer。
4. 纯 vapor Flutter（flutter-pure）：内置 7 组件各一条冒烟（list-view items + 作用域插槽、textarea
   事件、defer 就绪、form 收集、rich-text 节点、picker、canvas 的 ref）。
5. 包体：vapor-app（只用 view/text）web 与 Flutter release 的 shared.js 不因本 spec 变大超过 3 KB；
   用了 input 的页面只多出 input 所在模块。
6. 浏览器：vapor-app 加一个「表单」页（input / switch / checkbox / picker / list-view），web 生产包
   实测交互；iOS 模拟器同页实测。
7. 回归：demo vapor-check / nav-vapor、bench、hello-fjs web 两种构建。
8. 文档：`docs/vue3.md`（enableVapor 能力边界更新）、`docs/vapor-contract.md`（render-host）。

## 7. 待澄清

无（路线已由用户选定；circular / scopeId 的降级按「明确告警」原则处理）。

## 8. 结果（2026-10-01）

- 纯 vapor 两端：web 28 个组件型标签、两端内置 7 组件经 render-host 运行；vapor-app 新增「表单」页
  （input / switch / checkbox-group / picker / form / list-view）在 web 生产包与 iOS 模拟器实测：输入、开关、
  复选、表单提交（`{"name":…,"notify":…,"fruits":["pear"]}`）、列表加行、picker 弹出与确定都正常。
- 实施中发现并修复的两个既有问题：**Flutter 端 vapor 模板静态属性全部丢失**（只带 class——`<image src>`、
  `<input placeholder>`、`name` 等都没了）；**父组件 scoped 样式不作用于子组件根元素**（Flutter 上
  `list-view` 因此高度无界而抛错）。另：编译器注入正则对 `_resolveComponent` 不匹配（`\b` 误用），
  页面文件名与原生标签同名会被 Vue 当成自引用（示例页由 form.vue 改名 controls.vue）。
- 包体（相对 spec 170）：vapor-app web 123.7 → 128.0 KB（gz 46.3 → 47.8），Flutter release
  shared.js 213.6 → 214.9 KB；增量来自样式规范化与 touch（web）。用到控件的页面自带其 chunk。
- 测试：runtime 943；回归 demo vapor-check / nav-vapor 输出不变，bench 在噪声内，hello-fjs 两种 web 构建成功。
