# 三方 UI 组件库

Vue 生态的移动端组件库（vant、Vux、nutui…）是按真浏览器写的：伪元素发丝线、属性选择器、`<Transition>`、`position: fixed` 弹层、挂载帧就要量 DOM 几何。ufjs 没有为此走「WebView 兜底」的路，而是把这些库当普通 npm 依赖接进来，靠三层机制补齐它们依赖的浏览器行为。

**vant 4 是这条路线的完整检验**：demo 的 `vant: basic` / `vant: form` / `vant: feedback` / `vant: more` / `vant: nav` 五个页面在浏览器与 iOS / Android 上两端对拍，**20+ 组件**（Button / Field / Cell 系 / Tabs / Swipe / Popup / Dialog / Picker / NumberKeyboard / Skeleton / NoticeBar…）达到结构、位置、交互一致。整库没有逐组件全量验证 —— 没进 demo 的组件大多可用（机制是通用的），用前先拿一页两端对拍。

## 各端支持状态

| 端 | 状态 | 说明 |
|---|---|---|
| Web | ✅ 完整支持 | 浏览器原生，组件库本来就在浏览器里跑，无需任何处理 |
| App（Flutter） | ✅ 已验证（vant） | CSS 引擎 + DOM 形状 API + vue-shim + 项目本地补丁；vant 4 的 demo 五页两端对拍一致 |
| 小程序 | ❓ 未测试 | 小程序构建**不引入 Vue 运行时**（模板编译期直译 WXML），带 render 函数的 npm 组件库预期走不通。小程序端请用对应的小程序原生版（vant → `@vant/weapp`），这类库按普通 npm 包进 vendor.js 即可 |

## 三层应对

