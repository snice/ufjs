# Spec: Flutter 端 canvas 2d 实现按需进包

- **ID**: 185-canvas-on-demand
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

`ui/element.ts`（element API，所有应用都带）静态引入 `canvas/surface.ts`，进而拉进 `context-registry` → `context-2d`
（10.7 KB）、`path2d`（2.8 KB）、display-list 编码等。没有用 `<canvas>` 的应用（vapor-app、demo）release 的 shared.js
也带着整套 2d 实现。

## 2. 不做什么

- 不改 canvas 的任何行为、op 协议与 web 端（web 的 canvas 是 DOM 实现）。
- 不改 `fjs` 入口导出的 canvas API（`Path2D`、`registerContextType` 等）——release 按页面实际导入收窄，用到才进包。

## 3. 行为

element 层只保留一个挂接点：`inner-canvas` 元素创建 / 移除时调用已注册的画布挂接函数。`canvas/surface.ts` 被引入时
把自己注册进去；Flutter 端两处 canvas 组件注册（vapor 的 `tags/flutter/canvas.ts`、VDOM 的 `app/flutter.ts`）引入它。
用了 `<canvas>` 的页面行为不变；没用的应用不再打包 2d 实现。没注册就创建了 `inner-canvas`（直接写内部标签）时告警一次。

## 4. 两端约定

只涉及 Flutter 端包体；web 不变。

## 5. 契约变更

- [x] 都不涉及

## 6. 验收标准

1. vapor-app release shared.js 不含 `canvas/context-2d.ts`；hello-fjs 的 canvas 页（两种模式）照常绘制。
2. canvas 相关单测全部通过；新增：未注册时创建 `inner-canvas` 告警、注册后挂接。
3. `pnpm test`、`pnpm run typecheck` 通过。

## 7. 待澄清

- 无

## 8. 实现记录

- `ui/element.ts`：去掉对 `canvas/surface` 的静态引入，改为 `setCanvasHooks()` 挂接点；未注册时创建 `inner-canvas` 告警一次。
- `canvas/surface.ts`：引入时注册挂接函数与 Flutter 的 2d 工厂；`canvas/context-registry.ts` 不再引用 context-2d，web 的
  DOM canvas 走浏览器原生 `getContext('2d')` 兜底。
- `vapor/tags/flutter/canvas.ts`、`app/flutter.ts` 引入 `canvas/surface`。测试辅助 `test/helpers/canvas.ts` 同样引入。
- 结果：vapor-app release shared.js 225.0 → 204.6 KB（字节码 663 → 607 KB）。iOS 上 hello-fjs 的 canvas / webgl 页
  VDOM 与 vapor 两种模式均正常。测试 `test/canvas-on-demand.test.ts`。
