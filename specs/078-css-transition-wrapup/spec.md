# Spec: transition 收尾——color / 分边与虚线 border-color / margin·padding

- **ID**: 078-css-transition-wrapup
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

spec 045 之后 `transform` / `opacity` / `background-color` / 统一实线
`border-color` / `width` / `height` / 定位偏移都有过渡，css-compat.md 的
transition 条目还挂着三条「App 端瞬时跳变」：

1. **文字 `color`**：页面写 `transition: color .3s`，文字变色在 App 上是
   瞬时的（web 真 CSS 平滑）。vant 的按钮文字、链接变色都踩这里。
2. **分边 / 虚线的 `border-color`**：统一实线边框走 `Decoration.lerp`
   已经过渡；`border-bottom`（分边）和 dashed / dotted 走
   `FjsSideBorderPainter` / `FjsDashedBorderPainter` 自绘，颜色从不插值。
3. **`margin` / `padding`**：布局间距属性整体瞬时跳变。

## 2. 不做什么（Non-goals）

- `border-width` 的过渡（只有 color 过渡；宽度跳变维持现状）。
- `transitionend` 对 margin / padding / color 不派发（width/height 有
  `FjsSizeTransitionEnd` 是因为 vant collapse 依赖；这批先不派，登记）。
- 嵌套 `text` span 上声明的 `color` 的过渡——段落自身颜色过渡；span
  自带颜色瞬时（要逐 span 建 tween 状态，收益不成比例），登记。
- out-of-flow（absolute/fixed）盒子的 margin：它被折叠进定位 inset
  （specs/041），不参与过渡。
- `transition-delay` 对这批属性不生效（TweenAnimationBuilder 无延迟钩子，
  与 background-color 的既有登记一致）。

## 3. 用户可见的行为

```vue
<template>
  <text class="link" @click="on = !on">a link</text>
  <view class="box" :class="{ big: on }">…</view>
</template>
<style scoped>
.link { color: #333; transition: color .3s; }
.link:hover { color: #07c160; }
.box { padding: 8px; margin: 4px; border-bottom: 1px dashed #ccc;
       transition: padding .2s, margin .2s, border-color .2s; }
.box.big { padding: 24px; margin: 12px; border-color: #07c160; }
</style>
```

两端（`fjs dev --web` 与 App）颜色渐变、间距渐变、虚线变色一致。

## 4. 两端约定（宪法 I）

| | Flutter（App） | Web |
|---|---|---|
| color | 段落 TextStyle 经 TweenAnimationBuilder 插值 | 真 CSS |
| border-color（分边/虚线） | 自绘 painter 的每边色 ColorTween | 真 CSS |
| margin/padding | 解析后的 EdgeInsets 经 EdgeInsetsTween 插值（% 在 LayoutBuilder 内解析后同样插值） | 真 CSS |
| 已知差异 | delay 不生效；嵌套 span 自带 color 瞬时；不派 transitionend | 无 |

JS 侧零改动（键透传 + 真 CSS），协议零改动。

## 5. 契约变更（宪法 II）

- [x] 都不涉及——纯 Dart 渲染层的既有属性消费点补 tween，无新 op / 事件 /
  natives。

## 6. 验收标准

1. `flutter test` 新增用例全过：文字 color 插值（含 ：hover 状态变体驱动）、
   分边/虚线 border-color 插值、margin/padding 插值、未声明 transition 的
   页面瞬时且零包装。
2. `pnpm run typecheck` / `pnpm test` 全绿。
3. hello-fjs「过渡演示」页扩展：文字变色 / 虚线变色 / 间距渐变三项，
   web 与模拟器对拍一致。
4. css-compat.md 的 transition 条目与单位节登记更新。

## 7. 待澄清

- 无。
