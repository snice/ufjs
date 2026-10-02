# Vue 3 集成指南

> 第二层第 5 篇。这一篇是**使用者视角**：SFC、scoped style、CSS 变量、
> 编辑器提示。渲染器怎么实现的见
> [custom-renderer.md](custom-renderer.md)，样式的支持边界见
> [css-compat.md](css-compat.md)。

fjs 通过 `@vue/runtime-core` 的 `createRenderer` 把 Vue 3 接到原生渲染：
Vue 只负责组件模型（响应式/组合式 API/模板编译产物），所有节点操作被
翻译为 fjs 的二进制 UI 帧交给 Flutter。

以上是 Flutter / Web 两端。小程序端不打包 Vue 运行时：`import { ref } from
'vue'` 被别名到 `@ufjs/runtime/wx`（只有 reactivity 加一层 setup→setData
胶水），模板编译为 WXML，见 [miniprogram.md](miniprogram.md)。

## 快速开始

```bash
pnpm exec fjs create my-app
cd my-app
pnpm install
pnpm run dev:web
```

`src/main.ts`：

```ts
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';

createFjsApp({
  routes,
  shell: Shell,
}).mount();
```

`createFjsApp` 会按 `src/pages` 生成的路由表创建 Flutter 原生页面；Web 构建时
同一入口会被 alias 到 vue-router + DOM 适配层。`ref/computed/watch` 等组合式
API 照常从 `vue` 导入。

普通页面的生命周期跟路由栈走：`router.push()` 打开的页面在返回 / pop 后会
`unmount`，对应的 element 子树、事件处理器和样式引擎索引一起释放。只有
`<route>` 里声明了 `tab` 的根页面会在 tab 间切换时保活；离开 tab 组时这些
parked tab 也会销毁。App 端调试浮层里的 heap 是不触发 GC 的采样，可能包含
已经不可达但还没被 QuickJS 扫掉的对象；`gc()` 只作为诊断工具，runtime 不在
路由切换后定时回收，避免 GC 落进下一次 push / 转场帧里造成抖动。

跑到 App：

```bash
pnpm run run:android
pnpm run run:ios
```

发布构建：

```bash
pnpm run build:release
pnpm run build:apk
```

`examples/hello-fjs` 是更完整的 Vue3 组件画廊，可作为组件和路由写法参考。

## SFC 支持

`<script setup lang="ts">` + `<template>` 完整支持（见
examples/hello-fjs/src/pages/index.vue）。

### `<style>` / `<style scoped>`

style 块完整支持（v1.1 起）。构建时 fjs 的 esbuild 插件把每个 style 块
原样注入运行时样式引擎；scoped 块通过组件 `__scopeId`（`data-v-<hash>`）
与元素关联，class 属性也由渲染器接管（Vue 会把静态/动态 class 归一化成
字符串传入）。

```vue
<template>
  <div class="row">
    <span :class="['chg', changePct > 0 ? 'up' : 'down']">{{ changePct }}%</span>
  </div>
</template>

<style scoped>
.row { flex-direction: row; align-items: center; margin: 2px;
       font-size: 14px; } /* fontSize/color 会继承给子 span */
.chg { flex-grow: 1; color: #555; }
.chg.up { color: #2e7d32; }         /* 复合选择器优先级更高 */
.toolbar button { margin: 4px; }     /* 标签选择器仅匹配本组件元素 */
.wrapper :deep(.child) { color: red } /* 穿透子组件边界 */
</style>
```

**选择器范围（基础集）**：类/标签/`*`、后代（空格）与子代（`>`）组合器、
`:deep(...)` / `::v-deep(...)` / `:global(...)`，以及写在最后一个复合选择器上的
`:active`。属性选择器、其他伪类（`:hover` 等）、id 选择器、at-rule（`@media`
等）会被跳过并告警。

**`:active`（按压态）**：

```css
.row { background-color: #fff; }
.row:active { background-color: #eef4ff; }   /* 按下时 */
```

命中 `:active` 的元素会额外算出一份「按下时」的完整样式，随 `activeStyle` 一起
下发；Flutter 侧由该节点自己的按下状态就地切换，不回 JS，按下到上屏就是一帧。
按压态完全由原始指针事件驱动，不走手势识别器：`onTapDown` 要等赢下竞技场（列表
里是 100ms 之后，快速点击则根本等不到），而 `onTapCancel` 会在外层滚动容器认领
手势时就触发——鼠标的判定阈值只有 1px，手一抖按压态就没了。现在的规则和浏览器
一致：按下即亮，抬手熄灭，只有指针移动超过拖拽阈值（真的在滚动了）才提前熄灭。
web 侧就是浏览器原生的 `:active`。两点差异：`:active` 只能写在
选择器的最后一个复合选择器上（`.row:active .title` 会被跳过并告警）；按压态只作用于
命中的节点自身，其中的继承属性（如 `color`）在 Flutter 侧不会再向子节点传递
（web 会），所以按压反馈优先用 `background-color` / `opacity` / 边框这类自身属性。

**层叠与继承**：优先级 = specificity + 源顺序（scoped 规则额外 +10，
对齐真实浏览器的 `[data-v]` 属性选择器）；最终合并顺序为
标签默认样式 < 规则 < 内联 `:style`。color/fontSize/fontWeight/
fontStyle/fontFamily/lineHeight/letterSpacing/textAlign/textTransform/
whiteSpace 与 CSS 自定义属性（`--x`）沿元素树向下继承（子元素自身声明
优先）。

### CSS 变量与 `v-bind()`

`<style>` 块里可用原生 CSS 自定义属性与 `var()`（含 fallback、链式引用、
循环引用安全降级）：

```css
.page { --muted: #888888; }
.head { color: var(--muted); }          /* 沿树继承 */
.status { color: var(--missing, #aaa); } /* fallback */
```

