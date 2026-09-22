# Plan: 092-devtools-live

对应 spec：`./spec.md`。改动三层，无协议增量。

## 层与文件

### 运行时（packages/fjs-runtime）——树版本 + cmd 面

1. `src/devtools-hooks.ts`：+`devtoolsTreeVersion` 常量对象 `{ value: 0 }`
   （零导入模块，host.ts 可安全引用）。
2. `src/host.ts` `flushNow()`：帧真正发出（`sink(frame)`）后 `value++`。
   位置是刻意挑的：一切 UI 变更（element API / Vue renderer / 组件包）
   的唯一汇聚点，随帧批计一次，不逐 op。
3. `src/devtools.ts`：
   - `cmd()` +`Dom.version` → `{ version }`；
   - `styleCmd()` +`exists: provider 存活判定`；
   - `version` 字面量更新。

### CLI（packages/fjs）——consoleLine + 活树轮询

4. `src/debug/cdp-server.ts`：
   - DevTools 连接即发合成 `Runtime.executionContextCreated`
     （"fjs host"，固定 id）；
   - `CdpRelay` 接口 +`consoleLine(level, text)`：eval-echo 过滤 →
     `Runtime.consoleAPICalled`（level→type 映射）；
   - Dom.version 轮询（500ms，会话存活期）：变更 → `DOM.documentUpdated`；
     未知 cmd 一次即停（旧运行时降级）；vm 换人重置基线；
   - `debug-reload` 拦截点顺手推 `DOM.documentUpdated` 并重置基线；
   - `CSS.get*StylesForNode` 应答 `exists===false` → 补推 documentUpdated；
   - `getMatchedStylesForNode` 恒回 inlineStyle（空也回）。
5. `src/commands/debug.ts`：tool 链接 `onLink` 挂 message 监听，
   `{fjs:'log'}` → `relay.consoleLine`（tool-conn 的 socket 原样可用，
   server 端零改动）。

### Dart（packages/flutter_fjs）——日志双写接全

6. `lib/src/engine.dart`：内部日志点 `onLog?.call(...)` → `_log(...)`
   （`_log` = onLog + dev socket 双写，native console 线已走它）。
   机械替换约 28 处，`_log` 自身与 trampoline 不动。

## 测试

7. `packages/fjs-runtime/test/devtools.test.ts`：Dom.version、styleCmd
   exists、帧落地版本号递增。
8. `packages/fjs/test/debug-cdp.test.ts`：consoleLine 合成/过滤/映射、
   轮询 → documentUpdated、未知 cmd 降级、debug-reload 推送、
   exists 自愈、matched 空样式也回 inlineStyle。

## 顺序

1 → 2 → 3 → 7（运行时闭环）→ 4 → 5 → 8（CLI 闭环）→ 6（Dart）→
typecheck + 全量 vitest → dist 重建 → 桌面探针验证 → 文档。

## 风险

- 轮询 evaluate 与 Network.drain 并行：同一通道、既有节奏，PrimJS
  断点期可用已被 089 验证；失败路径全部吞掉并降级。
- DevTools 对 documentUpdated 的反应是整树重拉 + 丢选中：HMR 后
  重新点开节点是可接受代价（内容本来已变）。
- 合成上下文 id 与引擎上下文 id 撞号：引擎 id 从小整数分配，固定取
  大常数避开。
