# Plan: 未处理的 Promise 拒绝要打日志

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 部分 | web 由浏览器报；Flutter 端在 native 补齐，均为 error 级日志。 |
| II 边界即契约 | 否 | 不新增 C ABI 导出、不改三张表；只改 `native/src/` 内部。 |
| III 同步单线程零序列化 | 否 | 仍在 pump 内同步完成。 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 修的就是静默吞错（外加 PrimJS 列表的泄漏）。 |
| VI 注释记录权衡 | 是 | 写清报告时机、两引擎机制差异、PrimJS 的 Error 包装差异。 |
| VII JS 能包就不要下 Dart | 说明 | 必须在 native：JS 侧没有 API 能得知「一个 Promise 被拒且无人处理」。不涉及 Dart。 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`、`docs/roadmap.md`。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| C++ 引擎门面 | `packages/flutter_fjs/native/src/engine.h` | 两个 flavor 各实现 `RejectionState` + `track_rejections(rt, state)` + `take_unhandled_rejection(ctx, state, &reason)` + `clear_rejections(ctx, state)`；quickjs-ng 用 tracker 回调维护待报列表，PrimJS 直接取运行时自带列表 |
| C++ | `packages/flutter_fjs/native/src/fjs_internal.h` | `FJSVM` 增加 `fjsengine::RejectionState rejections` |
| C++ | `packages/flutter_fjs/native/src/vm.cpp` | 创建时 `track_rejections`；pump 排空任务后逐条取出并 `log_line(ERROR)`；销毁前 `clear_rejections` |
| C++ 测试 | `packages/flutter_fjs/native/test/main.cpp` | spec §6.1 六条 |
| 文档 | `docs/toolchain.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

- **报告点只有一个**：`fjs_vm_pump` 里微任务排空之后。这是「一个检查点结束」的自然位置；同一轮里后续挂上的
  处理器已经把条目移除（PrimJS 由引擎移除，quickjs-ng 由 `is_handled=true` 回调移除）。
- **quickjs-ng**：tracker 回调在 `is_handled=false` 时 dup promise 与 reason 存入待报列表，在 `true` 时按 promise
  指针找到并释放。取出时交出 reason 的所有权。VM 销毁前释放未报条目，避免 `JS_FreeRuntime` 的泄漏断言。
- **PrimJS**：循环调用 `LEPUS_MoveUnhandledRejectionToException`，它把条目的 Error 放进当前异常并释放条目；
  `get_exception` 取走所有权。这同时把列表取空，修掉泄漏。运行时销毁时自带清理剩余条目。
- 门面把两种机制统一成「取下一条未处理 reason」，`vm.cpp` 不出现任何引擎名（与 engine.h 的约定一致）。

**被否掉的备选**：
- 在 JS 侧给 `Promise` 打补丁（包装 `then` 统计处理器）：无法覆盖引擎内部创建的 Promise（async 函数、
  `Promise.all` 内部），且对性能敏感路径有侵入。
- 每次拒绝立即报：会把「稍后同一轮就被 catch」的正常代码误报成错误。

## 4. 风险

- **预编译产物必须重建**才会在 App 里生效；本环境只能验证桌面构建。spec §6.5 由用户执行。
- PrimJS 只在 Error 带非空 stack 时入列（引擎实现如此）；极端情况下可能漏报，记录为已知限制。

## 5. 验证路径

```bash
cd packages/flutter_fjs/native
CC=clang CXX=clang++ cmake -B <tmp>/primjs -DFJS_BUILD_TESTS=ON && cmake --build <tmp>/primjs -j && <tmp>/primjs/fjs-test
CC=clang CXX=clang++ cmake -B <tmp>/quickjs -DFJS_JS_ENGINE=quickjs -DFJS_DEBUGGER=OFF -DFJS_BUILD_TESTS=ON && cmake --build <tmp>/quickjs -j && <tmp>/quickjs/fjs-test
```
