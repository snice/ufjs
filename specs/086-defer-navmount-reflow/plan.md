# Plan: navMount 期间推迟同步 layout

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及（差异要登记） | 行为只存在于 App 的 navMount 窗口。Web 走浏览器强制重排，没有这次 `flushLayout`。`docs/web.md` 已知差异写明。标签/事件/页面源码不变 |
| II 边界即契约 | 不涉及 | 三张表零改动。仍是现有 `fjs.ui.rect` host 模块 |
| III 同步单线程零序列化 | 涉及 | 不引入桥或线程。只是 navMount 当次不调用 `_reflow`；`dispatchEvent` 返回后既有 `_scheduleUiNotify` 让下一帧 build/layout |
| IV 外观照 WeUI | 不涉及 | 不改默认样式 |
| V 静默失效是 bug | 涉及 | 073 的 collapse 同 tick 量高不能悄悄变 0。防线：defer **只**包 `dispatchEvent(navMount)`，既有 widget 测试钉住窗口外仍强制重排 |
| VI 注释记录权衡 | 涉及 | `geometry.dart` 写清为什么 navMount 要抑制 `_reflow`、为什么 073 不能一起关 |
| VII JS 能包就不要下 Dart | 涉及，必须落 Dart | `_reflow` / `flushLayout` 是 Flutter 布局管线。JS 侧 `boundingRectOf` 已经 `flushNow()` 把 op 送过桥；贵的是 Dart 同步 layout。没有 JS 组件能替代 |
| VIII 变更落到文档 | 涉及 | `docs/ui-api.md`（rect 在 navMount 窗口 vs 之后）、`docs/web.md` 已知差异、`docs/vant-mount-perf.md` / `performance.md` 热点、`docs/threading-model.md` 转场窗口、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 无 |
| JS runtime | — | 无（`boundingRectOf` 仍 `flushNow` + `fjs.ui.rect`；未 layout 时宿主回 null，JS 已合成全零） |
| Web 适配层 | `docs/web.md` | 登记差异，不改代码 |
| C++ 引擎 | — | 无 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/geometry.dart` | `runWithoutGeometryReflow`；`fjs.ui.rect` 在计数器 >0 时跳过 `_reflow` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | `_mountWhenReady` 里 `dispatchEvent(navMount)` 包进上述窗口 |
| 测试 | `packages/flutter_fjs/test/vant_layout_test.dart` | 窗口内不强制重排；窗口外 073 仍绿 |
| 文档 | `docs/ui-api.md`、`docs/web.md`、`docs/vant-mount-perf.md`、`docs/performance.md`、`docs/threading-model.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

`geometry.dart` 用可重入计数器 `_suppressReflow`。`fjs.ui.rect` 仅在计数为 0
时调用 `_reflow`；否则直接读 `RenderBox`——已 layout 的节点（上一页）仍有
尺寸，尚未 build 的新节点没有 `element`，返回 null（JS 合成全零）。

`FjsEngine._mountWhenReady` 在 `dispatchEvent(key, navMount)` 外套
`runWithoutGeometryReflow`。push / replace / 首页 `fjs.nav.load` 都走这条，
第一次打开任何页都不会把 first-paint layout 拉进 JS 栈。

**「下一帧补」**：不新派事件。`dispatchEvent` 返回后既有 `_scheduleUiNotify`
会在下一帧 build+layout 上屏。vant Slider/Rate 在手势里会再读 rect，那时
窗口已关、走 073 强制重排。不在 post-frame 里重放 `onMounted`。

被否掉的备选：

- **关掉所有 `_reflow`**：会打破 073 collapse 同 tick 量高。否。
- **脏节点很多才跳过**：阈值难定，首页 25 dirty 也测到过 59ms layout。按
  调用栈（是不是 navMount）判断更干净。
- **navMount 后同步再 `_reflow` 一次**：layout 仍在同一段 UI 调用里，转场
  照样冻，只是日志好看。否。
- **JS 侧 boundingRectOf 在 navMount 里短路**：JS 看不见「是不是 navMount」；
  而且 op 已经要 `flushNow`。抑制点必须在 Dart `_reflow`。

## 4. 风险

- vant Tabs 下划线、Swipe 宽度若只在 `onMounted` 量一次且不再读，第一帧可能
  停在 0。登记为已知差异；手势/后续更新会纠正。vant-form 的 Slider/Rate
  拖动路径会再读（`geometry.dart` 头部注释已写）。
- 测试若在「模拟 navMount」时忘记包窗口，会以为没改。新用例必须走
  `runWithoutGeometryReflow`。
- debug 模拟器数字和 release 真机不同；验收看「mounted 日志不再含 160ms
  layout」，不把 first-paint 的绝对毫秒当合同。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
cd packages/flutter_fjs && flutter test test/vant_layout_test.dart
# 模拟器（chunk 预热后点 vant-form，看 [nav] mounted）
cd demo && pnpm exec fjs run ios
```
