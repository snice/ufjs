# Web CSS 兼容清单

> 第二层第 3 篇。这是**支持范围的单一事实来源**：加了新样式能力，先改这张表。
>
> fjs 在 Flutter 上没有浏览器排版引擎，CSS 由自己的引擎解析
> （[`css/parser.ts`](../packages/fjs-runtime/src/css/parser.ts) +
> [`css/style.ts`](../packages/fjs-runtime/src/css/style.ts)），
> 再翻译成 Flutter 的 Widget 参数
> （[`render/style.dart`](../packages/flutter_fjs/lib/src/render/style.dart)）。
> **Web 侧是真 CSS**，所以这张表的本质是"Flutter 侧能到哪"。

图例：✅ 两端一致　⚠️ 支持但有差异　❌ 不支持（引擎会 `warnOnce` 跳过，不会静默）

## 1. 选择器

| 选择器 | 支持 | 说明 |
|---|---|---|
| `.class` | ✅ | |
| `tag`（`view` / `text` / `div`…）| ✅ | scoped 块里只匹配本组件元素 |
| `*` | ✅ | |
| 后代组合器（空格）| ✅ | |
| 子代组合器 `>` | ✅ | |
| 复合选择器 `.a.b` | ✅ | 优先级按 specificity 算 |
| `:deep(...)` / `::v-deep(...)` | ✅ | 穿透子组件边界 |
| `:global(...)` | ✅ | |
| `:active` | ⚠️ | **只能写在最后一个复合选择器上**；见下方「状态伪类」 |
| `:first-child` / `:last-child` | ✅ | 任意复合选择器位置；兄弟参照跳过裸文字元素（见下） |
| `:disabled` | ✅ | 任意复合选择器位置；只对表单控件（`input` / `textarea` / `button` / `select`…）生效，随 `disabled` 属性即时切换（vant 禁用输入框的灰字）。`:enabled` 不支持 |
| `:hover` | ⚠️ | 只能写在最后一个复合选择器上；App 端仅桌面鼠标触发；后代超界不支持 |
| `:root` / `:host` | ⚠️ | 只收**自定义属性**（`--x`），作为每棵页面树继承链的起点；其他声明 `warnOnce` 跳过。组件库（vant 的 `--van-*`）的主题变量都声明在这里 |
| `#id` | ❌ | |
| 属性选择器 `[class<op>value]` | ⚠️ | 只认 **`class` 属性**：`=` / `~=` / `\|=` / `^=` / `$=` / `*=`，权重同一个类（specs/069，vant 的 `[class*=van-hairline]::after` 发丝线靠它）。`^=`/`$=`/`=` 比对的是按源顺序拼回的 class 串（空白与重复类名规整过）。其他属性（`[type=search]`）照旧 `warnOnce` 跳过 |
| `:nth-child` / `:not()` / 其他伪类 | ❌ | roadmap 之外的按需补充 |
| 相邻兄弟组合器 `+` | ✅ | 匹配**紧邻的前一个参与兄弟**（跳过裸文字，与结构伪类同规则）；`a + b + c` 链与 `>` 混用可正常回溯。层叠权重与后代/子代组合器相同（组合器本身不计分）。缓存正确性：存在 `+` 规则时前兄弟的签名进 chainKey——前者类名/scope 切换、兄弟插入删除都会即时重算后者（vant 的 `.van-button__loading + .van-button__text { margin-left: 4px }` 图标间距靠它）；没有 `+` 规则的页面零额外开销 |
| 后续兄弟组合器 `~` | ❌ | |
| 伪元素 `::before` / `::after` | ⚠️ | **装饰型**（specs/069）：只能在最后一个复合选择器上；`content` 只认 `''`/引号字符串（`none`/`normal` 不生成盒子），`attr()`/`counter()` 不支持（告警、不生成）；码点全在私有区的 iconfont 字形：盒子的字体栈命中某个 `@font-face` 声明的字体时正常渲染（specs/071），否则不渲染文字、只留装饰盒（同 web 字体缺失时的空盒）；盒内文字带上伪元素的可继承文字属性，`content` 随 class 切换同步更新。引擎按同一条层叠算样式（继承、`var()`、`em`、`inherit`），renderer 合成为真实子节点——`::before` 在最前、`::after` 在最后，布局/绘制/命中复用既有管道。不支持 `:active::before` 这类状态 + 伪元素组合。`content` 为**纯空白**（`" "`）时生成不带文字的空盒——vant 发丝线的惯用写法，真实空格子曾让 `scaleY(.5)` 的线浮起约 6px |
| `@media` | ✅ | 见下方「@media 媒体查询」小节 |
| `@font-face` | ⚠️ | specs/071。App 端：构建期把 `src` 里的 WOFF2 / WOFF（`data:` 内联或相对路径文件）统一转成 TrueType 并内联为 `data:font/ttf`，运行时经宿主方法 `fjs.font.load` 注册进 Flutter 字体表，加载完成后文字自动重排（首帧可能先空）。**不支持**：远程 `http(s)` / `//host` 源（跳过；没有其他可用源时 warnOnce 指名 family）、`local()`、`unicode-range`（告警后整字体生效）、可变字体轴、`font-display`、`document.fonts`。字体按内联计入 JS 包（TTF 约为 WOFF2 的 2–3 倍，>1 MB 构建期告警；大字体走资源文件是后续项）。Web 端浏览器原生 |
| `@supports` / `@import` / 其他 at-rule | ❌ | 整块 `warnOnce` 跳过 |

