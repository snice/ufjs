# Tasks: 事件首参契约

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 实现

- [x] T001 `packages/fjs-runtime/src/vue/renderer.ts`：`createElement` 处按
  raw 标签是否 ∈ `FJS_TAGS ∪ FJS_COMPONENT_TAGS`（`../tags`）记入模块内
  `WeakSet`；注释写清「分类跟 web 的组件/原生分界走标签，不走事件名」。
- [x] T002 同文件 `patchProp` 的 `on*` 分支：fjs 标签 → 首参 = 裸载荷
  （对象原样），并保留 `textValues` 的 live value 记录副作用；非 fjs 标签
  → 维持 `asDomEvent`；`once` / `aliasEvent` / CANONICAL 逻辑不动。
- [x] T003 `demo/vite/vant.ts`：加 Field `onInput`、Stepper `onInput`、
  Stepper `onBlur` 三条「首参可能是字符串」的锚点补丁（feature 文案写明
  「Field/Stepper 输入（fjs input 是组件，emit 裸值）」）。

## 测试

- [x] T010 `packages/fjs-runtime/test/` 新增用例（沿用 flutter-renderer
  挂载范式）：raw 标签（`image`/`input`）上的 `@load`/`@input` handler 收到
  `typeof === 'string'` 且 `JSON.parse` 可解析的原始载荷；非 fjs 标签
  （`div`）上的 handler 收到含 `detail`/`target` 的事件对象（且
  `clientX` 可读）；`.once` 只触发一次的语义不变。
- [x] T011 既有 `list-view` 内部 `typeof payload === 'string'` 路径有覆盖
  （若既有用例已覆盖则勾掉并注明用例名）。
- [x] T012 `pnpm run typecheck`、`pnpm test` 全绿。
- [x] T013 `cd packages/flutter_fjs && flutter test` 全绿（不是
  `No tests ran`）。

## 文档

- [x] T020 `docs/ui-api.md` 事件小节补两行：fjs 标签首参=裸载荷、
  非 fjs 标签（如 div）首参=事件对象（`detail`/`target`/`clientX`），
  并注明以 web 交付为契约来源。
- [x] T021 `docs/roadmap.md` 记一条 09-19 载荷包装回归的修复。

## 验收

- [x] T030 Android 模拟器（`pnpm --filter hello-fjs run run:android`）：
  图片页 mode 面板与 load/error 面板重新出现，14 个 mode 可点。
- [x] T031 缺失本地图 desc = `error {"errMsg":"image load failed"}`、
  本地图 desc = `load 240 x 160`；flutter run 控制台无 `[vue-error]`、
  无 `[fjs/dispatch-event] SyntaxError`。
- [x] T032 设备上 `form/radio`、`form/picker`、`container/scroll-view`
  各操作一次，`JSON.parse` 载荷正常回显。
- [x] T033 demo app 构建无补丁锚点 warn；设备上 Field / Stepper 输入、
  v-model 更新正常。
- [x] T034 观测记录：flutter run 日志中 `ImageDecoder$DecodeException`
  次数与节点，回填 spec §6.6。
- [x] T035 spec.md 第 6 节逐条核对，状态改 `done`。
