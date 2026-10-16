# Tasks: 221-story-drag-center-blur

- [x] T001 依赖 specs/222（filter: blur 两端可用）
- [x] T010 姿态锁定中心：去掉 translate，只 `scale()` + 圆角
- [x] T011 缩到 `CLOSE_SCALE`(0.85) 立即返回，不等松手；松手只剩速度判定 / 回弹
- [x] T012 背景：黑色层 + 页面容器 `filter: blur`（`CardExpand` 上报 `blur`，父页面写样式）；退场逐步归零
- [x] T020 Web 验证：拖 98px 同时横向移动 → `transform: scale(0.925)` 无位移、圆角 7px、背后 `blur(≈3px)`；拖到 280px 手指不松 → 层隐藏、背后 filter 清除、卡片完整；回弹后 filter 归零
- [x] T021 iOS 模拟器：连拍帧——居中缩小 → 整页 Today 被高斯模糊 + hero 飞回 → 卡片归位；手指全程未松（末尾保持近 2 秒）
- [x] T030 `pnpm run typecheck`、`pnpm test`、`flutter test` 通过
- [ ] T031 与录屏逐帧并排对照手感参数（0.4 / 0.3 / 28 / 20px / 0.35 / 0.85）；真机帧率
- [ ] T032 spec 状态改 `done`（等 T031）

## 实现期发现

1. 我最初用 `<glass-surface>` 做背景模糊，被用户指出方向错了（`filter: blur` 是独立能力）：玻璃面糊的是背后，这里要糊的是 Today 页自己。因此补了 specs/222，示例改成「页面内容容器自己 `filter: blur`」。
2. Web 上被模糊的容器必须在 `CardExpand` 之外：`filter` 会让元素成为 `position: fixed` 后代的包含块，放进去会把全屏层的定位弄偏。
3. `touch_path` 之后截图要在后台连拍才拍得到拖动中途；单次截图总是落在松手之后。
