# Plan: queueMicrotask 兜底不再吞异常

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | web 用浏览器原生；本改动只影响没有原生实现的引擎（PrimJS）。 |
| II 边界即契约 | 否 | 三张表不动，不改 native。 |
| III 同步单线程零序列化 | 否 | 仍是 Promise 微任务，时序不变。 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 本 spec 修的就是一处静默吞错。 |
| VI 注释记录权衡 | 是 | 写清为何用 try/catch 包回调而非 `.catch`、为何沿用 vm.cpp 的前缀、为何手工拼栈。 |
| VII JS 能包就不要下 Dart | 是 | 纯 JS 修复，不下 native。 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`、`docs/roadmap.md`。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/microtask.ts` | 导出 `installQueueMicrotask(target)`，模块加载时对 `globalThis` 调用；兜底同步校验参数类型，回调包 try/catch，出错时按 vm.cpp 的格式（前缀 + `String(e)` + `\n` + `stack`）走 `console.error` |
| 测试 | `packages/fjs-runtime/test/microtask.test.ts`（新增） | 见 spec §6.1 |
| 文档 | `docs/toolchain.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

在兜底里用 try/catch 包住回调，捕获后立刻上报，而不是给 `.then` 再挂 `.catch`：
`.catch` 也是在后续微任务里执行，而 try/catch 在同一个任务里报告，时序上最接近原生；
而且捕获后派生的 Promise 是 fulfilled，不会产生第二个未处理拒绝。

上报走 `console.error`：它映射到原生 `log_line(FJS_LOG_ERROR)`，与 vm.cpp 打日志用的是同一条通道。
原生 `console.*` 对 Error 只打 `toString()`，所以按 `format_exception` 的格式手动拼上 `stack`。
前缀沿用 vm.cpp 的 `[fjs] unhandled rejection in a microtask job: `，让两个 flavor 的日志逐字相同、
可以用同一个关键字搜。

**被否掉的备选**：
- 捕获后 `setTimeout(() => { throw e })` 交给原生 timer 路径上报：日志前缀会变成 `[fjs/timer]`，
  指错了位置，还多等一个 timer tick。
- 在 native 给 PrimJS 实现 `queueMicrotask` 或注册 rejection tracker：最彻底，但要重建所有平台的
  预编译产物，本环境做不了；作为后续 spec。

## 4. 风险

- 上报本身不能抛：`console` 被页面替换或删掉时，用 try/catch 兜住，不影响后续微任务。
- 日志文案用的是 quickjs-ng 那条「unhandled rejection」，对同步 throw 来说措辞不完全准确，
  但换来两端一致；注释说明。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime exec vitest run test/microtask.test.ts
pnpm test && pnpm -r --filter '!demo' --filter '!hello-fjs' run typecheck
```
