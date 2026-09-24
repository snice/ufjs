# 小程序编译：`fjs build --mp`

> 状态：spec 046 落地的第一版。目标形态是微信小程序 **Skyline 渲染 +
> glass-easel 组件框架**（`renderer: skyline`、`componentFramework:
> glass-easel`、`lazyCodeLoading: requiredComponents`）。

## 定位

fjs 的第三条产物路径。同一份 Vue SFC 源码：

| 路径 | 产物 | 模板去向 | 运行时 |
|---|---|---|---|
| `fjs build` | Flutter 宿主 bundle | render 函数（custom renderer） | element API + op 协议 |
| `fjs build --web` | 静态站点 | render 函数（DOM 适配层） | vue-router + DOM 组件 |
| `fjs build --mp` | **微信小程序四件套** | **WXML（编译期直译）** | `@ufjs/runtime/wx` 薄壳 |

与另外两端最大的不同：**不引入 Vue 运行时**。模板编译为 WXML 而非
render 函数，不打包 vdom；`import { ref } from 'vue'` 被别名到
`@ufjs/runtime/wx`，那只是 `@vue/reactivity`（ref/computed/watch，无
DOM、无 vdom）加一层 setup→setData 的胶水。分层思路对齐 wevu：
编译期（weapp-vite）管转换，运行期（wevu）管响应式与最小 setData。

## 用法

```bash
cd examples/hello-fjs
pnpm build:mp              # = fjs build --mp
pnpm dev:mp                # = fjs dev --mp：watch src/，增量重建 dist/mp
# 用微信开发者工具打开 dist/mp/（appid 默认 touristappid，可在
# package.json fjs.mp.appid 配置）
```

dev 模式没有 HTTP 服务：开发者工具自己监听 `dist/mp` 的文件变化并热编译，
`fjs dev --mp` 只负责 watch 源码 → 重建（全量发射，~100ms 级）。

**产物是 TypeScript 源码**（对齐官方 TS 快速启动模板）：每个 SFC 发射
为一个可读的 `.ts` 模块，`import` 已重写到发射位置，TS 编译交给开发者
工具（`useCompilerPlugins: ["typescript"]`）——fjs 不对应用代码做
esbuild 打包。跨页单实例不再靠注册表 hack：所有本地 TS/JS 依赖发射到
`fjs/shared/<源相对路径>`，微信的模块缓存保证全局单份。

`package.json` 的 `fjs.mp` 字段：

```jsonc
{
  "fjs": {
    "mp": {
      // 不进 app.json 的页面（路径或路径片段）
      "exclude": ["example/", "comp/canvas"],
      // 应用壳（每页包一层 NavBar/TabBar），默认 src/Shell.vue
      "shell": "@/Shell.vue",
      // project.config.json 的 appid 兜底（优先级低于 app.config.ts 的 wxmp.appid）
      "appid": "wx1234567890"
    }
  }
}
```

appid 的来源优先级：**app.config.ts `wxmp.appid`**（app 级配置，与 android/
ios 并列）> package.json `fjs.mp.appid` > `touristappid`。

`wxmp.setting` 写入 project.config.json 的 `setting`，与 fjs 的默认值**按键
浅合并、用户优先**：

```ts
wxmp: {
  appid: 'wx55831603b568aa90',
  renderer: 'skyline',
  setting: { minified: true, minifyWXSS: true, minifyWXML: true },
}
```

默认值里 `es6` / `enhance` 为 true（产物是 TS 源码，typescript 插件只剥类型，
`??`、`?.` 等语法要靠它们降级，否则预览/上传报 `Unexpected token ?`），
`useCompilerPlugins: ["typescript"]` 必须保留——覆盖这几项要清楚后果。

## 产物结构

```
dist/mp/
  project.config.json          miniprogramRoot + useCompilerPlugins: typescript
  miniprogram/
    app.{ts,json,wxss}         skyline + glass-easel 全局配置
    sitemap.json
    fjs/runtime.ts             vendor 包：wx 运行时 + @vue/reactivity（CJS）
    fjs/rich-text.js           rich-text 管线（仅 skyline 且有页面用到 <rich-text> 时产出）
    fjs/routes.ts              生成路由表（'fjs/pages' 的 wx 形态）
    fjs/shared/<rel>           发射的本地 TS 模块（theme.ts、catalog.ts…）
    fjs/modules/<module>/<tag>/ 模块包提供的组件四件套（如 iconmind）
    fjs/{fjs-modal,…}/         runtime 提供的组件四件套（fjs-rich-text / fjs-rich-node 按需）
    components/<name>/*        编译后的本地组件（Shell、Panel…）
    pages/<route>/*            **页面本体**：页面 SFC 即 page
    assets/                    静态图片（import 被改写成根绝对路径常量）
    <sub>/…                    分包（fjs.mp.subpackages）：页面、专属 vendor、
                               专属 shared、搬入的 public 目录，见下节
```

