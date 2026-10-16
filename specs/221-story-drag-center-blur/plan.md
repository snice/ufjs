# Plan: story-drag-center-blur

对应 spec：`./spec.md`

## 1. 宪法自查
纯示例改动；依赖 specs/222 提供的 `filter: blur()`。不动 `packages/`，不动契约。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 示例 | `examples/app-store-clone/src/components/CardExpand.vue` | 姿态去掉 translate（只 `scale()`，锁屏幕中心）；拖到 `scale ≤ 0.85` 立即 `finishDrag()`；松手只留「速度 > 0.7px/ms 收起，否则回弹」；背景改成「黑色层 + 向父页面上报模糊半径」，退场用 JS 逐步归零 |
| 示例 | `examples/app-store-clone/src/pages/index.vue` | 页面内容放进独立容器，容器 `filter: blur(Npx)`；`CardExpand` 在容器外，监听 `@blur` |

## 3. 方案

录屏逐帧：拖动时页面始终水平居中、只缩放；背景 Today 页糊成色块；缩到约 0.85 直接飞回。
- 位置锁定：`pose = { scale, radius }`，不再有 `tx/ty`；`finishDrag` 里把姿态换算成 hero 矩形时矩形以屏幕中心为准。
- 自动返回：拖动分支每帧算 `scale`，越过 `CLOSE_SCALE` 就调 `finishDrag()`，`phase='settling'` 之后的 move 全被忽略。
- 背景：`CardExpand` 不碰别人的节点，只 `emit('blur', px)`；页面把 `px` 写成容器的 `filter`。`filter` 在 App 端不插值，
  退场（飞回 / 回弹）由 `fadeBackdrop` 以 40ms 一步线性归零。

**被否的备选**：用 `<glass-surface>` 铺在故事页后面做模糊（用户否决，见 specs/222）；让 `CardExpand` 直接去改 Today 页面节点的样式（跨组件耦合）。

## 4. 风险
1. Web 上 `filter` 会让容器成为其 fixed 后代的包含块：`CardExpand` 必须在被模糊容器之外（已是）。
2. 逐帧改 `filter` 在 App 上的成本：整页 `ImageFiltered` 重新合成。模拟器可接受，真机未测。
3. 阈值 0.85 是录屏估计；到达阈值瞬间手指还在拖，之后的 move 被忽略（不会反向拉回）。

## 5. 验证路径
```bash
pnpm --filter app-store-clone run typecheck
# web：脚本化 pointer 事件，读 pose / filter 的 style
# iOS：fjs run ios，touch_path 慢拖 + 后台 simctl 连拍
```
