# Tasks: 218-story-drag-dismiss

对应 plan：`./plan.md`。

## 契约层

- [x] T001 确认契约零变更（只用既有触摸事件 / transform / transition / `@scroll`）

## 实现

- [x] T010 `CardExpand.vue`：加 `.dim` 与 `.pose`，把 hero / content / close 放进姿态容器，姿态写成 `transform` + `border-radius`
- [x] T011 `CardExpand.vue`：content scroll-view 加 `bounces=false`、`@scroll`（scrollTop）与四个触摸事件，写拖动状态机（armed → dragging），拖动中逐帧写姿态 / 遮罩
- [x] T012 `CardExpand.vue`：松手判定（距离 / 速度）→ 回弹或收起；收起走"淡出内容 → 姿态换算成 hero 矩形并无过渡交换 → 既有几何回飞"
- [x] T013 重入保护：拖动 / 回弹 / 收起期间忽略 ✕ 与新的 open，`touchcancel` 回弹，定时器统一清理

## 两端对齐

- [x] T020 Web（桌面鼠标）逐条验 spec §6 #2 #3 #5 #6
- [x] T021 iOS 模拟器验 #4（含 touchmove 在 scroll-view 上是否到达、是否被提前 cancel）
- [ ] T022（部分：没有逐帧并排对照录屏，只验了姿态公式与结果）对照录屏调参（常量在 §3），差异记入「实现期发现」

## 测试

- [x] T030 `pnpm --filter app-store-clone run typecheck`
- [ ] T031（未做，见「实现期发现」）手势判定逻辑若可抽成纯函数则补 vitest；示例工程无 vitest 配置则在此明确写不加的原因

## 文档

- [x] T040 两端新差异（如有）登记；无则写「无」

## 验收

- [x] T050 `pnpm run typecheck`、`pnpm test`
- [ ] T051（部分，见「实现期发现」验收表）spec §6 逐条核对并记结果
- [ ] T052（等 T022 与 T051）spec 状态改 `done`

## 实现期发现

### 验收结果（spec §6）

| # | 项 | Web（桌面，pointer 事件） | iOS 模拟器 |
|---|---|---|---|
| 1 | typecheck / 全部测试 | 通过（runtime 1015、cli 511、audio 23、webview 36、liquidglass 6、webgl 30） | — |
| 2 | 到顶下拖：整页跟手、缩小、圆角变大；拖够飞回、拖不够回弹 | 通过。慢拖 80px：姿态 `translate(0,64) scale(.943) radius 5.3`，松手回弹；慢拖 170px：姿态 `translate(0,168) scale(.851) radius 13.9`，松手收起、层隐藏 | 通过：慢拖 225pt 收起、短拖 80pt 回弹（只能看松手后的结果，截不到按住中的帧） |
| 3 | 已下滚时下拖不触发 | 通过（scrollTop=126 时姿态不变） | 通过（离开顶部后下拖只是滚回顶部，没有收起） |
| 4 | 模拟器同上 | — | 见上 |
| 5 | 收起后卡片完整、可再次打开 | 通过 | 通过（反复开关多次） |
| 6 | ✕ 仍可用、连点不卡 | ✕ 路径 217 已验，本次未改；`close()` 在非 idle 相位直接返回 | 未重测 |
| 7 | 无 gc()、无新依赖、packages 零改动 | 通过 | — |

### 发现

1. **App 端拖动被 `touchcancel` 打断（根因）**：默认 `touch-action: auto` 下，到顶下拖超过滚动器的 18px 认领阈值就输掉手势竞技场，页面收到 `touchcancel`（`packages/flutter_fjs/lib/src/render/touch.dart` 头部注释写明「losing the arena is exactly that signal」）。日志序列 `start → move armed → move dragging → end touchcancel`。web 桌面鼠标不会发生，所以只在 App 上暴露。
2. **修法（只用 JS）**：滚动视图在**页面处于顶部时**设 `touch-action: pan-x`（本节点 8px 阈值先于滚动器认领所有竖向拖动），离开顶部恢复 `auto`。代价：认领期间滚动器看不到这根手指，所以「从最顶部向上滑」的**第一次手势**由我们手动驱动 `scroll-top`（无惯性），之后是原生滚动。实机手感上，第一次从顶部上滑没有惯性，这是已知折中。
3. **（已由 specs/219-touch-action-pan-up 取代）根治需要运行时的方向性认领**：让 `touch-action` 只认领「向下」、把「向上」留给滚动器（例如新增 `pan-up` 一类取值，`pointer_claim.dart` 的识别器在向上位移超过阈值时 reject）。这是 `packages/flutter_fjs` 的改动，本 spec 不做，**建议另开 spec**。
4. `scroll-view` 的 `:key` 绑 `openCount`：展开层常驻挂载，重开时滚动位置会残留，靠重建滚动视图回到顶部。
5. 工具侧：模拟器 `tap` 偶尔丢首击；`touch_path` 不能在按住中途截图，所以按住中的姿态只在 web 上用 JS 派发 pointer 事件量到了数值，App 端以「结果是否符合阈值」间接验证。

### 未做

- T031 不加单测：手势判定内联在组件里（依赖 `ref` 与定时器），示例工程没有 vitest 配置；纯函数部分（进度、缩放、阈值）只有三个一行公式，已在 web 上用具体数值核对。
- T022 没有逐帧并排对照录屏；参数（0.4 / 0.3 / 28 / 0.15 / 0.7）取自录屏抽帧估算，手感需要用户上手后再调。
- 背景遮罩是黑色半透明近似，录屏里露出的 Today 页是模糊+变暗。
