# Tasks: 事件首参按「web 组件是否 emit 该事件」判定

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表零变更（`ops.ts`/`ui_ops.dart`、`native-global.d.ts`/`natives.cpp`、`element.ts EventType`/`fjs.h`）——本 spec 不动它们
- [x] T002 新增 JS 内部契约表 `packages/fjs-runtime/src/event-emits.ts`：`WEB_EMITS` 与 `emitsFor(tag)`（小写 Set，无条目→空），顶部注释写清判定依据与方案 A 取舍

## 实现

- [x] T010 `packages/fjs-runtime/src/vue/renderer.ts`：`payloadEventTags` WeakSet 改为 `payloadEvents` WeakMap（createElement 时按 rawTag 记 `emitsFor`，仅 fjs 标签）
- [x] T011 `packages/fjs-runtime/src/vue/renderer.ts`：`patchProp` 用 `parseEventName` 后的 prop 名（去 `on`、小写）查表决定 `rawPayload`，改写相关注释

## 两端对齐

- [x] T020 Web 侧：确认 `packages/fjs-runtime/src/web/components/*.ts` 零改动（参照物），`fjsComponents` 的 emits 与表一致
- [x] T021 两端对拍：单测里对同一模板断言 Flutter 首参形状与 web 语义一致（emit 事件→裸载荷，`@click`→事件对象）

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/event-emits.test.ts`：漂移测试（每个 web 组件 `emits` == 表；表 key 都存在于 `fjsComponents`）
- [x] T031 `packages/fjs-runtime/test/flutter-event-payload.test.ts` 追加：`view`/`button`/`image` 上 `@click.stop` 调到 fn 不抛错；`view @click` 首参含 target/clientX；`view @tap` 首参 null；`onScrollToUpper`/`onLongPress` 走裸载荷
- [x] T032 原有 103 用例原样通过

## 文档

- [x] T040 更新 `docs/ui-api.md` 的「首参形状」段：按事件是否在 web emits 中判定
- [x] T041 `docs/roadmap.md` 登记 specs/104

## 验收

- [x] T050 `pnpm run typecheck`（含 demo、hello-fjs）——runtime / cli / webview / spine / webgl / racing 通过；demo（5 处）与 hello-fjs（3 处）报模块标签 `icon-mind` / `web-view` 的 TS2339，干净 HEAD 上错误完全相同，属既有问题、与本 spec 无关
- [x] T051 `pnpm test`——runtime 678、cli 339、webview 36、webgl 30 全过
- [x] T052 spec.md 第 6 节逐条核对（设备观测项在本环境无 Flutter，记为待验）