**层叠规则**：优先级 = specificity + 源顺序，scoped 规则额外 +10
（对齐浏览器里 `[data-v]` 属性选择器的权重）。最终合并顺序：
`标签默认样式 < CSS 规则 < 内联 :style`。

**继承**：`color` / `fontSize` / `fontWeight` / `fontStyle` / `fontFamily` /
`lineHeight` / `letterSpacing` / `textAlign` / `textTransform` / `whiteSpace`
以及 CSS 自定义属性（`--x`）沿元素树向下继承，子元素自身声明优先。

**`inherit` 关键字**（specs/069）：任何属性写 `inherit` 都取父元素的计算值
（伪元素的「父」是它的宿主元素——vant 分割线 `::before { border-style: inherit }`
靠它拿到 `--dashed`）；父元素没有这个属性时整条声明作废，回到初始值，同 CSS。
`initial` / `unset` / `revert` 未实现。

## 2. 属性

CSS 文本里用 kebab-case（`font-size: 16px`），内联对象用 camelCase
（`fontSize: 16`）。数字不带单位 = 逻辑像素。

### 盒模型

| 属性 | 支持 | 说明 |
|---|---|---|
| `width` / `height` | ✅ | |
| `min-width` / `min-height` / `max-width` / `max-height` | ✅ | |
| `margin` / `padding`（含单边）| ✅ | `16` \| `'8 16'` \| `'T H B'` \| `'T R B L'` \| `'8px'`；单边覆盖简写。无单位长度在 web 由构建期补 px（`css-compat.ts`，dev 与 build 共用）——不补的话浏览器把整条声明当非法丢弃，两端高度分叉（spec 041 对拍修出）；`line-height` 例外，数字两端都是倍数 |
| `background-color` | ✅ | |
| `color` | ✅ | 继承 |
| `opacity` | ✅ | |
| `overflow: hidden` | ✅ | 容器上是裁剪 |
| `overflow: ellipsis` | ⚠️ | fjs 扩展，text 节点上是截断省略 |
| `pointer-events: none` | ⚠️ | 节点照画但不接命中，点击落到下面的节点（specs/069：vant 步进器 +/- 的伪元素线条盖在按钮上）。子树里用 `pointer-events: auto` 重新打开**不支持** |
| **百分比尺寸**（spec 036）| ✅ | `%`/`calc()` 参照父盒内容宽高；参照无界（列表、scroll-view 纵向）退化为 auto，与 web 同规则；详见下方「单位」 |
| **百分比间距与偏移**（spec 044）| ✅ | `padding` / `margin`（简写与长手）四边参照**父盒宽**（上下边也是，CSS 语义）；`top`/`bottom` 参照父盒高、`left`/`right` 参照父盒宽；row flex 子项由父把容器宽上界传下去（同 `width: 50%` 的机制）。**不生效的少数消费点**：`input` 的 `contentPadding`、text 节点路径上的 margin/padding——布局前就要数的场景只认绝对值（与 `<swiper>` 高度同款登记） |
| `box-sizing` | ⚠️ | 恒为 `border-box`（web 侧基础样式表钉死），不可改 |

### 边框与圆角

| 属性 | 支持 | 说明 |
|---|---|---|
| `border`（简写）| ✅ | `1px dashed #ccc` |
| `border-width` / `border-color` / `border-style` | ✅ | 覆盖简写的对应分量；1~4 值按边展开（`border-width: 1px 0 0` 只画上边，vant 分割线；specs/069）。简写不写颜色时取 `currentColor`（元素的文字色），同 CSS |
| `border-style` 值 | ⚠️ | `solid` / `dashed` / `dotted` 真画；`double` / `groove` 等按 solid |
| `border-radius` | ✅ | `12` \| `'8px'` \| `'8px 16px'` \| `'1px 2px 3px 4px'` |
| `border-radius: %` | ⚠️ | 横向依宽、纵向依高解成椭圆角（specs/069：van-radio 圆点、van-switch 圆钮）。**只在盒子宽高是确定 px 时生效**；内容自适应的盒子写百分比圆角保持方角（布局期才有尺寸，没为这个角落把整个装饰盒推迟到布局期）。`a / b` 椭圆写法不支持（整条丢弃并告警） |
| 单边边框（`border-top` 等，spec 041）| ✅ | 简写与 `-width`/`-color`/`-style` 长手都可；每边级联：单边长手 > 单边简写 > 全局长手 > 全局简写（合并 map 定优先级，**不还原源顺序**——`border-bottom: none` 之后再写 `border: 1px red`，web 上 bottom 会被简写重置回来，App 上仍无）；仅声明 `-color`/`-style` 按 CSS 语义推出 1px。**非一致边 + `border-radius`** 由自绘 painter 按边描画（角弧归相邻边各半），角部衔接与浏览器有亚像素差；`button` 的默认 hairline 只补页面没声明的边 |

`border-color` 单独出现时按 CSS 语义算 1px 边框；`none` 和 0 宽度就是没边框
（`button` 自带的那道 hairline 也是这么关的）。

### Flex 布局

