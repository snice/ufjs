# Vapor vs VDOM 对比总结（specs/181–182，2026-10-02）

自研 vapor 运行时（specs/161–180）在两个真实项目上做了完整回归：`examples/hello-fjs`（66 个路由，覆盖全部内置标签、
样式、动画、canvas / three / echarts / 游戏）按 `enableVapor` 开关两种模式逐页对比，`demo` 测三方库（vant / NutUI /
pinia）。本文是测试结论与两种模式的对照。

## 1. 结论速览

- **hello-fjs**：首轮 `enableVapor: true` 在 web 上首页即栈溢出、27 个路由白屏。修掉 14 个问题后，web 66 个路由的静态
  文本 / 结构、41 个路由的按钮点击结果与 VDOM 模式一致（剩余差异只有网络请求、随机数、计时等非确定内容）；iOS 66 个
  路由两种模式均无报错。
- **demo（三方库）**：原设计下 enableVapor 不能用 vant / NutUI（纯 vapor 包里没有 Vue 渲染器）。按用户选择改为
  **按需带 interop**（specs/182）：检测到三方 VDOM 组件库就自动把渲染器打进来。现在 web 17 个路由、iOS 16 个路由全部
  可用，组件式 / 命令式弹层、表单 v-model、父子联动组件、Popover 跨页都正常。
- **修复多数在共用的运行时里**（`vapor/host.ts` / `runtime.ts` / `render-host.ts`），两端同时受益。几个 bug 很基础
  （v-for 的 index 别名错、多根块直接抛错、静态 v-for 在插槽根丢格子），说明此前 vapor-app 这个小样本覆盖不够——
  `test/vapor-real-app.test.ts` 把这些形状固定成了回归测试。

## 2. 能力对照

| 能力 | VDOM（`enableVapor: false`） | Vapor（`enableVapor: true`） |
|---|---|---|
| SFC 编译 | 全部 VDOM；单个 `<script setup vapor>` 可选 | 项目 SFC 全部 vapor（specs/177）；Options API 组件提示改写 |
| 模板语法 | 全部 | compiler-vapor 的全部 helper（specs/170）；v-for 支持数组 / 数字 / 字符串 / 对象 / Map / Set（specs/181） |
| 生命周期 | 全部 | mount / unmount / activated / deactivated；`onUpdated` 只对 render 函数组件有意义；`onErrorCaptured` 不支持 |
| setup 抛错 | errorHandler，组件为空 | 同左（specs/181，此前整页白屏） |
| provide / inject、pinia、vueuse | ✅ | ✅（双模函数，specs/167） |
| `getCurrentInstance()` | ✅ | vapor 组件里为 null（伪造会让读 `proxy` 的库崩） |
| Transition / KeepAlive / Teleport / TransitionGroup | ✅ | ✅（specs/174–176，178–179） |
| 自定义指令 | 对象式 | 函数式 + **对象式适配**（specs/181：created … unmounted，`vnode.props` 给出元素上绑定的值，`v-motion` 可用） |
| fjs 内置标签 / 组件 | VDOM 组件 | render-host 执行同一份实现（specs/171） |
| 三方 VDOM 组件库（vant、NutUI） | ✅ | ✅ 按需带 interop（specs/182，自动检测，`fjs.vapor.interop` 可强制） |
| 路由（web） | vue-router + KeepAlive 页面栈 | 自写 history 驱动（specs/173），LRU 页面缓存 16 页，切页跑 deactivated / activated |
| `app.use` / `app.provide` / `app.component` / `app.directive` | ✅ | ✅（app 外壳，specs/167；directive 自 specs/181） |
| `app.mixin`、第二次 mount | ✅ | 告警忽略 |
| Suspense | ✅ | ❌ |

## 3. 包体

`fjs build --web` / `fjs build --pages`（dev 形态，未 `--release`），JS 合计，gz 为 `gzip -9`：

