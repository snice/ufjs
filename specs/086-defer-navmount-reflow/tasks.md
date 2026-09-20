# Tasks: navMount 期间推迟同步 layout

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 无——三张契约表零变更（spec 第 5 节已勾「都不涉及」）。

## 实现

- [x] T010 `packages/flutter_fjs/lib/src/geometry.dart`：可重入
      `runWithoutGeometryReflow`；`fjs.ui.rect` 在窗口内跳过 `_reflow`。
      注释写清 navMount vs specs/073。
- [x] T011 `packages/flutter_fjs/lib/src/engine.dart`：`_mountWhenReady` 里
      `dispatchEvent(navMount)` 包进 T010 的窗口。

## 两端对齐

- [x] T020 Web 无对应实现（浏览器没有这次 `flushLayout`）。`docs/web.md`
      已知差异登记 App 端仅 navMount 窗口内推迟重排。

## 测试

- [x] T030 `packages/flutter_fjs/test/vant_layout_test.dart`：窗口内对尚未
      build 的节点读 rect 为 null；关闭窗口后同一节点强制重排读到高度。
      既有 073 两条「同一 tick 改树再读」保持绿。
- [x] T031 `cd packages/flutter_fjs && flutter test test/vant_layout_test.dart`

## 文档

- [x] T040 `docs/ui-api.md`：rect / offset* 在 navMount 窗口 vs 页面已挂上。
- [x] T041 `docs/vant-mount-perf.md` + `docs/performance.md`：首开剩余从
      「GC/JS 树」改成「navMount 内一次 flushLayout」，并记下本 spec。
- [x] T042 `docs/threading-model.md`：转场窗口补一句 navMount 不再同步
      layout。
- [x] T043 `docs/roadmap.md` 记一笔完成项。

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对（含模拟器 `[nav] mounted` 量级）
      typecheck 通过；pnpm test 通过（webview AbortError 噪声、用例全绿）；
      `flutter test` 473 通过 / 3 跳过；vant_layout_test 073 两条 + 086 两条绿。
      模拟器 vant-form `[nav] mounted` **98ms**（改前 249–267ms）。
