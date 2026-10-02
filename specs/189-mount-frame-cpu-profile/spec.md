# Spec: 挂载帧的函数级归因与下刀（profile 驱动）

- **ID**: 189-mount-frame-cpu-profile
- **状态**: in-progress
- **日期**: 2026-10-02

## 1. 要解决什么

specs/188 后，克隆挂载的 show 上屏（~152ms）剩三段：JS ~30ms、**挂载帧
76–106ms**、两个 vsync 间隙。挂载帧 = LAYOUT 71–99（内嵌 BUILD 58–73）+
PAINT ~5——与 hello-fjs 优化后的 VDOM/Vapor（~83ms）持平，是三条渲染路径
共享的前沿。phase 级拆账（frame-timeline）到此为止：BUILD 里面是 widget
分配、FjsStyle 查找、Element 膨胀还是 GC，span 看不见。

## 2. 不做什么（Non-goals）

- 不重写渲染器 / widget 共享这类大 refactor（除非 profile 指着它）。
- 不动 update2000 的 TextPainter 重排版（另一条账）。

## 3. 用户可见的行为

- 新工具 `packages/flutter_fjs/tool/cpu-profile.mjs`：窗口期 CPU 采样按
  函数聚合（self / inclusive 两列），与 frame-timeline 互补。
- 按归因结果做的优化（以实际 profile 为准，当前候选：
  按 interned style 缓存 Decoration 等每节点重复分配）。

## 4. 两端约定（宪法 I）

纯 Dart 渲染侧 + 工具，不涉及页面能力。web 不适用（无 Flutter 渲染管线）。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. cpu-profile.mjs 能给出挂载帧窗口的函数级分布。
2. 优化以 profile 为据；真机 frame-timeline 复测挂载帧下降，改 1 格读数
   不回退。
3. `pnpm test` 通过。

## 7. 待澄清

- 无。
