# Plan: 去掉 dev units

- **ID**: 095-drop-dev-units
- **日期**: 2026-09-22

## 宪法自查

| 条 | 是否触及 | 说明 |
| --- | --- | --- |
| I 两端同源 | 否 | dev 通道。web 仍整页刷新。 |
| II 三张契约 | 否 | 只收 WS 文本协议，见 spec §5。 |
| III 单线程 | 否 | 少一次热替换路径。 |
| VII JS 能包 | 否 | 删除 Dart 侧 `_hotSwapUnits`，不新增渲染。 |
| VIII 文档 | 是 | toolchain、code-splitting、debugger、roadmap、website。 |

## 改哪些文件

1. `packages/fjs/src/bundler/build.ts` — 删除 unit 构建、`units` 选项、`DevUnitsInfo`。共享 chunk 在 dev sourcemap 打开时同样盖章。
2. `packages/fjs/src/bundler/vue-plugin.ts` — stub 只走 `__FJS_SHARED`。`projectSource` 丢掉 `node_modules`。
3. `packages/fjs/src/dev/server.ts` — 不再协商 units，不提供 unit 路由。`changeMessage` 只认页面或整包。
4. `packages/fjs-runtime` — 删除 `dev-units.ts` 及其导出和测试。
5. `packages/flutter_fjs` — 引擎不再拉 `/units.js`、不再热替换 unit。`reload units:` 解析为整包。
6. 文档见上表。

## 顺序

先 CLI 构建与 server（测试能红），再 runtime 与 Dart，最后文档。
