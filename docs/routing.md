# 路由：一份代码，两套导航

> 第三层第 2 篇。分包（每页一个 chunk）见
> [code-splitting.md](code-splitting.md)。

同一个 `router.push('/comp/button')`，在两个平台上落到完全不同的东西上：

| | Flutter | Web |
|---|---|---|
| 谁在管页面栈 | Flutter 的 `Navigator`（原生路由） | vue-router（enableVapor：自带的 history 驱动，specs/173） |
| 转场动画 | 平台自带（iOS 右滑推入、Android 系统转场） | CSS transition |
| 返回手势 | 平台自带（iOS 边缘滑动、Android 返回键 / 手势） | 浏览器后退 |
| 一个页面 = | 一个 `.js` / `.fjsbundle` chunk，按需加载 | 一个 esbuild chunk，`import()` 按需加载 |
| 页面状态 | 出栈即销毁（和原生一致），tab 页切换保活 | 默认 `<KeepAlive>`：新页从 0,0 起，返回还原离开时的滚动，tab 页切换保活 |

应用代码不知道自己在哪边：都写 `useRouter()` / `useRoute()`，构建时 `fjs/router`
被 alias 到对应实现（`router/flutter.ts` 或 `router/web.ts`）。

## 应用入口

```ts
// src/main.ts —— 两个平台完全相同
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';   // 构建时生成，见下
import Shell from './Shell.vue';

createFjsApp({
  routes,
  shell: Shell,              // 每个页面都被它包一层
  setup(app) { /* 装插件、错误处理 */ },
}).mount();
```

`shell` 拿到一个 `route` prop、页面放在它的默认插槽里。Flutter 上它是每个原生
路由页的外壳；web 上也是每个历史条目一份（`<KeepAlive>` 按栈缓存），外壳里的
`<scroll-view>` 不会串到下一页。导航栏 / tabBar 只写一遍（要 tabbar
**跨页常驻、全局唯一**，用下面的「全局 tab bar」）：

```vue
<!-- Shell.vue -->
<script setup lang="ts">
import type { RouteLocation } from 'fjs/router';
const props = defineProps<{ route: RouteLocation }>();
</script>
<template>
  <safe-area><view class="shell">
    <NavBar :title="String(route.meta.title ?? '')" />
    <scroll-view class="body"><slot /></scroll-view>
  </view></safe-area>
</template>
```

## API

`fjs/router` 的表面是 vue-router 的子集，语义对齐：

```ts
import { useRouter, useRoute } from 'fjs/router';

const router = useRouter();
router.push('/comp/button');                   // 原生 push（有转场、可手势返回）
router.push({ path: '/detail', query: { id: '3' } });
router.push({ name: 'detail', params: { id: 3 } });
router.replace('/api');                        // 原地换页，不进栈——切 tab 用它
router.back();                                 // = 平台返回
router.go(-2);
router.preload('/comp/button');                // 提前加载页面代码，不挂载（见下文）

const route = useRoute();                      // 响应式：path / params / query / meta
```

- `useRoute()` 返回的是**当前组件所属页面**的 route（Flutter 侧按页 provide，
  web 侧走 vue-router 自己的注入），不是全局栈顶。
- `go(n)` 只支持负数：原生栈没有前进历史。
- `replace` 在栈只有首页时是「原地换首页」，这正是 tabBar 想要的行为
  （无转场，和小程序一致）。

### 页面代码提前加载：`router.preload`

第一个页面停稳（`onPageSettled`）后，路由会在空闲时把**每个静态路由**的页面代码逐个
加载好（specs/143），打开页面时只剩挂载：

