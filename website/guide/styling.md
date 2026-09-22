# 样式

在浏览器里，样式是真 CSS。在 Flutter 上没有浏览器排版引擎，ufjs 自带一个 **CSS 引擎**：解析你写的 CSS，算出每个节点的样式，再翻译成 Flutter Widget 的参数。它支持的是一个以 **flex 布局**为核心的子集。

记住这一篇的几条差异，就能写出各端一致的样式。

## 写法

三种方式都支持，优先级从低到高：标签默认样式 < CSS 规则 < 内联 `:style`。

```vue
<template>
  <view class="card" :style="{ padding: 16, backgroundColor: color }">
    <text class="title">标题</text>
  </view>
</template>

<style scoped>
.card { border-radius: 8px; }
.card .title { font-size: 18px; font-weight: 600; }
</style>
```

- CSS 文本里用 kebab-case（`font-size: 16px`），内联对象用 camelCase（`fontSize: 16`）
- **数字不带单位就是逻辑像素**
- `<style>` 和 `<style scoped>` 都支持，scoped 规则优先级额外 +10（对齐浏览器里 `[data-v]` 的权重）
- `lang="scss"` 等预处理器**不支持**，会被跳过并告警

## 与浏览器不同的地方

### 1. `view` 默认纵向

```css
/* 所有 view 相当于 */
display: flex;
flex-direction: column;
```

要横排显式写 `flex-direction: row`。

### 2. 交叉轴默认值

`display: flex` 且**没写** `flex-direction` 时，引擎会补齐 CSS 默认（`row` + `stretch`），行为和浏览器一致。显式写了 `flex-direction` 之后 `align-items` 不再补默认 —— Flutter 是 `center`、CSS 是 `stretch`，**在乎的地方显式写**。

### 3. `flex-grow` 就是「分剩余空间」

Flutter 上 `flex-grow: 1` 等于 `Expanded`，Web 上被自动改写成 `flex: 1 1 0%`，两端一致。另外内置标签一律 `flex-shrink: 0`（Flutter 的子节点不压缩）；`div` / `input` 这类 HTML 标签由渲染器恢复 CSS 初始值 `flex-shrink: 1`，块级容器和表单控件可以让位给兄弟节点，声明的值照常赢。

`flex-basis` 对不增长、主轴没写尺寸的子项生效（px 或容器主轴 `%`）；flex 子项的 `margin: auto` 也按 CSS 语义吸收剩余空间（`margin: 0 auto` 居中、`margin-left: auto` 推到行尾）。`align-self` 支持五档常用值。`display: inline-block` / `inline` 映射成**横排可换行的收缩盒**（没有行内格式化上下文）——以前这两个值无效、表现为块级竖排，老页面会看到它们变横排。

### 4. 单位

| 单位 | 支持 |
|---|---|
| `px`、无单位 | ✅ |
| `%`、`calc()` | ✅ 用在宽高、`min-*` / `max-*`、margin / padding、top / left / right / bottom、`gap` |
| `%`（部分属性，引擎有特殊参照） | `transform` 的 `translate(x%, y%)` 按元素自身宽高；`border-radius` 的 `%` 在有确定尺寸的盒上生效；`font-size` 的 `%` 由引擎按父计算字号改写成 px |
| `em` / `rem` | 构建时换算成 px |
| `vw` / `vh` | ❌ |

百分比的参照是父盒在这个方向上的空间。在 `scroll-view` 里纵向是无界的，所以 `height: 50%` 不生效 —— 用 `flex-grow` 或写死 px。内容自适应的盒子上 `border-radius: 50%` 仍是圆（超限圆角会被钳回），但 `10%` 这类小值保持方角。

### 5. 层级与悬浮

`z-index` 只在**同一父节点下的绝对定位兄弟之间**生效（含负值），不建模层叠上下文 —— 其余场景仍是后写的盖在先写的上面。

`position: fixed` 支持：元素被挪进页面的**置顶 overlay 宿主**（Flutter 根 Overlay 上的全屏层），不随页面滚动、盖在宿主 chrome 之上，偏移与 `%` 尺寸参照整屏。三点要知道：上下层级只看插入顺序；从原父元素继承的样式断开（同 web 上 teleport 到 `<body>`）；不经 safe-area 包裹，`top: 0` 会顶进状态栏区域。

