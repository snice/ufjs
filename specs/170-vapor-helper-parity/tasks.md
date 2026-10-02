# Tasks: vapor 运行时补齐 compiler-vapor 的 helper 与组件层能力

对应 plan：`./plan.md`。

## 契约层

- [x] T001 确认不涉及 op / natives / 事件类型
- [x] T002 VaporBackend 可选成员（`vapor/host.ts`）

## 实现

- [x] T010 `vapor/host.ts`：监听多路分发、class 分层、showHost/setStyleHost、withOnce、createKeyedFragment/setBlockKey、createForSlots、onReset、锚点登记
- [x] T011 `vapor/helpers.ts`：中立 helper 全集
- [x] T012 `vapor/runtime.ts` / `instance.ts`：props/attrs/emits、透传、expose、作用域插槽、动态插槽、模板 ref、指令、动态原生标签、内置组件降级、useAttrs
- [x] T013 `backend-flutter.ts` / `web-dom.ts`：后端成员、DOM choice model、DOM 修饰符
- [x] T014 入口导出（index / flutter-pure / web-dom / vue-shim / vue-pure）
- [x] T015 `sfc-compiler.ts`：空 `<script setup vapor>` 防重复注入

## 两端对齐

- [x] T020 web 与 Flutter 各一组行为测试对拍同一批写法

## 测试

- [x] T030 守护测试（Flutter 入口 / web 入口各一文件）
- [x] T031 `vapor-helpers-web.test.ts`（11 条）
- [x] T032 `vapor-helpers-flutter.test.ts`（3 条）

## 文档

- [x] T040 `docs/vue3.md` vapor 支持矩阵；`docs/vapor-contract.md` 后端可选成员

## 验收

- [x] T050 typecheck / test
- [x] T051 bench / demo vapor-check / nav-vapor / vapor-app check / web 冒烟
- [x] T052 spec §6 逐条核对，状态 done
