# Spec: vant-more 组件 App 端修复（Skeleton 溢出 + Empty SVG 渐变）

- **ID**: 073-vant-more-gaps
- **状态**: done
- **日期**: 2026-09-19

## 1. 要解决什么

demo 的 `vant: more` 页在 App 端（fjs-go 真机/模拟器）与 web 端对拍，两处明显不符：

1. **Skeleton**：App 端 `van-skeleton title avatar :row="3"` 的内容列不收缩，
   整行横向溢出（Flutter 打出 RIGHT OVERFLOWED BY 84 px 的黄黑条纹），布局与
   web 不一致。
2. **Empty**：App 端默认图（内联 SVG）只画出零星实色碎片——vant 的 Empty
   插画几乎全部用 `<linearGradient>/<radialGradient>` + `fill="url(#…)"` 上色，
   svg.dart 对 paint server 直接"painted nothing"。

根因：

- Skeleton：`renderer.ts` 的 HTML 标签映射把 `div → view`，丢掉了 CSS 的初始
  值 `flex-shrink: 1`；Dart 侧 `_noShrinkTags`（flex.dart）按 `view` 处理为
  不收缩，`width: 100%` 的 `.van-skeleton__content` 不给 avatar 让位。web 上
  `div` 是原生 DOM、默认可收缩，所以只有 App 端错。
- Empty：`svg.dart` 头部注释明说 "gradients / patterns (`url(#…)`) paints
  nothing"。

## 2. 不做什么（Non-goals）

- 不做 `pattern`、`mask`、`clipPath`、`filter`、`<use>`、`<text>`（svg.dart
  维持现有豁免清单）。
- 不做 `gradientUnits="userSpaceOnUse"`（vant 全系用默认 objectBoundingBox）。
- 不动 fjs 自有标签（`view`/`text` 等）的收缩约定——web base-css 把它们钉在
  `flex-shrink: 0` 是为了对齐 Flutter 的天然行为，App 排版页依赖它。
- 不在本 spec 内重排 vant-more 页面结构。

## 3. 用户可见的行为

修复后 `vant: more` 两端对拍：

- Skeleton：avatar 32×32 在左，内容列（title 40% 宽 + 3 行）在右且不再溢出；
  末行 60% 宽的错位与 web 一致。
- Empty：默认图与 `image="search"` 完整呈现（渐变阴影、渐变主体都上色），
  与 web 观感一致。

页面内三处过时的"App 端预期空白/空缺"文案改为实际行为。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| HTML 映射元素的 flex-shrink | `div/section/…→view` 带默认 `flexShrink: 1`（元素级缺省样式） | 原生 DOM，CSS 初始值本来就是 1 |
| SVG 渐变 | linear/radial、objectBoundingBox、stop-opacity、gradientTransform(matrix/translate/scale/rotate) → `ui.Gradient` shader | 浏览器原生 |
| 事件载荷 | 不涉及 | 不涉及 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（纯两端各自的行为对齐，协议不动）

## 6. 验收标准

1. `pnpm run typecheck` 通过；`pnpm test` 通过（含新增 renderer 缺省样式用例）。
2. `cd packages/flutter_fjs && flutter test` 通过（含新增 skeleton 收缩、
   svg 渐变用例）。
3. demo `vant: more` 在 web（`fjs dev --web`）上 Skeleton/Empty 布局不回归。
4. iOS 模拟器 fjs-go 连 dev server 实拍：Skeleton 不再溢出、Empty 插画完整，
   与 web 对拍一致。

## 7. 待澄清

- 无
