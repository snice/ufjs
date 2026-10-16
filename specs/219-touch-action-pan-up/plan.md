# Plan: touch-action 方向性认领（pan-up / pan-down）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter：`packages/flutter_fjs/lib/src/render/touch.dart`；Web：原生 CSS 透传 + `packages/fjs-runtime/src/web/components/gestures.ts` 的鼠标平移分支。Safari 不支持登记到 `docs/web.md` |
| II 边界即契约 | 否 | `touch-action` 是既有 style 键，只多两个取值；不动 ops / natives / 事件表 |
| III 同步单线程零序列化 | 否 | 纯手势识别，无桥 |
| IV 外观照 WeUI | 否 | 无外观 |
| V 静默失效是 bug | 是 | 小程序不支持：编译期 `warn` 并按 auto；Safari 忽略是浏览器行为，文档登记 |
| VI 注释记录权衡 | 是 | 识别器里写明「为什么放弃要在滚动器阈值之前」「为什么自己 reject 不派 cancel」 |
| VII JS 能包就不要下 Dart | 破例（有理由） | 这是手势竞技场层面的认领，JS 侧无法在竖向一个方向上让出手势（218 已用 JS 折中验证过，代价是第一次上滑无惯性）；必须在 Dart 识别器里按位移方向 reject |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`、`css-compat.md`、`miniprogram.md`、`web.md`、`vue-global.d.ts` 注释 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/touch.dart` | `TouchAction` 加 `panUp` / `panDown`；`parseTouchAction` 认 `'pan-up'` / `'pan-down'`；`_TouchActionRecognizer.handleEvent` 在 move 里先判「留出方向」→ 自己 reject（`_selfResolved`，不派 cancel，停止跟踪该指针），否则按 `_claims` 认领；`_claims` 为两个新值加分支 |
| Dart 测试 | `packages/flutter_fjs/test/touch_event_test.dart` | 新增 §6 #1 的用例（复用现成的 `_render(scrollable: true)` ListView 夹具） |
| Web 适配层 | `packages/fjs-runtime/src/web/components/gestures.ts` | `claimsGesture` 改返回具体取值；`dragPanBindings` 对 `pan-up/down` 节点按拖动方向决定平移还是放弃 |
| Web 测试 | `packages/fjs-runtime/test/…`（照既有 gestures / touch 测试位置） | `pan-up` 向下拖不平移、向上拖平移 |
| 类型 | `packages/fjs-runtime/src/vue-global.d.ts` | 注释里的取值列表 |
| 小程序 | `packages/fjs/src/mp/wxml.ts`、`packages/fjs/src/mp/build.ts` | 识别 `pan-up/pan-down`（内联与 class），`warn` 一次并按 auto 处理 |
| 小程序测试 | `packages/fjs/test/mp-compiler.test.ts` | `pan-up` 告警且不生成 catch / handler |
| 文档 | `docs/ui-api.md`、`docs/css-compat.md`、`docs/miniprogram.md`、`docs/web.md` | 取值与差异 |
| 示例 | `examples/app-store-clone/src/components/CardExpand.vue` | 到顶声明 `pan-up`，删手动 `scroll-top` 分支（`scrollTarget`、`scrolling` 相位） |

确认存在的参照：`touch.dart` 的 `_TouchActionRecognizer`（本 spec 前已读）、
`touch_event_test.dart` 的 `_render` / `_treeWith` / `_listens`、`mp-compiler.test.ts:724` 的 `describe('touch-action')`。

## 3. 方案

**识别器**：move 事件里算位移 `delta`。先判是否越过阈值；越过后：
- 竖向主导（`|dy| > |dx|`）且方向是被留出的（`pan-up` 留向上 = `dy < 0`；`pan-down` 留向下 = `dy > 0`）
  → `resolvePointer(rejected)` 并记入 `_selfResolved`（不会触发 `onLost`/`touchcancel`），清理并停止跟踪；
- 否则 → accept 认领（和 `pan-x` / `pan-y` 同路径）。

放弃发生在 8px，滚动器的阈值是 18px，所以滚动器随后正常赢；节点的 `Listener` 本来就独立于竞技场，
继续收到该指针的 move / up，JS 只看到事件流不断，没有 cancel。

**为什么不用现成的 `pan-y` 变通**：`pan-y` 是「竖向留给父级、横向归自己」，没法表达「向上留、向下归我」。

**被否的备选**：
- 在 JS 里切换 `touch-action`（218 的做法）：对一次手势已经晚了，只能靠手动驱动 `scroll-top`，上滑第一次没有惯性。
- 自定义 `DragGestureRecognizer` 子类走 Flutter 标准拖动：要重写 touch 事件的派发路径，改动面远大于在现有识别器里加方向判定。
- 一个新名字（如 `pull-down`）：CSS 标准已有 `pan-up/pan-down`，web 侧能直接透传，不造轮子。

## 4. 风险

1. **自己 reject 后节点还能收 move 吗**：`Listener` 独立于竞技场，现有测试「touch-action: pan-y leaves vertical scrolling」已经走过「识别器放弃、列表滚动」的路径，但没断言 move 继续到达；新用例要断言。
2. **阈值边界抖动**：位移刚过 8px 时方向可能飘；以越过阈值那一刻的主导方向为准，只判一次（reject / accept 之后不再翻转）。
3. **`pan-down` 与 iOS 回弹**：下拉时 scroll-view 若在顶部且 `bounces=true`，滚动器会开始过滚；示例里 `bounces=false`，文档提醒同时设置。
4. **mp 编译器正则**：现在只匹配 `(none|pan-x|pan-y)`，`pan-up` 会被静默当作 auto —— 要显式匹配并告警（宪法 V）。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter test test/touch_event_test.dart
pnpm --filter @ufjs/runtime test && pnpm --filter @ufjs/cli test
pnpm run typecheck && pnpm test
cd examples/app-store-clone && fjs run ios   # 到顶下拖收起 / 上滑有惯性
```
