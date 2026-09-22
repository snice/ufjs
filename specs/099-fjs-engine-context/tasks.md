# Tasks: DevTools 上下文名改为 fjs engine

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不改 `ops.ts` / `ui_ops.dart`、`native-global.d.ts` / `natives.cpp`、`element.ts` / `fjs.h`

## 实现

- [x] T010 `packages/flutter_fjs/native/primjs/src/inspector/debugger_struct.h`：`V(debugger_context, …)` 改为 `"fjs engine"`
- [x] T011 `packages/fjs/src/debug/cdp-server.ts`：注释里的引擎上下文名改为 `fjs engine`

## 两端对齐

- [x] T020 确认 Web 不走 PrimJS inspector 上下文，无 web 侧改动
- [x] T021 确认 `fjs host` 的合成上下文名与 id 424242 不变

## 测试

- [x] T030 检索现行源码：除 `specs/088-devtools-debugger/` 与 `specs/092-devtools-live/` 外不再出现 `fjs console`
- [x] T031 增量 `cmake --build packages/flutter_fjs/native/build-native -j`，确认 inspector 重编通过

## 文档

- [x] T040 `packages/flutter_fjs/native/primjs/VENDORED.md` 与 `docs/debugger.md` 的现行名字改为 `fjs engine`
- [x] T041 `docs/roadmap.md` 记下这次改名

## 验收

- [x] T050 对照 spec.md 第 6 节逐条核对
- [x] T051 spec.md 状态改为 `done`
