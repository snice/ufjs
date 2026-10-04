# Plan: nested-scroll-header / nested-scroll-body

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | App 改 `flutter_fjs/lib/src/widgets/`（新 nested 模块）+ web 改 `fjs-runtime/src/web/components/`（新组件 + base-css），同一套标签/属性/行为；已知差异（吸收语义）登记 `docs/ui-api.md` |
| II 边界即契约 | 否 | 无新事件号、无新 op；路由按直接子级形状判定（specs/052 先例），`type` 属性与 Dart 端一致不参与路由 |
| III | 否 | — |
| IV 外观照 WeUI | 否 | 结构性组件，无默认外观（block 容器） |
| V 静默失效是 bug | 是 | nested 标签不在 `type="nested"` scroll-view 里 → 编译期 warn；webview 降级/丢 offset-top → warn；App 横向嵌套 → warnOnce |
| VI 注释记录权衡 | 是 | 自定义收起 sliver 的几何推导、吸收语义的取舍写入代码注释 |
| VII JS 能包就不要下 Dart | 是 | 包不了：需要 Flutter 的 sliver 滚动协调与自定义几何（原生渲染能力），这正是宪法 VII 允许下 Dart 的情形；web/mp 侧不做 Dart 等价物 |
| VIII 文档 | 是 | `docs/ui-api.md`、`docs/miniprogram.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 标签清单 | `packages/fjs-runtime/src/tags.json` | 加 `nested-scroll-header` / `nested-scroll-body` |
| CLI dist | `pnpm --filter @ufjs/cli run build` | json 内联刷新（AGENTS.md §4.6） |
| mp 编译 | `packages/fjs/src/mp/wxml.ts` | `isNestedScrollView`；根降级 skyline 例外；INJECTED_ATTRS 对 nested 跳过 type/enable-flex；`.fjs-scroll-inner` 对 nested 跳过；webview 渲染器把 header/body 降级为 view（只留第一个元素子节点）并把 body 直接子级 scroll-view/list-view 降级为 view（剥滚动属性/事件）；编译期父子校验 warn |
| web 组件 | `packages/fjs-runtime/src/web/components/nested-scroll.ts`（新） | `FjsNestedScrollHeader`（纯容器）、`FjsNestedScrollBody`（offset-top clamp + 父级校验） |
| web 注册 | `web/components/index.ts`、`base-css.ts`、`event-emits.ts` | fjsComponents 登记；基线样式（block、只显首子、吸收规则）；WEB_EMITS 两行 `['tap','longPress']` |
| Dart | `packages/flutter_fjs/lib/src/widgets/nested_scroll.dart`（新） | 标签常量、offset-top 读取、sliver 拆分（runs / headers / body 首子 + 吸收 scope）、`offset-top>0` 的收起 sliver（仿 RenderSliverPersistentHeader 钉尾几何） |
| Dart 分发 | `lib/src/node/node_adapters.dart` | `_ScrollViewNodeAdapter` 加 nested 路由（优先于 sticky 路由） |
| Dart 吸收 | `lib/src/widgets/scroll_view.dart`、`list_view.dart` | 读吸收 scope：scroll-view 退化为普通盒；list-view 全量行 + 不滚动（并提示大列表用 skyline/web） |
| 测试 | `packages/fjs/test/mp-compiler.test.ts`、`packages/fjs-runtime/test/web-nested-scroll.test.ts`（新）、`packages/flutter_fjs/test/nested_scroll_test.dart`（新） | 见 spec §6.3 |
| 文档 | `docs/ui-api.md`、`docs/miniprogram.md` | 标签表 + 已知差异 |
| Demo | `examples/hello-fjs/src/pages/comp/container/nested-scroll.vue`（新，页面自注册） | 对照页：hero + offset-top 尾巴 + 30 行列表 |

## 3. 方案

选定：

- **路由判定**照 sticky（specs/052）：直接子级含 nested 标签 → nested 路由，
  `type` 属性不参与判定；nested 优先于 sticky 路由。
- **App**：单一 CustomScrollView（沿用 FjsScrollView 的 controller/事件机制，
  外层 `@scroll`/边缘事件零改动）。`offset-top=0`（默认）时 header/body 都是
  普通 sliver，原生滚动天然正确（收起→续滚一气呵成）；`offset-top>0` 时最后
  一个 header 换自定义收起 sliver——几何同普通盒 sliver（scrollExtent=子高），
  paint 时把子项钉在 `-(高-offset-top)` 之下（仿 RenderSliverPersistentHeader
  的 pinned paintOrigin 写法，保证滚过之后视口仍会调 paint）。后续内容从钉住的
  尾巴下方继续滚（viewport 先画的 sliver 在上层，与 SliverAppBar pinned 同理）。
- **吸收**：body 内容外包 `FjsNestedBodyScope(absorbed)`；被吸收的
  scroll-view 退化为普通盒（不再创建 Scrollable，避免 repaint boundary 把
  cull 窗口钉死在内层静态视口），list-view 退化为全量行；被吸收容器内部重置
  scope，更深层的滚动器保持独立。
- **Web**：两个组件 + 三条 CSS 规则（block 基线、`:not(:first-child)` 隐藏、
  body 直接子级滚动容器 `overflow: visible`）；offset-top 用 rAF 节流的
  scroll clamp（body 顶部到不了 offset-top 之上）。
- **mp**：skyline 全透传（三处让位：INJECTED_ATTRS、fjs-scroll-inner、根
  降级）；webview 编译期降级为 view 树（单一滚动，视觉与 App/web 等价）。

被否：

- Flutter `NestedScrollView`：SliverPersistentHeaderDelegate 的 maxExtent 是
  先验常数，而 header 高度是 JS 内容的布局产物；且 inner 独立滚动与 web 吸收
  语义相悖（宪法 I）。
- 206 式手势驱动（内层真滚动 + overscroll 通知程序化收外层）：惯性不连续，
  要手写速度传递；吸收方案单一滚动位置天然连续。
- web 手写 touch 手势（van-sticky 式）：单一滚动容器免费获得同样行为 + 正确
  事件，无需自绘。
- webview 运行时组件（sticky 的 fjs-sticky-* 先例）：nested 无事件、无逐帧
  测量需求，编译期降级更简单且产物更小。

## 4. 风险

- 吸收把 body 内层滚动器的 `scroll-top` 等属性变哑（三端一致），文档登记；
  App 端 list-view 全量化在超大列表上有成本（warn 提示）。
- `offset-top>0` 的钉尾是"绘制压住"而非裁剪：透明尾巴下列表行会透出（wx 为
  裁剪），登记已知差异。
- web 吸收用 CSS `!important` 压页面给内层滚动器的 height/overflow，页面
  内联 important 会赢——登记。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli run build
pnpm --filter demo run typecheck && pnpm test
cd packages/flutter_fjs && flutter analyze && flutter test test/nested_scroll_test.dart
# web: fjs dev --web 开 hello-fjs 嵌套滚动页对照
# App: fjs run ios 同页对照；skyline 产物交用户在工具/真机复核
```
