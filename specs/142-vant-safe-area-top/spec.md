# Spec: vant 顶部弹层让出状态栏（Notify / ImagePreview close）

- **ID**: 142-vant-safe-area-top
- **状态**: done
- **日期**: 2026-09-27

## 1. 要解决什么

demo 的 vant feedback 页（`demo/src/pages/vant/feedback.vue`）在 App 端（iOS）两个问题：

1. **showImagePreview 的右上角 close 点不动**。fjs 应用是 edge-to-edge
   （`fjs_app.dart` 主动 `SystemUiMode.edgeToEdge`），vant ImagePreview 的
   close 图标按 CSS 定位在 `top: var(--van-image-preview-close-top)` ≈ 屏幕最
   顶端 —— 落进了状态栏区域。实测（iOS 模拟器 + agent-device）：
   - y < ~62pt（safe-area top）内的点击**不达应用**：点 close 图标（中心
     y≈27pt）预览不关；同一预览里点图片（y≈300pt）正常走
     `closeOnClickImage` 关闭；点 y=65pt+ 的遮罩区域正常走
     `closeOnClickOverlay` 关闭。62pt 恰为 iPhone 17 的状态栏高度。
   - 视觉上图标也被状态栏（时钟/电量）压住。
2. **showNotify 顶着屏幕最上沿渲染**，文案被状态栏遮住。Notify 的 fixed 根
   `top: 0` 被 hoist 进 app 级浮层宿主（specs/137），宿主不做 safe-area
   让位（docs/overlay-host.md §5 明确"不经 safe-area 包裹"），所以通知条
   与状态栏文字重叠。

共同根因：vant 的顶部锚定弹层默认假设"页面顶部从浏览器 chrome 之下开始"，
而 fjs 应用把页面画到状态栏底下，顶部锚定的东西必须自己让出 inset。

## 2. 不做什么（Non-goals）

- **不修**"状态栏区域点击不达应用"本身。它影响一切画在 inset 里的交互
  （系统行为/模拟器行为/运行时哪一层吞的未定），范围远超本次反馈页，
  单独立项。本次只把这两个组件的交互元素移出该区域。
- 不改运行时 / op 协议 / Dart 侧：`<safe-area>` 标签两端已有
  （App = Flutter `SafeArea`，web = `env(safe-area-inset-*)` 内边距），
  不引入 `env()` 支持、不加新的 JSI 通道。
- 不动 NavBar / Tabbar / Sticky 等其它顶部锚定元素 —— 它们有各自的
  `safeAreaInsetTop` prop 或页面自行包 `<safe-area>` 的既有做法。
- web 构建不动：`vite/vant.ts` 的补丁走 `fjs.app` hook，只在 App 构建
  生效（该文件自身的约定）。桌面浏览器 `env(safe-area-inset-top) = 0`，
  本来就没有这个问题。

## 3. 用户可见的行为

页面代码零改动，仍是：

```ts
showNotify({ type: 'success', message: '来自 showNotify' });
showImagePreview({ images, closeable: true });
```

App 端行为变为：

- Notify 弹出后，通知条仍从屏幕最顶端开始（含状态栏区域一起着色），
  **文案与图标让到状态栏以下**，不再被时钟/电量压住；关闭动画照旧。
- ImagePreview 打开后，右上角 close 图标**位于状态栏以下**
  （状态栏顶 + `--van-image-preview-close-top`），可点击，点击即关。
  其它 `closeIconPosition`（bottom-left 等）不受影响，维持原样。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 补丁生效：顶部元素包 `<safe-area edges="top">`，内容让出状态栏 | 补丁不生效（`fjs.app` 只跑 App 构建）；桌面浏览器无状态栏，无需让位 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 移动端浏览器（刘海 + `viewport-fit=cover`）里这两个组件仍贴顶 —— vant 原生行为 | 同左 |

差异登记在 `docs/overlay-host.md` 已知差异表。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter demo run typecheck` 通过。
2. `pnpm test` 通过。
3. `fjs run ios` + feedback 页：
   - 点 showNotify → 通知条可见、文案在状态栏以下，不被时钟遮挡；
   - 点 showImagePreview → 点右上角 close 图标 → 预览关闭（探针列表不新增条目，
     预览消失）；
   - `showImagePreview({ closeIconPosition: 'bottom-left' })` 之类非 top-right
     场景不受影响（补丁按位置条件生效）。
4. `pnpm --filter demo run build:web` 成功（web 产物不含补丁行为，回归确认）。

## 7. 待澄清

- 无。状态栏区域点击不达应用的现象已用探针页复现并记录
  （`specs/142-vant-safe-area-top/plan.md` §1），作为独立问题另行处理。

## 8. 验收结果

1. ✅ `pnpm --filter demo run typecheck` 通过。
2. ✅ `pnpm test` 通过（0 fail；runtime/cli/webview 各包全绿）。
3. ✅ `fjs run ios`（iPhone 17 模拟器，agent-device 操作）：
   - showNotify：绿条仍到屏幕顶（沉浸着色），"来自 showNotify" 在状态栏以下，
     不再被时钟/电量遮挡；3 秒自动关闭照旧。
   - showImagePreview：close 图标移到状态栏以下（中心 ≈ y 70pt），
     点它预览关闭（a11y 树 "1 / 2" 节点消失）。
   - `closeIconPosition: 'bottom-left'` 走原样分支（与 vant 原始代码逐字节
     一致）；它顶到左上角是 App 端 absolute+bottom 定位的既有限制，
     非本次改动引入，demo 未使用该形态。
4. ✅ `pnpm --filter demo run build:web` 与 `fjs build`（app 产物）成功，
   无 `[vant] app patch did not apply` 告警。