页面就是页面：路由 SFC 直接以 `Component()`（`isPage: true`）注册为
小程序页面（skyline 模板推荐写法），它自己的 wxml 就是
`<shell route="{{ route }}">页面元素</shell>`——shell 的包裹方式与
createFjsApp 在另外两端做的一致，`route`（path/query/meta）由编译器
注入 setup 并在 onLoad 同步 query。`virtualHost` 让组件不产生宿主
节点，flex 链与另外两端一致。emit 的 import 重写规则：
`vue`/`fjs`/`fjs/router`/`@ufjs/runtime/wx`/`@ufjs/webgl` → `fjs/runtime`；`fjs/pages`
→ `fjs/routes`；`@/x.png` 类资源 → 根绝对路径常量；其余本地模块 →
`fjs/shared/<rel>`（递归发射，源结构保持不变）；`import type` 整条擦除；
裸导入按 app 的 `package.json` 处理：包名在 `dependencies` / `devDependencies`
里的，→ `fjs/npm/<spec>.js`（CJS shim），所有用到的 npm 入口由 esbuild 打进
**一个** `fjs/npm/vendor.js`（es2018、minify，共用内部模块只有一份实例，如
echarts/zrender、three 及其 addons）；不在 package.json 里的包名直接报错。产物
根目录**不写** package.json：构建不使用「构建 npm」，该文件在 miniprogramRoot
之外也不参与上传，留着只会让开发者工具弹无关的 npm 构建提示。没用
开发者工具的「构建 npm」：它只打包每个包的 `main` 入口，子路径导入
（`echarts/core`、`three/examples/jsm/...`）和纯 ESM 包过不去，而且要求产物
目录里有 node_modules。注意主包 2MB 上限：大库（three、echarts 全量）真机
预览 / 上传可能超限——配分包（下一节）把这些库挪出主包。

### 分包（specs/063）

`package.json` 的 `fjs.mp.subpackages` 声明微信 subPackages，页面源码零改动：

```jsonc
"fjs": {
  "mp": {
    "subpackages": [
      { "root": "game",   "pages": ["example/game/"], "public": ["wm", "fb"] },
      { "root": "canvas", "pages": ["example/canvas/", "example/animation/"], "public": ["spine"] }
    ]
  }
}
```

- `pages` 片段的匹配语义与 `mp.exclude` 一致（path 全等 / includes / 页面名）。
  页面命中两个分包、tab 页被配进分包、root 用保留名（`pages`/`components`/
  `images`/`assets`/`workers`/`fjs`/`html`）或互为前缀、主包一个页面不剩——都是
  构建期报错。
- **npm vendor 按归属拆包**：只被一个分包可达的库进 `<root>/fjs/npm/vendor.js`；
  被主包或多个包引用的进主包 vendor（子包 require 主包合法，反之禁止；共享库
  因此只有一份实例）。每包仍有一份 `fjs/npm/<spec>.js` shim，指向 spec 实际
  所在的 vendor。本地模块同样按可达性归属：只被一个分包可达的进
  `<root>/fjs/shared/`，否则主包——否则一个只有分包页面用的 adapter 会把它
  的大库依赖拽回主包 vendor。
- **public 目录跟分包走**（`public` 字段，目录名单个名字）：图片复制到
  `<root>/<dir>/`，产物里该包模块的字符串字面量与 wxml 里的 `/dir/…` 前缀
  统一改写成 `/<root>/dir/…`（模板串头部也改写，`` `/wm/${name}.png` `` 这类
  动态拼路径因此无需改页面）。数据文件（atlas/skel…）的 base64 模块仍留主包
  （public-data 注册表在主包 app.ts 注册，主包不能 require 子包文件），注册表
  key 改写成新 URL。**守卫**：包外任何产物文件若仍引用已搬目录的前缀，构建
  报错并列出文件——宁可失败也不发一个真机断图的包。
- 已知限制：URL 拼在**更长字符串中段**（`'go /wm/x'`）不改写也不报错；wxss
  的 `url()` 不支持（fjs 样式引擎本就不支持背景图，产物里不会出现）。
- `components/`、runtime 组件、`workers/` 恒在主包（子包页面跨包 require/引用
  主包组件均合法）。没配 `subpackages` 时产物与不分包版本逐字节同形。
- **分包预下载**：`mp.preloadRule` 按 **fjs 路由路径**（可省开头的 `/`）声明，
  编译期翻译成 app.json 的真实页面路径 key；`packages` 引用 `subpackages` 的
  root（`"__APP__"` 表示主包），`network` 可选 `"all"`/`"wifi"`（默认微信的
  wifi）。key 不是已知路由、packages 引用未声明的 root、network 非法都是构建
  报错。同组页面共享 2MB 预下载限额（微信侧校验）。hello-fjs 的配置：进"示例"
  tab 即在任意网络下预下载 game 与 canvas：

  ```jsonc
  "preloadRule": { "/example": { "network": "all", "packages": ["game", "canvas"] } }
  ```

