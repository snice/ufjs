# Spec: PrimJS 的 queueMicrotask 兜底不再吞掉回调里的异常

- **ID**: 108-queue-microtask-errors
- **状态**: done（真机项待用户验证）
- **日期**: 2026-09-24
- **来源**: 近 3 天代码 review（f8e840a，specs/091 的 `microtask.ts`）。

## 1. 要解决什么

PrimJS 没有 `queueMicrotask`，`packages/fjs-runtime/src/microtask.ts` 用
`Promise.resolve().then(cb)` 补了一个。两个引擎在回调抛错时表现不同：

| 引擎 | 回调 `throw` 之后 |
|---|---|
| quickjs-ng（原生 `queueMicrotask`） | 回调本身就是任务，`execute_pending_job` 返回 < 0，`native/src/vm.cpp` 打 `[fjs] unhandled rejection in a microtask job: <消息 + 栈>` |
| PrimJS（JS 兜底） | 抛错只让 `.then` 派生的 Promise 变成 rejected，任务本身正常结束；原生侧没有注册 rejection tracker——**什么都不打，异常彻底消失** |

默认引擎就是 PrimJS，所以用户和框架代码（路由的 settle 回调就在用）里
`queueMicrotask` 回调的错误在默认配置下全部静默（宪法 V）。

另外兜底对非函数参数也不同：标准要求 `queueMicrotask(123)` **同步**抛 `TypeError`，
兜底版本把它推迟到微任务里，于是也被吞掉。

## 2. 不做什么（Non-goals）

- 不改 native：不给 PrimJS 加原生 `queueMicrotask`，也不注册 Promise rejection tracker
  （那样需要重建所有平台的预编译产物）。
- 不处理「普通 Promise 未处理拒绝两个引擎都不报」这个更大的问题——需要改 native，另开 spec。
- 不改 quickjs-ng 与浏览器的行为（它们有原生实现，兜底不会安装）。

## 3. 用户可见的行为

```ts
queueMicrotask(() => { throw new Error('boom'); });
queueMicrotask(() => console.log('still runs'));
```

- 改前（PrimJS）：什么日志都没有；`still runs` 照常输出。
- 改后（PrimJS）：error 级日志
  `[fjs] unhandled rejection in a microtask job: Error: boom\n<stack>`——与 quickjs-ng
  逐字一致；`still runs` 照常输出，一个回调出错不影响后续微任务。
- `queueMicrotask(123)`：同步抛 `TypeError`（与标准、浏览器、quickjs-ng 一致）。

## 4. 两端约定（宪法 I）

web 端用浏览器原生实现，不受影响。Flutter 端两个引擎 flavor 的日志输出对齐。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter @ufjs/runtime test` 通过，新增 `test/microtask.test.ts`：
   在没有 `queueMicrotask` 的假全局上安装兜底后——
   - 回调抛 Error：以 error 级输出上述前缀 + 消息 + 栈；
   - 回调抛非 Error 值（字符串）：同样输出，不崩；
   - 抛错的回调之后排队的微任务照常执行，且按 FIFO 顺序；
   - 回调在当前同步代码之后执行；
   - 非函数参数同步抛 `TypeError`；
   - 已有原生 `queueMicrotask` 时不覆盖。
2. `pnpm run typecheck` 通过（demo / hello-fjs 既有 TS2339 除外）。
3. 真机（需用户执行，默认 PrimJS）：在页面里 `queueMicrotask(() => { throw new Error('x') })`，
   `flutter run` 控制台出现上述日志。
4. `docs/toolchain.md` 中「引擎全局差异由 runtime 兜底」一段补充错误上报说明；
   `docs/roadmap.md` 登记。

## 7. 待澄清

无。

## 8. 验收记录（2026-09-24）

1. `test/microtask.test.ts`：9 项通过——091 原有 2 项（模块加载时安装 / 不覆盖原生）
   保留，新增 7 项覆盖 §6.1。变异检查：把兜底改回 `Promise.resolve().then(callback)`
   后「上报 Error」「上报非 Error」「抛错后继续 FIFO」3 项失败。
2. typecheck 通过；`pnpm test` 全绿（runtime 685）。
3. **待用户真机验证**（默认 PrimJS）。
4. `docs/toolchain.md`、`docs/roadmap.md` 已更新；roadmap 新增未勾选项「两引擎均无 rejection tracker」。
