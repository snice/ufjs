# Spec: CSS `filter: blur()` 两端同源

- **ID**: 222-css-filter-blur
- **状态**: in-progress
- **日期**: 2026-10-16
- **来源**: specs/221（故事页拖动返回，背景要高斯模糊）。用户明确：背景模糊用 `filter: blur`，
  不借 `@ufjs/liquidglass`，`filter` 是独立的 CSS 能力。

## 1. 要解决什么

`docs/css-compat.md` 把 `filter` / `backdrop-filter` 都登记为 ❌；`fjs lint` 对 `filter` 报「drop」。
但 `filter: blur()` 是最常用的一种（弹层出现时把页面糊掉、拖动返回时的背景、图片占位），
Web 上浏览器原生支持，**只有 App 端渲染不出来**，页面在两端表现不一致，也没法在 App 上给任意节点加高斯模糊。
liquidglass 的 `<glass-surface>` 是「在原位画一块玻璃」，不是「把某个节点自己糊掉」，两件事。

## 2. 不做什么（Non-goals）

- 只做 `blur(<length>)`。`brightness / contrast / grayscale / drop-shadow / hue-rotate …` 不做：
  App 端告警一次并忽略这些函数，`fjs lint` 报 warn（Web 上仍然生效）。
- 不做 `backdrop-filter`（仍是 ❌，要玻璃用 `<glass-surface>`）。
- 不做 `filter` 的 transition / animation（App 端不插值，与 `border-radius` 同类，写在 css-compat 差异里）；
  逐帧由页面自己写样式。
- 不做多函数组合的语义（`blur(2px) brightness(.8)`）：App 端取其中的 `blur`，其余告警忽略。
- 小程序：webview 渲染器里是浏览器原生；skyline 未验证，登记。

## 3. 用户可见的行为

```vue
<view class="page" :style="{ filter: dragging ? `blur(${blur}px)` : undefined }">…</view>
```

- `filter: blur(8px)`：节点**连同整棵子树**一起高斯模糊，半径 = 标准差（与 CSS 同），不影响布局、命中测试照旧。
- `blur(0)` / `none` / 缺省：等同没有 filter，不加任何包装。
- 单位：`px`，或裸数字（style 对象里 `blur(8)` 也按 px，与其他长度一致）；`em/rem` 经 css 引擎已换算成 px。
- 子树边缘不外溢：模糊后的内容被节点自己的盒子裁成矩形外也会有「淡出」，用 `TileMode.decal`
  保证边缘不向内拖入颜色（与浏览器行为接近）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `filter: blur(r)` | `ImageFiltered(ImageFilter.blur(sigma: r, tileMode: decal))` 包在节点内容外、`transform` 之内 | 浏览器原生 CSS |
| 其他 filter 函数 | 告警一次并忽略 | 浏览器原生（生效） |
| 动画 / 过渡 | 不插值（逐帧写样式可以） | 浏览器原生 |
| 已知差异 | 模糊半径一致；大半径的耗时在 App 上更高；裁剪行为与浏览器在边缘有亚像素差 | — |

## 5. 契约变更（宪法 II）

- [x] 都不涉及：`filter` 本来就能作为 style 值过桥（样式引擎透传），Dart 侧只是新读一个 key。

文档（宪法 VIII）：`docs/css-compat.md`（`filter` 行改 ⚠️、`transition` 差异里补一句）、`docs/ui-api.md`
（style 速查里加 `filter`）、`docs/miniprogram.md`。lint：`support.ts` 的 `DROPPED_PROPERTIES` 去掉 `filter`，
`lint.ts` 对非 `blur` 的函数报 warn。

## 6. 验收标准

1. Flutter 单测（真的跑起来，不是 `No tests ran`）：`filter: blur(6px)` → 渲染树里有 `ImageFiltered`，
   sigma = 6；`blur(0)`、`none`、缺省 → 没有；`brightness(.5)` → 没有，且告警一次；`blur(4px) brightness(.5)` → 只有 blur。
2. lint 单测：`filter: blur(4px)` 不报；`filter: brightness(.5)` 报 warn；`backdrop-filter` 仍 drop。
3. `pnpm test`、`pnpm run typecheck`、`flutter test` 通过；css-support 的结构性测试通过。
4. iOS 模拟器：示例里对 Today 页面设 `filter: blur(…)`，肉眼可见模糊、布局不变、取消后恢复。
5. 文档同步。

## 7. 待澄清

无。