- hello-fjs 是参考配置：主包从 3.1MB 降到 ~1.2MB（源码口径），game/canvas 两个
  分包各 ~0.8/1.1MB。

## 标签映射（编译期）

| fjs 标签 | 小程序端 |
|---|---|
| view/text/image/scroll-view/swiper/swiper-item/button/input/textarea/switch/slider/form/picker(-view/-column)/web-view | 同名直出（下面几行是直出时要补的语义/外观） |
| text | 打 `.fjs-text`；被 `align-items: center/flex-end` 的 column 父级（本 SFC 的 class）居中/尾对齐、且自身没有背景/边框/宽度的 text 再打 `.fjs-text--center/--end`（stretch + text-align）——skyline 不给交叉轴居中的 text 传宽度约束，长文本不换行 |
| button | 打 `.fjs-button` + 由静态 `type`/`plain`/`size` 推出的变体 class，数值同 base-css（重置 wx 按钮的 184px 宽、粗体、灰底）；默认 `hover-class="fjs-button--pressed"`：按住时 `box-shadow: inset 0 0 0 999px rgba(0,0,0,.1)` 整体压暗 10%（WeUI 按压模型，数值同 base-css 的 `:active::after`）。不用 `::after`：webview 内置按钮自己占用 `::after`（细边框），遮罩画不出来；内阴影两种渲染器都生效且跟随圆角。页面自带 hover-class 时不覆盖。`disabled`（静态或绑定）打 `.fjs-button--disabled`：保持变体配色、整体 50% 透明（wx 自带的灰色禁用外观被覆盖，同 base-css `:disabled`）；`loading` 不交给 wx（其图标是深色小图、skyline 下还叠在文字上方），编译器在文字前画 web 同款 14px 转圈（2px 描边、四分之三圆，用两块裁剪拼出——skyline 四边颜色不同会丢圆角；样式随用到它的组件 wxss 输出，因为 skyline 不执行 app.wxss 里声明的 `@keyframes`），按钮打 `.fjs-button--loading` 不可点、不变淡 |
| input | `secure`→`password`，`keyboard`→`type`，默认补 `maxlength="-1"`（wx 默认 140）；`multiline`（静态或 `:multiline="true"`）编译为 `textarea` |
| switch | `value`→`checked`，默认 `color="#34c759"` |
| slider | 默认 `active-color`/`block-color` #007aff、`block-size` 16，去掉 wx 左右 18px 外边距 |
| swiper | 直接子节点必须是 swiper-item（`<template>` 透明、`<slot>` 放行），否则编译报错——与 Flutter / Web 共用 `src/template/swiper-children.ts`（specs/051）；swiper-item 的直接子元素打 `.fjs-fill` 撑满 |
| scroll-view | 子节点统一包进 `.fjs-scroll-inner`，本 SFC class 里的 flex 布局声明（gap/flex-direction/align-items…）内联到包装上——skyline `type="list"` 不对直接子节点做 flex；`direction: horizontal`（class/style/属性）→ `scroll-x`。**例外**：静态 `type="custom"` 的 scroll-view 是 sticky 组件的宿主（sticky-header / sticky-section 必须是它的**直接**子节点），不注入 `type`/`enable-flex`、也不包内层；绑定的 `:type` 无法静态判断，按普通 list 滚动容器编译 |
| list-view（`:items` + `#default="{ item, index }"`） | `scroll-view type="list"` + `wx:for`，行是直接子节点（skyline 按需构建，等价虚拟化，**不**包内层） |
| defer（specs/118） | 透明 `<block>`，内容与页面一起渲染；`placeholder-height`（静态 / 绑定、两种拼写）编译期丢弃 |
| checkbox / radio / checkbox-group / radio-group / label | runtime 组件 `fjs-*`（wx 原生语义不同：状态在 `checked`、change 只在 group 上触发）。`value` 布尔、change 载荷 `"1"/"0"`，group 载荷同 ui-api.md；label 点整行转发给 `for` 指向或第一个控件。宿主 class 上的 flex 布局经 `layout` 属性内联到组件根节点（skyline 不支持 `inherit`） |
| progress | runtime 组件 `fjs-progress`：`value` 0-1、缺省为不定进度、`type="circular"` 转圈 |
| rich-text | **按渲染器分流**（spec 050）。**webview**：原生 `rich-text`，`nodes` / `space` / `user-select` / `bindtap` 原样透传，只补 `fjs-rich-text-host` class（块级盒子），不打包管线、不拷组件。**skyline**：runtime 组件 `fjs-rich-text`（原生实现行内元素各占一行、无 ol 编号、表格挤成一行、img 宽度与 pre 空白失效）。在 wx 运行时跑另两端同一条管线（`rich-text/*` → `wx/rich-text.ts` 转成渲染数据），管线**不在** `fjs/runtime.ts` 里：有页面用到时才单独打成 `fjs/rich-text.js`，由组件 `require('../rich-text')`；由 `fjs-rich-node` 画出：块是 view、一个段落是一个 `text` 加一层行内 run、含图片的段落是可换行的横排、hr 是 16px 高中间 1px 线。组件实例只在块级嵌套处递归。编译器补 `scope`（页面 data-v class），并把用到 rich-text 的 SFC 的 wxss 汇总到 `fjs/fjs-rich-node/page-styles.wxss` 由组件 `@import`——skyline 下页面样式进不了组件模板。没有页面用 rich-text 时两个组件与 `fjs/rich-text.js` 都不产出 |
| picker-view | 打 `.fjs-picker-view`（220px 高）、`picker-view-column` 的直接子元素打 `.fjs-picker-item`（44px 行，居中 16px `#333333`），`indicator-style` 默认 `height: 44px`；静态 `item-height` 换算成内联高度（非数字字面量告警后按 44）。`:value` 编译为 `value="{{ __fjs.pickerValue(v, __fjsPvN) }}"`：skyline 丢掉创建时的 value、列选项被整体替换时（联动列）再丢一次，但事后交相同下标就生效且不派 change，所以运行时 `pickerSync` 在首帧渲染完、以及 value / 各列 v-for 列表变化那次 setData 渲染完（setData 回调）后把 tick +1，wxs 重算出数组副本。v-for 里的 picker-view 只有首帧那次 |
| form | 原生 form；`@submit` 载荷 `JSON.stringify(detail.value)`，键序即文档序（与 web 对拍一致）。fjs-checkbox / fjs-radio / 两个 group 挂 `wx://form-field`：交互把当前态写回 `value`；group 是字段（checkbox-group 值为选中名字数组、radio-group 为选中名字或 `''`），成员挂到 group 下时把标识名挪到内部 `key`、清空 `name`——原生 form 跳过空 name 的字段，组内成员因此不单独出现 |
| inner-canvas | `canvas type="2d"` |
| 页面根节点的 scroll-view | 页面在 shell 的滚动主体里（有 shell 且路由未声明 `scroll: false`）时编译为普通 view：web / Flutter 上内层滚到头会交给外层、且内层本就没有有界高度，滚动全在外层；skyline 不做滚动接力，内层必须写死高度，超出主体视口的部分永远划不到（tab 页最后一截被挡）。自己管滚动的页面声明 `scroll: false`。**例外**：skyline 下静态 `type="custom"` 的根 scroll-view 不降级（skyline 没有页面级滚动，降级会连 sticky 子组件一起作废），高度检查照常强制 |
| scroll-view | 追加 `type="list"`（skyline 必需，webview 兼容）与 `enable-flex`——`.fjs-box` 基线让 scroll-view 成为 flex 容器，webview 下不加这个属性会告警；而去掉 flex 的话 webview 的滚动区不计入内容（scrollHeight 等于盒子高度，滚不动）。页面自己写了 `type` 时让位，见上面的 custom 例外 |
| sticky-header / sticky-section | **按渲染器分流**（specs/052）。**skyline**：原生组件原样直出，`offset-top` / `push-pinned-header` / `bindstickontopchange` 都交给 skyline；必须是 `type="custom"` scroll-view 的直接子节点。注意 skyline 原生组件在首帧会对每个 header 先派一次 `isStickOnTop:false`（web / Flutter 端首帧静默），页面若以「收到事件」为吸顶依据需自行忽略首次。**webview**：编译为 runtime 自定义组件 `fjs-sticky-header` / `fjs-sticky-section`（specs/053，skyline 构建不拷贝这两个四件套）。组件用 `virtualHost`——sticky 必须长在页面流真实节点上，真实宿主会把吸顶边界缩到自身高度；事件由 IntersectionObserver（relativeToViewport 按 offset-top 平移）测量，`offset-top` 支持绑定值，`allow-overlapping` / `padding` / `push-pinned-header` 接受但不生效 |
| stack / divider / safe-area / position | `view` + 内置 class（`fjs-stack` 等，取值同 web 的 base-css） |
| modal | `fjs-modal` 自定义组件（runtime 提供，`@modal-closed` 同名；底部 sheet，数值同 base-css） |
| page-container | **同名透传 wx 原生标签**（基础库 ≥ 2.16.0，specs/065）：不进任何映射表，`show` / `duration` / `round` / `close-on-slide-down` 等属性原样直出，虚线事件走兜底命名（`@before-enter` → `bindbeforeenter`，与 wx 的 `bind:beforeenter` 等价）。web / Flutter 端是各自的实现（见 ui-api.md 三端差异表），返回手势关闭在小程序端由 wx 原生提供 |
| **模块 widget 标签**（如 icon-mind） | **由模块包提供**：`fjs.widgets.<tag>.mp` 指向包内四件套，构建拷贝到 `fjs/modules/<包名>/<tag>/` 并写入 usingComponents。构建同样跑模块的 prepare 钩子，生成的每个 `.json` 转成 `fjs/modules/<包名>/data/<file>.js`（CommonJS，组件 `require('../data/icons.json.js')`）。编译器给 widget 补 `fjs-color`：从本 SFC 静态 class / style 推出的继承色（自身优先，再找祖先），可能是 `var(--x)` |

