# Plan: 调试通道鉴权

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否（页面能力） | dev WS 协议两侧同步：CLI `dev/server.ts` + `dev/debug-relay.ts`，Dart `lib/src/dev_client.dart`。 |
| II 边界即契约 | 否 | 三张表不动；`fjs_vm_debugger_attach` 签名不变，预编译产物不用重建。 |
| III 同步单线程零序列化 | 否 | token 写入是一次同步 `evalSource`；质询走既有 CDP 通道。 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 质询失败、tool 被拒都打日志说明原因与出路（升级 flutter_fjs / `--remote-tools`）。 |
| VI 注释记录权衡 | 是 | 写清：为何质询走 `Runtime.evaluate`（不动 native）、为何豁免回环、为何 token 不比 dev server 边界更强。 |
| VII JS 能包就不要下 Dart | 部分 | Dart 侧只改 dev 通道解析和拨号前一次求值，不新增能力。 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`（fjs dev / fjs debug 小节）、`packages/fjs/src/cli.ts` 帮助、`docs/roadmap.md`。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI | `packages/fjs/src/dev/net-trust.ts`（新增） | `isLoopbackAddress`（127/8、`::1`、`::ffff:127.x`）、`DEBUG_TOKEN_RE` |
| CLI | `packages/fjs/src/dev/server.ts` | 连接时记下对端地址；`tool` 仅回环或 `--remote-tools`；`eval`/`perf`/`debug-relay` 要求发送者是已登记 tool；`debug-relay` 带 token |
| CLI | `packages/fjs/src/dev/debug-relay.ts` | `open(owner, port, token?)`，greeting / 广播 `debug on <port> <token>` |
| CLI | `packages/fjs/src/commands/debug.ts` | `randomBytes(16)` 生成 token，传给 relay 与 dev server |
| CLI | `packages/fjs/src/debug/cdp-server.ts` | `token?` 选项：非回环 VM 先质询，通过才占槽；挂起上限 4、超时 5s；`trustLoopback` 测试开关 |
| CLI | `packages/fjs/src/cli.ts` | 帮助加 `--remote-tools` |
| Dart | `packages/flutter_fjs/lib/src/dev_client.dart` | 解析可选 token；`onDebugAttach(port, token)` |
| Dart | `packages/flutter_fjs/lib/src/engine.dart` | 记住 token，每次拨号前 `globalThis.__fjsDebugToken = "<token>"` |
| 测试 | `packages/fjs/test/debug-cdp.test.ts`、`debug-relay.test.ts`、`net-trust.test.ts`（新增）、`packages/flutter_fjs/test/dev_client_test.dart` | 见 spec §6 |
| 文档 | `docs/toolchain.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

- **质询而非握手行**：让 VM 在连接后主动发一行 token 需要改 C++ transport 与 C ABI 并重建所有平台产物；
  relay 已经能对 VM 发 `Runtime.evaluate` 并按保留 id 取回结果（`vmEval`），所以反过来由 relay
  问 VM 要 `globalThis.__fjsDebugToken`。质询 id 用独立保留段（≥ 2e9），与桥接求值（≥ 1e9）区分。
- **挂起连接不占槽**：`vm` 只在认证通过后赋值，冒充者无法再用「先连先得」把真 App 挤掉。
- **回环豁免**：`fjsrun` 不经 dev server 拿不到 token；Android 走 `adb reverse`，对端地址即回环。
  本机进程本就能直接连无鉴权的 DevTools 端口，豁免不扩大暴露面。
- **tool 限回环**：`fjs log/eval/debug` 默认连 127.0.0.1；跨机器是少数用法，改为显式 `--remote-tools`。
- token 只有十六进制字符，拼进 JS 字符串字面量无注入风险；Dart 侧仍按正则校验后才使用。

**被否掉的备选**：
- relay 的 VM 端口改绑 127.0.0.1：物理 iOS 设备走局域网就连不上了。
- 用 dev server 的 WS 转发 CDP、取消独立 TCP 端口：改动面大，且要改 native transport。
- token 放进 `fjs_vm_debugger_attach` 的 host 参数里夹带：hack，且仍要改 native 解析。

## 4. 风险

- 引擎处理 `Runtime.evaluate` 的时机：现有 DOM 桥接已依赖它在正常运行时应答，风险低；真机验收项覆盖。
- Dart 改动在本环境无法编译运行，`dev_client_test.dart` 与真机项需用户执行。
- 从另一台机器用 `fjs log --host` 的用户需要加 `--remote-tools`，属行为变化，写入文档与拒绝提示。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli exec vitest run test/debug-cdp.test.ts test/debug-relay.test.ts test/net-trust.test.ts
pnpm --filter @ufjs/cli test && pnpm --filter @ufjs/cli run typecheck
cd packages/flutter_fjs && flutter test test/dev_client_test.dart   # 用户本机
```
