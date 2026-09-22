# Spec: DevTools 上下文名改为 fjs engine

- **ID**: 099-fjs-engine-context
- **状态**: done
- **日期**: 2026-09-22

## 1. 要解决什么

`fjs debug` 连上 Chrome DevTools 后，控制台的 JavaScript 上下文下拉里，引擎自己的那一项叫 `fjs console`。它和旁边合成的 `fjs host` 叠在一起，读起来像两个 console，看不出这一项是 JS 引擎。

名字来自 vendored PrimJS 字面量池：`Runtime.enable` 时若没有可用的 `debugger_name`，`HandleRuntimeEnable` 用 `literal_pool.debugger_context` 作为 `Runtime.executionContextCreated` 的 `name`。088 把上游的 `debugger context` 改成了 `fjs console`，并且明确不用 `SetJSDebuggerName`——GC 关闭期设置的字符串活不到 `Runtime.enable`。

## 2. 不做什么（Non-goals）

- 不改 `fjs host`（id 424242，中继合成的 Dart 日志上下文）。
- 不合并两个上下文，不改 Console 日志的归属。
- 不改历史 spec（088 / 092）里对当时名字的记录。
- 不引入 `SetJSDebuggerName` 运行期改名。
- 不改 web 构建：浏览器 DevTools 不走这条 CDP 上下文。

## 3. 用户可见的行为

`fjs debug` 打开 `devtools://…/inspector.html?ws=127.0.0.1:<cdpPort>/cdp`，控制台上下文下拉：

- 引擎项显示 **`fjs engine`**
- 宿主项仍是 **`fjs host`**

在 `fjs engine` 里求值仍进 VM；`fjs host` 仍只承载宿主日志。

## 4. 两端约定（宪法 I）

| | Flutter / 桌面 fjsrun | Web |
|---|---|---|
| 行为 | DevTools 上下文名改为 `fjs engine` | 不涉及。web 用浏览器原生 DevTools |
| 事件载荷 | 无 | 无 |
| 已知差异 | 只影响 PrimJS inspector 上报的上下文名 | 无此下拉 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

改的是 inspector 字面量池里的一个显示字符串，以及引用这个名字的现行文档与注释。

## 6. 验收标准

1. `packages/flutter_fjs/native/primjs/src/inspector/debugger_struct.h` 的 `V(debugger_context, …)` 为 `"fjs engine"`。
2. `packages/flutter_fjs/native/primjs/VENDORED.md` 与 `docs/debugger.md` 里对现行名字的描述改为 `fjs engine`。
3. `packages/fjs/src/debug/cdp-server.ts` 里对照引擎上下文的注释改为 `fjs engine`。
4. 现行实现与现行说明（`debugger_struct.h`、`VENDORED.md`、`docs/debugger.md`、`cdp-server.ts`）不再把引擎上下文叫做 `fjs console`。历史 spec 088 / 092，以及本 spec / roadmap 里对旧名的叙述除外。
5. 重新 `cmake --build` native 后，DevTools 下拉看到 `fjs engine` 与 `fjs host`。未重编的旧 `.so` / xcframework 仍会显示旧名——验收以新编引擎为准。

## 7. 待澄清

无。