## 事件映射

模板 `@x` 编译为 `bindx="__fjsCall"` + `data-*` 属性，运行时
`adaptEvent(tag, event)` 把 wx 事件对象归一成 fjs 语义载荷后再调
handler（**载荷约定与另外两端一致**，如 switch `@change` 收 `"1"/"0"`、
input 收 `e.detail.value`、tap 无载荷）。内联箭头函数被提取成生成代码，
v-for 作用域变量经 `data-args` 传递。已对账的 tag×event 组合见
`fjs-runtime/src/wx/events.ts`，未列出的走 `e.detail` 透传。数组/对象载荷
一律转成另两端同样的字符串：picker-view 与 picker `@change` 是下标数组 JSON 串
（单列 picker 是下标串），picker `@columnchange` 是 `{"column":0,"value":2}`，
form `@submit` 是 `{name: value}` JSON 串。

## 模板能力对照

| Vue 写法 | 小程序端 |
|---|---|
| 插值、三元、算术、成员访问 | `{{ }}` 直译 |
| v-if / else-if / else | wx:if / wx:elif / wx:else |
| v-for + :key | wx:for + wx:for-item/index + wx:key；嵌套循环未命名的下标自动取 `__i1`… |
| `n in 3` / `n in rows`（数字） | 字面量展开成 `[1, 2, 3]`；脚本里初值为数字的绑定走 `fjs/fjs.wxs` 的 `list()`——Vue 从 1 数，wx:for 从 0 数 |
| v-for 内依赖 item 的函数调用（`picked.includes(item.id)`） | 生成按下标取值的 computed 表 `__dN[index]`（WXML 不能调用函数，实例级 computed 看不到循环变量） |
| v-show | `hidden` |
| :class 对象/数组/模板字符串 | 编译期内联展开（保留 v-for 作用域） |
| :style 对象/标识符 | 内联展开（数字值经 wxs `unit()` 补 px）；含展开运算符/函数调用的走 `stringifyStyle` computed，v-for 内为按下标取值的 computed 表 |
| 内联事件 handler | 提取为 setup 内生成函数，经 `__fjsCall` 分发；v-for 内经 `data-args` 传**各层下标**，handler 里从响应式列表取回原对象（按值传的是 setData 快照副本，改它不会更新） |
| `requestAnimationFrame` / `cancelAnimationFrame` | 小程序模块包装里这两个名字是 undefined 的遮蔽绑定，编译器给用到的模块补 import，运行时以 16ms 定时器实现 |
| `setImmediate` / `clearImmediate` | 宿主里根本没有：库用 `typeof window !== 'undefined'` 探测浏览器时会走 Node 分支读这个裸全局（Anime.js 在模块求值期就这么挑主循环）。与上一行同一套注入，映射到同一个帧定时器——不用「尽快执行」的宏任务，那样的自我重排循环会把线程占满 |
| 模板中的函数调用 `{{ f(x) }}` | 提取为 computed |
| v-model（input/textarea） | value + bindinput |
| 默认/具名 slot | slot 直译 |
| **作用域插槽** | ❌ 告警并丢弃 |
| **`let` 绑定的模板更新** | ❌ 用 ref（与 Vue 行为一致） |

