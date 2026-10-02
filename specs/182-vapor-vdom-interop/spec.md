# Spec: enableVapor 按需带 VDOM interop（vant / nutui 等三方组件库）

- **ID**: 182-vapor-vdom-interop
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

specs/181 用 demo 测三方库时发现：`enableVapor: true` 的应用用不了 vant / nutui。纯 vapor 包里没有 Vue 渲染器
（specs/166/169/171 的取舍），三方 VDOM 组件只能走 render-host，而 render-host 明确只服务 fjs 自己的控件：
vant 依赖 `getCurrentInstance().proxy`、`createApp`（命令式弹层）、`vShow` / `vModelText`、runtime-dom 的
`<Transition>` 等。web 上 dev 直接起不来（依赖预构建报 `vShow` 不是 `vue` 的导出）。

用户拍板（specs/181 待澄清）：**按需带 interop**——项目用了三方 VDOM 组件库时，enableVapor 自动把 Vue 渲染器和
interop 打进来；页面仍是 vapor，三方组件经真渲染器挂载（Vue 3.6 `vaporInteropPlugin` 的思路）。没用这类库的应用包体不变。

## 2. 不做什么（Non-goals）

- 不改非 enableVapor 应用的包形状（它们本来就带 interop）。
- 不让项目自己的 Options API 组件走 interop（specs/177 已提示改写）；只针对三方包。
- 小程序端不涉及。

## 3. 用户可见的行为

```ts
// main.ts —— 不需要额外配置
createFjsApp({ enableVapor: true, plugins, routes, shell: Shell }).mount();
```

- 构建 / dev 时扫描项目源码导入的三方包：包里含 VDOM 编译产物（`createVNode` / `openBlock` /
  `createElementBlock` / `createBlock`）即判定为 VDOM 组件库，开启 interop。日志提示一次：
  `[fjs] enableVapor: VDOM component library detected (vant) — bundling the Vue renderer for interop`。
- `package.json` 的 `fjs.vapor.interop: true | false` 可强制开 / 关。
- 开启后：页面、壳、项目组件仍编成 vapor；`<van-button>` 等经 interop 用 Vue 渲染器挂载；`showToast()` 等命令式
  API（`createApp`）可用；VDOM 子树能 inject 到 vapor 祖先 provide 的值（pinia、路由），能解析 app 注册的全局组件。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| interop 入口 | `fjs/vapor` → `vapor/index.ts`（带 backend-flutter-interop） | `fjs/vapor` → `vapor/web.ts`（带 web-interop），`vue` → `vapor/vue-interop.ts`（runtime-dom + vapor 生命周期） |
| VDOM 渲染器 | fjs 自己的 renderer（vue-shim） | runtime-dom（替换 web-interop 原先的简化 createRenderer：style 对象、DOM prop、vShow/vModel 都走真实现） |
| provide / 全局组件 | VDOM 根拿到 vapor 父组件的 provides、app 的 components / directives | 同左 |
| 已知差异 | Flutter 端 vant 的命令式 API 仍靠 demo 的 vite 插件补丁（与 VDOM 模式相同） | — |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（op 协议 / natives 不变）

## 6. 验收标准

1. demo 加 `enableVapor: true`：web dev 能起，全部 17 个路由（vant / nutui / pinia）静态 + 点击探针与 VDOM 模式一致、无新增报错。
2. demo `enableVapor: true` 在 iOS 上 vant 页面可用。
3. hello-fjs（无 VDOM 组件库）仍判定为纯 vapor，`fjs build --web` 产物里没有 runtime-dom。
4. `pnpm run typecheck`、`pnpm test` 通过；新增检测与 interop 的单测。

## 7. 待澄清

- 无（方向已由用户确定）

## 8. 实现记录

demo `enableVapor: true` 逐步跑通时遇到并修掉的问题：

| 现象 | 原因 | 修复 |
|---|---|---|
| web dev 依赖预构建失败（`vShow` 等不是 `vue` 的导出） | 纯 vapor 的 `vue` 是 runtime-core | interop 时 `vue` → `vapor/vue-interop.ts`（vue 包的 runtime 构建 + 双模生命周期） |
| vant 组件 style 对象丢失、多根组件顺序颠倒 | web interop 用的是自写的简化 createRenderer（style 走 cssText 字符串），reposition 逆序插入 | 改用 runtime-dom 的 `render`；插槽桥接改为占位元素 + vnode 钩子（支持作用域插槽参数） |
| `<GridItem> must be a child component of <Grid>`（Tabs / Collapse / Steps / Sidebar 同） | 写在 vapor 模板里的子组件是另一个独立的 VDOM 根 | 插槽桥接记下调用插槽的 VDOM 组件，插槽内再挂的 VDOM 组件以它的 provides 为父 |
| ActionSheet / Dialog 打开后不显示 | 顶层宿主只取了一层 subTree（ActionSheet → Popup → Fragment），插槽根位置挂载时 Fragment 的其余节点留在临时容器里 | 沿组件 subTree 下钻取 Fragment / Teleport 的起止范围 |
| Flutter 构建失败：`fjs/vue` 没有 `createApp` | demo 的 vant 补丁让命令式 mount 从 `fjs/vue` 取 createApp | interop 时 Flutter 的 `fjs/vue` 用完整面 |
| Flutter 上 vant Tabbar 竖排溢出 | Flutter 插槽桥接的包装 view 是真实的盒 | Dart 渲染器支持 `display: contents`（收集子节点时展开、脏标记沿它向上），包装节点设 `display: contents` |
| 离页后 vant Popover（teleport 到 body）仍盖在下一页上 | 壳缓存页面不跑 deactivated；VDOM 组件渲染的插槽里的 vapor 组件不在页面实例树上 | 壳切页时 deactivate / activate；interop 把 VDOM 子树的钩子挂到 vapor 父实例；无当前实例时插槽内容归插槽作者 |
| web 上 vapor 模式页面样式错位（页面根背景 / 内边距、按钮颜色丢失） | interop 挂载的组件（开 interop 后 fjs 的组件型标签 scroll-view / button 也走这里）根元素没拿到父组件的 scoped id | 父组件（插槽内容为插槽作者）的 `__scopeId` 设到 VDOM 根 vnode 上，由 runtime-core 落到根元素 |
| 全页水印尺寸回落默认值 | `v-bind="obj"` 与其它 prop 混写时 compiler-vapor 把 props 放进 `$` 动态源，组件层只读顶层 key | createComponent 入口摊平 `$`：后写的覆盖先写的，class / style 合并 |
| float 页 Sticky 进页即判吸顶（top 468） | vapor web 壳先插入新页、挂载后才加转场类，新页 onMounted 时排在旧页下面量位置；模板 ref 拿到的是 interop 块 | 壳先处理离场、新页插入前就带 enter 类（Vue `<Transition>` 的顺序）；interop 组件的模板 ref 为组件公开实例 |

页面样式对比：demo 16 个路由在 390×844 下逐元素比对位置、尺寸与 18 项计算样式，vapor 与 VDOM 一致（剩余差异只来自网络时序、
旋转中的 loading 图标与跑马灯）。

验收：demo web 17 个路由静态 + 点击探针（含组件式 / 命令式弹层、表单 v-model、Collapse / Tabs / Sidebar /
Picker / 数字键盘、Popover 跨页）全部可用、无新增报错；iOS 16 个路由无报错，Tabbar / Grid / ActionSheet
抽查正常。hello-fjs 判定为纯 vapor，`fjs build --web` 产物无 runtime-dom。`pnpm test`、`pnpm run typecheck`、
`flutter test`（562）通过。