| 属性 | 支持 | 说明 |
|---|---|---|
| `flex-direction` | ✅ | `row` / `column`（默认 column，**和 CSS 的 row 不同**）|
| `flex-wrap` | ⚠️ | 映射 `Wrap`，此时 `flex-grow` 失效。**例外**（specs/070）：横向 wrap 里有 `flex-grow` 子项、且没有子项声明 `width: 100%` 时按单行 Flex 排（CSS 按基准尺寸 0 断行，vant Field 的 label + `flex: 1` 值区留在同一行）；真的一行放不下时不会换行（需要测量式布局） |
| `justify-content` | ✅ | start / end / center / space-between / space-around / space-evenly |
| `align-items` | ⚠️ | CSS 初始值是 `stretch`、Flutter 是 `center`。`display: flex` 且**没写** `flex-direction` 时引擎补齐 CSS 默认（`row` + `stretch`，vant Cell 的值/箭头因此不再掉行）；显式写了 `flex-direction` 后 `align-items` 仍不补——在乎就显式写 |
| `align-items: stretch`（收缩盒里） | ✅ | 不被父级拉伸的 flex 子项（父级 `align-items: center` 等）按 CSS 先收缩到最宽子项、再把子项拉伸到这个宽度——以前会撑满父级整行，vant Tabbar 文字因此左对齐（specs/070） |
| `margin: auto`（flex 子项） | ✅ | 主轴 auto margin 吸收剩余空间（`margin: 0 auto` 居中、`margin-left: auto` 推到行尾；有 `flex-grow` 兄弟时不生效，同 CSS）；交叉轴两侧 auto 在拉伸行里居中（块级 `width + margin: 0 auto`）。vant NavBar 标题居中（specs/070）。flex-wrap 容器内暂不支持 |
| `flex-grow` / `flex` | ⚠️ | Flutter 上是 `Expanded`（只拿剩余空间）；web 侧被改写成 `flex: n 1 0%` 对齐。**会增长的项带主轴 `max-width/max-height`**（`flex: 1; max-width: 10%`）：CSS 把它冻结在上限、余量分给其他增长项；Flutter 的 Flex 不重分配，所以直接按上限定尺寸、退出 flex 分配（行够宽时就是 CSS 的结果，vant 左对齐分割线；specs/069） |
| `flex-basis` | ⚠️ | 不增长、主轴没写尺寸的项：`flex-basis`（px 或容器主轴 %）即主轴尺寸，wrap 与普通 flex 都生效（vant 宫格 `flex-basis: 33.33%`；specs/069）。增长项按 basis 0 处理（与 `flex: 1` 简写一致）；`flex-shrink` 的收缩不参与 |
| `flex-shrink` | ⚠️ | 内置标签一律 `flex-shrink: 0`（对齐 Flutter 子节点不压缩）。其他标签（`input` 等，web 上是 CSS 初始值 1）在横向行里、主轴为百分比宽度时可收缩到剩余空间（vant Field 的 `input { width: 100% }` 让出清除图标的宽度，specs/070）；多个收缩项平分而非按基准比例 |
| `gap` / `row-gap` / `column-gap` | ✅ | |
| `align-self` | ✅ | `auto` / `flex-start` / `center` / `flex-end` / `stretch`（`start` / `end` / `self-start` / `self-end` 同义）。App 端：容器里有子项写了它，整个容器按 stretch 布局，其余子项各按 `align-items` 在自己那一行里对齐；容器原本不拉伸（或交叉轴无上限，如纵向滚动里的 row）时先按内容量出交叉轴尺寸再定死（两遍布局），容器自身尺寸与不写时一致。没写的容器零开销。wrap 容器里不生效 |
| `justify-self` | — | flex 布局里本来就无效（web 同样忽略，只对 grid 生效），两端一致；grid 不支持 |
| `display: none` | ✅ | |
| `display: inline-block` / `inline` / `inline-flex` | ⚠️ | 没有行内格式化上下文（行盒、基线对齐、文字绕排都不做）。`inline-block`/`inline` 映射成**横排可换行的收缩盒**：子元素横排（`flex-direction: row; flex-wrap: wrap`，不覆盖显式声明的方向），自身在交叉轴上不被 stretch 拉伸（specs/069：vant 步进器 −/输入/+ 横排）。**行为变化**：以前这两个值无效、表现为块级竖排，老页面会看到它们变横排——这是对齐 web |
| HTML 块级盒里的行内文字 | ⚠️ | 渲染函数/模板里的 HTML 块级标签（`div`、`p`…）**只含行内文字**（`span` 与裸文字，未设 display）时合成一段文字排版，同浏览器（vant 字数统计 `<div><span>0</span>/50</div>` 一行）。混有其他盒子（view、图片、块级/定位的文字）时仍按纵向 flex 排；fjs 自己的 `view` 不受影响，照旧竖排子节点 |
| `display: grid` | ❌ | |

### 定位