## 布局基线的落地方式

`app.wxss` 承载全局布局基线（容器 = column flex + border-box，同 web 的
base-css）。两个 skyline 硬约束决定了它的形态：

1. **skyline 只支持 class 选择器**——`view {}` 这类标签选择器被静默忽略。
   基线因此写在 `.fjs-box` 上，编译器给每个容器标签（view/scroll-view/
   swiper 等，见 wxml.ts CONTAINER_TAGS）统一打这个 class。
2. **百分比高度链在 skyline 不可靠**——`page` 用 `100vh` 显式定高（官方
   skyline quickstart 同款），页面 `:host` 用 `flex: 1 1 0%` 从 page 接链。

另外组件 JSON 一律 `"styleIsolation": "apply-shared"`——否则 app.wxss 进
不了组件（默认 isolated），基线同样失效。这三个坑任何一个漏掉，症状都
是"内容全部叠在页面顶部"。

## 已知差异（对齐 css-compat.md 的风格）

- **样式**：WXSS 是真 CSS。scoped 靠「属性选择器→class」改写（skyline
  不匹配属性选择器）；`position: fixed` 受 skyline 限制。
- **无单位数字 / flex-grow**：与 web 共用 `css-compat.ts` 的长度规则（`height: 28` → `28px`，`@media` 条件同理）；`flex-grow: n` 补 `flex-basis: 0%`（Expanded 语义，百分比基数在不定高容器里回退为内容尺寸）。
- **`:active`**：改写为 `.fjs-pressed`，模板里带该 class 的元素加 `hover-class="fjs-pressed" hover-stay-time="60"`；`:hover`/`:focus` 触屏无对应，丢弃并告警。
- **`@media`**：skyline 不求值条件（所有块都生效）。编译期把块 N 的规则主体补 `.fjs-mq-N`，带主体 class 的元素 class 上加 `{{ __fjsMq[N] }}`；运行时用 App 端 CSS 引擎同一个求值器（`css/parser.ts` `mediaMatches`）按窗口尺寸填充，`wx.onWindowResize` 时重算。代价：这些规则比同名基础规则多一个 class 的优先级。横竖屏切换需要 app.json 的 `pageOrientation`（当前未设）。
- **页面路由**：页面在 `onLoad` 里挂载（此时才有 query），`route` 由 setup 最开头的 `__fjsRoute` 提供并立即设为当前路由，页面自己 `useRoute()` 读到的就是本页和本页 query；路由字面量同时作为页面初始 data，先于页面挂载的 shell 首帧即可读到。`onPageSettled` 以首帧渲染（onMounted）后一个宏任务近似——小程序没有转场结束事件。
- **touch 事件**：载荷与另外两端同形（`FjsTouchEvent`：touches / changedTouches / identifier / offsetX 等），原点取 wx 的 `currentTarget.offsetLeft/Top`（skyline 下查节点 rect 补上）；canvas 的触点自带相对画布的 `x/y`，offsetX/Y 直接取它，不用 clientY 减原点（两者参照系在 skyline 真机上可能不一致，纵向命中会偏）；`targetTouches` 近似为 touches；`touch-action`（class 或静态内联 style 里的 none / pan-x / pan-y）由编译器落地：webview 下 `none` 把 touchmove 编译成 `catchtouchmove`（无处理函数时绑空方法）；skyline 下节点外包同轴的 `horizontal-/vertical-drag-gesture-handler`（none 两个都包，pan-y 只包横向，pan-x 只包纵向），内层同类型手势先识别，外层 scroll-view 不再滚动。手势组件是虚拟节点，不影响布局；`v-if` 挪到最外层。
- **布局基线**：全局默认 flex column + border-box（对齐 Flutter/web 两
  端，因此 app.json 故意**不设** `defaultDisplayBlock`/`defaultContentBox`）。
