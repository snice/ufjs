# Spike 结论（2026-09-20）

primjs tag **4.1.1**（commit `8d129eab`；仓库 PRIMJS_VERSION 文件写的是
`2.11.1-rc.1`，与 git tag 不同步——engine id 建议用 git tag 并注明）。
gate 四项全部通过，走 PrimJS 迁移（spec §6.1-6.4）。

## 验证结果

| Gate 项 | 结果 |
|---|---|
| CMake 独立构建（host macOS，ENABLE_QUICKJS_DEBUGGER=ON） | 通过：libquick.a（引擎+gc+inspector）+ libnapi.a |
| Android NDK 28.2.13676358 | 通过：arm64-v8a 与 armeabi-v7a 都编过，无需"仅 arm64"限制 |
| mini-host API 面验证 | 通过：`LEPUS_*` 与 quickjs `JS_*` 同名前缀映射（NewRuntime/NewContext/Eval/NewCFunction2/GetGlobalObject/SetPropertyStr/GetException/ToCString/FreeCString） |
| CDP 冒烟（自动化客户端 + 真实 Chrome 前端） | GATE PASS，八项全绿 |

CDP 冒烟断言（cdp-client.mjs）：scriptParsed → setBreakpointByUrl 解析到
精确 location → paused（callFrames.functionName === "work"）→ Runtime.getProperties
拿到局部变量 ["i","n","s"] → evaluateOnCallFrame `s+i` 求值 → stepOver 再停 →
removeBreakpoint + resume 跑完 → Runtime.consoleAPICalled 到达。
真实 Chrome DevTools 前端（`devtools://…inspector.html?ws=`）经中继连接成功。

## 迁移必读的坑（spike 实证）

1. **回调注册是"宏顺序"不是"结构体顺序"**。`RegisterQJSDebuggerCallbacks(rt,
   void**, 23)` 按 quickjs.cc 的 `QJSCallBackName` 宏序取槽位，而
   quickjs-inner.h 的 `QJSDebuggerCallbacks2` 结构体里 `inspector_check` 和
   `debugger_exception` 两项与宏序**互换**。宿主必须显式按宏序排函数指针数组，
   严禁把结构体地址强转 `void**` 传入。
2. **scriptParsed 引擎自动发**（含 scriptId/url/hash/sourceMapURL/
   executionContextId），宿主的 `script_parsed_ntfy` 回调只做簿记，不要重复
   组装下发。
3. **消息泵模型**（与我们单线程架构完全吻合）：
   - 运行中：宿主事件循环（对应我们的 `fjs_vm_pump` 搭车轮询）读 socket →
     `PushAndProcessProtocolMessages(GetDebuggerInfo(ctx), msg)`；
   - 暂停时：引擎在 JS 线程上调 `run_message_loop_on_pause` → 宿主在该回调里
     阻塞 poll socket，每条消息走 `ProcessPausedMessages(ctx, msg)`；
     `Debugger.resume` 的处理会调 `quit_message_loop_on_pause` 解除阻塞。
   - 引擎按需检查（`DebuggerCallEachOp` 只在"单步中或命中断点 pc"时进
     inspector check），无断点零开销。
4. **开启调试的三步**：`RegisterQJSDebuggerCallbacks` → `QJSDebuggerInitialize(ctx)`
   → `PrepareQJSDebuggerForSharedContext(ctx, funcs, 23, /*devtool_connect=*/true)`
   （置 `ctx->debugger_mode=1`，脚本才进调试器脚本表、断点才有处可落）。三者的
   声明：前两个在公开 quickjs.h，其余在 `src/inspector/interface.h`（extern "C"，
   宿主可自行声明原型）。
5. **console 引擎不带**：宿主自己注入 console.*（Lynx 也这么做），
   `SendConsoleAPICalledNotification` 等 CDP 组装函数引擎侧现成，宿主回调可很薄。
6. **构建疑点**：libquick.a 链接时有成片 "alignment of atom is too small" ld
   告警（上游 -Os + anon 常量段），spike 无实害；迁移时留意并向上游反馈。
   tag 上的 CMakeLists 已无 WebFetch 初查所见的无条件 `-DEMSCRIPTEN`。
7. **每次 eval 产生独立 scriptParsed**（phase 2 的 `main();` 是 scriptId 2）——
   Dart 侧 filename 真名化（T026）后，DevTools 里页面 chunk 才能按 unit 区分。

## 产物

- `spike_host.cpp` — 最小宿主（回调注册 + 两阶段脚本 + TCP server，119 行核心逻辑）
- `relay.cjs` — TCP(换行分帧 JSON) ⇄ WebSocket 中继 + `/json/version` `/json/list`
- `cdp-client.mjs` — 自动化 gate 断言（node + 仓库现有 ws 依赖）
- 复现：/tmp/fjs-spike 下 `cmake -B build -S primjs -DENABLE_QUICKJS_DEBUGGER=ON &&
  cmake --build build -j`，然后 `c++ -std=c++17 …` 编 host，起 host+relay，
  `node cdp-client.mjs`（或 Chrome 打开 devtools URL，Sources → test.js 第 4 行打断点）
