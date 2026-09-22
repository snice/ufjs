# Plan: DevTools 上下文名改为 fjs engine

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不涉及页面能力 | 上下文名只存在于 PrimJS inspector 的 CDP `Runtime.executionContextCreated`。Web 用浏览器原生 DevTools，没有这条上下文。不改 `fjs-runtime/src/web/`。 |
| II 边界即契约 | 否 | op 协议、natives 表、事件类型都不动。 |
| III 同步单线程零序列化 | 否 | 只改显示字符串，不改执行模型。 |
| IV 外观照 WeUI | 否 | 不是组件外观。 |
| V 静默失效是 bug | 是 | 旧 `.so` / xcframework 仍会报旧名。验收写明以新编引擎为准，不把「源码改了但二进制没换」当成已生效。 |
| VI 注释记录权衡 | 是 | `cdp-server.ts` 里对照引擎上下文的注释改成 `fjs engine`，说明它和合成的 `fjs host` 并列。不新开一套改名机制。 |
| VII JS 能包就不要下 Dart | 不适用 | 名字在引擎字面量池里，JS / Dart 都设不了：088 已实测 `SetJSDebuggerName` 在 GC 关闭期活不到 `Runtime.enable`。 |
| VIII 变更落到文档 | 是 | `docs/debugger.md`、`native/primjs/VENDORED.md`、`docs/roadmap.md`。历史 spec 088 / 092 不改。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/debug/cdp-server.ts` | 注释里的引擎上下文名 |
| JS runtime | — | 不改 |
| Web 适配层 | — | 不改。web 无此上下文 |
| C++ 引擎 | `packages/flutter_fjs/native/primjs/src/inspector/debugger_struct.h` | `V(debugger_context, "fjs engine")` |
| Dart 宿主 | — | 不改 |
| 文档 | `packages/flutter_fjs/native/primjs/VENDORED.md`、`docs/debugger.md`、`docs/roadmap.md` | 现行名字改为 `fjs engine` |

## 3. 方案

把字面量池里的 `debugger_context` 从 `"fjs console"` 换成 `"fjs engine"`。`HandleRuntimeEnable` 在没有 `debugger_name` 时已经用这个池项作为 `executionContextCreated.name`，不用再接一条运行期改名。

否掉的备选：

- **`SetJSDebuggerName`**：088 C1 实测，GC 关闭期设置的字符串活不到 `Runtime.enable`，下拉仍是字面量池的值。
- **中继改写引擎事件里的 name**：引擎先发自己的 `executionContextCreated`，中继再改名会和引擎上下文 id 对不上，求值仍按引擎上下文走。显示名的源头就在字面量池。
- **改历史 spec 088 / 092**：那是当时的决策记录，不是现行说明。

## 4. 风险

字面量编进 inspector 二进制。只改头文件、不重编 `fjs_debugger`（以及 App 实际加载的那份 xcframework / jniLibs），DevTools 下拉仍是 `fjs console`。本次改源头并增量重编已有的 `build-native`；正在跑的 App 要重新装载新的 debugger 二进制后，下拉才会变。

## 5. 验证路径

```bash
rg -n 'fjs console' --glob '!specs/088-devtools-debugger/**' --glob '!specs/092-devtools-live/**'
cmake --build packages/flutter_fjs/native/build-native -j
```