- **public/**：`public/` 下的图片拷到小程序根目录，`/images/x.png` 这类根绝对路径两端一致。非图片文件（数据文件）也进包，但**不以文件形式**：真机上 FileSystemManager 读不到代码包（DevTools 读的是源码目录，只在真机上失败），白名单外的后缀（`.atlas`、`.skel`、`.txt`）上传时还会被过滤。所以每个数据文件编译成 `fjs/public/<路径>.js`（导出 base64），`fjs/public-data.js` 以字面量 `require` 懒加载登记（「过滤无依赖文件」会保留），`app.ts` 启动时交给运行时；wx 的 `fetch('/spine/x.atlas')` 这类根相对 GET 不走 `wx.request`（会报 invalid url），先查这张表，查不到再用 FileSystemManager，都没有返回 404。按路径被 wx API 使用的媒体类文件（mp3 / mp4 / wasm 等）照旧原样拷贝。npm 依赖里 `import '@ufjs/runtime'` / `'fjs'` 在 vendor 打包时映射到 wx 运行时（`fjs/runtime`），不会再打进一份 App 运行时。小程序模块包装会把 `requestAnimationFrame` / `cancelAnimationFrame` 遮成 undefined：SFC 由编译器补 import，vendor.js 顶部则注入转发到 wx 运行时的同名函数（spine-core 的 `AssetManager.loadAll` 靠它轮询）。
- **safe-area**：`edges`（与 web / Flutter 同义）限定补哪几边。顶边只在盒子顶边位于状态栏下方之外时补（测量顶边，它不随自身 padding 移动）；未写 `edges` 且顶边已在状态栏下方的是嵌套，全为 0（等价 Flutter SafeArea 对 MediaQuery 的消耗）。底边补 Home 指示条，tab 页不补（原生 tabBar 已占据，沿 owner 链查路由表 `meta.tab`）；按**窗口**底边（`screenTop + windowHeight`）而非屏幕底边算——Android 微信的页面窗口止于系统导航栏上方、那一条由微信自己涂色，内容无法穿过它，也不应再补一次。**底边不测量**：webview 渲染器排版过程中报告的盒子会随自身 padding 与内容增长，测量值曾变成约 600px 的底部内边距，把 shell 的 scroll-view 挤成零高——整页无法点击、`:active` 无效。组件自身不 grow（与另外两端一致），宿主与根节点 `min-height: 0`：webview 遵循 CSS 的 flex 最小内容尺寸，高度链断开时 scroll-view 会长到整页内容高，变成整个窗口滚动。
- **页面根**：shell 模板（无 shell 时为页面模板）的根元素由编译器打 `.fjs-page-root`，撑满页面——对应 web 的 `fjs-page-host > *` 与 Flutter 根节点的 growChildren。hello-fjs 的 NavBar 自带 `safe-area edges="top"`（状态栏区域与导航栏同底色、固定在滚动区外），TabBar 自带 `edges="bottom"`，二级页的底部安全区放在 shell 滚动区内容末尾（内容可滚到指示条下；`scroll: false` 的页面仍在外面留一条）。
- **skyline 限制（已确认，未绕过）**：input 不认 `line-height`，单行输入框比 web 矮约 2px；DevTools 模拟器里 textarea 的 `placeholder-style`/`placeholder-class` 不生效；`text-transform` 不支持；四边颜色不同的 border 会让 `border-radius` 失效（fjs-progress 的圆环因此用裁剪实现）。
- **icon-mind**：skyline 没有内联 SVG，组件把与 web 替身相同的形状（描边粗细、duotone 规则一致）拼成 SVG data URI 交给 `<image>`。image 不继承 `color`、skyline 又读不到计算样式（SelectorQuery 的 computedStyle 为空，`mask-image`/`filter` 也不支持），颜色按 `color` 属性 > `fjs-color` > `#333333` 取；`var()` 由 wx 运行时解析——`:style` 绑定里出现过的 CSS 自定义属性全部登记在一张全局表（`style.ts` `resolveCssColor`，主题切换时通知重绘）。局限：继承色只看模板静态 class，经 `:class` 动态切换或跨组件继承的颜色拿不到。原生 tabBar 不支持 SVG 图标，tab 仍只有文字。
- **canvas**：映射为 `type="2d"`，`wx/canvas.ts` 桥接 2d：`<canvas ref>` 编译成 `id="fjs-cv-<ref>"`，首次渲染后经 SelectorQuery 拿节点赋给 setup ref（`getContext('2d')` / `width` / `height` / `devicePixelRatio` / `toDataURL`）；`@resize` 在测量到尺寸及窗口尺寸变化时触发，载荷同另两端；backing store = 布局尺寸 × pixelRatio，页面坐标是逻辑像素。`loadCanvasImage` 等第一块 canvas 出现后用 `createImage()` 加载，drawImage / createPattern 里按节点换成该节点自己的图片（尚未解码完的那帧跳过）；加载失败会 console.warn 路径和 errMsg。真机 `createImage` 不认 webp（安卓实测失败，模拟器正常），canvas 素材用 png / jpg。限制：ref 只认静态标识符、不能与 `id` 并用，v-if / v-for 里的 canvas 拿不到；DevTools 不支持 skyline canvas 调试，需真机。**WebGL**：import 了 `@ufjs/webgl` 的 SFC，canvas 编译为 `type="webgl"`（wx 节点的 type 决定 context 种类，显式写 `type` 优先；`@ufjs/webgl` 在小程序端映射到运行时，无需注册），`getContext('webgl' / 'webgl2')` 直接返回 wx 的 context，`texImage2D` / `texSubImage2D` 接受 `loadCanvasImage` 的句柄；同一块 canvas 只能拿 2d 或 webgl 其一。基础库没有 WebGL2 时 `getContext('webgl2')` 返回 null（基础库会打一条 `Invalid context type [webgl2]` 的 error），页面按 `?? getContext('webgl')` 回落。
- **defer**：App 与 web 上折叠线下的内容等转场结束才挂，小程序上随页面一起出——`<defer>` 要省的是 JS 挂载那一帧，skyline 按需构建节点，没有这笔账，拆开反而多一次 setData。`placeholder-height` 因此没有意义，编译期丢弃。
- **rich-text（skyline）**：嵌套 text 不支持 `vertical-align`（`sub` / `sup` 只变小不抬升）与 `position`/`top`；含图片的段落是「文字段 + 图片」的换行横排，图片旁的长文字在自己的盒子里换行、不绕排；非 scoped 的页面样式经 page-styles.wxss 会作用到**所有页**的 rich-text 内部节点（scoped 的带 data-v class，只命中来源页）；`<img>` 不给宽高时 load 后按原图宽度、不超过容器。
- **rich-text（webview，原生）**：默认样式（标题字号、段落边距、列表缩进）来自原生 / 浏览器 UA，而不是 `rich-text/defaults.ts`，数值接近但不保证一致；页面 `<style scoped>` 规则**命不中**内部节点（原生节点不带 data-v class），要样式化内部节点请用非 scoped 样式；白名单外标签（script / iframe 等）被原生静默丢弃、**没有**控制台告警（加告警需要在 wx 侧解析 HTML，与「webview 不打包管线」冲突，spec 050 Q2）。
- **picker-view**：上下渐隐用原生遮罩（不是 web 的 mask-image）；v-for 内的 picker-view 选项列表整体替换后不会重交 value。
- **hello-fjs 示例页的开放情况**：组件页开放 rich-text、picker-view、form、position（spec 048），仍排除 canvas、web-view、refresh；示例页开放 percent-spacing、pseudo、responsive、transition、page-settled、drag、dnd、2048；排除 echarts / f2 / shooter / three-gltf / gltf-viewer / webgl / webgl-instanced（npm 渲染库或 WebGL）、motion / anime（依赖 @vueuse/motion、animejs）、theme（Flutter 管线压测：styleEngine / op sink）、gomoku / tetris（canvas 桥）；animation 组（anime / motion）自 spec 061 起开放。
- **v-motion / @vueuse/motion**（specs/061）：小程序端没有元素可写，指令的 `el.style[key] = v` 落不下去。编译器把 `v-motion` 元素的 `:initial` / `:enter` / `:variants`（外加 `:delay` / `:duration`）收进 setup 里的一次 `motion()` / `motionEach()` 调用，运行时交给 `useMotion` 一个**DOM 形状的替身**（一个带 reactive `style` 的普通对象——motion 只碰 `el.style[key]` 与 `el.style.transform`），再把替身的 style 串回绑到元素上（`style="{{ __m0 }}"`，v-for 里是 `__m0[index]`）；元素自己的 `:style` / 静态 `style` 仍在前面，motion 写在后面生效。`@vueuse/motion` 不进运行时包：`useMotion` 由编译出的页面模块 import 后传进去。元素上的 `:ref` 拿到的就是这个替身，`el.motionInstance.apply('right')` 照常可用。帧循环与 App 端同路：没有 `window`，framesync 退到 16.7ms 的 setTimeout。
  不支持：`hovered` / `tapped` / `focused`（要 DOM 事件）、`visible` / `visibleOnce`（要 IntersectionObserver）、`leave`（要 vdom 卸载钩子）——编译期告警后丢弃；嵌套 v-for 里的 `v-motion` 同样丢弃并告警。`:key` 变化在另外两端是重挂载重播入场，这里由运行时重建实例等效实现（key 表达式编译进 `motionEach`）。
- **setData 的时机与内容**（specs/062，来龙去脉见 [performance.md 的「一页 Anime.js 为什么卡」](performance.md#小程序端一页-animejs-为什么卡2026-09)）：同一批响应式写入合并成**一次** setData，排在一个微任务上（`nextTick()` 仍在它之后）——`@vue/reactivity` 自己没有任务队列（队列在 runtime-core，这个目标不装），没有 scheduler 的 `watch` 是同步的，一帧写 25 个对象 × 3 个属性会过桥 75 次。另外 `v-for` 的列表按**模板真正读到的字段**投影后再下发（`__fjsProject`）：`wx:for="{{ dots }}"` 只为走一遍列表，模板读 `dot.id`，那么 `scale` 每帧在变也不会让整个数组重发；整项被读（`{{ chip }}`、`dot[key]`、事件 `data-args`）、`wx:key="*this"`、嵌套 v-for 的内层列表、运行时才知道是否为数字的列表都原样放过。`__fjsData` 因此就是「模板读到的名字」集合。
- **fetch**：`@ufjs/runtime/wx` 安装基于 `wx.request` 的 polyfill，文本/
  JSON 响应可用；流式与 blob 不可用。
- **toast / invokeHostAsync**：`fjs` 模块在 wx 端的 `toast` 走 `wx.showToast`。
- **Worker**（specs/049）：`new Worker('/workers/x.js')` → `wx.createWorker('workers/x.js')`。构建把 `src/workers/*`
  打包后写到 `miniprogram/workers/`，外包一层适配：函数内声明局部 `onmessage`、`postMessage(string)` 转
  `worker.postMessage({ d })`，worker 里抛出的错以 `{ e }` 回到页面 `onerror`；app.json 加 `"workers": "workers"`。
  wx 同时只允许一个 worker：建新的会先终止旧的并 `console.warn` 一次。worker 里没有 `wx` API。
- **路由**：push/replace/back 映射 `wx.navigateTo`/`redirectTo`/
  `navigateBack`；栈深受小程序 10 层限制。

## 实现索引

| 文件 | 职责 |
|---|---|
| `packages/fjs/src/mp/wxml.ts` | 模板 AST → WXML + 生成代码提取 |
| `packages/fjs/src/mp/script.ts` | compileScript 产物包装与注入 |
| `packages/fjs/src/mp/css.ts` | WXSS + scoped class 改写 |
| `packages/fjs/src/mp/project.ts` | app.json / project.config 等工程文件 |
| `packages/fjs/src/mp/build.ts` | `--mp` 编排（编译闭包、.ts 发射、模块组件） |
| `packages/fjs-runtime/src/wx/` | vue shim、instance（setData diff）、events、router、fetch、worker |
| `packages/fjs/src/project/workers.ts` | `src/workers` 扫描、打包、wx worker 适配（三端构建共用） |