| 属性 | 支持 | 说明 |
|---|---|---|
| `position: relative` | ✅ | 成为定位上下文；配 top/left 只挪画面不动布局 |
| `position: absolute` | ✅ | 脱流，按最近定位祖先摆；偏移从定位祖先的 **padding 边**量起（CSS 包含块，specs/069 修正——以前从内容边量，vant `.van-cell::after` 发丝线缩进一个 padding）。`margin: auto` + 对边 + 尺寸在该轴居中（vant 对话框 `left: 0; right: 0; width: 320px; margin: 0 auto`）。绝对定位盒自身的 margin 折进 inset 偏移（`top: 0; margin-top: 4px` ⇒ 盒顶 4，声明尺寸不被缩小——vant badge 圆点，specs/073）；**百分比 margin 在 abs 盒上暂不生效**（margin 按盒宽参照、top/bottom inset 按盒高，参照系不同折不进去，needs a spec）。**溢出部分可点**：带点击/触摸处理的绝对定位盒超出祖先边界的部分照样接收按下（同 web 的 `overflow: visible`；vant Slider 24px 圆钮挂在 2px 轨道上，以前只有轨道那 2px 能按中，其余落到 scroll-view）。纯装饰的定位盒不参与 |
| `position: sticky` | ✅ | web / 小程序 webview 原生 CSS；Flutter 端按「滚动容器直接子节点（或 sticky-section 内）」语义走 sliver 吸顶，`top` 即 pin 线（specs/052/053）。深层嵌套 Flutter 端不吸顶并告警（web 会吸顶于最近滚动祖先）；小程序 skyline 的 wxss sticky 未承诺，请用组件 |
| `position: fixed` | ⚠️ | 元素被运行时整体挪进页面的**置顶 overlay 宿主**（保留标签 `fjs-overlay-host`，Dart 侧经 `OverlayPortal` 渲染在根 Overlay 上），全屏、不随页面滚动、盖在宿主 chrome 之上（specs/069）。偏移与 `%` 尺寸参照整屏。**不是通用的视口定位**：上下层级只看插入顺序（`z-index` 仍不支持）；从原父元素继承的样式断开（同 web 上 teleport 到 `<body>`）；弹层动画时序由 Flutter 侧驱动，可能与 web 有出入；**不经宿主 safe-area 包裹**，`top: 0` 会顶进状态栏区域，宿主要自行留出安全区。旧宿主不认识保留标签时退化为页面内的全屏盒（会随滚动带走）。**诊断**：hoist 由样式引擎回调触发（解析结果 `position === 'fixed'`）；`createStaticVNode`（静态提升 vnode）在本 renderer 没有 DOM innerHTML 语义，app 构建以 `hoistStatic: false` 规避（specs/070），手写静态 vnode 会得到指名报错 |
| `top` / `right` / `bottom` / `left` | ✅ | |
| `z-index` | ⚠️ | 只在**同一包含块的绝对定位兄弟之间**生效：按 z-index 排序（相等保持树序，`auto` 记 0），负值画在文档流内容之下（specs/073，vant 步骤条圆点的白底盖住连接线靠它）。不建模层叠上下文——跨包含块、文档流元素之间仍是顺序即层级。例外：`sticky-header` 组件自带的 `z-index: 1`（web 端）是组件默认外观的一部分，不开放给页面 CSS |

### 文字

| 属性 | 支持 | 说明 |
|---|---|---|
| `font-size` | ✅ | 继承 |
| `font-weight` | ✅ | 100–900 \| normal \| bold |
| `font-style` | ✅ | |
| `font-family` | ✅ | 按 CSS 读字体栈（specs/071）：去引号、逗号分隔，首项为主字体、其余为 Flutter `fontFamilyFallback`；栈在第一个系统/通用族名处截止（`-apple-system`、`system-ui`、`sans-serif`、`serif` 等 = 平台默认字体，所以 vant 的 `-apple-system-font, helvetica neue, …` 仍是系统字体，同 Safari）。`monospace` 映射成平台等宽字体（iOS / macOS `Menlo`、Windows `Courier New`、其余 `monospace`）。**行为变化**：以前整串（含引号）当一个字体名，带引号的名字从未生效 |
| `font`（简写） | ✅ | specs/071：`[style] [variant] [weight] [stretch] size[/line-height] family` 在解析期展开为 `font-style` / `font-weight` / `font-size` / `line-height` / `font-family`（省略项重置为 `normal`），同一条规则里后写的单项照常覆盖；值含 `var()` 时替换后再拆；`inherit` / `unset` / `initial` 按 CSS 处理。系统字体关键字（`caption`、`menu` 等）告警跳过。**行为变化**：以前 App 端整条 `font:` 被忽略。内联 `:style` 对象里的 `font` 不展开 |
| `line-height` | ⚠️ | 数字 = 倍数，`24px` = 绝对值。**默认 1.4**（两端钉死同一个值，CSS 的 `normal` 和 Flutter 字体度量对不上）|
| `letter-spacing` | ✅ | |
| `text-align` | ✅ | |
| `text-decoration` | ✅ | underline / line-through / overline |
| `text-transform` | ✅ | uppercase / lowercase / capitalize |
| `white-space: nowrap` | ✅ | 单行 |
| `text-shadow` | ✅ | |
| `max-lines` | ⚠️ | fjs 扩展，配 `overflow: ellipsis` |
| `word-break` / `text-overflow` | ❌ | 用 `max-lines` + `overflow: ellipsis` |
| `vertical-align` | ⚠️ | 只认 `sub` / `super`，且只在**嵌套在 text 里的 text 片段**上生效。Flutter 上把片段平移（上移父字号的 1/3、下移 1/5，和 Chrome 一致），行盒不跟着撑高 |

未声明颜色的 `text` 取基础样式表 `body` 的 `14px / #333333`。

**嵌套 text 片段**（spec 034）：`text` 里的 `text` 是同一段落里的行内片段。片段上认
颜色 / 字号 / 字重 / 字体 / 斜体 / 行高 / 字间距 / `text-decoration` / `text-shadow` /
`background-color`（画在字形后面）/ `vertical-align`；**不认** margin / padding / border /
width / height——Flutter 的 `TextSpan` 没有盒子，web 侧用 `!important` 归零保持一致。
`text-align` / `max-lines` / `white-space` / `overflow` 只看最外层那个 `text`。

