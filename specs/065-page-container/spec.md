# Spec: 页面容器 page-container

- **ID**: 065-page-container
- **状态**: in-progress
- **日期**: 2026-09-16

## 1. 要解决什么

微信小程序自 2.16.0 起提供 `page-container`（"假页"容器）：遮罩 +
四向弹出面板，**返回操作（右滑手势 / 安卓物理返回 / navigateBack）关闭
的是容器而不是页面**。fjs 的弹层目前只有 `modal`（bottom sheet 特化），
业务要做半屏抽屉、右侧滑出面板、居中弹窗时没有组件可用，更没有
「返回关闭容器」这个页面级语义。

补齐目标：同一份 Vue 源码里 `<page-container>` 在三端表现一致——
Flutter（iOS 模拟器）、web、微信小程序。

## 2. 不做什么（Non-goals）

- **`position="left"`**：wx 文档可选值只有 `top bottom right center`，
  跟着 wx 走，不私自扩展。
- **web 端拦截浏览器返回键**：浏览器没有「返回手势关闭弹层」的页面语义，
  用 history API 伪造返回条目弊大于利。记已知差异。
- **`overlay-style` / `custom-style` 的对象形式**：三端契约定为字符串
  （mp 原生属性就是字符串；web 赋 cssText；Flutter 解析后并入样式）。
- **多容器叠加的 z-index 语义**：wx 限定每页最多 1 个容器；fjs 的
  z-index 在 Flutter 端只体现为路由顺序（后开在上）。属性收下，文档说明。
- **`root-portal` / 跨页面挂载**：wx 的兄弟能力，不在本 spec。
- **鸿蒙**：wx 自己也不支持返回拦截。
- **Android 真机验证**：沿用 007/008 惯例，验收端为 web、iOS 模拟器、
  微信开发者工具。

## 3. 用户可见的行为

```vue
<page-container
  :show="show"
  position="bottom"
  round
  :close-on-slide-down="true"
  :duration="300"
  @before-enter="log('beforeenter')"
  @after-enter="log('afterenter')"
  @before-leave="log('beforeleave')"
  @after-leave="show = false"
  @clickoverlay="show = false"
>
  <view class="panel">…</view>
</page-container>
```

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `show` | boolean | false | 是否显示容器；显隐由页面状态驱动 |
| `duration` | number | 300 | 动画时长 ms |
| `z-index` | number | 100 | 层级（见 Non-goals） |
| `overlay` | boolean | true | 是否显示遮罩 |
| `position` | string | bottom | `top` / `bottom` / `right` / `center` |
| `round` | boolean | false | 面板圆角 |
| `close-on-slide-down` | boolean | false | 下滑（right 为右滑）一段距离后关闭 |
| `overlay-style` | string | — | 遮罩自定义样式 |
| `custom-style` | string | — | 面板自定义样式 |

| 事件 | 触发时机 |
|---|---|
| `@before-enter` | 进场动画开始前 |
| `@enter` | 进场动画开始 |
| `@after-enter` | 进场动画结束 |
| `@before-leave` | 离场动画开始前（含返回手势/下滑触发的关闭） |
| `@leave` | 离场动画开始 |
| `@after-leave` | 离场动画结束。**返回手势/下滑关闭后页面靠它把 `show` 归位** |
| `@clickoverlay` | 点遮罩。不自动关闭，由页面在 handler 里改 `show`（wx 语义） |

所有事件无载荷。页面典型写法是 `@after-leave="show = false"`——无论谁
发起关闭（JS / 遮罩 / 返回手势 / 下滑），show 最终都被拉回 false。

## 4. 三端约定（宪法 I）

| | Flutter | Web | 微信小程序 |
|---|---|---|---|
| 实现 | 原生标签：route 级透明 `PageRouteBuilder`，遮罩 = `ModalBarrier` 语义，面板 = 活子树 `FjsNodeRenderer` | 原生标签：`Teleport to body` + fixed 遮罩/面板 + CSS transition | 编译透传 wx 原生 `<page-container>`（基础库 ≥ 2.16.0） |
| 动画 | 路由 transition（Slide/Fade），时长 = `duration` | CSS transition，时长 = `duration` | wx 原生 |
| 返回操作关闭容器 | ✅ 路由 pop（iOS 右滑 / PopScope）免费获得 | ❌ 已知差异 | ✅ wx 原生 |
| `close-on-slide-down` | ✅ 面板拖拽手势，过阈值 pop 路由 | ✅ touch 拖拽（尽力对齐） | ✅ wx 原生 |
| `@clickoverlay` | 遮罩点击派发，不自动关 | 同左 | wx 原生 |
| 事件载荷 | 无 | 无 | 无 |
| 已知差异 | `z-index` 只按路由顺序 | 不拦浏览器返回 | skyline 下 wx 原生 `position=center` 不渲染面板（内容有布局、无绘制，custom-style 救不回；bottom/top/right 正常）——wx 组件缺陷，mp 端需要居中弹层暂用 `modal` |

**验收补充记录（2026-09-16）**：route 不得混入 `CupertinoRouteTransitionMixin`
——底下的 fjs 页面路由会把这次 push 当成 Cupertino push 而横向滑动、手势
语义也会漏到页面层；容器 route 是 bare `PageRoute`（canTransitionTo=false），
边缘手势由自写手势条提供。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——**不涉及**。
- [ ] natives 表——**不涉及**。
- [x] 事件类型（`element.ts` + `ffi.dart` + `fjs.h`）——+7：
      `beforeenter / enter / afterenter / beforeleave / leave / afterleave /
      clickoverlay`，取当前最大事件号之后连续 7 个；事件号紧张（一字节
      预算），但这 7 个是模板级用户事件（`@before-enter` 直接写），按
      tap/change 的先例各占一号，不走 canvas 的「一号多消息」。

其它同步点：`tags.json`（+`page-container`，原生标签身份）、
`node_adapters.dart`、`web/components/index.ts`。**不进**
`component-tags.json`（它不是 JS 组件）；**不进** app/flutter.ts 注册表。

## 6. 验收标准

1. `pnpm run typecheck` 通过；`pnpm test` 通过（含新增的
   web-page-container / mp-compiler 透传 / vue-plugin 标签分派用例）。
2. hello-fjs 新增 `src/pages/comp/feedback/page-container.vue`（四个
   position 入口 + round/overlay/close-on-slide-down 开关 + 事件日志）。
3. **web**：`pnpm --filter hello-fjs run dev:web` 走查——四向动画方向
   正确、`duration` 生效、点遮罩只派 `@clickoverlay` 不自动关、
   `@after-leave` 后 `show` 归位、事件按序打点。
4. **iOS 模拟器**：`pnpm --filter hello-fjs run run:ios` 走查同上条；
   另测边缘右滑返回——**关闭的是容器、页面不动**，且关闭后
   `@after-leave` 把 `show` 拉回 false；`close-on-slide-down` 下滑过
   阈值关闭。
5. **小程序**：`pnpm --filter hello-fjs run build:mp` 构建通过，wxml 里
   `page-container` 原样透传（`bindbeforeenter` / `bindclickoverlay` 等
   事件名正确）；微信开发者工具（skyline）打开 `dist/mp` 走查，四向/
   返回手势/事件日志与另两端一致，skyline 可用性结论记录回本 spec。
6. 文档：`docs/ui-api.md` 加 page-container 一节（含三端差异表）；
   `docs/miniprogram.md` 标签映射表加"透传 wx 原生"一行。

## 7. 待澄清

- 无（方案方向已在计划阶段与用户对齐：原生标签 + 三端三实现）。