| | 加载什么 | 什么时候算空闲 |
|---|---|---|
| Flutter 分包 | 页面 chunk 的读取 + 执行（构建期样式快照仍在打开时导入，见 [vant-mount-perf.md](vant-mount-perf.md#页面-chunk-空闲预执行specs143)） | 由 Dart 判定：没有手指按着、没有路由在转场、本帧之后没有帧在排队（fling、动画都算）；常驻动画的页面等满 2 s 后放行 |
| Flutter 单包 | 页面模块（`definePageLoader` 的 loader） | 同上 |
| Web | 路由表里的 `() => import(...)` | `requestIdleCallback`（没有时退回 50 ms 定时器） |
| 小程序 | 不做（分包由微信加载，`preload` 直接 resolve） | — |

一次只加载一个页面，按路由表顺序；带参数的路由（`/user/:id`）和 `/*` 跳过。某页加载
失败会打一行 `[fjs-router] preload … failed`，跳过它，打开该页时按原路径再试并报错。

手动预加载用 `router.preload(to)`，**不等空闲**，适合放在马上就要跳转的地方：

```vue
<view @touchstart="router.preload('/vant/form')" @tap="router.push('/vant/form')">表单</view>
```

返回 `Promise<void>`；已加载、路径不匹配时立即 resolve。

关掉自动预加载（只留手动）：

```ts
createFjsApp({ routes, preload: false, /* … */ });
```

**注意**：

- 页面模块的**顶层代码**（`<script>` 里 setup 之外的部分）会在预加载时执行，而不是在打开时。
  setup、`onMounted` 不受影响，因为预加载不挂载页面。
- 页面里**不带 scoped** 的 `<style>` 是全局样式。它原来在"打开过那一页之后"才生效，现在在
  "预加载到那一页之后"就生效，两端都是这样（web 上 Vite 在模块求值时注入 CSS）。构建期样式
  快照按同样的状态抓取，所以不会因此被拒（specs/143）。

### tab 页会被保活

`meta.tab` 是数字的页面（`<route>` 块里写 `"tab": 0`，或 `fjs page --tab 0`
生成）算作一组 tab 页。在两个 tab 页之间 `replace`，**离开的那个不销毁**：

| | 离开的 tab 页 |
|---|---|
| Flutter | Vue app 继续挂着，根元素只是被标记 `__navHidden`，宿主把它 offstage 渲染 |
| Web | 留在 `<KeepAlive>` 的 `include` 里，滚动位置照常记快照 |

所以切回来时页面还是走的时候的样子——滚动位置、输入框、展开的手风琴、列表数据
都在，也不会重新发一遍请求。

- 保活只在 tab 组内部有效：`replace` 到一个不是 tab 的页面，整组缓存一起丢掉。
- `push` 一个二级页再返回不影响缓存：tab 页在原生栈里本来就在下面待着。
- 同一个 tab 带不同 query（`/api?x=1`）视为新页面，旧的那份丢掉。
- 被保活的页面**没有停**：定时器、动画、`setInterval` 都还在跑（和小程序 onHide
  的语义一样）。要在离开时停掉，自己在页面里根据 `route` 判断。
- Web 上 `keepAlive: false` 会连 tab 保活一起关掉。

## 全局 tab bar（specs/210）

shell 里的 tabBar 随页面实例化，push 二级页后整个消失，也做不出角标这类跨页
状态。`createFjsApp` 的 `tabBar` 选项把 tabBar 变成**全局唯一**的一份，悬浮
在 TabGroup 的底部（fixed 层，**不占页面高度**，内容从 bar 底下滚过）——
只在 tab 页显示（微信原生 tabBar 的语义），外观可以是 App Store 那种悬浮
胶囊：

```ts
createFjsApp({
  routes,
  shell: Shell,                     // 导航栏照旧留在 shell 里
  tabBar: { component: TabBar },    // 不传则一切照旧（shell 自渲染的 tabBar）
});
```

| | TabGroup 长什么样 | 为什么切换不闪烁 |
|---|---|---|
| Flutter | 基页 FjsView 里的 Stack：页面区铺满 + bar 根 `Positioned(bottom)` 悬浮 | bar 是本视图里的普通层（带 GlobalKey），不进 overlay 宿主，页面切换的重绘不重建它 |
| Web | `#app` 内：`fjs-page-host`（flex:1 铺满）+ `fjs-tabbar-host`（absolute 悬浮） | 页面转场发生在 fjs-page-host 内部，bar 在外面 |
| 小程序 | 微信原生 tabBar 照旧（`meta.tab` 生成），tabBar 选项忽略 | — |

push 的语义是**整页盖住**：Flutter 上二级页是 Navigator 里的新路由，把
TabGroup 连 bar 一起盖住——**bar 不做任何隐藏/恢复动作**，push 期间保持
挂载、pop 揭开的瞬间就在原位（navPop 按两段式协议要等退场动画播完才通知
JS，specs/003，若按"当前路由不是 tab 页"去隐藏，bar 会在整个返回动画里
消失）；web 同构：bar 同样一直挂着，二级页的页面入口（`fjs-page-entry`）带 `data-covers-bar`，样式表把它抬到 bar 之上（含进出场动画期间），pop 时二级页滑走即露出 bar。
页面级模态弹层画在页面内容之上，天然盖住 bar——两端行为一致。

组件契约：props 是 `{ tabs, active }`——`tabs` 是路由表里 `meta.tab` 为数字的
页面（`{ path, title, tab }`，按 tab 排序）；`active` 是当前 tab 页的
`meta.tab`（bar 只在该值非空——即当前就在 tab 页——时显示）。切 tab 的写法
不变，仍是 `router.replace(path)`——离开的 tab 照常被 park 保活（见上一节），
tabbar 不参与页面栈。

- **可见性**：常驻 TabGroup，push 的二级页整页盖住它（不隐藏、无恢复动作，两端一致）。tab 页想整页全屏
  （游戏、播放器）再配 `<route>` meta `"tabBar": false`。
- **bar 压在内容上**（不占页面高度）：tab 页的滚动内容末尾要自己留出底部
  空档（hello-fjs 的 Shell 用一条固定高度的空 view +
  `<safe-area edges="bottom">`），最后一行才不会被胶囊盖住。
- **外观完全归应用的组件**：框架只提供挂载与状态。hello-fjs 的演示是 App Store
  悬浮胶囊——半透明底色，web 端加 `backdrop-filter` 毛玻璃；Flutter 端没有
  模糊 tag，靠透明度近似（要用真毛玻璃就得像 iconmind 那样写一个带
  `BackdropFilter` 的模块，另立 spec）。
- bar 不在任何页面树里：它自己是一个 Vue app——web 挂在 `#app` 里
  `fjs-page-host` 之后的 `fjs-tabbar-host` 上，Flutter 挂在专用根
  `fjs-tab-bar-host` 上、由基页 FjsView 停靠。所以它够不着任何页面根上的
  CSS 变量，hello-fjs 的 TabBar 在自己根节点挂了同一份主题变量（读同一个
  useTheme 单例）。
- `enableVapor` 模式暂不支持（vapor 包不含 VDOM 渲染器，surface 进不去），
  传了会 warn 并忽略。

## 全局组件（specs/211）

悬浮球、客服入口、全局播放条这类**应用级常驻 UI**：写进 shell 每页各挂一份，
状态不跨页；用 `position: fixed` 在 App 端又被 hoist 进页面级 overlay 宿主，随页面走。
`createFjsApp` 的 `globalComponents` 把一个 Vue SFC 挂成**全应用唯一一份**：

```ts
createFjsApp({
  routes,
  globalComponents: [
    Toolbox,                                   // 简写：所有 route 显示
    {
      component: FloatingBall,
      include: ['/', '/comp/*'],               // 缺省 = 所有 route
      exclude: ['/example/game/*'],            // 优先于 include
    },
  ],
});
```

- **匹配对象是 `route.path`**：字符串精确匹配；`'/a/*'` 前缀通配（含 `/a` 本身）；`RegExp` 测 path。
- **单例、保状态**：路由不命中时只 `display:none`，**不卸载**——悬浮球的位置和展开态走一圈
  被排除的页面回来仍在。
- **层序**：在页面树之上，**push 的二级页也盖不住它**（Flutter 在 Navigator 之上，web 在
  `fjs-page-host` 之上）；页面模态弹层（vant Popup / Dialog 的遮罩）盖住它——web 靠
  z-index（全局层 4，模态 1000+），App 端全局层本身在模态之上，所以 JS 侧读
  `modalMaskCount`（overlay 宿主已有的遮罩判定）在有遮罩时让位隐藏。结果两端一致。
- **事件穿透**：全局层本身不接事件，只有组件自己的元素响应。web：`fjs-global-host` 与包装层
  `pointer-events:none`、后代 `auto`，**组件根节点自己要写 `pointer-events:none`**（否则铺满的根会挡住页面）；
  Flutter：命中只发生在盒子绘制处（同 overlay 宿主），空白处落到页面，组件根不用写。
  「点空白收起」这类有意拦截，由组件在展开期间自己铺一层遮罩。
- **尺寸**：全局层没有流内内容，Flutter 把它排成高度 0，`100%` / inset 全塌，组件量不到自己的坐标空间。
  所以框架在 Flutter 上给每个组件的包装层**显式 px 宽高**（取宿主视口，`viewportSize`）；组件自己的根也建议写
  px（hello-fjs 的 FloatingBall 用 `fjs.viewport.get` 的值），不要依赖 `100%`。
- **命中顺序**：高度为 0 的父级会让子元素落入 `FjsOverflowHitScope` 的延迟命中。它曾按**挂载先后**排序，
  后显示的遮罩会压住先挂载的扇形项；现已改为按**绘制顺序**（树序 / z-index）。
- **不拦返回**：全局根是 `__global`，不是 `__appOverlay`，不进 `fjsAppOverlayHoldsBack`。
- 组件内可 `useRouter()` / `useRoute()`；组件坐标系 = 整个 App 区域（包装层 absolute 铺满）。
- 小程序忽略该选项；`enableVapor` 下 warn 后忽略。
- 示例：hello-fjs 的 `FloatingBall.vue`（拖拽吸附 + 扇形菜单）。

## 转场动画

转场是**按这次导航算的**，不是一个全局常量。谁在动谁说了算：push / replace 看
目标页，返回看被弹出的那页——和原生「路由自带转场样式」一个意思。

```ts
createFjsApp({
  routes, shell,
  transition: false,                 // 全关
  // 或者一个 web CSS 动画名（默认 'fjs-page'）
  // 或者按导航决定：
  transition: (nav) => (nav.kind === 'push' ? 'fjs-page' : false),
});
```

`nav.kind` 有五种：`initial`（首屏）、`push`、`replace`、`pop`、`tab`
（两个 tab 页之间的 replace）。

### 内置的几套转场

名字在两端是同一个东西：web 上是基础样式表里的一组 CSS 类，Flutter 上是一个原生
路由。所以 `transition: 'fjs-fade'` 在 web / iOS / Android 上是同一个动画。

| 名字 | 效果 | iOS 与 Android 一致？ |
|---|---|---|
| `fjs-page`（默认） | web 轻微右滑 + 淡入；**Flutter 用平台自带**（iOS Cupertino、Android 看主题） | ✗ |
| `fjs-slide` | iOS 式整页右滑（离开页视差跟随）。Flutter 底页靠顶页 route 的 `delegatedTransition`（与官方 `CupertinoPageRoute` 同一份），不是只滑当前页 | ✓ |
| `fjs-fade` | 纯淡入淡出，不位移 | ✓ |
| `fjs-slide-up` | 从底部升起，模态页那种 | ✓ |
| `fjs-zoom` | Material 3 的缩放淡入 | ✓ |
| `false` | 完全没有动画 | ✓ |

**默认那档两端不一致是故意的**：不写 `transition` 的 app 应该拿到各平台自己的习惯
转场。想让 iOS 和 Android 长一样，就挑一个具名的：

```ts
createFjsApp({ routes, shell, transition: 'fjs-slide' });   // 全 app 统一
```

```vue
<route>
{"title": "选择城市", "transition": "fjs-slide-up"}
</route>
```

- 具名转场之外的字符串按「app 自己的 CSS 动画名」处理：web 会用它，Flutter 那边
  没有对应的原生路由，退回平台自带转场。
- Flutter 侧的实现在 `packages/flutter_fjs/lib/src/transitions.dart`，宿主想自己
  摆一个页面时可以直接用 `fjsTransitionBuilder(name)`。
- 具名转场的时长两端都是 280ms。
- web 上转场期间两页都是绝对定位铺在 `<fjs-page-host>` 上，**谁在上面看方向**：
  push 是新页压住旧页，pop 是旧页从上面滑走。自定义动画不用管这件事，基础样式表
  按 `-enter-active` / `-leave-active` 统一处理了。

单个页面自己关，写在 `<route>` 块里：

```vue
<route>
{"title": "扫码", "transition": false}
</route>
```

优先级：应用传函数 > 应用传 `false` > 页面的 `meta.transition` > 默认策略
（`tab` 和 `initial` 无动画，其余用应用给的名字 / `'fjs-page'`）。

两个平台的落点不一样：

| | `transition: false` / `meta.transition: false` | 具名转场 | 其它字符串 |
|---|---|---|---|
| Flutter | 原生路由不带转场（时长 0），返回手势照常可用 | 对应的原生页面路由 | 平台自带转场 |
| Web | 换页无动画（`fjs-page-none`，只把离开页移出文档流） | 对应的一组 CSS 类 | 当成 CSS transition 名 |

**返回是同一套动画反着放**：pop 时离开页向右滑出、进入页从左边回来，不再和 push
长得一样。方向不是靠第二个动画名，而是 `<fjs-page-host>` 上的 `data-nav`
（`push` / `pop` / `tab` / `replace` / `initial`，无动画时是 `none`）——因为
`<KeepAlive>` 把页面缓存起来时连转场钩子一起存了，返回时那一页拿到的**名字**可能
还是上一次导航的，而宿主元素上的属性任何时候都是当前这次的。自定义动画想区分方向，
也照着这个写：

```css
fjs-page-host[data-nav="pop"] .zoom-enter-from { transform: translateX(-8px); }
```

- **tab 切换默认就没有动画**：Flutter 上它本来就是原地换基页、不进原生栈；web 以前
  会滑一下，现在对齐了。想要回来就在 tab 页上写 `"transition": "fjs-page"`。
- web 上的自定义名字要自己写 CSS（照着 `.fjs-page-*` 那几条），别忘了
  `.<name>-leave-active { position: absolute; inset: 0; }`——两页在转场期间是重叠的。
- `transition: false`（应用级）在 web 上会整个去掉 `<Transition>`；页面级的 `false`
  则保留它、只是不跑动画，因为在 `<KeepAlive>` 外面增删 `<Transition>` 会把页面重挂。
- 被 pop 掉的页面会多活一个转场的时间（离开动画播完才从 `<KeepAlive>` 里丢掉），
  它的滚动快照仍然是立刻删的——下次再 push 进去还是从 0,0 开始。

### 取参：`route.params` 与 `route.query`

动态段（`src/pages/user/[id].vue` → `/user/:id`）进 `params`，问号后面的进
`query`。两者都是 `Record<string, string>`——**值永远是字符串**，要数字自己转。

```vue
<!-- src/pages/user/[id].vue -->
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'fjs/router';

const route = useRoute();
const router = useRouter();

// route 是响应式的，派生值用 computed，不要在 setup 里解构 route.params
const id = computed(() => Number(route.params.id));
const tab = computed(() => route.query.tab ?? 'info');

if (!Number.isFinite(Number(route.params.id))) router.replace('/');
</script>

<template>
  <view class="page">
    <text class="title">用户 {{ route.params.id }}</text>
    <text>当前分栏：{{ tab }}</text>
  </view>
</template>
```

跳过去的三种写法：

```ts
router.push('/user/7?tab=orders');                     // 直接拼
router.push({ path: '/user/7', query: { tab: 'orders' } });
router.push({ name: 'user-id', params: { id: 7 } });    // 名字见 fjs routes
```

解析结果：

```ts
route.params            // { id: '7' }
route.query             // { tab: 'orders' }
route.fullPath          // '/user/7?tab=orders'
```

- `params` / `query` 的值都做过 `decodeURIComponent`
- 只写键不写值的 `?flag` 解析成 `{ flag: '' }`，`fullPath` 会归一化成 `?flag=`
- 名字跳转时 `params` 里的数字会自动 `String()` 后填进 `:id`
- `push({ name })` 用的名字是路由表里的 `name` 列（`fjs routes` 可查）。默认名由
  **文件路径**推导：`user/[id].vue` → `user-id`、`comp/button.vue` →
  `comp-button`。要换个好记的就在 `<route>` 块里写 `{"name": "user"}`，或生成时
  `fjs create page 'user/[id]' --route-name user`

catch-all `src/pages/[...all].vue`（`/*`）匹配到的整段在 **`params.pathMatch`**
里——名字取自 vue-router 的约定，不是方括号里写的那个词——且不带前导斜杠：访问
`/nope/deep` 得到 `{ pathMatch: 'nope/deep' }`，两端一致。

### 路由名的类型提示

路由表构建期就知道，所以名字不用靠记。`fjs build` / `fjs dev` / Vite 插件，以及
`fjs create page`，都会把当前路由表写成 `src/fjs-routes.d.ts`：

```ts
// generated by fjs — do not edit
export {};

declare global {
  interface FjsRoutes {
    "index": "/";
    "user-id": "/user/:id";
  }
}
```

于是：

```ts
router.push({ name: 'user-id', params: { id: 7 } });   // 补全
router.push({ name: 'user-idd' });                     // 报错：Did you mean "user-id"?
router.push('/user/7');                                // 路径只提示不拦
```

- `name` 是**严格**的联合类型：写错就是编译错误，编辑器还会给出最接近的名字
- `path` 是**宽松**提示：表里的路径会出现在补全里，但动态路由实际推的是填好参数
  的 `/user/7`，它不在表里，所以不做限制
- 这个文件是生成的，不要手改，也不要提交——模板的 `.gitignore` 里已经有它。构建、
  dev、Vite 插件任意一个跑过就会重新生成
- 没有这个文件时（纯 element API 的单页应用，或刚 clone 还没构建过），`name` 和
  `path` 退回普通 `string`：类型检查照常通过，只是少了那层校验。CI 里想要这层
  校验，在 `vue-tsc` 之前先跑一次 `fjs build`（或 `vite build`）即可

## 页面路由自动生成

`src/pages/**/*.vue` 就是路由表，`fjs build` 把它生成成虚拟模块 `fjs/pages`：

```
src/pages/index.vue        ->  /              chunk "index"
src/pages/about.vue        ->  /about         chunk "about"
src/pages/comp/button.vue  ->  /comp/button   chunk "comp-button"
src/pages/user/[id].vue    ->  /user/:id      chunk "user-id"
src/pages/[...all].vue     ->  /*             chunk "all"
```

文件名按 kebab-case 转换（`ButtonPage.vue` → `/button-page`），`index.vue` 取父
目录路径，`[id]` 是动态段。

`fjs create page <name>` 按这套约定生成文件，`fjs routes` 打印当前的完整路由表。

### `<route>` 块：标题、meta、平台

```vue
<route>
{ "title": "按钮", "tag": "button", "group": "表单组件", "platforms": ["app"] }
</route>
```

- `path` / `name` / `platforms` 由生成器读取，其余字段进 `route.meta`
- `platforms` 缺省是 `["app", "web"]`；写 `["app"]` 表示**这个页面只有 App 端
  有**——web 构建的路由表里根本不会出现它，页面代码也不会进 web 产物
- 也可以用文件名后缀简写：`about.app.vue` / `about.web.vue`

因为路由表本身就是「当前平台真正存在的页面」，首页那种目录/导航列表直接读
`routes` 就行，不用再手写一份并且两边对不上：

```ts
import { routes } from 'fjs/pages';
const items = routes.filter((r) => r.meta?.group === '表单组件');
```

## Flutter 侧：一个路由 = 一个原生页面

宿主用 `FjsApp` 代替 `FjsView`：

```dart
MaterialApp(home: FjsApp(engine: engine))
```

`FjsApp` 是一个由 JS 路由驱动的 `Navigator`。协议全部走已有的通道，没有新的
FFI 入口：

```
JS -> Dart   invokeHost('fjs.nav.push',    key, fullPath, title, chunk)
             invokeHost('fjs.nav.replace', key, fullPath, title, chunk)
             invokeHost('fjs.nav.load',    key, fullPath, chunk)   // 首页换页
             invokeHost('fjs.nav.pop')
Dart -> JS   dispatchEvent(key, 10 /* navMount */)  chunk 已在 VM 里，挂载吧
             dispatchEvent(key, 11 /* navPop */)    路由没了，卸载
```

一次 push 的完整时序：

1. JS `router.push(path)` 解析路由，分配 key，调 `fjs.nav.push`
2. Dart 把 `NavEntry` 加进 `engine.navStack` 并 `notifyListeners()`——**转场立刻
   开始**，页面内容还没到时先显示 `placeholder`
3. Dart 异步 `chunkLoader(chunk)` 取到 chunk 并 eval 进同一个 VM（已加载过的
   chunk 直接跳过），然后回派 `navMount`
4. JS 建一个新的根元素（打上 `__navKey` 标记）、把页面组件挂上去
5. `FjsView(navKey: n)` 只渲染 `__navKey == n` 的那棵根子树

`FjsApp` 只在 `navStack` 的 key / path / transition 真变时才重建
`Navigator.pages`。镜像树刷新（canvas 一帧、`requestAnimationFrame`、
`dispatchEvent`）走 `FjsView` 自己的 listener，不碰路由栈。否则 Flutter 会
对 `pages` 做引用比较后跑 `_updatePages()`，再对每条 route
`changedExternalState()` → `_forceRebuildPage()`，iOS 边缘返回的交互式 pop
就被拆掉：半屏卡住、左侧白边、或者转场中露出 `placeholder`（spec 024）。

返回分两段，手势返回和 `router.back()` 最终汇合到同一条 `navPop`：

1. Navigator 出栈（手势 / 系统返回键是命令式 pop；`fjs.nav.pop` 则先从
   `navStack` 拿掉对应页，让声明式 pages 跟上）
2. `onDidRemovePage` → `engine.onRouteRemoved(key)`：**只 park**，不立刻
   卸 JS。退出动画还在播，页面内容必须留着（spec 003）
3. route dispose（反向转场结束）→ `onRouteTransitionComplete` → 从
   `navStack` 删除 → 回派 `navPop` → JS `app.unmount()` + 删根元素

> `onRouteTransitionComplete` 把改栈和回派放进 microtask：dispose 还在
> Navigator 内部清理里，同步 `notifyListeners()` 会在半拆的 route 上 diff。

`FjsApp` 还用 `NavigatorPopHandler` 包了一层，嵌套在宿主 Scaffold 里时系统返回
键也能落到这个 Navigator 上。

Web 没有边缘返回手势：`router.back()` 和浏览器后退都是 vue-router 出栈，
离开页按 CSS 转场卸掉，和这次无关。

## 分包：shared prelude + 每页一个 chunk

`fjs build --pages` 产出三种东西：

| 产物 | 内容 |
|---|---|
| `dist/app/shared.js` | **prelude**：vue + fjs 运行时 + 应用自己的公共模块（Shell、组件、store），挂到 `globalThis.__FJS_SHARED` |
| `dist/app/bundle.js` | 应用入口，只剩 `main.ts` 自己（hello-fjs 实测 2.4 KB） |
| `dist/app/pages/<chunk>.js` | 每个路由一个，只有这个页面的代码（6–12 KB） |

hello-fjs 实测（`--pages --bytecode`）：

```
shared.fjsbundle   1,210,078 B   ← 每个 VM 装一次
bundle.fjsbundle       6,163 B
pages/comp-button.fjsbundle   23,811 B   ← 进一个页面才下载/加载这一份
```

**哪些模块进 shared** 是自动算的，不用配置：入口能到达的模块（外壳、组件），
加上**被两个以上页面引用**的模块（hello-fjs 里的 `Panel.vue`）。页面文件本身
永远不进——它们就是 chunk。实现是先跑一次 esbuild probe（`write: false` +
metafile，一次带上所有入口），按每个 output 的 inputs 统计。

宿主怎么用：

```dart
// prelude 注册一次，engine.reset() 会自动重放进新 VM
engine.addPrelude(await loadShared());
// 路由要页面时按 chunk 名取
engine.chunkLoader = (chunk) async => loadPageChunk(chunk);
engine.runBundle(await loadApp());
```

`fjs dev --pages` 把这三样分别挂在 `/shared.js`、`/bundle.js`、`/pages/<id>.js`，
并在 `/manifest.json` 里写 `"split": true`。`connectDev()` 看到这个标记就自动
注册 prelude、接上 chunkLoader——**fjs go 不用改任何代码就能跑分包工程**，热重载
时 shared 和 bundle 一起重新拉取（外壳代码也可能变）。

不带 `--pages` 时是单包：路由表用 `definePageLoader` 登记每个页面，页面模块在
第一次打开（或被预加载，见上文 `router.preload`）时才执行；`chunk` 字段为空，push
时 Dart 不做任何加载，直接回派 `navMount`。开发期和小工程用这个更简单。

两种模式下页面代码都会在首页停稳后空闲预加载（specs/143），所以打开页面时的
`[nav] mounted` 通常不再包含 chunk 的读取和执行。

## 一个坑：页面文件名和内置标签同名

`src/pages/comp/basic/divider.vue` 里写 `<divider />` 时，`@vue/compiler-dom` 会把
**文件名推断成组件名**，于是这个标签被当成「自引用组件」，页面无限递归自己
渲染自己（表现是 `RangeError: Maximum call stack size exceeded`）。

fjs 的 SFC 插件给编译器传了 `isNativeTag`，把内置标签集合声明成元素，所以这个
问题在 ufjs 里不存在；web 构建则相反——把同一批标签声明成**组件**，好让
它们走到 DOM 适配层。两个方向都在 `packages/fjs/src/bundler/vue-plugin.ts` 里。

## 相关

- [Web 平台](web.md)
- [分包与 release assets](code-splitting.md)
- [Vue 3 集成](vue3.md)
