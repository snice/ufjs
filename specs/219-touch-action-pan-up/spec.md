# Spec: touch-action 方向性认领（pan-up / pan-down）

- **ID**: 219-touch-action-pan-up
- **状态**: in-progress
- **日期**: 2026-10-16
- **来源**: specs/218-story-drag-dismiss 的实现期发现 1–3。

## 1. 要解决什么

`touch-action` 现在只有 `none` / `pan-x` / `pan-y`，没有方向。想做「到顶下拉返回」这类
手势（App Store 故事页），需要**向下的竖向拖动归节点、向上的竖向拖动留给外层滚动**：

- `pan-x` 把**所有**竖向拖动都认领了，向上滚内容也被抢走；
- 不声明（`auto`）时，到顶下拖超过滚动器的 18px 就输掉手势竞技场，节点收到
  `touchcancel`，手势流断掉，跟手做不出来（Flutter 才有，web 桌面鼠标没有）。

218 只能用 JS 折中：到顶时设 `pan-x`，从顶部上滑的第一次手势手动驱动 `scroll-top`
（无惯性）。要根治，得让认领**有方向**。

## 2. 不做什么（Non-goals）

- 不做 `pan-left` / `pan-right`（没有场景；`pan-x` / `pan-y` 已覆盖横向）。
- 不做组合值（`pan-up pan-left` 这类 CSS 多值写法）：单值。
- 不改 `none` / `pan-x` / `pan-y` / `auto` / `manipulation` 的现有行为。
- 小程序端不支持方向性（wx 的手势组件没有方向区分），编译期告警并按 `auto` 处理。

## 3. 用户可见的行为

与 CSS Pointer Events L2 同名同义：

```css
.pull { touch-action: pan-up;   }  /* 向上的竖向拖动留给外层滚动，其余（向下、横向）归本节点 */
.push { touch-action: pan-down; }  /* 向下的竖向拖动留给外层滚动，其余（向上、横向）归本节点 */
```

「向上」指手指向上移动（内容跟着上滚）。判定与 `pan-x` / `pan-y` 同口径：

- 位移超过认领阈值（触摸 8px / 鼠标 1px）时看方向：竖向分量大于横向分量且方向是被
  留出的那个 → 本节点**放弃**（外层滚动正常接管，**不派 `touchcancel`**，节点仍能收到
  后续 `touchmove` / `touchend`）；否则 → 本节点**认领**（外层滚动不会启动）。
- 放弃发生在滚动器自己的 18px 阈值之前，所以滚动器随后正常赢得这根手指。

对页面（`CardExpand.vue`）的效果：到顶时声明 `pan-up`，下拉归自己（跟手、不被取消），
上滑是原生滚动（有惯性），不再需要手动驱动 `scroll-top`。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `pan-up` / `pan-down` | `_TouchActionRecognizer` 加两个取值：向留出方向位移超阈值 → reject 自己（不派 cancel），其余方向位移超阈值 → accept | 原生 CSS `touch-action: pan-up / pan-down`（浏览器自己实现方向性） |
| 桌面鼠标 | 阈值 1px，同上 | 滚动容器的「鼠标手动拖动」（`gestures.ts` 的 `dragPanBindings`）对 `pan-up/down` 节点：留出方向照常平移，认领方向不平移 |
| 事件载荷 | 不变 | 不变 |
| 已知差异 | — | **Safari（含 iOS）不支持 `pan-up / pan-down`**（只认 auto/none/manipulation/pan-x/pan-y），声明被忽略等同 `auto`：到顶下拉会被浏览器接管并 `pointercancel`。Chrome / Edge / Firefox 支持。登记到 `docs/web.md` |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及。`touch-action` 本来就是 style 值，Dart 侧 `parseTouchAction` 读它；新增两个取值，
  不新增 op / native / 事件。

文档（宪法 VIII）：`docs/ui-api.md`（触摸事件 / touch-action 节、style 速查里的取值列表）、
`docs/css-compat.md`（`touch-action` 一行）、`docs/miniprogram.md`（不支持）、
`docs/web.md`（Safari 差异）、`packages/fjs-runtime/src/vue-global.d.ts` 的注释。

## 6. 验收标准

1. Flutter 单测（`packages/flutter_fjs/test/touch_event_test.dart`，真的跑起来，不是 `No tests ran`）：
   - `pan-up`：向上拖 → 外层列表滚动、**无 `touchCancel`**、节点仍收到 move；
   - `pan-up`：向下拖 → 列表不滚、节点认领、**无 `touchCancel`**、收到 move；
   - `pan-down` 镜像；
   - 横向拖动 → 认领（外层不滚）；
   - 先横后竖等混合位移按「竖向分量大于横向分量」判定，不抖；
   - 回归：`none` / `pan-x` / `pan-y` / `auto` 既有用例不变。
2. `pnpm test`、`pnpm run typecheck` 通过（含 mp 编译器测试：`pan-up` 告警并忽略）。
3. `examples/app-store-clone/src/components/CardExpand.vue` 改用 `pan-up`，删掉手动 `scroll-top` 分支；
   iOS 模拟器：到顶下拖仍能收起（不被 `touchcancel` 打断）、到顶上滑是原生滚动（有惯性）。
4. Web：Chrome 里 `touch-action: pan-up` 的节点下拖不被浏览器接管（DevTools 触摸模拟）。
5. 文档同步（§5 列的几处），Safari 差异与小程序不支持已登记。

## 7. 待澄清

无。命名沿用 CSS 标准值 `pan-up` / `pan-down`，不另造名字。
