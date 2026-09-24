# Spec: 调试通道鉴权——relay 的 VM 端口质询 token，dev server 的 tool 连接限回环

- **ID**: 107-debug-channel-auth
- **状态**: done（Dart 测试与真机项待用户本机验证）
- **日期**: 2026-09-24
- **来源**: 近 3 天代码 review（调试中继端口无鉴权）；排查中发现 dev server 的 tool/eval
  暴露面更大，用户决定一起修。

## 1. 要解决什么

### relay（`packages/fjs/src/debug/cdp-server.ts`）

`fjs debug` 的 VM 监听端口默认绑 `0.0.0.0:38903`，任何能连上的 TCP 客户端都被当成
「App 的 VM」，且只有一个会话槽位、先到先得：

- 局域网内任何人连上就占住槽位，真正的 App 被拒（「a second app tried to attach」）；
- 冒充的 VM 会收到开发者在 DevTools 里执行的全部命令（表达式、断点位置……），
  也能向开发者的 DevTools 伪造任意 CDP 事件；
- 冒充的 VM 发来的 `sourceMappingURL=fjs-map:<path>` 会让 relay 读开发机上任意
  `*.js.map` 文件（内容给到本机 DevTools）。

### dev server（`packages/fjs/src/dev/server.ts`）

默认绑 `0.0.0.0:38900`（手机要连）。WebSocket 上：

- 任何客户端发 `{"fjs":"tool"}` 就成为 tool；
- 更糟的是 `eval` / `perf` / `debug-relay` 分支**根本不检查发送者是不是 tool**；
- `eval <id> <source>` 会推给所有已连接的 App 执行——**局域网内任何人都能在开发者
  手机/模拟器上的 App 里执行任意 JS**；`debug-relay` 能把 App 指向任意端口。

## 2. 不做什么（Non-goals）

- **不改 native / C ABI**：`fjs_vm_debugger_attach` 签名不变，不重新编译预编译产物
  （本环境也编不了）。token 验证走 relay 已有的 CDP `Runtime.evaluate` 通道。
- 不给 App ↔ dev server 的连接加鉴权：App 本来就要从局域网连，dev server 也在对局域网
  提供源码与 bundle；它的信任边界是「能连上 dev server 的人」。本 spec 的目标是让
  relay 与 tool 通道**不比这个边界更宽**，而不是提供认证体系。
- 不加密（CDP 与 dev 通道均为明文，本地开发场景）。
- 不改 Chrome DevTools 一侧（本来就只监听回环）。

## 3. 用户可见的行为

命令不变，正常使用无感：

```bash
fjs dev                     # 或 fjs run android/ios
fjs debug                   # App 自动接上，行为与现在相同
fjs log / fjs eval …        # 本机照常使用
```

变化：

1. `fjs debug` 每次启动生成一个随机 token（128 bit），经 dev server 下发给 App：
   `debug on <port> <token>`。App 拨号前把它写进 VM 的 `globalThis.__fjsDebugToken`。
2. relay 收到**非回环**地址的 VM 连接时，先用 `Runtime.evaluate` 取这个 token，
   常数时间比对通过才占用会话槽位；失败或 5 秒无应答则断开并打日志。未通过的连接
   **不占槽位**，最多同时挂起 4 个。回环连接（本机进程、Android 的 `adb reverse`
   隧道、`fjsrun --debug-connect 127.0.0.1:…`）不质询——它们与本来就不设防的
   DevTools 回环端口处于同一信任级别。
3. dev server 只接受**回环地址**的 tool 连接；`eval` / `perf` / `debug-relay` 只接受
   来自已登记 tool 的消息。非回环 tool 被拒时，服务端打印原因并回 `{"fjs":"denied"}`。
   需要从另一台机器连（`fjs log --host <ip>`）时，启动 dev server 加
   `fjs dev --remote-tools`，启动时打印一行风险提示。
4. 旧版 flutter_fjs（不认 token）连新 relay：非回环时质询失败，日志提示升级；
   回环（Android 模拟器 / USB）照常。新 App 收到旧 CLI 的 `debug on <port>`（无 token）
   照常工作。

## 4. 两端约定（宪法 I）

不涉及页面能力；web 端没有 native 调试通道。dev 通道的文本协议在 CLI
（`dev/server.ts`、`dev/debug-relay.ts`）与 Dart（`lib/src/dev_client.dart`）两侧同步修改。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及——变的是 dev WS 文本协议：`debug on <port>` 增加可选第三段 `<token>`
      （32 位小写十六进制），两侧同步并向后兼容。

## 6. 验收标准

1. `pnpm --filter @ufjs/cli test` / `typecheck` 通过，新增：
   - relay：开启质询时，未设置/错误 token 的 VM 被断开且不占槽位，正确 token 的 VM
     之后能正常与 DevTools 互通；挂起中的冒充连接不阻塞真 App；超时断开；
   - relay：不质询时（回环）行为与现有测试一致（现有用例原样通过）；
   - `DebugRelayRegistry` 的 greeting 带 token；
   - dev server 的回环判定（IPv4 / IPv6 / IPv4-mapped）与 tool 准入判定。
2. `packages/flutter_fjs/test/dev_client_test.dart` 新增 `debug on <port> <token>` 解析用例
   ——**需用户本机 `flutter test` 执行**。
3. 真机（需用户执行）：`fjs run ios`（物理机走局域网）+ `fjs debug` 能附加并命中断点；
   Android 模拟器照常；`fjs log --host <局域网IP>` 在未加 `--remote-tools` 时被拒。
4. `docs/toolchain.md` 的 debug / dev 小节写明鉴权行为与 `--remote-tools`；`docs/roadmap.md` 登记。

## 7. 待澄清

- [x] 范围 → 用户选「relay + dev server tool 一起修」（2026-09-24）。

## 8. 验收记录（2026-09-24）

1. `pnpm --filter @ufjs/cli test`：351 通过。新增 `test/debug-auth.test.ts`（4）：正确 token
   获得会话并与 DevTools 互通；错误 token 被拒；无应答的冒充者挂起期间真 App 仍能接入、
   冒充者超时断开；挂起连接发的消息不会到达 DevTools；无 token 时行为与原来一致。
   `test/net-trust.test.ts`（3）、`test/debug-relay.test.ts` greeting 带 token（1）。
   变异检查：把 token 比对改成恒真后，「拒绝错误 token」用例失败。原有 relay 用例 19 项原样通过。
   typecheck 通过。
2. `packages/flutter_fjs/test/dev_client_test.dart` 新增 `parseDebugAttach` 用例——**未运行**
   （本环境无 Flutter），请本机 `flutter test test/dev_client_test.dart`。
3. **待用户真机验证**：物理 iOS（局域网拨号，走质询）+ `fjs debug` 附加并命中断点；
   Android 模拟器（回环豁免）照常；另一台机器 `fjs log --host <IP>` 在未加 `--remote-tools` 时
   收到拒绝原因并退出。
4. `docs/toolchain.md`（日志/求值小节与 fjs debug 小节）、`packages/fjs/src/cli.ts` 帮助、
   `docs/roadmap.md` 已更新。