`v-bind(expr)` 把 JS 响应式状态直接绑进 CSS（机制与 web 版 Vue 相同：
插件改写为 `var(--<id>-<expr>)`，compileScript 注入的 useCssVars 在
运行时把计算后的自定义属性挂到组件根元素，随依赖变更自动重算）：

```vue
<script setup lang="ts">
const dark = ref(false);
const mutedColor = computed(() => (dark.value ? '#999999' : '#666666'));
</script>

<template>
  <button @click="() => (dark = !dark)">theme</button>
</template>

<style scoped>
.page { --muted: v-bind(mutedColor); }
.head { color: var(--muted); }
</style>
```

`lang="scss"` 等需要预处理器的块会被跳过（告警）。

## 可用能力（已验证）

| 能力 | 说明 |
|---|---|
| `ref` / `computed` / `reactive` | 组合式 API 照常从 `vue` 导入 |
| `v-for` | 含 `:key` diff 增量更新 |
| `v-if` | 锚点实现为空文本节点，不渲染可见内容 |
| 事件 | `@tap` / `@text-changed` / `@submit`（或 `:on-tap="fn"`） |
| 动态 style / class | `:style="{ ... }"` 与 `class` / `:class` |
| `<style>` / `<style scoped>` | 见上节，完整支持（v1.1 起） |
| 模板插值 / TS | `{{ }}`、TS 类型检查 |

## 编辑器提示（VS Code + Vue - Official）

内置标签的 props、事件、插槽都声明在
`packages/fjs-runtime/src/vue-global.d.ts`（`GlobalComponents` 增强）。
要让编辑器读到它们，项目的 `tsconfig.json` 需要两件事：

```jsonc
{
  "compilerOptions": {
    // `@/x` -> `src/x`。构建侧不用配：`fjs build` 的每条流水线和 Vite 的
    // `fjs()` 插件都内置了这个别名，这里只是让 tsc / Volar 也认得。
    "paths": { "@/*": ["./src/*"] }
  },
  "vueCompilerOptions": {
    // text / image / button / input / switch / progress 同时是原生
    // HTML/SVG 标签名。不加这个插件，Volar 会按 @vue/runtime-dom 的
    // IntrinsicElementAttributes 去解析它们，永远看不到 fjs 的类型：
    // 没有属性补全、跳不到 d.ts、事件签名还是 DOM 的。
    "plugins": ["@ufjs/runtime/volar"],
    "strictTemplates": true
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue"]
}
```

并在 `src/` 下放两行把类型引进来（见
`examples/hello-fjs/src/fjs-global.d.ts`）：

```ts
/// <reference types="@ufjs/runtime/ambient" />
import '@ufjs/runtime/vue-global';
```

第一行把**所有** `fjs*` specifier 一次带进来：`fjs`、`fjs/app`、`fjs/router`、
`fjs/vue`、`fjs/web`，以及工具链生成的 `fjs/pages`、`fjs/plugins`。这些映射只有
`@ufjs/runtime` 自己能保证正确，所以它以 `src/ambient.d.ts` 的形式随包发布，
升级 runtime 就跟着更新。

因此工程侧**不需要**：

- tsconfig 的 `paths` 里那几条 `fjs*`（只留 `@/*`，那是你自己工程的别名）
- `src/fjs-pages.d.ts`
- `src/fjs-plugins.d.ts`

唯一还需要生成到工程里的是 `src/fjs-routes.d.ts`——路由**名字**是随你的
`src/pages` 变的，只能在你这边生成。

老工程迁移：删掉上面三样，加上这行 reference。留着也不报错（重复的 ambient
声明会有一个静默胜出，内容相同就没影响），只是那几份副本会随版本变旧。

`@ufjs/runtime` 要作为 devDependency 装上，`@ufjs/runtime/volar` 才解析得到。
另外两点：

- 不要写 `declare module '*.vue'` 的 shim。Vue - Official 自己会解析
  `.vue`，shim 只会把组件类型压成 `DefineComponent<{}, {}, any>`。
- **新增内置标签后编辑器仍按 DOM 类型报错**：`volar.cjs` 只在插件加载时读一次
  `tags.json`，重启 TS server（`TypeScript: Restart TS Server`）即可；命令行的
  `vue-tsc` 每次都是新进程，不受影响。
- 页面文件名和内置标签同名时（`pages/comp/input.vue` 里的 `<input>`），
  Vue 会把它当成**自引用**，属性提示会变空。加一行
  `defineOptions({ name: 'InputPage' })` 即可。

命令行同款检查：项目内执行 `pnpm run typecheck`。仓库示例可以执行
`pnpm --filter hello-fjs typecheck`。

## 第三方组件库兼容（vant）

Vue 生态的移动端组件库是按真浏览器写的：伪元素发丝线、属性选择器、
`<Transition>`、`position: fixed` 弹层、`document.createElement` 挂 Toast、
挂载帧就要量 DOM 几何。fjs 的应对分三层：

