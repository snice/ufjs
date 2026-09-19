# 068 · demo 接入 Vant 组件库做兼容性测试

## 背景与动机

`demo` 是 `create→run→build` 的回归验证场，但它目前只用原生标签和自己写的
SFC。第三方组件库是 fjs "JS 能包就不要下 Dart" 主张的最苛刻检验：Vant 4
是真实世界的 Vue 3 移动端组件库，它假设真浏览器 DOM（伪元素发丝线、属性
选择器、Teleport、`document.createElement` 挂载 Toast 等）。

把 Vant 接进 demo 并写几个测试页，目的是**量化 fjs 渲染管线对真实组件库的
兼容程度**：哪些组件直接可用、哪些缺样式但结构正常、哪些 API 在 App 端
必然不可用（并把失败显式暴露出来而不是白屏）。

## 最终方案（实现过程中与最初设想有两处收敛，见「过程发现」）

1. `demo` 安装 `vant`（^4），写入 `fjs.packages` / `fjs.shared`。
2. **JS 按需**：页面不 import 组件；`src/plugins/vant.ts`（无平台后缀，
   两端都加载）对用到的 20 个组件逐个 `app.use(...)` 全局注册。样式按需
   引入（`vant/es/<comp>/style/index.mjs`）也写在同一个文件里——App 构建
   （esbuild）把 CSS 抽成死文件丢弃，只有 web 消费它。 esbuild 不做目录
   index 推导，所以路径必须写全到 `/index.mjs`。
3. **类型**：`src/vant-components.d.ts` 手写 `GlobalComponents` 声明
   （vant 不自带），与插件的 `app.use` 列表保持同步——插件管运行时，
   这个文件管 vue-tsc strictTemplates。
4. 三个测试页 + index 入口：`/vant-basic`（Button/Tag/Cell/Divider/
   Grid/Badge）、`/vant-form`（Field/Switch/Checkbox/Radio/Stepper/
   Rate/Slider 的 v-model）、`/vant-feedback`（Popup/ActionSheet/Dialog
   组件式 + 命令式 Toast/Dialog 探针，try/catch 后把结果写在页面上）。

## 过程发现（两处 packages/ 修复，均超出一开始"不改 core"的预设）

1. **`fjs-runtime/src/vue/vue-shim.ts` 缺 4 个 DOM 专属导出**。任何
   `import { X } from 'vant'` 都会拉进整棵 barrel，其中预编译代码从
   `'vue'` 导入 `vShow / withKeys / Transition / createApp`（只在
   runtime-dom 有），app 构建直接失败。shim 的职责就是补这类名字
   （TransitionGroup 是先例），故：
   - `Transition`：渲染 slot 的直通组件（动画是 Flutter 侧的事）；
   - `vShow`：`setStyle(el, {display: 'none' | 'flex'})`（Dart 侧只认
     `display == 'none'`，显示写显式默认值而非清空）；
   - `withKeys`：直通（fjs 事件不带键码，宁多触发不失效）；
   - `createApp`：调用即抛错（命令式弹层需要 `document.createElement`
     做挂载点，App 端没有 DOM，探针页显示这个报错本身就是测试结论）。
2. **`flutter_fjs/lib/src/widgets/button.dart` 取标签只看一层**。按钮
   适配器是叶子渲染（子节点不产 widget，只从 `text` 子节点或自身文本取
   label），而 vant 的 label 在
   `<button><span class="van-button__text">主要</span></button>` 的
   孙节点上 → App 端按钮渲染成空框。修复：label 沿 `text` 标签后代
   递归收集（子节点不渲染，不会二次绘制）；回归测试加在
   `test/button_style_test.dart` 的 `label extraction` 组。

## 不做什么

- ~~不给 App 端接 vant 样式~~（已推翻，见下「后续：App 端样式」）。

- 不接入 `@vant/auto-import-resolver`（Vite 插件帮不了 esbuild 构建，
  全局注册是两端一致的按需方案）。

## 后续：App 端样式（按用户要求接入）

App 端实测「渲染不正常」：样式没进 jsbundle。两处根因、一处遗漏：

1. **构建**：`import 'x.css'` 在 app 构建里走 esbuild 默认 css loader，
   产出 `shared.css` 死文件，宿主从不读，页面无样式且无报错。`vueSfcPlugin`
   （所有 Flutter 构建都挂它）非 web 模式下接管 `.css`，转成
   `registerStyles(null, css)`，与 SFC `<style>` 同一条引擎路径；web 构建
   不变。回归：`packages/fjs/test/vue-plugin-css.test.ts`。
2. **引擎**：vant 的全部主题变量声明在 `:root,:host` 上，CSS 引擎按
   不支持的伪类整条跳过 → 所有 `var(--van-*)` 解析失败。`:root`/`:host`
   现在把自定义属性提升为继承链起点（父节点没有可继承的自定义属性时从这里
   取），其他声明 warnOnce 跳过。回归：`css.test.ts` 两条。
3. **按钮 label**：vant 实际结构是 `button > div.van-button__content >
   span.van-button__text`，上一版只沿 `text` 标签递归，中间的 `view` 断链，
   按钮仍是空框（之前的 App 端验证用的是未重编的 fjs-go）。改为沿全部后代
   收集。