### 视觉效果

| 属性 | 支持 | 说明 |
|---|---|---|
| `box-shadow` | ✅ | 字符串或数组 |
| `background` / `background-image` | ⚠️ | 仅 `linear-gradient` / `radial-gradient`；不支持位图 url（用 `<image>` 标签）|
| `transform` | ✅ | translate / translateX / translateY / translate3d / scale / scaleX / scaleY / rotate(deg\|rad\|turn\|grad) / matrix(a,b,c,d,e,f)，从左到右复合 |
| `transition` | ⚠️ | `transform` / `opacity` / `background-color`（实色，无背景 ↔ 有背景按透明渐入渐出）/ `border-color`（实线统一边框）/ `width` / `height` 两端渐变（spec 045；简写与长手、duration/curve/delay 同一套解析），以及绝对/固定定位盒的 `left` / `top` / `right` / `bottom`（spec 073——vant Progress 的 portion `width` 与 pivot `left` 都靠它；`FjsLength` 是 px+百分比线性对，两端插值等价于 calc() 插值，被 delegate 解析的百分比因此逐帧跟随盒子）。尺寸与 inset 是布局属性：逐帧重排，与 web 成本一致，别在大子树上用。**App 端差异**：`transition-delay` 对 background-color / border-color / 尺寸 / inset 不生效（transform/opacity 有）；gradient 背景跳变不动画；inset 的 transitionend 不派发（width/height 照旧，由尺寸动画派发）；文字 `color` / 虚线或分边不同的边框 / 其余布局属性 App 端瞬时跳变，web 原生渐变。页面转场用 `<Transition>`，见 [routing.md](routing.md) |
| `<Transition>`（组件） | ⚠️ | vue-shim 里的 fjs 版（BaseTransition + 引擎类操作）：enter/leave 的 `-from/-active/-to` 类照常落地，组件库里 animation 型的 enter/leave 规则（vant 的 `van-fade-enter-active { animation: … }`）由 keyframes 引擎原生播放；transition 型的类切换（vant 弹层滑入滑出、Dialog 缩放）由 App 端按上表 `transition` 的支持范围补间。类移除时机取元素计算样式里 animation 与 transition 的「时长 + 延迟」较长者（本端没有 DOM end 事件）；`transition-*` 长写覆盖在简写之上。`v-show` 在 `<Transition>` 内走钩子（离场动画放完才 `display: none`）。**App 端差异**：`<TransitionGroup>` 是纯透传（vant 弹层不用） |
| `animation` / `@keyframes` | ⚠️ | 引擎解析、原生执行，无逐帧桥往返；支持范围与差异见下方「动画」小节 |
| `filter` / `backdrop-filter` | ❌ | |

**拖动一定用 `transform: translate(...)`**，不要用 `left/top` 或 `margin`：
前者只重绘不重排，命中测试跟着一起动。

### 动画（`animation` / `@keyframes`）

引擎只负责**解析**（[`css/animation.ts`](../packages/fjs-runtime/src/css/animation.ts)）：
`animation` 简写在解析期展开成 8 个长手（同 `font`，`var()` 的简写替换后再拆），
`@keyframes` 块在注册时收集（`@-webkit-` 前缀容忍；`from`/`to`/百分比帧、
同偏移帧按属性合并后者赢）。命中的元素随计算样式拿到
`animationKeyframes: {name: [{offset, style}]}` + 各长手，**帧在原生侧逐帧跑**
（[`render/animation.dart`](../packages/flutter_fjs/lib/src/render/animation.dart)，
每个动画节点一个 ticker，没有逐帧桥往返）；web 端浏览器原生，零参与。
vant 的 loading 转圈（`van-rotate` 盒子旋转 + `van-circular` 描边流动）两端一致。

| | 支持 | 说明 |
|---|---|---|
| 长手 | ✅ | `animation-name/-duration/-timing-function/-delay/-iteration-count/-direction/-fill-mode/-play-state`（`paused` 生效）；同一条规则里后写的单项照常覆盖 |
| 缓动 | ✅ | `linear` / `ease` / `ease-in` / `ease-out` / `ease-in-out` / `steps(n[, start])` / `cubic-bezier(...)`；帧上可写 `animation-timing-function` 覆盖本段（CSS 逐段缓动） |
| 语义 | ✅ | CSS Animations 1：delay、fill-mode（含 backwards/forwards/both）、direction（含 alternate 系）、迭代次数（含 `infinite` 与小数次数）、名字列表变化才重启动画 |
| 多重动画 | ✅ | 逗号分隔，逐属性后者赢 |
| 帧里的 `var()` | ✅ | 按每个元素自己的自定义属性解析（vant 的 `--van-loading-spinner-duration`） |
| 动画的属性（App 端） | ⚠️ | **任意节点**上只有 `transform` / `opacity` 真动（包在 transition 层外，运行期以动画为准）；**svg 形状**上还有描边/填充族（`stroke-dasharray` / `stroke-dashoffset` / `stroke-width` / 颜色等，见下节）。其余属性（`background-color`、尺寸…）的帧会下发但 App 端不动，web 原生全动 |
| 伪元素上的 `animation` | ❌ | 伪元素样式不附带 keyframes，App 端不动（web 会动）；按需再补 |
| `@keyframes` 之外 | ❌ | Web Animations API、`getAnimations()`、SVG SMIL 不涉及 |

