# Spec: touch-action: none 不得吞掉同节点的 @tap

- **ID**: 097-tap-touch-action-arena
- **状态**: done（2026-09-22 全量 `flutter test` 通过）
- **日期**: 2026-09-22

## 1. 要解决什么

hello-fjs 的「鹈鹕骑行」（spec 096）canvas 盒子上同时写了 `@tap` 和
`touch-action: none`（canvas-compat §9 对手势画布的标准处方），web 端点按
切换速度正常，**Flutter 端 `@tap` 一次都不派发**。

复现测试 `packages/flutter_fjs/test/tap_touch_action_test.dart`：
同一节点只挂 `@tap` 时 tap 正常；再加 `touchAction: "none"` 后 dispatch
日志为空。

根因：`_TouchActionRecognizer.addAllAllowedPointer`（`render/touch.dart`）
对 `touch-action: none` 在 **pointer-down 时就 `resolvePointer(accepted)`**，
经竞技场的 eagerWinner 机制在 down 结束时赢下整个 arena——同节点包裹在外层的
`TapGestureRecognizer` 在手指抬起前已被 `rejectGesture`，tap 永远等不到
accept。它与三处已写下的意图全部矛盾：

- 自己的类注释：「It never wins by default … Only movement makes it claim.」
- spec 029 文档表：「节点进手势竞技场，**手指移动约 8px** 抢下指针」；
- web 语义：`touch-action` 只管滚动/缩放归属，**从不影响 click/tap**（宪法 I）。

web 端 tap 正常、App 端不派发 = 两端不同源。

## 2. 不做什么（Non-goals）

- **不改 tap / touch 事件的载荷、类型、op 协议**——三张表零改动。
- **不改 web 侧**：web 本来就是对的。
- **不重新设计竞技场**：只去掉 `none` 的 down 时 eager-accept，抢指针仍走
  「移动过 8px 即 claim」的既有路径（`_claims()` 对 `none` 的分支已在）。
- **不顺带处理 pan-x/pan-y**：它们本来就不 eager-accept，无此 bug。

## 3. 用户可见的行为

修复后，同时写 `@tap` 和 `touch-action: none` 的节点（画布、拖拽块……）：

```vue
<canvas ref="cv" class="cv" @tap="onTap" />
<!-- .cv { touch-action: none; } -->
```

- **轻点（无位移或位移 < tap 阈值）**：派发 `@tap`——和 web 上点按
  画布一致；`touchstart/end` 照常。
- **拖动（位移过 8px）**：`_TouchActionRecognizer` claim 手势，外层滚动容器
  拿不到指针（`touchmove` 持续派发、不发 `touchcancel`），`@tap` 不派发
  ——与拖动不产生 click 的 web 行为一致。
- 只挂 `touch-action: none` 不挂 `@tap` 的节点（游戏画布、拖拽 demo）：
  行为不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 轻点派发 tap；移动过 8px 抢下指针、外层不滚 | `touch-action: none` 不抑制 click；拖动由浏览器原生判定 |
| 事件载荷 | 不变 | 不变 |
| 已知差异 | 抢指针阈值 8px 是 Flutter 侧近似（web 由浏览器判定，无固定值）——既有差异，spec 029 已登记 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）：不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）：不涉及
- [ ] 事件类型（`element.ts` + `fjs.h`）：不涉及
- [x] 都不涉及（纯 Dart 手势竞技场时序修复）

## 6. 验收标准

1. `flutter test`（`packages/flutter_fjs`）**全量通过**，含：
   - `tap_touch_action_test.dart` 两个用例（control 通过 + 修复后 touch-action 用例通过）；
   - `touch_event_test.dart` 里 `touch-action: none keeps an enclosing list from
     scrolling`、`wins before a fast first scroll move`、`pan-y` 等既有用例不回归
     ——它们就是 eager-accept 当初要保的行为。
2. `pnpm --filter hello-fjs run typecheck` 通过（页面代码零改动）。
3. 鹈鹕骑行页在 App 端点画布切换 ×1/×2.5 生效（web 已验，App 端为手工项）。

## 7. 待澄清

- 无
