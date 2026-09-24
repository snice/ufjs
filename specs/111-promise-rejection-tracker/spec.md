# Spec: 未处理的 Promise 拒绝要打日志（两个引擎）

- **ID**: 111-promise-rejection-tracker
- **状态**: done（预编译产物重建与真机项待用户执行）
- **日期**: 2026-09-24
- **来源**: spec 108 排查时发现，登记在 `docs/roadmap.md` 的未勾选项。

## 1. 要解决什么

```js
Promise.reject(new Error('boom'));                  // 没有 .catch
fetch(url).then((r) => r.json());                   // 网络失败，没人接
async function load() { throw new Error('x') } load();
```

浏览器和 Node 都会报 `Uncaught (in promise)` / `unhandledRejection`。fjs 的 native 侧两个引擎都没有任何输出——
async 函数里的错误、没接 `.catch` 的请求失败全部静默（宪法 V）。原因：

| 引擎 | 现状 |
|---|---|
| PrimJS（默认） | 运行时自带 `unhandled_rejections` 列表：拒绝时若没有处理器就入列，之后挂上处理器会移出，通过 `LEPUS_MoveUnhandledRejectionToException` 取出。**`native/src/` 从未取过**——不报错，而且列表只进不出，每条未处理拒绝的 Error 对象（连同其栈字符串）一直留到 VM 销毁，是一个随运行时间增长的内存泄漏。 |
| quickjs-ng | 需要宿主用 `JS_SetHostPromiseRejectionTracker` 注册回调，**没有注册**。 |

`native/src/vm.cpp` 里现有的 `[fjs] unhandled rejection in a microtask job` 只覆盖「任务本身抛错」，不是 Promise 被拒。

## 2. 不做什么（Non-goals）

- 不向 JS 暴露 `unhandledrejection` / `rejectionhandled` 事件或 `event.preventDefault()`——只做日志。
  （web 端浏览器自己会在控制台报。）
- 不在「稍后才挂上处理器」时补发 `rejectionhandled` 日志：一次微任务排空结束时仍未处理，就报；与浏览器报
  `Uncaught (in promise)` 的时机一致。
- 不改 C ABI、natives 表、op 协议、事件类型。
- 不在本环境重新生成各平台预编译产物（需要 NDK / Xcode / DevEco）。

## 3. 用户可见的行为

`flutter run` 控制台 / `fjs log`（error 级）：

```
[fjs] unhandled promise rejection: Error: boom
    at <anonymous> (page.js:12)
    ...
```

- 报告时机：每次 `fjs_vm_pump` 排空微任务队列之后。同一轮排空里后来挂上 `.catch` 的不报。
- 每条拒绝最多报一次。
- 两个引擎前缀相同。reason 不是 Error 时：quickjs-ng 打印其字符串形式；PrimJS 的运行时会先把它包成
  Error，所以显示为 `Error: <值>`（引擎行为，登记为已知差异）。
- PrimJS 的未处理拒绝列表被取空，不再随运行时间增长。

## 4. 两端约定（宪法 I）

web 端由浏览器报告；Flutter 端由本 spec 补上。两者文案不同（各自平台的惯例），均为 error 级。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及——只改 `native/src/`（`engine.h` 门面 + `vm.cpp` + `fjs_internal.h`），不新增导出符号。

## 6. 验收标准

1. `native/test/main.cpp` 新增用例，**两个引擎 flavor 都编译并运行**（本环境 clang 桌面构建）：
   - `Promise.reject(new Error('boom'))` 无处理器 → 一次 pump 后恰好一条 `unhandled promise rejection` 日志，含 `boom`；
   - 同一轮里 `.catch` 掉的 → 不报；
   - 先拒绝、在同一轮排空中的后续微任务里再 `.catch` → 不报；
   - `async` 函数抛错且返回的 Promise 无人接 → 报；
   - 多次 pump 同一条拒绝只报一次；
   - reason 为字符串时也报且不崩。
2. `fjs-test` 在 primjs 与 quickjs 两个 flavor 下均 ALL PASS。
3. 回退 `vm.cpp` 的改动后，上述「应报」的用例失败（证明测试有效）。
4. `pnpm test` 不回退。
5. **需用户执行**：用 `tool/build-android.sh` / `build-apple.sh` / `build-ohos.sh` 重新生成 `abi/` 与
   `ios|macos/abi/` 预编译产物（AGENTS.md §4.8），再真机确认日志出现。
6. `docs/toolchain.md`（引擎差异一节）与 `docs/roadmap.md` 更新。

## 7. 待澄清

无。

## 8. 验收记录（2026-09-24，Linux 桌面构建）

1–2. `native/test/main.cpp` 新增 6 条用例；**primjs 与 quickjs 两个 flavor** 用 clang 编译，`fjs-test` 均 ALL PASS。
   实际日志（PrimJS）：`[fjs] unhandled promise rejection: Error: rej-boom\n    at <eval> (test.js:1:37)`；
   两个引擎各恰好 3 条（测试故意触发的），其余用例无额外噪声。
3. 变异检查：去掉 pump 里的报告，两个 flavor 各 4 项失败。
   引用管理另用 **ASan/LSan**（quickjs-ng flavor，GCC）整套跑：正常实现零泄漏、零内存错误；
   变异「take 时不释放 promise」→ LSan 报 515 处泄漏，证明检测有效。
   说明：原计划的「销毁时仍有未报条目」用例已删除——所有 JS 入口（eval / 执行 bundle / 派发事件）末尾都会
   pump，pump 结束时列表总是空的，该路径在现有代码里不可达；`clear_rejections` 作为防御性清理保留。
   （引擎按 `-O3 -DNDEBUG` 编译，quickjs-ng 的泄漏断言在普通构建里不生效，故改用 LSan。）
4. `pnpm test`、typecheck 全绿。
   额外冒烟：spec 093 的真实运行时 bundle（Vue + fjs-runtime）在桌面 PrimJS `fjsrun` 上运行 3 秒，无误报。
5. **待用户执行**：`tool/build-android.sh` / `build-apple.sh` / `build-ohos.sh` 重建预编译产物，真机确认日志。
6. `docs/toolchain.md`、`docs/roadmap.md` 已更新。
