# Spec: 4050 屏克隆挂载对照 + 节点级 repaintBoundary

- **ID**: 188-clone-mount-repaint-boundary
- **状态**: ready
- **日期**: 2026-10-02

## 1. 要解决什么

specs/187 修好仪器后，真机 profile 的剩余账目（specs/187/tasks.md）：

1. **element 层 57–66ms**（show 的 JS 段主体）：4050 次逐节点
   `create/ensure/setClasses/insert/setText` + JS 簿记 + op 编码。runtime 已有
   native 模板克隆（`defineCloneTemplate` / `cloneMany`，specs/152/162，
   Vapor 在用）：模板注册一次，50 份实例一条 CLONE_MANY op 由 libfjs-style
   展开，JS 侧只剩 id 分配和句柄记账。4050 网格的初始内容是 50 行**完全相同**
   的 0..39——模板=一行（81 节点），一条 op 挂整棵树。
2. **PAINT 整层重录 20–25ms**（改 1/200 格的帧内大头）：格子无 repaint
   boundary，任何一格变化都重录整个可见视口的显示列表。需要节点级
   `RepaintBoundary`——这是 Flutter 合成原语，必须下 Dart（宪法 VII 的例外），
   做成 opt-in prop。

## 2. 不做什么（Non-goals）

- 不改 CLONE_MANY / 样式 op 协议（能力已存在，宪法 II 无涉）。
- 不做 Dart 侧模板批量建 widget（克隆后镜像树同构，挂载帧 BUILD 仍逐个；
  先量 JS 段收益，Dart 侧另行评估）。
- 不动 update2000 的 TextPainter 重排版、raster glyph atlas（记录在案）。
- 不给 web 补 repaintBoundary（web 基质是真 DOM + 浏览器合成器，无需对应物；
  纯 element API 的 hello-js 本就不跑 web）。

## 3. 用户可见的行为

4050 屏多一排模式切换（复用 hello-fjs 的 .modes/.mode 样式）：
「逐个 | 克隆」。克隆模式在 `engine.canClone`（native 样式引擎已 attach）时
走 `cloneMany`：模板=一行 81 节点（row + 40×(cell+text)，静态文本 0..39），
`allocIds(81*50)` 预分配 id，一条 op 挂载，`adoptElement` 补 JS 句柄供 bump
逐格 setText。不可克隆（TS 引擎）时回退逐个并 warn 一次。

Flutter 侧新增 opt-in prop（camelCase，同 htmlBlock 先例）：

```ts
setProps(row, { repaintBoundary: true });   // 该节点自成一层的显示列表
```

改行内任一格只重录该行；其余 49 行的层缓存复用。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| repaintBoundary | 节点自成 RepaintBoundary 层 | 无操作（浏览器合成器自管层）；`docs/ui-api.md` 登记 |
| 克隆挂载 | CLONE_MANY，libfjs-style 展开 | 不适用（native 样式引擎不存在；屏幕回退逐个） |

## 5. 契约变更（宪法 II）

- [ ] op 协议 / natives 表 / 事件类型：都不涉及（props JSON 布尔值、既有
  CLONE op；index 新增 `adoptElement` / `allocIds` 两个导出——element.ts 本就
  导出的公开函数，host-ops 一直在用）。

## 6. 验收标准

1. `pnpm --filter hello-js run build` 通过；`pnpm test` 通过。
2. 离线 fjsrun：engine 行 native；克隆模式回退逻辑不炸。
3. 真机 profile：克隆模式的 show——「其余」（element 层）显著低于逐个的
   57–66ms；改 1 格的帧 PAINT 从 ~25ms 降到个位数（frame-timeline 验证）；
   两个模式的网格渲染一致（背景色、字号、bump 文本变化）。
4. tab 切换（主题压测 ↔ 4050）来回多次，两屏样式正常（二次 attach 路径）。

## 7. 待澄清

- 无。