1. **通用的进 runtime** —— 所有组件库共享：
   - CSS 引擎的支持面：装饰型 `::before` / `::after`、属性选择器 `[class*=…]`、相邻兄弟 `+`、`position: fixed` 置顶 overlay、`animation` / `@keyframes`、内联 `<svg>`、`@font-face` 字体图标……见[样式](./styling)
   - 元素上的 DOM 形状 API：`el.style`、`getBoundingClientRect()` / `offset*`、`addEventListener`、`contains()`，input / textarea 的 `value` / `focus()` / `blur()` —— 见[运行时 API](/reference/runtime-api#元素上的-dom-形状-api)
   - vue-shim 补齐的 DOM 专属导出：`<Transition>`、`vShow`、`withKeys`（见下）
2. **库特有的留在项目本地** —— vite 插件的 `fjs.app` 钩子对库源码打补丁（见下节）
3. **`window` / `document` 不在 runtime 里模拟** —— 给全局塞浏览器假象会翻转每个库里 `inBrowser` 之类的判断，影响面不可控。库里没做浏览器判断的路径由插件打守卫补丁；个别库确实需要全局时，由项目自己 opt-in 一个只含所需表面的最小侧影

## vite 插件的 `fjs.app` 钩子

App 端打包走 esbuild、不跑 Vite，但组件库的适配仍然写在项目的 `vite.config` 里 —— 一处声明，两端生效。只要插件带上 `fjs.app` 钩子，App 端打包就会加载 `vite.config` 并对匹配的文件执行它：

```ts
// vite/vant.ts —— 项目本地的插件文件，不单独发 npm 包
import type { Plugin } from 'vite';

export function vant(): Plugin {
  return {
    name: 'vant-app-patch',
    fjs: {
      app: {
        filter: /\/vant\/es\/.*\.mjs$/,   // 绝对路径、`/` 分隔
        transform(code, id) {
          // 字面量锚点替换，返回 null 表示不改
        },
      },
    },
  };
}
```

```ts
// vite.config.ts
export default defineConfig({ plugins: [fjs(), vant(), vue()] });
```

- 只有声明了 `fjs.app` 的插件会在 App 端执行；plugin-vue、`fjs()` 等仍只作用于 web
- 多个钩子命中同一文件时按 config 里的顺序串联；`.vue` / `.css` 仍由 fjs 自己编译
- 改了 `vite.config` 要重启 `fjs dev`（每个进程只加载一次）

### 三类补丁（通用套路）

vant 的十几条补丁分三类，接其它组件库时大概率也是这三类：

| 补丁 | 解决什么 |
|---|---|
| `window` / `document` 守卫 | 库里没做浏览器判断就摸全局的路径（vant 的 `isWindow`、`useLockScroll`、`getScrollParent` 等），App 端会 ReferenceError 并把组件更新中途打断 —— 补上 `typeof window === "undefined"` 早退或让调用方走已有回退 |
| `touch-action` 声明 | Slider / Rate 这类拖拽在 scroll-view 里的手势。web 靠非 passive `touchmove` 里 `preventDefault()` 赢下手势，App 端 JS 监听晚手势竞技场一帧、指针已判给滚动容器 —— `touch-action` 是两端都认的抢手势声明 |
| 测量重试 | Tabs 下划线这类「挂载帧读 `offsetLeft / offsetWidth` 还是 0」（首帧布局未发生），按 rAF 重试至多 10 帧，量到为止 |

补丁是**字面量锚点替换**：库升级后锚点对不上就跳过该补丁、构建告警一次并写明哪个功能在 App 端失效 —— 宁要显式降级，不要坏 bundle。

## vant 的接入（demo 是参考实现）

三个文件加一个侧影，各管一件事：

1. **`src/plugins/vant.ts`**（**无平台后缀** —— 带 `.app.ts` / `.web.ts` 会静默跳过另一端，页面报 `Failed to resolve component`）：对用到的组件逐个 `app.use` 全局注册；样式按需引入写在同一文件（`vant/es/<comp>/style/index.mjs` —— esbuild 不做目录 index 推导，路径必须写全）。文件**第一个** import 是 `./vant/dom-env`
2. **`src/plugins/vant/dom-env.ts`**：runtime 不装全局假象，但 vant 一批能力（`raf()` / `doubleRaf()`、`getComputedStyle`、点外关闭）在 `inBrowser` 为假时直接死 —— `raf()` 返回 -1 且**不回调**，NoticeBar 的跑马灯永远不启动。demo 为 vant 一个库 opt-in 一个**只含它所需表面的最小侧影**：`requestAnimationFrame`、读 fjs 样式引擎的 `getComputedStyle`、document 级 pointer-down 流（点外关闭）、「首次可见」的 IntersectionObserver（等首帧布局出来再报可见）。web 构建里 `window` 本来就存在，这些全都不运行
3. **`src/vant-components.d.ts`**：手写 `GlobalComponents` 声明（vant 不自带），与注册列表保持同步 —— 插件管运行时，这个文件管 vue-tsc strictTemplates
4. **`vite/vant.ts`**：带 `fjs.app` 钩子的本地插件，按上表打补丁

完整范例在仓库里：[`demo/vite/vant.ts`](https://github.com/snice/ufjs/blob/main/demo/vite/vant.ts)（补丁插件）、[`demo/src/plugins/vant/`](https://github.com/snice/ufjs/tree/main/demo/src/plugins/vant)（注册与 dom-env 侧影）。

## 已知差异（App 端）

- **命令式 Toast / Dialog 不可用**：`showToast()` / `showDialog()` 内部 `document.createElement` + `createApp`，App 端没有 DOM 容器。改用组件式（`<van-popup>` / `<van-dialog v-model:show>`），两端一致
- **没有深层 target / 事件委托**：`target` 就是挂监听的节点。组件库靠 `event.target` 区分子节点位置的写法（vant Checker 的 `label-disabled`）在 App 端不生效
- **`position: fixed` 走置顶 overlay 宿主**：Teleport 的视觉与交互等效，不是 DOM 语义；层级只看插入顺序，从原父元素继承的样式断开
- **`getComputedStyle` 是最小 shim**（dom-env 提供）：够组件库做滚动父级查找（`overflow`）与隐藏判断（`display`），伪元素样式、百分比还原这些没有

接其它组件库时，先拿一页两端对拍，差异逐条对照上表归类：能进 runtime 的提 issue，库特有的写进自己的 `fjs.app` 插件。
