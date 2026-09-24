# Plan: web 鼠标拖动滚动尊重 touchmove 的 preventDefault

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 只 web 错；App 侧 overlay 不在滚动容器内 |
| II 边界即契约 | 否 | — |
| III | 否 | — |
| IV | 否 | — |
| V 静默失效是 bug | 是 | 补单测 |
| VI 注释记录权衡 | 是 | 注释写为什么用捕获 + 派发后检查 |
| VII | 否 | 本来就是 JS（web 适配层） |
| VIII 文档 | 否 | 行为向浏览器语义靠拢，无新契约 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Web 适配层 | `packages/fjs-runtime/src/web/components/gestures.ts` | `dragPanBindings` 加 `onTouchmoveCapture`：拖动中收到 touchmove，派发结束后（微任务）若 `defaultPrevented` → 撤回 scroll、释放 capture、结束本次拖动 |
| 测试 | `packages/fjs-runtime/test/web-drag-pan.test.ts`（新） | 见 spec §6.1 |

## 3. 方案

捕获阶段：vant 在 touchmove 里 `stopPropagation`，冒泡到不了 scroll-view。
派发后检查：捕获时页面监听还没跑，`defaultPrevented` 未定；微任务在派发它的
监听（模拟器的 mousemove）返回后、绘制前执行，撤回不会被画出来。
pointermove 先于 mousemove → 模拟 touchmove，所以第一步可能已滚了几像素，撤回即可。

否掉：让 dragPan 看 pointermove 的 `defaultPrevented` —— 页面阻止的是 touch 事件，
pointer 事件对它不可见；在 `@vant/touch-emulator` 上打补丁 —— 那是第三方代码。

## 4. 风险

- 页面在 touchmove 里只在部分帧阻止（vant lock-scroll 到边界才阻止）：一旦阻止就
  放弃整个拖动，与手机上"首个 touchmove 被阻止则整次手势不滚"接近。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime test
# 浏览器 localhost:5175/#/vant-nav 复测
```