### SVG（内联 `<svg>` 上的 CSS）

`<svg>` / `<circle>` / `<path>` / `<g>` / `<rect>` / `<ellipse>` / `<line>` /
`<polyline>` / `<polygon>` 在 App 端是宿主元素：Vue 建出普通节点子树，属性进
props、CSS 走同一条引擎，整棵子树由一个画笔画出
（[`widgets/svg.dart`](../packages/flutter_fjs/lib/src/widgets/svg.dart)）——
形状子节点不建 widget。web 端浏览器原生渲染完整 SVG。vant 的
`<svg viewBox="25 25 50 50"><circle …/></svg>` loading 图形靠它上屏。

- **层叠**：呈现属性（`fill="none"`）< CSS 规则（`.van-loading__circular circle
  { stroke: currentColor }`）< 运行中的动画。选择器照常用（类型选择器
  `circle`、类、后代、`+` 都行）。
- **CSS 属性**：`fill` / `stroke` / `fill-opacity` / `stroke-opacity` /
  `stroke-width` / `stroke-linecap` / `stroke-linejoin` /
  `stroke-miterlimit` / `stroke-dasharray` / `stroke-dashoffset` /
  `fill-rule` / `opacity` / `display` / `visibility` / `transform`，沿树按
  SVG 语义继承；支持 `d` 全命令（含圆弧）、`viewBox` +
  `preserveAspectRatio`、`transform` 属性与 CSS transform。
- **`currentColor`**：`fill` / `stroke` 按节点自己的文字色解析——按钮里的
  spinner 图标跟着 `color` 走就是这条。
- **尺寸**：CSS 宽高 > `width`/`height` 属性 > viewBox 比例 > 浏览器默认
  300×150。
- **不支持**（跳过 + `warnOnce` 一次）：`<text>` / `<use>` / 渐变与 pattern
  （`url(#…)` 画不出、留告警）/ clip / mask / filter / `<symbol>`。

### 颜色取值

✅ `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` / `rgb()` / `rgba()` /
`hsl()` / `hsla()` / 命名色 / `transparent`

**`currentColor`**（vant 两端兼容收尾）：`color` 属性上的 `currentColor`
由引擎消解成继承值（CSS 语义就是"取自身颜色"，原样下发会让 App 端解析成黑——
vant spinner 的 `color: currentColor` 之前画黑线就是这个）；伪元素样式里的
`currentColor` 全属性替换成宿主计算色；`fill` / `stroke` 保留关键字、由 svg
画笔按节点文字色解析；`border` 简写省略颜色时的取值见边框小节。其余属性
（`background-color` 等）上的关键字 App 端读不出、按缺失处理，web 原生认识。

同一个解析器也服务 `<canvas>` 的 `fillStyle` / `strokeStyle`
（[canvas-compat.md](canvas-compat.md)）——那边解析失败会画成黑色，所以
加解析能力时两处一起看。

### CSS 变量

| | 支持 | 说明 |
|---|---|---|
| `--x` 自定义属性 | ✅ | 沿树继承 |
| `var(--x)` | ✅ | |
| `var(--x, fallback)` | ✅ | |
| 链式引用 | ✅ | |
| 循环引用 | ✅ | 安全降级，不死循环 |
| Vue `v-bind(expr)` | ✅ | 机制同 web 版 Vue：改写成 `var(--<id>-<expr>)` + `useCssVars` |

### 单位

✅ `px`、无单位（= 逻辑像素）
✅ `transform` 的 `translate(x%, y%)`：按**元素自身**宽高（specs/069：对话框的
`translate3d(0, -50%, 0)`）。`%` 平移放在变换列表最前面时精确；排在 rotate/scale
之后的 `%` 平移按未旋转处理（登记的近似）
✅ `%`、`calc()` —— **尺寸**（`width` / `height` / `min-*` / `max-*`）、
**盒模型间距**（`padding` / `margin` 简写与长手，spec 044）与
**定位偏移**（`top` / `right` / `bottom` / `left`，spec 044）上生效。
❌ `em`、`rem`（构建时就换算成 px 了）、`vw`、`vh`；
❌ 其余属性上的 `%`：`gap` / `border-radius` / `font-size` 等按 CSS
也是百分比，这里读不出来，等同没写（按需补，参照机制各不相同）。

百分比的参照是**父盒子在这个轴上给出的空间**——和 CSS 一样是父元素的内容盒。
参照轴（spec 044）：尺寸与 padding/margin 的**四边都参照父盒宽**
（`padding-top: 10%` 是宽的 10%，CSS 就是这样）；`top`/`bottom` 参照父盒**高**、
`left`/`right` 参照父盒**宽**。
一条 CSS 规则同样适用：**参照无界时百分比退化成 auto / 0**。列表里、
`scroll-view` 里纵向是无界的，所以 `height: 50%` 在那里不生效（web 上同理），
要撑高就给 `flex-grow` 或写死 px。

