# Tasks: 调试通道鉴权

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 dev WS 协议：`debug on <port> [<token>]`（token 为 32 位小写十六进制，可选、向后兼容）；三张跨边界表零变更
- [x] T002 新增 `packages/fjs/src/dev/net-trust.ts`：`isLoopbackAddress`、`DEBUG_TOKEN_RE`

## 实现

- [x] T010 `packages/fjs/src/dev/debug-relay.ts`：registry 携带 token，greeting 带 token
- [x] T011 `packages/fjs/src/dev/server.ts`：tool 限回环 + `--remote-tools`；`eval`/`perf`/`debug-relay` 要求已登记 tool；`debug-relay` 转发 token
- [x] T012 `packages/fjs/src/debug/cdp-server.ts`：非回环 VM 质询 token；挂起不占槽、上限 4、超时 5s
- [x] T013 `packages/fjs/src/commands/debug.ts`：生成 token 并传递
- [x] T014 `packages/fjs/src/cli.ts`：帮助文本 `--remote-tools`

## 两端对齐

- [x] T020 Dart `packages/flutter_fjs/lib/src/dev_client.dart`：解析可选 token
- [x] T021 Dart `packages/flutter_fjs/lib/src/engine.dart`：拨号前写 `globalThis.__fjsDebugToken`

## 测试

- [x] T030 `packages/fjs/test/net-trust.test.ts`（新增）：回环判定
- [x] T031 `packages/fjs/test/debug-relay.test.ts`：greeting 带 token
- [x] T032 `packages/fjs/test/debug-cdp.test.ts`：质询通过 / 失败 / 超时 / 冒充不占槽；原有用例不变
- [x] T033 `packages/flutter_fjs/test/dev_client_test.dart`：token 解析（用户本机运行）

## 文档

- [x] T040 `docs/toolchain.md`：dev / debug 小节写明鉴权与 `--remote-tools`
- [x] T041 `docs/roadmap.md` 登记 specs/107

## 验收

- [x] T050 `pnpm --filter @ufjs/cli run typecheck`、`pnpm run typecheck`（demo / hello-fjs 既有 TS2339 除外）——6 个包 Done
- [x] T051 `pnpm test`——cli 351（新增 8）、runtime 678、webview 36、webgl 30 全过
- [x] T052 spec.md 第 6 节逐条核对；Dart 与真机项标为需用户本机验证
