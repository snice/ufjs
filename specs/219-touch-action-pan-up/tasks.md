# Tasks: 219-touch-action-pan-up

对应 plan：`./plan.md`。

## 契约层

- [x] T001 确认契约零变更（`touch-action` 是既有 style 键）

## 实现

- [x] T010 `touch.dart`：`TouchAction` 加 `panUp` / `panDown`，`parseTouchAction` 认新值
- [x] T011 `touch.dart`：识别器 move 里按方向放弃（self-reject，不派 cancel）/ 认领，`_claims` 加分支，写清权衡注释
- [x] T012 `gestures.ts`：`claimsGesture` 返回取值；`dragPanBindings` 对 `pan-up/down` 按方向平移或放弃
- [x] T013 mp：`wxml.ts` / `build.ts` 识别 `pan-up/pan-down`，告警并按 auto

## 两端对齐

- [ ] T020（未做浏览器内真触摸：用 happy-dom 单测覆盖鼠标平移分支，Chrome 触摸模拟没有跑）Web：Chrome 里（DevTools 触摸模拟）`pan-up` 节点下拖不被接管、上滑正常滚动；桌面鼠标同理
- [x] T021 `docs/web.md` 登记 Safari 不支持

## 测试

- [x] T030 `touch_event_test.dart`：pan-up / pan-down / 横向 / 混合位移 / 无 cancel / 无回归（先跑通现有用例作基线）
- [x] T031 web 手势单测（照既有位置）
- [x] T032 `mp-compiler.test.ts`：`pan-up` 告警且不生成 catch

## 文档

- [x] T040 `docs/ui-api.md`（touch-action 节 + style 速查取值）、`docs/css-compat.md`、`docs/miniprogram.md`、`vue-global.d.ts` 注释

## 示例

- [x] T050 `CardExpand.vue` 改用 `pan-up`，删手动 `scroll-top` 分支
- [x] T051 iOS 模拟器验证：到顶下拖收起不被取消、到顶上滑是原生滚动

## 验收

- [x] T060 `pnpm run typecheck`、`pnpm test`
- [ ] T061（部分，见下表）spec §6 逐条核对
- [ ] T062（等 T020 与 T061）spec 状态改 `done`

## 实现期发现

### 验收结果（spec §6）

| # | 项 | 结果 |
|---|---|---|
| 1 | Flutter 单测 | `touch_event_test.dart` 16 → 22（新增 pan-up 上滑 / 下拉 / 先后反向 / 横向、pan-down 两个方向），先写后跑：实现前 4 个失败（`Expected: not contains <18>` 即 touchCancel、列表被滚走），实现后全过；既有 none / pan-x / pan-y / auto 用例不变。`tap_touch_action_test.dart` 同跑通过 |
| 2 | `pnpm test` / typecheck | typecheck 全 workspace 无错；runtime 1018（+3）、cli 512（+1）、audio 23、webview 36、liquidglass 6、webgl 30 全过；`flutter test` 整包 799 通过、9 个被跳过（既有的需要 native 的用例，非本次改动） |
| 3 | 示例改用 `pan-up` | 完成，`CardExpand.vue` 删掉 `scrollTarget` / `scrolling` 相位 / `:scroll-top`。iOS 模拟器：到顶快速上滑是原生滚动；离开顶部后下拉只滚回顶部、不触发返回；回到顶部后慢拉 225pt 收起（不再被 `touchcancel` 打断） |
| 4 | Web Chrome 真触摸 | **未验**。只有 `web-drag-pan.test.ts` 的 3 个新用例（鼠标平移按方向判定） |
| 5 | 文档 | `ui-api.md`、`css-compat.md`、`miniprogram.md`、`web.md`（Safari 不认）、`vue-global.d.ts` 注释已同步 |

### 发现

1. 放弃（reject）发生在 8px，滚动器的阈值是 18px，所以滚动器随后正常赢；节点的 `Listener` 独立于竞技场，仍收到该指针的 move / end，JS 看不到 `touchcancel`。风险 #1 成立，已用单测断言。
2. 「只判一次」：位移刚过阈值那一刻定方向，之后加了 `_decided` 保护；`pan-up` 先下拉被认领、再反向上拉不会交还手势（单测覆盖）。
3. `pan-up` / `pan-down` 对「横向」一律认领（CSS 语义：只有被留出的竖向方向交给浏览器）。
4. web 鼠标平移分支原先对任何非 auto / manipulation 的声明都整体让出，这次改成返回具体取值：未知值或组合值（如 `pan-x pan-y`）仍按 `none` 处理，行为不变。
5. 小程序编译器此前对 `pan-up` 是静默当 auto（正则不匹配）；现在显式识别并 `warn`，符合宪法 V。
6. 模拟器上拿不到「惯性」的定量对比：快速上滑 150pt 页面滚动约 100pt，说明走的是原生滚动物理，但没有做与手动驱动版的并排帧对比。

### 未做

- T020：没有在 Chrome 触摸模拟里验 `pan-up` 的真触摸；Safari 不支持已登记。
- T061 / T062：Web 真触摸那一条没验，spec 保持 in-progress。