高度确定的普通列里 `height: 100%` 是**生效**的，尽管 Flutter 的 `Flex` 按设计
给子节点无界主轴：声明了主轴百分比（或 % 间距 / 偏移，spec 044）的那个子节点，
由父 flex 把自己的内容盒作为上界传下去（[`render/flex.dart`](../packages/flutter_fjs/lib/src/render/flex.dart)
的 `_flexChild`），没写百分比的子节点照旧拿无界约束。绝对定位的子节点同理——
`RenderStack` 只在给了对边或显式尺寸时才给有界约束，所以 `position: absolute` +
`width/height: 100%`（或 `top: 50%` 这类偏移）在 `positionedChild` 里解析：参照是
定位祖先**布局完成后的 padding 盒**（`Positioned.fill` + 布局委托在布局期取尺寸，
specs/069）。以前用的是它收到的约束上界，收缩包裹的盒子上这个数不是它的真实尺寸
——vant 宫格的 `inset: -50%` 发丝线只有格子高度的三分之一。

`calc()` 支持 `+ - * /` 和括号，混算 px 与 %（`calc(100% - 32px)`）；
`*` / `/` 的另一侧必须是纯数字，这是 CSS 自己的规矩。
表达式在解析时就归约成「一个 px 项 + 一个 % 项」，每帧只剩一次乘加。

内部实现见
[`render/length.dart`](../packages/flutter_fjs/lib/src/render/length.dart)。
注意这几个组件的尺寸仍然只认绝对值：`<image>` 的 `widthFix` / `heightFix`、
`<swiper>` 的高度、`<picker-view>` 的高度——它们在布局前就要一个数。

## 3. fjs 独有的样式键

这两个键浏览器不认识，构建时由
[`web/css-compat.ts`](../packages/fjs-runtime/src/web/css-compat.ts) 改写成
等价 CSS（纯字符串处理，esbuild 和 Vite 插件走同一份）：

| fjs 键 | Flutter 语义 | 改写成的 CSS |
|---|---|---|
| `flex-grow: n` | `Expanded(flex: n)` | `flex: n 1 0%` |
| `direction: horizontal` | scrollable 的轴 | `overflow-x: auto; overflow-y: hidden` |
| `direction: vertical` | 同上 | `overflow-x: hidden; overflow-y: auto` |

真正的 `direction: ltr | rtl` 原样放行。

另外 `touch-action`（`auto` / `none` / `pan-x` / `pan-y` / `manipulation`）
两端同名同义：web 上是原生 CSS，Flutter 上让节点进手势竞技场，
手指移动约 8px（鼠标 1px）就抢下指针，早于滚动容器的 18px 阈值。

`cursor` 同样两端同名（web 原生，App 端不改变视觉），并承载一条**可点性
约定**：按钮上写 `cursor: default` / `none` / `not-allowed` ——组件库标记
不可点的方式，vant 的 loading 按钮（`--loading { cursor: default }`）、
禁用按钮（`not-allowed`）和 fjs 自己的 `.fjs-button--loading` 都是这样——
App 端按压**不画** 10% 黑色遮罩，与 web 上遮罩伪元素被藏掉的表现一致
（`widgets/button.dart` 的 `fjsButtonCursorAllowsPress`）。没写 `cursor`
（App 端常态，web 基础样式表不进 App）保持遮罩。

## 4. 状态伪类（`:active` / `:hover`）与结构伪类

### 按压态 `:active`

| | Flutter | Web |
|---|---|---|
| 实现 | CSS 引擎额外算一份按压样式，随 `activeStyle` 下发；节点自己就地切换，**不回 JS** | 浏览器原生 `:active` |
| 触发 | pointer down 当帧（不走手势竞技场：`onTapDown` 要等赢下竞技场，列表里是 100ms 之后）| 原生 |
| 取消 | 抬手，或指针移动超过拖拽阈值 | 原生 |
| 继承 | ⚠️ **不向子节点传递** | 会传递 |
| 位置 | ⚠️ 只能写在最后一个复合选择器上 | 任意 |

所以按压反馈优先用**自身属性**：`background-color` / `opacity` / 边框。
`.row:active .title { ... }` 会被跳过并告警。

### 悬停态 `:hover`

| | Flutter | Web |
|---|---|---|
| 实现 | CSS 引擎多算一份悬停样式，随 **op 12**（`SET_HOVER_STYLE`，协议版本 6）下发；`MouseRegion` 就地切换，不回 JS | 浏览器原生 `:hover` |
| 触发 | 桌面鼠标进入节点**或其子树**（与浏览器语义一致）；移动端触摸永不触发，同移动浏览器 | 原生 |
| 取消 | 鼠标离开 | 原生 |
| 继承 | ⚠️ 不向子节点传递（同 `:active`） | 会传递 |
| 位置 | ⚠️ 只能写在最后一个复合选择器上 | 任意 |

**与 `:active` 同时命中**：按压覆盖悬停（两端约定以 active 优先；web 靠源
顺序天然成立，页面把 `:active` 规则写在 `:hover` 之后即可对齐）。触屏按压
在两端都不会带出悬停样式。

### 结构伪类 `:first-child` / `:last-child`

- CSS 引擎按元素树判定兄弟位置，随**普通样式**下发，无独立通道；兄弟增删
  （v-for push/pop、v-if 切换）后受影响兄弟即时重算。
- **兄弟参照物**：裸文字（`createText` 产生的 text 元素）被跳过——它在 web
  上是文本节点、不算元素；页面显式写的 `<text>` 两端都是元素，照常参与。
  v-if 注释锚点两端都不算。
- 无父节点的页面根视为 first+last（web 上页面根是 `#app` 的首子节点）。

## 5. @media 媒体查询（spec 043）