| 应用 | 模式 | Web | Flutter shared.js |
|---|---|---|---|
| vapor-app（两页 + Shell + pinia，框架本身的差距） | VDOM | 294.6 KB / gz 105.6 KB | 323.4 KB / gz 116.4 KB |
| | Vapor | **183.2 KB / gz 65.7 KB（−38%）** | 350.0 KB / gz 123.8 KB |
| hello-fjs（three / echarts / pixi 等占大头） | VDOM | 3922.7 KB / gz 1233.8 KB | 477.5 KB / gz 168.2 KB |
| | Vapor（纯，无 runtime-dom） | 3867.1 KB / gz 1213.3 KB | 472.2 KB / gz 166.0 KB |
| demo（vant / NutUI） | VDOM | 605.9 KB / gz 212.0 KB | 858.2 KB / gz 291.8 KB |
| | Vapor + interop | 527.1 KB / gz 184.6 KB | 827.4 KB / gz 278.8 KB |

- web 收益明确：纯 vapor 不带 runtime-dom / vue-router / VDOM 组件表。带 interop 的 demo 仍比 VDOM 小 13%（页面与壳是
  vapor，vue-router 不在图里）。
- Flutter dev 包里 vapor 不一定更小：分页构建的 shared.js 以整命名空间导出，tree-shake 不掉。`--release` 收窄导出后
  vapor-app 为 207.3 KB，比 VDOM 小 34%（数据见 docs/performance.md「Vapor 包体」）。

## 4. 性能（引用已有数据）

见 docs/performance.md 的 flat-4050（2000 格）记录：**更新**是 vapor 的主场——改 1 / 200 格 JS 从 VDOM 的十几到几十 ms
降到 0–6 ms；**挂载**在真机上与 VDOM 持平（iPhone，中位 ~87–92 ms），Flutter 侧帧构建两条路径完全一致（镜像树同构）；
帧流量 vapor 21 KB vs VDOM 47 KB。本轮没有新增基准。

## 5. 本轮修复（明细在 spec.md §8 与 specs/182 §8）

hello-fjs（spec 181）：模块 SFC 的 `fjs/data` 解析、`vue` 缺 runtime-dom 名字、`<slot>` 转发递归、多根块活节点列表、
静态 v-for 插槽根丢格子、v-for 别名、render-host 插槽 scope 被误停、rich-text 段落 span、对象式指令、render-host 任意
prop 变化触发更新、render-host 重渲染的解析告警、web canvas 隐藏时上报 0 尺寸、setup 抛错隔离、页面缓存的
activated / deactivated。

demo（spec 182）：自动检测 + interop 别名、web interop 换成 runtime-dom 真渲染器、跨 vapor 插槽的 VDOM 父子 inject、
嵌套组件根的宿主范围、Flutter `display: contents`、页面缓存下 VDOM 子树的 deactivated。

## 6. 已知差异 / 限制

- **元素结构**：vapor 在 Flutter 端用零尺寸 `view` 做锚点，内联文本折叠进元素本身——元素数与 VDOM 不同，画面一致。
- **web 页面缓存**：vapor 壳把离开的页面留在 DOM 里（`display: none`，LRU 16 页），VDOM 壳用 KeepAlive 摘出 DOM。依赖
  「离开页面即销毁」的代码在 vapor 下要改用 `onDeactivated`。
- **`getCurrentInstance()` 为 null**：vapor 组件里读实例的库代码走无实例分支（vueuse 正常）。
- **interop 的边界**：VDOM 组件是独立的渲染根，经插槽桥接维持父子 inject；VDOM 组件之间依赖 `parent.subTree` 排序子组件
  （vant 的 useChildren）时，写在 vapor 模板里的子组件按挂载顺序排。
- **Flutter 端 vant 命令式 API** 与 VDOM 模式一样依赖 demo 的 vite 插件补丁。
- 未在本轮覆盖：小程序端、Android 真机、release 构建的逐页回归。

## 7. 建议

- **新应用默认可开 `enableVapor: true`**：自写页面与组件全部 vapor，三方组件库自动走 interop，不需要额外配置。
- 以 web 为主、对首屏包体敏感、且不依赖三方 VDOM 组件库的应用收益最大（vapor-app web −38%）。
- 大量细粒度更新的页面（表格、看板、游戏 HUD）在两端都受益于 vapor 的更新路径。
- 仍有 Options API 组件、依赖 `getCurrentInstance` / Suspense / `onErrorCaptured` 的项目继续用 VDOM 模式，或按页面
  逐个写 `<script setup vapor>`（VDOM 应用里 vapor 组件经收养互操作挂载）。