### 6. 按压态 `:active` 由原生切换

```css
.row { background-color: #fff; }
.row:active { background-color: #eef4ff; }
```

`:active` 的样式在 CSS 引擎里提前算好下发，按下时 Flutter **直接切换，不回 JS**，按下即亮。两个限制：

- 只能写在选择器的**最后一段**：`.row:active .title` 会被跳过并告警
- 按压样式**不向子节点继承**，所以按压反馈优先用 `background-color` / `opacity` / 边框

`:hover` 同理（App 端只有桌面鼠标会触发）。

## 支持范围速查

**选择器**

| 支持 | 不支持 |
|---|---|
| `.class`、标签、`*`、后代（空格）、子代 `>`、复合 `.a.b` | `#id` |
| `:deep()` / `::v-deep()` / `:global()` | `:nth-child`、`:not()` 等其它伪类 |
| `:active`、`:hover`、`:first-child` / `:last-child`、`:disabled` | 后续兄弟组合器 `~` |
| 属性选择器 `[class*=…]` 等（**只认 `class` 属性**，六种运算符） | 其它属性（`[type=search]`） |
| 相邻兄弟组合器 `+`（`.a + .b`） | `@supports` / `@import` |
| 装饰型伪元素 `::before` / `::after`（`content` 只认字符串，见下） | `:active::before` 这类状态 + 伪元素组合 |
| `:root` / `:host`（只收 `--x` 自定义属性）、`@font-face`、`@media` | |

伪元素按「装饰盒」实现：引擎照常层叠算样式，渲染时合成真实子节点（`::before` 在最前、`::after` 在最后），布局与命中走既有管道。`content: " "` 生成不带文字的空盒（发丝线惯用写法）；iconfont 字形要求盒子字体栈命中某个 `@font-face`。

**属性**（常用部分）

| 类别 | 支持 |
|---|---|
| 盒模型 | `width` `height` `min-*` `max-*` `margin` `padding`；`box-sizing` 默认 `border-box`，写 `content-box` 也按 CSS 语义生效 |
| 背景与边框 | `background-color`、`background`（仅线性 / 径向渐变）、`border` 及单边（`-width` 等长手支持 1~4 值按边展开）、`border-radius`（含 `%`）、`box-shadow`、`opacity`、`overflow: hidden`、`pointer-events: none`（子树内重新打开不支持） |
| Flex | `flex-direction` `justify-content` `align-items` `flex-grow` `flex-shrink` `flex-basis` `flex-wrap` `gap`（含 `%`）`align-self`、flex 子项 `margin: auto` |
| 定位 | `position: relative / absolute / sticky / fixed`、`top` `left` `right` `bottom`、绝对定位兄弟间的 `z-index` |
| 文字 | `color` `font`（简写）`font-size` `font-weight` `font-style` `font-family`（按字体栈解析）`line-height`（默认 1.4）`letter-spacing` `text-align` `text-decoration` `text-transform` `text-shadow` `white-space`、`currentColor` |
| 省略号 | `max-lines` + `overflow: ellipsis`（fjs 扩展，代替 `text-overflow`） |
| 变换 | `transform`：translate / scale / rotate / matrix（`translate` 的 `%` 按元素自身尺寸） |
| 过渡 | `transition`：`transform` `opacity` `color` `border-color` `background-color` `width` `height` `padding` `margin` 与 fixed/abs 的四边 inset 两端渐变 |
| 动画 | `animation` + `@keyframes`：引擎解析、原生逐帧，见下节 |
| 其它 | `display: none`、`display: inline-block` / `inline`（横排收缩盒）、`touch-action`、`cursor`、`inherit` 关键字、内联 `<svg>` 上的 CSS（`fill` / `stroke` 族） |

**不支持**：`display: grid`、`~` 组合器、`:nth-child` / `:not()` 等其它伪类、`#id`、`class` 以外的属性选择器、`filter` / `backdrop-filter`、行内格式化上下文（基线对齐、文字绕排）。

