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

### 2. row 时交叉轴默认居中

`flex-direction: row` 时，Flutter 的 `align-items` 默认是 `center`，CSS 是 `stretch`。**在乎的地方显式写 `align-items`。**

### 3. `flex-grow` 就是「分剩余空间」

Flutter 上 `flex-grow: 1` 等于 `Expanded`，Web 上被自动改写成 `flex: 1 1 0%`，两端一致。另外内置标签一律 `flex-shrink: 0`（Flutter 的子节点不压缩）。

### 4. 单位

| 单位 | 支持 |
|---|---|
| `px`、无单位 | ✅ |
| `%`、`calc()` | ✅ 用在宽高、`min-*` / `max-*`、margin / padding、top / left / right / bottom |
| `em` / `rem` | 构建时换算成 px |
| `vw` / `vh` | ❌ |

百分比的参照是父盒在这个方向上的空间。在 `scroll-view` 里纵向是无界的，所以 `height: 50%` 不生效 —— 用 `flex-grow` 或写死 px。

### 5. 层级按文档顺序

`z-index` 不支持，后写的节点盖在先写的上面。`position: fixed` 也不支持，悬浮元素用 `position: absolute` 放在页面根节点下。

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
| `:deep()` / `::v-deep()` / `:global()` | 属性选择器 `[x=y]` |
| `:active`、`:hover`、`:first-child`、`:last-child` | `:nth-child`、`:not()` 等其它伪类 |
| `@media` | 兄弟组合器 `+` `~`、`::before` / `::after` |

**属性**（常用部分）

| 类别 | 支持 |
|---|---|
| 盒模型 | `width` `height` `min-*` `max-*` `margin` `padding`（`box-sizing` 恒为 `border-box`） |
| 背景与边框 | `background-color`、`background`（仅线性 / 径向渐变）、`border` 及单边、`border-radius`、`box-shadow`、`opacity`、`overflow: hidden` |
| Flex | `flex-direction` `justify-content` `align-items` `flex-grow` `flex-wrap` `gap` |
| 定位 | `position: relative / absolute / sticky`、`top` `left` `right` `bottom` |
| 文字 | `color` `font-size` `font-weight` `font-style` `font-family` `line-height`（默认 1.4）`letter-spacing` `text-align` `text-decoration` `text-transform` `text-shadow` `white-space` |
| 省略号 | `max-lines` + `overflow: ellipsis`（fjs 扩展，代替 `text-overflow`） |
| 变换 | `transform`：translate / scale / rotate / matrix |
| 过渡 | `transition`：`transform` `opacity` `background-color` `width` `height` 两端都有渐变 |
| 其它 | `display: none`、`touch-action` |

**不支持**：`display: grid`、`inline-*`、`position: fixed`、`z-index`、`align-self`、`animation` / `@keyframes`、`filter`。

完整的支持矩阵（每条都标了两端差异）在仓库的 [CSS 兼容清单](https://github.com/snice/ufjs/blob/main/docs/css-compat.md)。不支持的写法**不会静默失效**，引擎会打一次告警。

## 继承

和浏览器一样，这些属性沿元素树向下继承：`color`、`font-size`、`font-weight`、`font-style`、`font-family`、`line-height`、`letter-spacing`、`text-align`、`text-transform`、`white-space`，以及所有 **CSS 自定义属性**（`--x`）。

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

- `transition` 适合简单的状态过渡；`transform` / `opacity` / `background-color` / 宽高两端都会渐变，其它属性在 App 端是瞬时跳变
- `@keyframes` 动画暂不支持；`@vueuse/motion`、Anime.js 已在 App 端验证可用
- 拖拽跟手时改 `transform: translate(...)`，而不是 `left` / `top`：前者只重绘，不触发布局
