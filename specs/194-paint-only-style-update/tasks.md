# Tasks: 「只改绘制」的样式更新快路径

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。
分支 `194-paint-only-style-update`（基于 `193-flat-display-surface`，合并顺序 193 → 194）。

## 契约层

- [x] T001 确认不动三张表：`git diff --stat 193-flat-display-surface` 里没有 `ops.ts` / `ui_ops.dart` / `natives.cpp` / `native-global.d.ts` / `fjs.h` / `element.ts`

## 测量（已完成）

- [x] T010 `test/theme_switch_bench_test.dart`：1000 行主题切换负载，阶段拆分、节点 build 数、纯 layout 对照
- [x] T011 数据写入 spec.md「结论」，选层（候选 ①）

## 实现

- [x] T020 `render/paragraph.dart`：`RenderFjsParagraph.recolorPaintOnly(span)`（同键宽度换共享 painter、校验尺寸、只 `markNeedsPaint`）；`test/shared_paragraph_test.dart` 仍绿，并加「只改颜色不触发祖先 layout」一例
- [x] T021 `widgets/text.dart`：`FjsTextEnvData.peek(context)`（不登记依赖）
- [x] T022 `render/paint_only.dart`：分类（键白名单、回退原因枚举、`FjsStyleEntry.paintOnlyTo` 记忆）、`applyPaintOnly(node)`（下探找 `RenderDecoratedBox` / `RenderFjsParagraph`）、`FjsPaintOnlyStats`、开关 `fjsPaintOnlyEnabled`（`FJS_PAINT_ONLY` dart-define）与 dev 宿主函数 `fjs.dev.paintOnly`（release 不注册）；`engine.dart` 注册
- [x] T023 `mirror_tree.dart`：`MirrorNode.paintHook` / `pressed`；`SET_STYLE` 分类并记入 `_paintOnly`（不标节点与父节点）；`flushDirty` 先处理 `_paintOnly`（已脏跳过、钩子失败回退 `_touch`）
- [x] T024 `render/renderer.dart`：`_FjsNodeViewState` 注册 / 注销钩子；`_PressedNode` 带 `node`、同步 `pressed`
- [x] T025 `examples/hello-js/src/theme-bench.ts`：`__themeBench.setPaintOnly('on'|'off')`

## 两端对齐（宪法 I）

- [x] T030 Web 侧：**不适用**（浏览器自己决定重绘范围）。在 spec.md「两端约定」下补验证记录：`git diff` 无 `packages/fjs-runtime`、`packages/fjs` 改动；`pnpm test` 通过
- [x] T031 两路径对拍（Flutter 快路径开 / 关）：见 T040

## 测试

- [x] T040 `test/paint_only_test.dart`：分类单测（每个回退原因一例）+ 对拍（plan §5 的 fixture 列表，逐节点矩形 + 逐像素）+ 多次切换 / 切回 + 穿过 flat 子树
- [x] T041 节点 build 计数：4000 节点只改颜色后 `FjsNodeRenderer.buildCount` ≤ 节点数的 10%（按实测校准写回 spec §6.3）；混有布局变化的更新照旧重建
- [x] T042 `test/theme_switch_bench_test.dart` 加 off / on 两臂，各 ≥12 轮 min / med / max；整帧 on ≤ off 的 50%（校准后写回 spec §6.5）
- [x] T043 `flutter test` 全量；`render_bench_test` / `mount_bench_test` 与改动前同机对照不回退

## 文档（宪法 VIII）

- [x] T050 `docs/architecture.md`「重建粒度」补「只改绘制」路径（判定、回退条件、关键文件、开关）
- [x] T051 `docs/performance.md`：主题切换数据与方法（离线 + 模拟器），标注「真机待复核」
- [x] T052 `docs/roadmap.md` 打勾

## 验收

- [x] T060 `pnpm run typecheck`、`pnpm test`
- [x] T061 `flutter test` 全量（native 已编译）
- [x] T062 模拟器对照（iPhone 17 Pro，debug，`scroll-view` 与 `list-view` 两种容器）：hello-js 主题压测屏 4000 节点切主题，快路径开 / 关各 ≥4 轮最慢帧；`FjsPaintOnlyStats` 读 applied / fallbacks；画面开 / 关截图比对
- [x] T063 `git diff --stat 193-flat-display-surface` 确认只含本 spec 预期路径（plan §2 表）
- [x] T064 spec.md 第 6 节逐条核对，状态改 `done`；「结论」节标注「真机待复核」并列出要复测的读数
