# Plan: 169-vapor-logical-anchor

## 改动

1. `fjs-runtime/src/vapor/host.ts` `setInsertionState`：`typeof anchor === 'number'`
   → `insertionAnchor = null`，注释写清 Vue 语义与编译器为何只在末尾发数字。
2. 删除 `VaporBackend.childAt` 声明与 `backend-flutter.ts` / `web-dom.ts` 两份实现
   （无其他调用方；`childElementIds` / `elementById` 的 import 若因此无用一并清掉）。
3. 测试：`test/helpers/vapor-insertion-cases.ts` 放共享用例；
   `test/vapor-insertion-web.test.ts`（happy-dom，DOM 后端）；
   `test/vapor-own.test.ts` 增加 Flutter 侧用例（文本顺序 + 与 VDOM 快照对比）。

## 顺序

先写测试确认失败 → 改 host.ts → 删 childAt → 跑全量测试 + vapor bench。