完整的支持矩阵（每条都标了两端差异）在仓库的 [CSS 兼容清单](https://github.com/snice/ufjs/blob/main/docs/css-compat.md)。不支持的写法**不会静默失效**，引擎会打一次告警；写完想提前把「写了也不生效」的规则报到命令行，跑 `npx fjs lint`（见 [CLI 参考](/reference/cli)）。

## 继承

和浏览器一样，这些属性沿元素树向下继承：`color`、`font-size`、`font-weight`、`font-style`、`font-family`、`line-height`、`letter-spacing`、`text-align`、`text-transform`、`white-space`，以及所有 **CSS 自定义属性**（`--x`）。

任何属性都可以写 `inherit` 关键字取父元素的计算值（伪元素的「父」是它的宿主元素）；`initial` / `unset` / `revert` 未实现。

`:root` / `:host` 只收自定义属性，作为每棵页面树继承链的起点 —— 组件库的主题变量（如 vant 的 `--van-*`）都声明在这里，页面里直接 `var()` 覆写即可。

## 自定义字体（`@font-face`）

```css
@font-face {
  font-family: "my-icons";
  src: url("./fonts/my-icons.woff2") format("woff2");
}
.icon-home::before { font-family: "my-icons"; content: "\e601"; }
```

iconfont 写法照 web。App 端构建时把 WOFF2 / WOFF 统一转成 TrueType 内联进包，运行时注册进 Flutter 字体表，加载完成后文字自动重排。限制：远程 `http(s)` 字体源、`local()`、`unicode-range` 不支持；字体按内联计入 JS 包（TTF 约为 WOFF2 的 2–3 倍，超过 1MB 构建期告警），大字体走资源文件是后续项。Web 端浏览器原生。

## CSS 变量与主题

原生的自定义属性和 `var()` 都可以用（含 fallback）。配合 Vue 的 `v-bind()` 可以把响应式状态直接绑进 CSS：

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
const dark = ref(false);
const bg = computed(() => (dark.value ? '#111' : '#fff'));
</script>

<template>
  <view class="page">
    <button @tap="dark = !dark">切换主题</button>
  </view>
</template>

<style scoped>
.page { --bg: v-bind(bg); background-color: var(--bg); }
</style>
```

做全局主题的推荐方式：在 Shell 的根节点上设一组 CSS 变量，整棵页面树通过继承拿到它们。切主题只改这一个节点。参考 `examples/hello-fjs/src/theme.ts`。

::: tip 性能提示
主题变化时，如果长列表和读主题的状态在同一个组件里，Vue 会把整张列表重新 diff 一遍（输出完全一样，白算）。把列表挪进一个 props 不随主题变化的子组件，就能整个跳过。
:::

## 媒体查询

```css
@media (min-width: 600px) {
  .grid { flex-direction: row; }
}
```

支持 `min-width` / `max-width` / `width`、对应的 height 系列、`orientation`，以及 `and` 和逗号组合。App 端按窗口逻辑尺寸求值，旋转屏幕或窗口改变大小时自动重算。

## 动画

- `transition` 适合简单的状态过渡。两端渐变的属性：`transform` / `opacity` / `color` / `border-color` / `background-color` / 宽高 / `padding` / `margin` / 定位 inset。App 端差异：`transition-delay` 只对 transform / opacity 生效；gradient 背景跳变不动画；inset 与 padding / margin 不派 transitionend
- `@keyframes` / `animation` 支持：引擎解析简写与关键帧（帧里的 `var()` 按元素自己的自定义属性解析），App 端原生逐帧执行、没有逐帧桥往返。任意节点上真正动起来的是 `transform` / `opacity`，其余属性的帧只下发不插值（web 原生全动）；伪元素上的动画 App 端不动
- 页面/组件转场用 Vue 的 `<Transition>`（App 端是 fjs 版实现）：enter/leave 的 `-from/-active/-to` 类照常落地，animation 型规则由 keyframes 引擎播放，transition 型类切换按上表补间；结束时机取计算样式里「时长 + 延迟」较长者（本端没有 transitionend 可听）。`<TransitionGroup>` 是纯透传
- 拖拽跟手时改 `transform: translate(...)`，而不是 `left` / `top`：前者只重绘，不触发布局