1. **通用的进 runtime**——CSS 引擎的支持面（见
   [css-compat.md](css-compat.md)）、元素上的 DOM 形状 API（见
   [ui-api.md](ui-api.md#元素上的-dom-形状-api)）、vue-shim 补齐的 DOM 专属
   导出（下文）；
2. **库特有的留在项目本地**——vite 插件的 `fjs.app` 钩子对库源码打补丁，
   机制见 [toolchain.md](toolchain.md#ui-组件库适配vite-插件的-fjsapp-钩子)；
3. **`window` / `document` 不在 runtime 模拟**——给全局塞浏览器假象会翻转
   每个库里 `inBrowser` 之类的判断，影响面不可控（specs/070 的结论）。库里
   没做浏览器判断的路径由插件打守卫补丁；个别库确实需要全局时，由项目
   自己 opt-in 一个最小侧影（demo 的 `dom-env.ts`，见「vant 的接入」）。

vant 4 是这条路线的完整检验：demo 的 `vant: basic` / `vant: form` /
`vant: feedback` / `vant: more` / `vant: nav` / `vant: float` 六个页面两端
（web 浏览器 ↔ iOS/Android）对拍，specs/068–073 起共 29 个 spec。46 个
组件达到结构、位置、交互一致；完整落账（补了哪些 Vue API / DOM API /
CSS、性能演进）见 [vant-adaptation.md](vant-adaptation.md)，换一个库的
打法规范见 [third-party-components.md](third-party-components.md)；剩余
差异登记在下方「已知差异」。

### 元素上的 DOM 形状 API

任何元素（经 `ref` 拿到的、或作为事件 `target` 的）都带一小组 DOM 形状的
成员，按 DOM 写法的组件库（vant）不需要 fjs 适配就能操作：

| 成员 | 说明 |
|---|---|
| `el.style` | 内联层写入，与 `:style` 绑定共用同一份记录 |
| `el.getBoundingClientRect()` / `offset*` | App 上 navMount 当次不强制重排，未布局全零；页面挂上之后同一 tick 改树再读会重排 |
| `el.addEventListener` / `removeEventListener` | 事件名同 `on<Name>` prop，`passive` / `capture` 选项忽略 |
| `el.contains(other)` | 后代判断（vant Checker 判断是否点在图标上） |
| `el.isConnected` / `parentNode` / `nodeType` / `tagName` | 影子树的逻辑父链；`tagName` 是 fjs 标签大写（specs/129） |
| `el.setAttribute` / `removeAttribute` | 与模板里写同名属性等价（popperjs 写 `data-*` 靠它，specs/129） |
| `el.scrollTop` / `scrollLeft` / `clientTop` / `clientLeft` | 读最近一次 scroll 事件报告的偏移；可写不真滚（specs/129） |
| `input` / `textarea` 的 `value` | DOM 式读写，库按 `event.target.value` 实现的 v-model 两端可用（specs/070） |
| `input` / `textarea` 的 `focus()` / `blur()` | DOM 式控件焦点，经 `fjs.control.*` 宿主模块路由（specs/077） |
| click 事件的 `clientX` / `clientY` | 按需读取（specs/073） |

完整定义与边界（伪元素盒上的 target 映射、`::before` 语义等）见
[ui-api.md](ui-api.md#元素上的-dom-形状-api)。

### vue-shim：补上 runtime-dom 才有的名字

App 构建里 `vue` 被 alias 到 `@vue/runtime-core` + fjs 的 shim
（[`vue/vue-shim.ts`](../packages/fjs-runtime/src/vue/vue-shim.ts)）。组件库
的 barrel 无条件 `import { vShow, withKeys, Transition, createApp } from 'vue'`
——这些名字只存在于 runtime-dom（真浏览器运行时），缺一个整个构建就失败。
shim 逐个补上，语义按 fjs 的现实重述：

| 导出 | 语义 |
|---|---|
| `<Transition>` | fjs 版（BaseTransition + 样式引擎翻类）。enter/leave 的 `-from/-active/-to` 类照常落地：animation 型规则（vant 的 `van-fade-enter-active { animation: … }`）由 keyframes 引擎原生播放，transition 型类切换由 App 端按 transition 的支持范围补间。结束时机取计算样式里 animation 与 transition 的「时长 + 延迟」较长者——本端没有 transitionend / animationend 可听。`v-show` 在 `<Transition>` 内走钩子，离场动画放完才 `display: none` |
| `vShow` | 只碰内联 `display` 一项（隐藏写 `none`、显示恢复原值），元素其余规则不动——以前整张替换计算样式，vant 步进器第一次改值就把输入框和加号的样式丢光（specs/069） |
| `withKeys` | 直通。fjs 事件不带键码，守卫没有东西可测——处理器在每个事件上照跑，而不是永不触发 |
| `withModifiers` | 照 runtime-dom 的 modifierGuards 如实实现：`.stop` 调 `stopPropagation()`（App 端 tap 会冒泡，specs/129）、`.prevent` 调 `preventDefault()`、`.self` 比 `target` / `currentTarget`；系统键 / 鼠标键字段 App 端不存在，按「没按」读。不能像 `withKeys` 那样直通——那样 `.stop` 失效、父级 click 误触发。包装函数缓存在处理器上（同 runtime-dom），重渲染时 prop 不变。NutUI 预编译的 Tag 关闭图标要它（specs/139） |
| `<TransitionGroup>` | fjs 版（specs/179）：条目的 enter / leave 用上面 Transition 的同一套类名与计时；重排做 FLIP——位置经 `ui/geometry` 同步读取，被移动的条目先用内联 `transform` 放回原处，下一帧加 `*-move` 并撤掉 transform 滑到新位置（比 DOM 晚一帧起步：App 端只在渲染过的两个样式之间补间）。vapor 组件里见下文 specs/176 |
| `createApp` | 指名抛错。挂第二个 Vue 根需要容器，App 端没有 DOM；要挂的库由它的适配补丁改从 `fjs/vue` 取 `createApp` + `createDetachedRoot()`（游离根，相当于 body 上的 `<div>`），内容经 Teleport / hoist 落到 app 级 overlay 宿主。vant 的 `showToast()` / `showDialog()` / `showNotify()` / `showImagePreview()` 就是这样打通的（specs/137，demo/vite/vant.ts） |
| `measureTextBlock` | 经 `__FJS_SHARED` 暴露给库的侧影：库的测高逻辑用宿主排版（vant TextEllipsis 的二分截断靠它，specs/128） |

静态提升同样挂在 DOM 语义上：`createStaticVNode` 的挂载走
`insertStaticContent`（innerHTML 语义），本 renderer 没有这个函数。App 构建
因此以 `hoistStatic: false` 编译 SFC（specs/070：静态子树大的页面整页空白，
本地 Node 复现不出来——测试走运行时模板编译，没有静态提升）；手写静态
vnode 会得到指名报错。

### vant 的接入（demo 是参考实现）

四个文件加一个侧影，各管一件事：

1. **`src/plugins/vant.ts`**（**无平台后缀**——带 `.app.ts` / `.web.ts` 会
   静默跳过另一端，页面报 `Failed to resolve component`）：对用到的组件逐个
   `app.use` 全局注册；样式按需引入写在同一文件
   （`vant/es/<comp>/style/index.mjs`——esbuild 不做目录 index 推导，路径必须
   写全），App 构建把每条样式 import 抽成 `registerStyles()` 调用、web 端
   消费 CSS。文件**第一个** import 是 `./vant/dom-env`：vant 在模块求值时就
   决定 `inBrowser`（`typeof window !== 'undefined'`），必须抢在它前面
2. **`src/plugins/vant/dom-env.ts`**：上一条的另一面。runtime 不装全局
   假象，但 vant 一批能力（`raf()` / `doubleRaf()`、`getComputedStyle`、
   点外关闭）在 `inBrowser` 为假时直接死——`raf()` 返回 -1 且**不回调**，
   NoticeBar 的跑马灯永远不启动。demo 为 vant 一个库 opt-in 一个**只含它
   所需表面的最小侧影**：`requestAnimationFrame`；读 fjs 样式引擎的
   `getComputedStyle`（display/position/transform 等按 DOM 初始值兜底，
   transform 转成浏览器形状的 `matrix(...)` 供 Picker 拖动时读 ty）；
   document 级 pointer-down 流（NumberKeyboard 点外关闭的 click-away 靠
   它，监听的是 `document`、判的是 `el.contains(event.target)`）；「首次
   可见」的 `IntersectionObserver`（页面树先建后显示，vant 挂载时量到的是
   0，观察者逐帧等布局出来再报一次可见——Tabs 下划线重测靠它）；吸收
   lock-scroll 类写入的 documentElement/body。web 构建里 `window` 本来就
   存在，这些全都不运行
3. **类型**：demo 早期手写过 `src/vant-components.d.ts`（`GlobalComponents`
   增强），vant 4.10 起自带这份声明，文件已删——自带 `GlobalComponents`
   的库什么都不用做，不带的才手写并和注册列表保持同步（插件管运行时，
   这个文件管 vue-tsc strictTemplates）
4. **`vite/vant.ts`**：带 `fjs.app` 钩子的本地 vite 插件，对 vant 源码做
   **字面量锚点替换**，补丁分三类：
   - `window` / `document` 守卫：`isWindow`（Rate 点击 / Slider 点按时
     `useRect` 走到）、`useLockScroll`（弹层开关时的滚动锁）、
     `getScrollParent`（Tabs/Sticky 的滚动父级查找）、`isHidden`（Tabs /
     Swipe 的初始化门）、Field autosize——这些路径没做浏览器判断，App 端
     直接 ReferenceError 并把组件更新中途打断
   - `touch-action` 声明：Slider / Rate 在 scroll-view 里的拖动。web 上靠
     非 passive `touchmove` 里 `preventDefault()` 赢下手势，App 端监听在
     JS 里跑、晚 Flutter 手势竞技场一帧，指针已经判给滚动容器——只有
     `touch-action` 这个声明是两端都认的抢手势方式
   - 测量重试：Tabs 下划线在挂载帧读 `offsetLeft / offsetWidth` 还是 0
     （首帧布局还没发生），按 rAF 重试至多 10 帧，量到为止

   锚点在 vant 升级后对不上时，该补丁跳过、构建告警一次并写明哪个功能在
   App 端失效——降级成「这个功能又坏了」，而不是产出坏 bundle。
5. **`src/plugins/vant-touch.web.ts`**（**只 web**）：引入 vant 官方的
   `@vant/touch-emulator`。vant 是移动端库，Field 清除图标只听
   `touchstart`，Slider / Swipe / Picker 拖动也都是 touch 处理——桌面浏览器
   用鼠标永远触发不到（点清除只会让输入框失焦，文字还在）。emulator 把鼠标
   转成 touch 事件，真触摸设备上它自己跳过。App 端的触摸本来就是 touch
   事件，也没有 document 可打补丁，所以带 `.web.ts` 后缀（specs/123）

### 已知差异（登记过的）

- 命令式弹层（`showToast()` 等）两端可用，App 端挂在 app 级宿主上、可见期间
  拦系统返回（specs/136/137）
- 没有深层 target / 事件委托：`target` 是被点中的**有监听的**最内层节点，
  不会是它里面没挂监听的子节点。vant Checker 设 `label-disabled` 时，App 端
  点图标也不切换（specs/072）。tap / click 会冒泡到有监听的祖先，
  `.stop` 生效（specs/129）
- `position: fixed` 走置顶 overlay 宿主——Teleport 的视觉与交互等效，不是
  DOM 语义；fixed 元素之间按 z-index 叠放，详见
  [css-compat.md](css-compat.md#定位) 的 `position: fixed` 条
- `<Teleport to="body">`（vant Popover 默认如此）在 App 上落到同一个 overlay
  宿主；其它选择器没有 DOM 可查，目标为空（specs/129）
- `window.getComputedStyle` 是 dom-env 里读 fjs 样式引擎的最小 shim，不是
  完整计算样式：vant 用它做滚动父级查找（`overflow`；`scroll-view` 两个轴都
  答 `scroll`）与隐藏判断（`display`），更深的用法（伪元素样式、百分比还原）没有
- dom-env 另给 popperjs（Popover）补了全局 `Element` / `HTMLElement`
  （对 fjs 元素 `instanceof` 为真）和 document 盒子的最小形状

## Vue Vapor（自研运行时，specs/161）

Vapor 模式把模板编译成直接改节点的代码，不建 vnode、不 diff。在 fjs 上它按组件选用，**运行时是
fjs 自己的实现**（`fjs-runtime/src/vapor/runtime.ts`，直连元素 API；specs/148 时代的官方
runtime-vapor + DOM 外壳已移除）：

```vue
<script setup vapor lang="ts">
defineProps<{ vals: number[] }>();
</script>
<template>
  <view v-for="(v, i) in vals" :key="i" class="cell"><text>{{ v }}</text></view>
</template>
```

**什么时候用**：状态频繁局部变化的组件——大表格、列表里改一项、计数器、实时数据。flat-4050 同一棵
4050 元素的树（`examples/bench` 的 `pnpm run vapor`，fjsrun，Mac，PrimJS）：

| | VDOM | Vapor（自研运行时） |
|---|---:|---:|
| 改 1 格文本 | 11.7 ms | **0.0 ms** |
| 改 200 格 | 12.7 ms | **1.9 ms** |
| 改 2000 格 | 21.3 ms | **19.1 ms** |
| 首次挂载 | **18.0 ms** | 46.5 ms |

VDOM 改一格也要重跑整个组件的 render 再 diff；Vapor 只跑那一格的 effect。**首次挂载反而慢**：
模板克隆（libfjs-style 在 C++ 展开实例，specs/152）省掉了元素创建，但每个 v-for 项的块、
effect scope 和引用记账是 JS 对象，解释器下每项约 15 µs。一次性展示、之后不怎么变的页面继续用
VDOM。运行时的实现取舍（为什么外壳方案被换掉、哪些是 deliberate 简化）写在
`src/vapor/runtime.ts` 的文件头。

**两端同源**：Flutter 端 helper 落元素 API（op 帧 → Dart，模板实例由 libfjs-style 原生克隆）；
web 端同一份 runtime 换 DOM 后端（`cloneNode(true)` 实例化 + web 适配层同款 tap/longPress 手势）。
编译产物两端一字不差。

**和 VDOM 混用**（编译期包装，specs/161 §3.2）：VDOM 页面 import 一个 Vapor 组件时，CLI 自动把
导入重定向到生成的包装组件——包装在 setup 里挂 Vapor 块、渲染一个 `fjs-vapor-root` 占位，渲染器的
收养钩子让占位直接"是"Vapor 根元素（patch 跳过它，卸载随 VDOM 树）。反向（Vapor 组件里用 vant）走
互操作挂载：vant 组件经 fjs 自己的 VDOM 渲染器挂进 Vapor 树，props 是 getter（响应）、slot 桥接
（`demo` 的 `vant/vapor` 页全过：按钮/单元格/开关/步进器的点击与 v-model）。

**三方库**：node_modules 里以 `.vue` 发布、只有 `<script setup>` 的组件自动按 Vapor 编译；
`package.json` 里 `"fjs": { "vapor": { "libs": false } }` 关掉。带普通 `<script>`（Options API）的
SFC、TSX / 渲染函数写的库编不了 Vapor，走互操作。

**限制**（Vapor 组件内；都会抛错说明，不会静默出错）：

- 原生元素上的 `v-model`：不支持，用 `:value` + `@input`（vant 的 v-model 是组件 props/事件，
  不受影响）。
- 动态 slot 名：只做静态求值（`<component :is>` 已能切换，specs/174）。
- `defineVaporCustomElement`、SSR hydration：不支持。
- Vue 版本：**编译器**主体是 stable 3.5（`@vue/compiler-sfc@3.5.43`，parse + script-setup 的
  transform 也是它）；只有 vapor SFC 的**模板代码生成**用 `@vue/compiler-vapor@3.6.0-rc.9` 直调
  （specs/166，`fjs-runtime/src/vapor/sfc-compiler.ts` 自己做 SFC 拼装——vapor 属性、`__returned__`
  尾巴、`__vapor` 标记、v-bind CSS 变量都按 3.6 的产物形状拼）。这是全仓唯一的 3.6 产物，
  纯构建期依赖，不进任何应用包；**运行时**全部 stable 3.5（workspace 与 `fjs create` 模板钉
  `^3.5.43`）。3.6 转 stable 后升级 `@vue/compiler-vapor` 即可，其余不动。

**包体**：没有 Vapor 组件的应用不带 Vapor 运行时（`--pages` 构建也只在用到时才进共享 chunk）；
带 Vapor 组件的应用比 specs/148 时代小（不再打包 runtime-vapor 与外壳）。

### 全 Vapor 应用：`createFjsApp({ enableVapor: true })`（specs/166）

一个应用全部页面都是 Vapor SFC 时，在入口声明一次：

```ts
createFjsApp({ enableVapor: true, routes: [...], ... });
```

CLI 在构建期读这个开关（扫入口源码），runtime 在挂载期执行它。语义：

- **SFC 默认就是 vapor**（specs/177）：项目里的 `.vue`（`<script setup>`，或只有 `<template>`）
  不用写 `vapor` 属性，一律按 vapor 编译；写了也无害。只有 Options API 组件（只有普通
  `<script>`）编不成 vapor，构建时告警。关掉开关，没写 `vapor` 的文件回到 VDOM——同一份源码
  靠这一个开关切换；显式写了 `vapor` 的文件在 VDOM 应用里仍是 vapor（混用，specs/161）。
  `node_modules` 里的库 SFC 照旧按 `fjs.vapor.libs`。

- **页面原生挂载**：不再生成编译期 wrapper——Flutter 路由的 `mount()` 直接
  `createVaporApp(page)` 挂进页面根，没有每页一个 Vue app、没有收养；web 壳本身也是 vapor
  （`createVaporApp` 起根）。导航由一层很薄的 history 驱动（`router/web-history.ts`，specs/173）
  负责：hash / history 两种模式、`popstate`、懒加载页面模块、窗口滚动复位，匹配沿用与 Flutter
  共用的 `router/match.ts`——**enableVapor 的 web 包里没有 vue-router**（vapor-app 小 24 KB）。
  `fjs/router` 在这种构建里别名到 `router/web-vapor.ts`，API 不变。
- **web 不打 runtime-dom**：`vue` 别名到 runtime-core dist（`vue` 包的入口是 runtime-dom，
  纯 vapor 应用碰不到 DOM 渲染器）；`fjs/app` 别名到纯 vapor 壳（`app/web-vapor.ts`）、
  `fjs/vapor` 别名到无 interop 面（`vapor/web-pure.ts`）——vdom 渲染引擎、wrapper、adopt
  机制整段不进图。
- **全局组件**走 `components` 选项（Flutter 端内置 fjs 组件集自动带上）。
- **开关必须是字面量**：CLI 去掉注释（和字符串内容）后找 `enableVapor: true`；
  `enableVapor: flag` 这类非字面量构建期无法求值，会警告并按「未开启」处理。
- **fjs 标签在 vapor 模板里两端一致地编译成原生元素**（view/text/image…——web 后端
  createElement 出的就是同一批自定义元素，样式来自 base-css，手势走后端 on()）；
  `form` / `picker` / `list-view` / `textarea` 等组件标签仍走组件解析，纯 vapor 的 web 应用
  用它们会得到明确的 resolveComponent 报错（vdom interop 才挂得起）。
- **插件与 `setup(app)`（specs/167）**：没有 Vue app，但 `setup` / `plugins` 拿到一个 App
  形状的外壳（`app/vapor-app.ts`），在 `createFjsApp` 时**只跑一次**（VDOM 的 Flutter 路径是
  每页跑一次）。可用：`use` / `provide` / `component` / `runWithContext` /
  `config.globalProperties` / `config.errorHandler`；`mixin` / `directive` / `mount` 警告一次后
  忽略。pinia 照常写：

  ```ts
  createFjsApp({ enableVapor: true, routes, setup(app) { app.use(createPinia()) } }).mount();
  ```

  分包构建（`--pages` / `fjs run`）里 pinia 要登记进 `package.json` 的 `fjs.shared`
  （`fjs add pinia` 会写），否则入口与页面 chunk 各打一份 pinia、store 找不到 active pinia。

  `config.errorHandler` 收 vapor effect 与生命周期钩子里的异常，签名
  `(err, null, info)`——vapor 没有组件实例可传；没设时 `console.error`，且一个 effect 抛错
  不会连累同批其他 effect。
- **外壳 `shell` 必须是 vapor 组件**（开着 enableVapor 时普通 `<script setup>` 即是）：两端都把每个 vapor 页包进它
  （props `route` = 本页路由，默认插槽 = 页面），导航栏和返回键就放在这里。VDOM 的 shell
  在 enableVapor 下没有渲染器可用，会警告一次并不包壳——页面就没有导航栏 / 返回键
  （specs/167 §8）。`transition: false` 在 iOS 上同时关掉右滑返回。
- **路由**：页面里用 `fjs/router` 的 `useRouter` / `useRoute` / `onPageSettled`——两端都经
  vapor provide 拿到**本页**的 router / route（`reactive` 对象，导航走后仍是本页的）。
  vue-router 自己的 `useRouter` / `useRoute` 是 runtime-core 的 inject，vapor 页里拿不到
  （返回 undefined），CLI 发现 vapor SFC 从 `'vue-router'` 导入它们会警告；
  `<router-link>` / `<router-view>` 是 VDOM 组件，不可用。
- **fjs 自己的标签与内置组件两端可用（specs/171）**：web 的 input / image / scroll-view / swiper /
  switch / checkbox / radio / slider / progress / picker-view / modal / form / label / *-group /
  page-container / refresh / sticky-*，以及两端的内置组件 canvas / list-view / form / picker /
  rich-text / textarea / defer，都是 render 函数写的组件，enableVapor 下由 vapor 运行时的
  **render-host**（`vapor/render-host.ts`）执行——每个组件仍只有一份实现。编译器给用到这些标签
  的页面注入 `import "fjs/tag/<tag>"`，只打包实际用到的标签；只用 view / text 的应用不带
  render-host。自写的组件请写成 `<script setup vapor>`；swiper 的 `circular` 在纯 vapor web 下用首尾页的 DOM 快照做克隆页（specs/175，见 web.md）；rich-text 在 vapor
  页里拿不到页面的 scoped 样式。`fjs/app` / `fjs/vapor` / `fjs/vue` 在 enableVapor 下别名到纯 vapor 面
  （`app/flutter-vapor.ts` / `vapor/flutter-pure.ts` / `vue/index-vapor.ts`），渲染器不进图。
- **三方 VDOM 组件库按需带 interop（specs/182）**：构建 / dev 时扫描源码导入的三方包，包里有从 `vue`
  导入 `createVNode` / `openBlock` / `createElementBlock` / `createBlock` 的产物（vant、NutUI 这类编译好的
  组件库）就判定需要互操作，打印一次 `VDOM component library detected (…)`，并把 Vue 渲染器带进来：web
  的 `fjs/vapor` 改用带 interop 的 `vapor/web.ts`、`vue` 改用 `vapor/vue-interop.ts`（runtime-dom + vapor
  双模生命周期），Flutter 的 `fjs/vapor` / `fjs/vue` 改用完整面。页面、壳、项目组件仍是 vapor；三方组件经
  渲染器挂载（web 用 runtime-dom 本身，style 对象 / DOM prop / vShow / vModel / Transition 都是真实现），
  能 inject 到 vapor 祖先与 app 的 provide、解析 app 注册的组件；写在 vapor 模板里的父子组件
  （`<van-grid><van-grid-item>`、Tabs/Tab、Collapse、Steps、Sidebar）经插槽桥接仍是父子；
  `showToast()` 等命令式 API（`createApp`）可用。`package.json` 的 `fjs.vapor.interop: true | false`
  强制开关。只用 composable 库（pinia、@vueuse/core）或 `h()` 写的 render 函数组件的应用不开，包体不变。
- **web 壳**比 vdom 壳简单：visited 页常驻 LRU 缓存（默认 16）不按历史栈销毁；离开页面时对它跑
  `onDeactivated`、回来时 `onActivated`（与 VDOM 壳的 KeepAlive 一致，含页面里经 interop 挂的 VDOM
  组件——vant 的 Popover / Popup 靠它收起 teleport 出去的浮层，specs/181）。页面转场与
  vdom 壳一致（specs/178）：同一个 `transition` 选项 / `meta.transition`、同一套 `fjs-page-*` 类名与
  `data-nav`，`onPageSettled` 等进场结束。
- 参考实现：`examples/vapor-app`（pinia store + 生命周期；`pnpm run check` 是 fjsrun 断言 harness，
  `pnpm run build:web` 后 bundle 无 runtime-dom / wrapper / createRenderer 痕迹）。

### Vapor 组件的生命周期与 provide / inject（specs/167）

自研运行时有自己的组件实例，下面这些从 `'vue'` 导入即可（vapor SFC 的 `'vue'` 由 CLI 改到
`fjs/vapor`），**全部 vapor 组件**适用——enableVapor 应用，以及 VDOM 页里被收养的 vapor 组件：

| API | 时机 / 语义 |
|---|---|
| `onBeforeMount` | setup 返回后、块插入宿主之前 |
| `onMounted` | 块进入宿主树之后**同步**触发（`mount()` 返回前；收养路径在节点放进占位元素后），子先于父；v-if 翻转、v-for 新增项里新建的组件在那次更新结束时触发 |
| `onBeforeUnmount` | 宿主节点移除**前**，父先于子 |
| `onUnmounted` | 移除之后，子先于父。页面卸载、v-if 切走、v-for 删项、web 壳 LRU 逐出都会触发 |
| `provide` / `inject` / `hasInjectionContext` | Vue 语义：inject 读父组件的 provides，链尾是 app 级（`app.provide`）；`runWithContext` 内可读 app 级 |
| `onActivated` / `onDeactivated` | `<KeepAlive>` 缓存的分支（specs/174）与 web 壳缓存的页面（specs/181）切走 / 切回时触发 |
| `onUpdated` / `onBeforeUpdate` | 只在 render 函数组件（render-host）上有意义（它们会重渲染）；vapor 模板组件没有「整组件更新」 |
| `onErrorCaptured` / `onRenderTracked` / `onRenderTriggered` / `onServerPrefetch` | ❌ 不支持，调用时警告一次 |
| setup 抛错 | 交给 `app.config.errorHandler`（没有就 console.error），该组件渲染为空，父组件照常（specs/181） |

`.ts` 里的 composable（pinia、vueuse）从 `'vue'` 导入这些函数同样生效：Flutter 端 `vue`
是 vue-shim，enableVapor 的 web 端 `vue` 钉在 `vapor/vue-pure.ts`，两者导出的是同一套「双模」
函数（vapor setup 中走 vapor 实例，VDOM 组件中走 runtime-core）。**例外**：非 enableVapor 的
web 应用里 `vue` 是真 vue 包，那里的 `.ts` composable 在 vapor 组件里注册生命周期不生效。
`getCurrentInstance()` 在 vapor 里仍返回 null（伪造实例会让读 `instance.proxy` 的库崩），
vueuse `tryOnMounted` 这类会走它们的无实例分支。

### Vapor 模板语法支持（specs/170）

compiler-vapor 能生成的每个运行时 helper，四个 vapor 入口都有导出（守护测试
`vapor-helper-parity*.test.ts` 直接读编译器自己的 helper 清单对照）——做不到的写法降级并告警一次，
不再在模块加载时 `_xxx is not a function`。

| 写法 | Flutter | Web |
|---|---|---|
| `ref="el"` / `:ref` / v-for 里的 ref | ✅ 元素 = fjs Element；组件 = 其 `defineExpose` 的对象 | ✅ 元素 = DOM 节点 |
| `v-show` | ✅（经样式引擎写 `display`） | ✅ |
| `v-model` 文本（`<input>` / `<textarea>`，`.trim/.number/.lazy`） | ✅ `textChanged` 入、`value` 出 | ✅ |
| `v-model` checkbox / radio / select | ⚠️ 无对应原生元素，告警不绑定 | ✅ |
| `v-bind="obj"` / `v-on="obj"` | ✅ | ✅ |
| `.stop/.prevent/.self` | ✅（tap 事件对象） | ✅ |
| 按键修饰符 `.enter` 等 | 直通（fjs 事件无键码，同 VDOM） | ✅ |
| `v-html` | ⚠️ 按纯文本写入（用 `<rich-text>`） | ✅ |
| `v-once`、`:key` 重建、`<component :is>`（含原生标签）、`v-for` selector | ✅ | ✅ |
| 自定义指令 | ✅ vapor 指令函数 `(el, source, arg, modifiers) => cleanup` | ✅ 同左 |
| 作用域插槽 `#default="{ item }"`、动态插槽 | ✅ | ✅ |
| attrs 透传（class / style 合并、监听叠加、`inheritAttrs: false`、`useAttrs`） | ✅ | ✅ |
| `<Transition>`（v-if / v-show / `:key` / `<component :is>`；`mode`、`appear`、`duration`、`css: false`、自定义类名、JS 钩子与 done） | ✅ 类名进样式引擎，结束时机取计算样式的时长（与 VDOM 版同一套） | ✅ `classList` + transitionend / animationend，按计算时长兜底 |
| `<KeepAlive>`（`include` / `exclude` / `max`，`onActivated` / `onDeactivated` 含子组件） | ✅ 停用的节点挪进不挂树的容器（Flutter 的 remove 会销毁元素） | ✅ |
| `<Teleport>`（`to` / `disabled` / `defer`，可变；内容里的切换照常落在目标里） | ✅ `body` / `html` → 应用浮层宿主（与 VDOM 同一落点）；其他选择器无目标，告警后原地渲染 | ✅ `document.querySelector` 或元素 |
| `<TransitionGroup>`（v-for 条目的 enter / leave、FLIP move、`tag` 容器、`move-class`） | ✅ 位置经 `ui/geometry` 同步读取 | ✅ `getBoundingClientRect` |

同一元素上的多个监听（自己的 `@tap` + 父组件透传的 `@tap` + `v-on="obj"`）两端都按注册顺序叠加
——Flutter 后端每个事件键只留一个 handler，叠加在 vapor 的 host 层做。VDOM 路径不受影响（原生元素
上的 `v-model` 仍按下表不支持）。

## 不可用 / 注意

| 项 | 状态 | 说明 |
|---|---|---|
| `v-model` | ❌ 不可用 | 指令助手面向 DOM（el.addEventListener）。替代：`:value="draft" @text-changed="t => draft = t"` |
| vue-router | ❌ 不可用 | 路由走 `fjs/router`（VDOM web 构建内部用 vue-router；enableVapor web 用自带的 history 驱动，specs/173） |
| pinia | ✅ 可用 | 已在 QuickJS 上验证。用 `fjs add pinia` 装，它会把实例写在 `src/plugins/pinia.ts` 的模块作用域里——Flutter 上每个页面是独立的 Vue app，实例建在函数里会让每页各拿一套 store。见 [toolchain.md 的「添加三方库」](toolchain.md#添加三方库) |
| `vue` 包 | ⚠️ 被别名 | alias 到 `@vue/runtime-core`，避免拉入 DOM 运行时；runtime-dom 才有的名字由 vue-shim 补（见上节）。Vapor 组件的 `vue` 导入由 CLI 改到 `fjs/vapor`（vue-shim + 自研运行时） |
| 元素上的 DOM 形状 API | ✅ 可用 | 一小组 DOM 形状的成员，供组件库直接调用（vant 依赖它们），清单见上文表格；`@x.passive/.capture/.once` 修饰符按 Vue 的规则处理，`.once` 生效 |
| `window` / `document` | ❌ 无全局 | App 端没有，runtime 也不模拟：组件库里不带浏览器判断直接用它们的地方，由该库的 vite 插件打补丁处理（vant 的在 `demo/vite/vant.ts`，分哪几类补丁见上文），机制见 [toolchain.md](toolchain.md#ui-组件库适配vite-插件的-fjsapp-钩子) |

## 性能：长列表要放进自己的组件

一个和 fjs 特别相关的写法问题。**主题、字号这类沿树继承的东西是通过 CSS
自定义属性到达每个节点的，不走 props**，所以一行的 vnode 输出跟它们无关。
但如果列表和会变的状态挤在同一个组件里，那个状态一变，Vue 就会把整张列表
的 vnode 重建并 diff 一遍——输出完全相同，白花。

1000 行切主题的实测（`examples/bench` 的 `vue-theme-switch-*`）：

| | 耗时 (min) | 过桥 |
|---|---:|---:|
| 行内联在读主题 ref 的组件里 | 55.6 ms | 65,481 B |
| 行放进一个不读主题的子组件 | **34.6 ms** | 65,481 B |

**过桥字节数一模一样**——多出来的 21 ms 全在 Vue 那一层。把列表挪进一个
props 不随该状态变化的子组件，`shouldUpdateComponent` 就会整个跳过它。

```vue
<!-- 会跟着重渲染 -->
<view :style="themeVars">
  <view v-for="item in items" :key="item.id">...</view>
</view>

<!-- 不会：Rows 的 props 没变 -->
<view :style="themeVars">
  <Rows :items="items" />
</view>
```

`examples/hello-fjs` 的 `example/interaction/theme` 页有个「列表」开关，两种写法可以在
真机上直接对拍。

**这只是长列表要做的两件事里的第一件。** 第二件在 Flutter 那一侧：容器要用
`list-view` 而不是 `scroll-view`。`scroll-view` 里是一个 `Column`，它会 build、
layout 并且 **paint** 每一个孩子，屏上放不放得下都一样；`list-view` 走
`ListView.builder`，只落实视口里的那十几行。1000 行切主题实测：最慢帧
**166 ms → 29 ms**，而过桥的字节数一个不差
（见 [performance.md](performance.md#两个开关两条独立的账)）。

两件事互不替代：组件隔离省的是 Vue 的 vnode diff，`list-view` 省的是 Flutter
的 build / layout / paint。

**还有一条前提：页面外面不能再套一层滚动容器。** 滚动容器给内容的是无界高度，
所以 `list-view` 装在另一个 `scroll-view` 里就没有可虚拟化的窗口——它会把每一行
都挂出来，和普通 `view` 没有区别。`examples/hello-fjs` 的外壳因此认
`<route>{"scroll": false}</route>`：自带长列表的页面用它关掉外壳的
`scroll-view`，自己管滚动。实测这三件事一起用在 `example/interaction/theme` 上：JS 213 →
83 ms、最慢帧 184 → 23.8 ms（[performance.md](performance.md#同样两下用在-vue-页上)）。

事件处理器不用操心：`@tap="() => open(item)"` 每次渲染都是新闭包，但
渲染器只在处理器**存在性**变化时才过桥，换闭包是就地更新注册表，不产生 op。

## 工作原理

1. `flutterRoot()` 创建根元素并插入宿主根容器（id 0）
2. `createRenderer(nodeOps, patchProp)` 的 nodeOps 把 Vue 的
   createElement/insert/remove/setText 映射为 op 写入帧缓冲
3. patchProp 处理事件（函数 → JS 注册表 + `onXxx: true` 标记）与样式
4. 响应式变更 → Vue patch → 微任务 flush → 一次原生调用

渲染器实现：`packages/fjs-runtime/src/vue/renderer.ts`（约 200 行）。
它只是三层里最上面那一层，下面的 element API 和 op 帧协议是框架无关的——
接 React 或自研框架的完整步骤见
[custom-renderer.md](custom-renderer.md#接一个新框架以-react-为例)。
