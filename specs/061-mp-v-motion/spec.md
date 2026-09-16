# Spec: 小程序端的 v-motion（@vueuse/motion 三端同源）

- **ID**: 061-mp-v-motion
- **状态**: done
- **日期**: 2026-09-16

## 1. 要解决什么

`examples/hello-fjs/package.json` 的 `fjs.mp.exclude` 去掉了
`example/animation/`，anime 与 motion 两页开始参与小程序构建。anime 页靠
「动普通对象」在小程序端本来就成立（spec 031），motion 页的三个面板里只有
第三个（`useSpring` 缓动 reactive 对象）成立，前两个用的是 `v-motion` 指令：

- 编译期：`[fjs/mp] motion.vue: unsupported directive v-motion`，指令被丢弃，
  `:initial` / `:enter` / `:variants` 作为不认识的属性泄漏进 WXML；
- 运行期：页面渲染正常但**完全没有动画**，`:ref` 拿不到 `motionInstance`，
  「出发 / 返回」「重播入场」三个按钮都是空操作。

根因与 spec 042 在 App 端遇到的是同一个：motion 的指令路径是
`el.style[key] = value`，而小程序端模板编译成了 WXML，**根本没有元素**。App
端的解法是给 fjs 元素合成一个 DOM 形状的 `style`；小程序端没有元素可以合成。

## 2. 不做什么（Non-goals）

- 不在小程序端引入 vdom / 自定义渲染器（模板走 WXML 是 spec 046 的前提）。
- 不改 motion 页源码：三端同源，页面继续写 `v-motion`。
- 不支持需要 DOM 事件或 IntersectionObserver 的变体（见 §3）。
- 不把 `@vueuse/motion` 塞进 `@ufjs/runtime` 的包（运行时不依赖任何动画库）。

## 3. 用户可见的行为

`v-motion` 元素在小程序端按 variants 动起来，和另外两端同源：入场
(`initial` → `enter`，含 `transition.delay` 的 stagger)、命名 variants 经
`:ref` 拿到的 `motionInstance.apply('right')` 驱动、`:key` 变化重播入场。

编译期告警后丢弃的（写了也不报错，只是不动）：

| 变体 | 为什么 |
| --- | --- |
| `hovered` / `tapped` / `focused` | 要 DOM 事件监听 |
| `visible` / `visibleOnce` | 要 IntersectionObserver |
| `leave` | 要 vdom 卸载钩子 |

另外：嵌套 v-for 里的 `v-motion` 丢弃并告警（一层 v-for 支持）。

## 4. 三端约定（宪法 I）

页面源码一份，三端行为一致（上表的差异登记在
[`docs/miniprogram.md`](../../docs/miniprogram.md)）。改动只在
`packages/fjs/src/mp`（编译器）与 `packages/fjs-runtime/src/wx`（运行时），
Flutter / Web 侧不变。

## 5. 契约变更（宪法 II）

- [x] 运行时新增导出：`@ufjs/runtime/wx` 的 `motion` / `motionEach`、
      `setImmediate` / `clearImmediate`
- [x] 编译产物新增：`WxmlResult.usesMotion`，为真时页面模块多两行 import
- [x] `SHADOWED_GLOBALS` 增加 `setImmediate` / `clearImmediate`（见 §6 附带）

## 6. 做法

**替身（stand-in）**：motion 全部的元素接触面只有 `el.style[key]` 与
`el.style.transform`（`useElementStyle` / `useElementTransform`）。所以运行时
造一个 `{ style: reactive({}) }` 的普通对象交给 `useMotion`，并关掉两个需要
宿主能力的特性（`visibilityHooks: false, eventListeners: false`）——
`lifeCycleHooks` 负责 initial → enter，`syncVariants` 负责 variant 切换，
两者都只用 `watch`。替身的 style 经 `stringifyStyle` 变成 CSS 串，元素绑
`style="{{ __m0 }}"`（v-for 里 `__m0[index]`）。

**库不进运行时包**：`useMotion` 由编译出的页面模块 import 后作为第一个参数
传进 `motion()` / `motionEach()`。

**实例生命周期**：`motionEach` 按 index 持有实例，列表增删只建/停差量的那几
个——每帧重建会让动画一直从头开始。`:key` 表达式也编译进去：key 变了就停掉
旧实例、重建一个，等价于另外两端的重挂载重播。

**附带：`setImmediate`（anime 页）**。同一批放开的 anime 页在小程序端启动即
`ReferenceError: setImmediate is not defined`：Anime.js 用
`isBrowser ? requestAnimationFrame : setImmediate` 在**模块求值期**挑主循环，
而它在 npm vendor 包里——那个包的顶层在任何页面第一次 require 它时就跑完，页
面侧的 polyfill 模块根本来不及。所以 `setImmediate` / `clearImmediate` 进
`SHADOWED_GLOBALS`：vendor 包与用到该名字的模块都拿到指向运行时的注入绑定
（映射到同一个 16ms 帧定时器），与加载顺序无关。hello-fjs 的 anime 适配层因此
只负责 QuickJS 宿主。

## 7. 验收标准

1. `packages/fjs/test/mp-compiler.test.ts`：`v-motion` 的 style 绑定、变体属性
   不泄漏、v-for 每项一个实例、`:ref` 接线、`:key` 透传、DOM 变体与嵌套
   v-for 的告警。
2. `packages/fjs-runtime/test/wx-motion.test.ts`：替身 style → CSS 串、特性开关、
   `:ref` 句柄可 apply、列表增删的实例复用与停止、numeric v-for、key 变化重建。
3. `pnpm test` 通过；`pnpm --filter hello-fjs run typecheck` 通过。
4. `pnpm --filter hello-fjs run build:mp` 后 motion 页产物里只剩
   `:key` 不是 item property 的既有告警，WXML 里是 `style="{{ __m0[i] }}"`。
5. `packages/fjs/test/mp-shadowed-globals.test.ts`：`isBrowser ? rAF :
   setImmediate` 这类写法要注入 `setImmediate`。
6. 开发者工具真机/模拟器目验 motion 三个面板与 anime 页（用户侧）。
