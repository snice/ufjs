# 内置组件

ufjs 的界面由一组**内置标签**搭成。它们的命名和语义对齐微信小程序（`view` / `text` / `image` / `scroll-view` / `swiper`…），外观默认参照 WeUI。每个标签在 App、Web、小程序三条产物路径上各有一份实现：

| | Flutter | Web | 小程序 |
|---|---|---|---|
| `<view>` | `Flex` + 装饰 | DOM 组件 | 同名组件 |
| `<text>` | `Text` / `Text.rich` | DOM 组件 | 同名组件 |
| `<scroll-view>` | `SingleChildScrollView` | DOM 组件 | 同名组件 |

内置标签**不需要 import**，直接写在模板里。编辑器里有完整的属性和事件补全（前提是按[项目结构](./project-structure#tsconfig-json-与-fjs-global-d-ts)配好 tsconfig）。

::: tip 为什么不能写 div / span
Flutter 端没有 DOM。`div`、`span`、`p`、`h1`… 这类常见 HTML 标签会被映射到 `view` / `text` 并带上默认样式，可以用，但推荐直接写内置标签，语义更清楚，各端行为也最一致。
:::

## 标签速览

### 基础与布局

| 标签 | 作用 | 常用属性 / 事件 |
|---|---|---|
| `view` | 容器。**默认纵向 flex** | `@tap` `@longpress` 触摸事件 |
| `text` | 文本。嵌套的 `text` 是同一段落里的行内片段 | `max-lines` |
| `image` | 图片 | `src` `mode`（14 种，同小程序）`lazy-load` `@load` `@error` |
| `divider` | 分隔线 | `color` `height` |
| `safe-area` | 让出刘海 / 指示条 | `edges="top bottom"` |

### 滚动与列表

| 标签 | 作用 | 常用属性 / 事件 |
|---|---|---|
| `scroll-view` | 滚动容器 | `scroll-x` `scroll-y` `scroll-into-view` `@scroll` `@scrolltolower` |
| `list-view` | **虚拟化长列表**，只挂载视口附近的行 | `:items` + 默认插槽 |
| `swiper` / `swiper-item` | 轮播 | `current` `autoplay` `circular` `indicator-dots` `@change` |
| `refresh` | 下拉刷新 | `@refresh` |
| `sticky-header` / `sticky-section` | 吸顶 | 必须是 `scroll-view` 的直接子节点 |

### 表单

| 标签 | 作用 | 常用属性 / 事件 |
|---|---|---|
| `button` | 按钮 | `type`(default/primary/warn) `size`(default/mini) `plain` `loading` `disabled` `form-type` |
| `input` | 单行输入 | `value` `placeholder` `secure` `keyboard` `maxlength` `@text-changed` `@submit` |
| `textarea` | 多行输入 | `value` `auto-height` `@input` `@confirm` |
| `switch` / `checkbox` / `radio` | 开关、多选、单选 | `value` `name` `@value-changed` |
| `checkbox-group` / `radio-group` | 分组 | `@value-changed` |
| `slider` | 滑块 | `value` `min` `max` `@value-changed` |
| `picker` / `picker-view` | 选择器 / 滚轮 | `mode` `value` `@change` |
| `label` | 点击转发到控件 | `for` |
| `form` | 表单 | `@submit`（载荷是 `{name: value}` JSON 串）`@reset` |
| `progress` | 进度条 | `value`(0–1) |

### 浮层与其它

| 标签 | 作用 | 常用属性 / 事件 |
|---|---|---|
| `modal` | 底部弹层 | `visible` `@modal-closed` |
| `page-container` | 页面容器（返回手势关闭） | `show` `position` `@after-leave` `@clickoverlay` |
| `canvas` | 2D 画布，API 同浏览器 `CanvasRenderingContext2D` | `ref` → `getContext('2d')`，`@resize` |
| `rich-text` | 渲染 HTML 字符串 | `nodes` |
| `web-view` | 嵌网页（需安装模块 `@ufjs/webview`） | `src` `@message` |

完整的属性、事件和载荷格式，见仓库里的 [UI API 参考](https://github.com/snice/ufjs/blob/main/docs/ui-api.md)；每个组件的可运行示例在 [`examples/hello-fjs/src/pages/comp`](https://github.com/snice/ufjs/tree/main/examples/hello-fjs/src/pages/comp)。

## 事件

事件载荷**一律是字符串**（需要结构化数据时是 JSON 串），这是各端能保持一致的前提：

```vue
<switch :value="on" @value-changed="(v: string) => (on = v === '1')" />
<slider :value="n" @value-changed="(v: string) => (n = Number(v))" />
<image :src="url" @load="(p: string) => console.log(JSON.parse(p).width)" />
```

也可以用熟悉的 HTML 事件名，它们是别名：

| 写法 | 等价于 |
|---|---|
| `@click` | `@tap` |
| `@input` | `@text-changed` |
| `@change`（控件上） | `@value-changed` |
| `@change`（swiper 上） | 翻页事件，载荷是页索引 |

`:on-value-changed="fn"` 这种 prop 写法也可以，kebab-case 会自动转成 camelCase。

更多见[事件、网络与状态](./events-and-data)。

## 长列表

两件事，缺一不可：

1. **容器用 `list-view`**，不要用 `scroll-view` + `v-for`。`scroll-view` 会把每一行都 build、layout、paint 一遍；`list-view` 走 Flutter 的 `ListView.builder`，只落实视口里的十几行。
2. **页面外面不要再包滚动容器**（外壳里的 `scroll-view` 也算），否则 `list-view` 拿到的是无界高度，没有窗口可以虚拟化。

```vue
<list-view class="list" :items="rows">
  <template #default="{ item: row }">
    <view :key="row.id" class="row" @tap="open(row)">
      <text>{{ row.title }}</text>
    </view>
  </template>
</list-view>
```

实测 1000 行切换主题：最慢帧从 166 ms 降到 29 ms。

## 画布

```vue
<script setup lang="ts">
import { ref } from 'vue';
import type { FjsCanvasApi } from 'fjs';

const cv = ref<FjsCanvasApi>();

function draw(payload: string) {
  const { width, height } = JSON.parse(payload);
  const ctx = cv.value?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#07c160';
  ctx.fillRect(20, 20, width - 40, 60);
}
</script>

<template>
  <canvas ref="cv" class="cv" @resize="draw" />
</template>

<style scoped>
.cv { width: 100%; height: 200px; }
</style>
```

- `width` / `height` 是**逻辑像素**，不用乘 `devicePixelRatio`
- App 上 `onMounted` 时画布还没有尺寸，首次绘制写在 `@resize` 里
- `toDataURL()` 返回 Promise；`getImageData` 不支持
- 需要 WebGL 时安装模块 `@ufjs/webgl`

ECharts、F2、PixiJS、three.js 都有在 hello-fjs 里跑通的例子。

## 自定义 Flutter Widget 标签

内置标签不够时，可以用 Dart 写一个 Flutter Widget，注册成新标签，在模板里像内置标签一样使用。这是[模块](./modules#第三步-加一个-flutter-widget)的一部分。

## 页面文件名与标签同名的坑

页面文件名和内置标签同名时（`pages/comp/list-view.vue` 里写 `<list-view>`），Vue 会把标签当成**组件自引用**。加一行显式命名即可：

```ts
defineOptions({ name: 'ListViewPage' });
```
