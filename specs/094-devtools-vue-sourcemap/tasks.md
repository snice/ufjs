# Tasks: 094-devtools-vue-sourcemap

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 实现

- [x] T010 `vue-plugin.ts`：sourceMap 时拼 script + template mappings，sourcesContent 为 SFC 原文
- [x] T011 `build.ts`：`sourcemap` 选项、external map、`fjs-map:` 注释、单元 +1 行
- [x] T012 `dev/server.ts`：flutter dev 构建传 `sourcemap: true`
- [x] T013 `cdp-server.ts`：`fjs-map:` 内联 data URL，只读 `.js.map`
- [x] T014 `engine.dart`：单元 / shared / units 的 eval 文件名与源路径错开

## 测试

- [x] T030 插件：script 行与 template 行都映回 .vue
- [x] T031 构建：有标志才出 map，shared.js 不出，sourcesContent 是原文
- [x] T032 中继：data URL 可解码；非 `.js.map` 不读

## 文档

- [x] T040 `docs/debugger.md`、`docs/toolchain.md`、`docs/web.md`
- [x] T041 `docs/roadmap.md`

## 验收

- [x] T050 `pnpm --filter @ufjs/cli run typecheck`
- [x] T051 `pnpm --filter @ufjs/cli test`