iOS 模拟器（fjs-go 重编）对比 web：Button 各变体颜色/圆角/朴素/禁用/块级、
文字全部对齐。

## 再一轮：自动两端对比后修的引擎缺口（2026-09-18）

用 `fjs run ios` + web 端浏览器把三个页面逐屏截图对比，又发现四个问题、
修了四个：

1. **`display:flex` 没写 `flex-direction` 时，App 端是竖排**（Cell 标题与值
   竖排、Divider 占三屏高、Grid 三列变一列）。CSS 的初始值是 `row`，web 端
   用真 CSS 天然是对的；App 端引擎把未声明交给 Dart 侧默认 column。修复：
   `css/style.ts` 的 compute() 在合并结果上 pin 初始值——只有声明了
   `display: flex`（含 inline-flex / -webkit-flex）且未写方向的节点受影响，
   fjs 无样式的 view 默认竖排惯例不变。回归：css.test.ts 两条。
2. **em 单位整个不生效**（van-switch 2em×1em 塌缩不可见、Checkbox/Radio
   图标全宽拉伸）。`normalizeValue` 只把 px/rem 归一成数字，em 字符串透传到
   Dart 被 `_parseLengthUncached` 丢弃。em 依赖元素自身 font-size，只能在
   compute() 级联之后解析：`resolveEm()` 在 var() 替换后把 em 折算成 px
   （font-size 自身的 em 按 parent 的解析值算，`line-height` 保留 "Npx"
   字符串形态让 Dart 区分倍数与高度，复合值如 `translateX(1em)` 逐 token
   改写）。回归：css.test.ts 两条。
3. **纯绝对 calc() 不进盒子尺寸**（修完 em 后 van-switch 胶囊仍是 0 宽：
   `--van-switch-width: calc(1.8em + 4px)` 折算成 `calc(46.8px + 4px)` 后，
   decoration.dart 非相对分支走 `parseLength`，calc 被静默丢掉）。修复：该
   分支改用已解析的 `widthLength.px`（`parseFjsLength` 本来就支持 calc）。
4. **`<input>` 在收缩适应容器里撑爆**（Field 打开瞬间整页白屏：vant
   `.van-field__body` 的 `display:flex` 变 row 后，`width:100%` 的 input
   解析不到有界包含块，InputDecorator 断言 unbounded width）。修复：
   `widgets/input.dart` 用 LayoutBuilder 兜底——浏览器里 `<input>` 固有宽度
   （size=20 ≈ 178px）永远有界，无界时以它替代。

另有**演示侧**修复：vant 的命令式 API 在非浏览器环境是静默空操作
（`showToast` 直接 `return {}`，`showDialog` 返回 `Promise.resolve(undefined)`，
根本走不到 shim 的 createApp 抛错），探针页原先据此误报「调用成功」。
`vant-feedback.vue` 改为用返回值识别空操作并如实显示 ❌。

**验证后的剩余差异（仍属另立需求）**：
- 弹层贴底/遮罩：`position: fixed` + Teleport 架构级，组件式弹层目前原地渲染。
- 伪元素（发丝线、Checkbox 对勾、箭头字形）与 iconfont 字形缺失。
- `border-radius: 50%/100%`（radio 圆点、switch 圆点）需布局期解析，当前
  呈方角；涉及 decoration.dart 增加按角落数据的解析管道，未动。
- Checkbox/Radio 行有 debug 溢出红条（内容比行盒高约 5px；vant 用
  `overflow: hidden` 掩盖，引擎不支持该属性裁剪）。release 构建无红条。

## 验收标准（达成情况）

1. ✅ `pnpm --filter demo run typecheck` 通过。
2. ✅ `pnpm --filter demo run build` 成功；`fjsrun`（shared+units+bundle
   拼接加载）无错误。
3. ✅ `pnpm --filter demo run build:web` 成功。
4. ✅ web 端浏览器实测：三个页面组件全部渲染、vant 样式生效
   （主色 #1989fa 等）、Field v-model 回显正常。
5. ✅ App 端（fjs-go / iOS 模拟器）：结构照常；按钮 label 修复后
   vant 语义 props 映射到 fjs 按钮 chrome；命令式 Toast/Dialog 的
   预期报错会显示在 `/vant-feedback` 页面上。
6. ✅ `pnpm test`（fjs 18、fjs-runtime 58、webgl、webview 全过）、
   全 workspace `typecheck`、`flutter test`（button_style 16、
   form_controls + mirror_tree 27）不回归。

## 已知边界（写页面前核对过现状）

- 渲染器把 `div/span/i/button/input/img` 映射到 fjs 标签，未知标签
  原样透传（van-circle 的 SVG 不渲染但不崩）。
- CSS 引擎不支持伪元素/属性选择器/`nth-child`/兄弟组合器，App 端本来
  也不吃这些（无样式）。
- Flutter 端每个页面是独立 Vue app：`vant` 在 `fjs.shared` 里保证全
  app 一份模块实例。

## 待澄清

无。