| | Flutter | Web |
|---|---|---|
| 求值 | JS 侧 CSS 引擎：规则带 media 条件存储，按窗口逻辑尺寸匹配；尺寸变化全量重算，走既有 setProps（op 协议零改动） | 浏览器原生 `@media`，fjs 生产代码零改动 |
| 参照物 | Flutter 窗口逻辑像素（`MediaQuery.size`），与浏览器视口 CSS 像素同基准 | 浏览器视口 |
| 尺寸来源 | Dart 推送（事件 33，`{"width":n,"height":n}` 一位小数）+ renderer 加载时经 `fjs.viewport.get` 拉初始；`fjsrun` / 老宿主没有通道，按回退值 **390×844** 求值 | 浏览器自己知道 |

**支持的语法**（两端公共子集）：media type `screen` / `all`（省略 = 任意，
`only` 前缀容忍）；特性 `min-width` / `max-width` / `width` /
`min-height` / `max-height` / `height`（px 或无单位）与
`orientation: portrait|landscape`（正方形按 portrait，同 CSS）；组合
`and` 与逗号（或）。嵌套在 media 里的规则照常参与级联（specificity +
源顺序），scoped 照常。

**不支持 → 整块丢弃 + `warnOnce` 一次**（宪法 V）：`not`、`print` 等其他
type、未知特性（如 `prefers-reduced-motion`）、非 px 长度值、嵌套 at-rule。
页面只写上表语法时两端逐断点一致。

已知差异：

- **web 是浏览器原生，特性集是超集**。页面写了 App 不支持的特性时 web
  生效、App 整块不生效（有告警）——只在用超集特性时出现。
- **`(min-width: 600)` 无单位条件值**：App 端读成 600px；浏览器视其为非法
  条件整块丢弃——web 构建期（`rewriteFjsCss`）会补上 px，所以实际两端
  一致；dev（vite transform）与 build 共用这一份。
- **`fjsrun` / 未挂 `FjsView` 的宿主**没有尺寸通道，永远按 390×844 求值；
  media 规则在该环境下以回退值为准。

## 6. 其他已知的两端差异

不属于属性支持范围，但会让两端表现不同，都在
[web.md](web.md#已知差异) 有完整说明：

- **根节点占满屏幕**：web 侧 `#app > *` 拿 `flex-grow: 1`，对齐 Flutter 路由给
  页面根 widget 的整屏紧约束
- **滚动条不占布局**：`scroll-view` / `list-view` 只沿自身方向滚动并隐藏滚动条
- **页面缓存**：web 默认 `<KeepAlive>`，只缓存还在栈上的页
- **`v-show`**：两端都只写内联 `display`（隐藏写 `none`，显示时清掉、回落到样式表的
  `display`），与 runtime-dom 一致。App 端以前整张替换计算样式为 `{display}`，组件
  重渲染后元素丢光全部规则（specs/069：vant 步进器改值后输入框与加号失去样式）
- **下拉刷新**：web 只做了触摸端简化版，桌面浏览器拉不出来
- **swiper 翻页**：不用 CSS scroll-snap，组件自己驱动，一次手势翻一页
- **触摸事件**：web 由 pointer 事件合成（鼠标也能跑），一次 move 一根手指；
  Flutter 会把一帧内多指移动合成一条
- **`<label>` / `<form>` 不再是 HTML 兼容标签**：它们现在是 fjs 自己的标签
  （label 转发点击、form 收集子控件），不再分别映射成 `text` 和 `view`。
  `<label>` 原来自带的 `font-size: 14 / color: #666666 / margin: 4` 保留成了新
  标签的默认样式，所以只写文字的老页面外观不变；但它现在是容器，`<label>` 里
  混排元素的行为和以前的 text 节点不同
- **`<button>` 的默认描边不再由 JS 下发**：改成宿主的默认值
  （`widgets/button.dart` 的 `fjsButtonDefaultBorder` / web 的
  `.fjs-button--default`），这样 `type="primary"` 这类填充按钮才可能没有描边。
  页面写的 `border` / `border-color` / `border: none` 优先级不变。副作用：**新
  runtime 配旧 flutter_fjs 宿主**时 default 按钮会没有描边

## 7. 加一条新的 CSS 支持要改哪些地方

按顺序，每一步都不能省（宪法 I + VII）：

1. **解析**：`fjs-runtime/src/css/parser.ts`（选择器）或
   `css/style.ts`（属性归一化 / 继承规则）；有简写要展开时
   （`font` / `animation`）在 `css/font-shorthand.ts` / `css/animation.ts`
2. **Flutter 渲染**：`flutter_fjs/lib/src/render/style.dart`
   （+ 需要时 `style_parse.dart` / `decoration.dart` / `flex.dart`；
   动画在 `render/animation.dart`，svg 画笔在 `widgets/svg.dart`）
3. **Web 侧**：多数属性是真 CSS 不用改；需要改写的加到
   `fjs-runtime/src/web/css-compat.ts`，需要基础样式配合的改
   `web/base-css.ts`
4. **内联样式归一化**：`web/style.ts`（数字补 `px` 的白名单）
5. **文档**：改**本文件的表格**，必要时补 `docs/ui-api.md` 的样式清单
6. **roadmap**：`docs/roadmap.md` 对应条目打勾
7. **验证**：在 `demo` 或 `examples/hello-fjs` 加一页，
   `fjs dev --web` 和 `fjs run android` 两边对拍

不支持的属性**必须 `warnOnce` 跳过**，不能静默丢弃（宪法 V）。
