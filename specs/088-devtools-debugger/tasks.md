# Tasks: Chrome DevTools 调试器（PrimJS 路线，spike 门控）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。
Spike 组（T010-T014）是门控：不过则跳过"实现/测试"组的 PrimJS 部分，
按 plan.md §3.1 的自研 hooks 方案重排后续任务。

## 契约层（先做，后面都依赖它）

- [x] T001 `native/include/fjs.h`：+`fjs_vm_debugger_attach(vm, host, port)` /
      `fjs_vm_debugger_detach(vm)` 声明与注释（参照 `fjs_vm_heap` 的 OPTIONAL 语义写法）
- [x] T002 `lib/src/ffi.dart`：两个符号的可选绑定（`DynamicLibrary.lookup` 失败降级）+ spec 契约注释
- [x] T003 `docs/jsi-and-native-modules.md`：ABI 表登记两函数（三处同步之三）

## Spike（gate，1-2 天）

- [x] T010 clone primjs tag（暂定 4.1.1）到 /tmp/fjs-spike，CMake
      `ENABLE_QUICKJS_DEBUGGER=ON` host 构建过；记录 `-DEMSCRIPTEN` 疑点结论
      （tag 4.1.1 = 8d129eab；host/libquick.a+libnapi.a 编译通过；CMake 无
      -DEMSCRIPTEN（tag 上已随 CMake 回退消失），仅剩静态库 ld 对齐告警）
- [x] T011 mini-host：LEPUS API 面验证通过（NewRuntime/Context/Eval/CFunction2/
      global/exception/ToCString 全部同名前缀映射）；`QJSDebuggerCallbacks2` 23 槽
      按 quickjs.cc 宏顺序注册成功、暂停循环 + PushAndProcess 模型验证（见
      spike/spike_host.cpp；注意宏顺序与 inner.h 结构体字段顺序不一致）
- [x] T012 CDP 冒烟：GATE PASS——scriptParsed（引擎自动发）/断点解析/paused in
      work()/locals ["i","n","s"]/evaluateOnCallFrame/stepOver 再停/removeBreakpoint+
      resume 跑完/consoleAPICalled 到达；真实 Chrome DevTools 前端经中继连接成功
- [x] T013 Android NDK 构建确认（28.2.13676358）：arm64-v8a 与 armeabi-v7a 都编译
      通过，spec §2 无需"仅 arm64"限制
- [x] T014 gate 决策：通过，spec.md 状态改 in-progress，走 PrimJS 迁移

## 实现（gate 通过后）

- [x] T020 vendor 正式入库 `native/primjs/`（5.9MB 裁剪树 + `VENDORED.md` 注明
      tag 与 commit），CMakeLists 以 add_subdirectory 接入，OUTPUT_NAME 改回
      `quickjs` 供 build-apple.sh 归档；Android 链接 `log` 库（PrimJS 引用
      `__android_log_print`）
- [x] T021 移植 `src/vm.cpp` `natives.cpp` `value.cpp` `fjs_internal.h`
      （JS_*→LEPUS_*；UpdateStackTop 无对应，改为 create 时
      `LEPUS_SetMaxStackSize` 32MiB；`js_free`→`lepus_free`）
- [x] T022 移植 `tools/fjsc.cpp` `fjsrun.cpp`（后者 +`--debug-connect`），
      engine id → `primjs-4.1.1`
- [x] T023 移植 `test/main.cpp`，补 GC 压力用例（2 万对象 churn + 强制 gc）
- [x] T024 `native/src/debugger.cpp`：QJSDebuggerCallbacks2（23 槽，宏顺序）+
      C-owned TCP client + 暂停消息循环。**与计划的偏差**：console 不需要并入
      on_log——调试器附加期间引擎自己把 console.log 合成为
      Runtime.consoleAPICalled 走 CDP 通道，app 的 fjs log 通路反而收不到
      （已写入 toolchain.md）
- [x] T025 `fjs_vm_pump` 搭车轮询 + attach/detach 完整实现
- [x] T026 Dart 侧：engine.dart `runSource`/`_eval` filename 真名化
      （bundle.js / pages/<chunk>.js / unit id）+ attach 接线（`_debugPort`
      跨 reload 重挂）；dev_client.dart `debug on <port>` / `debug off`
- [x] T027 `bundler/build.ts` esbuild target es2021 → es2019（web 构建保持 es2020）

## 两端对齐

- [x] T030 豁免登记：`docs/web.md` 已知差异加一行（fjs debug 仅 app 端，web 用浏览器 DevTools）

## 测试

- [x] T040 fjs-test：真 loopback socket 的调试器集成测试（前端线程 enable →
      scriptParsed 重放 → 断点解析 → 命中 Debugger.paused → resume 跑完），
      46 项检查三连全绿
- [x] T041 vitest：cdp-server 中继测试（发现端点 / 双向管道含分帧 / 双会话拒绝）；
      tool-conn 抽取后 typecheck + 全量 vitest 320 项不回归

## 文档

- [x] T050 `docs/toolchain.md`：新章节"断点调试"（fjs debug 流程 + chrome://inspect +
      UI 冻结说明 + 端口表 + debug on/off + 桌面 fjsrun 链路）
- [x] T051 `docs/roadmap.md`：远期条目移入已完成「Chrome DevTools 调试器 + 引擎切换
      PrimJS」，记录切换决策与不做清单
- [x] T052 `docs/architecture.md` / `docs/jsi-and-native-modules.md`：引擎名、分层图、
      调试器 ABI 同步；`docs/publishing.md` / `NOTICE` / `LICENSE-primjs` 许可链更新；
      `docs/performance.md` 基线标注历史引擎

## 验收

- [x] T060 `pnpm run typecheck`
- [x] T061 `pnpm test`（29 文件 320 项全绿）
- [x] T062 `cmake build-native && fjs-test` 全绿（含 T040）
- [x] T063 设备回归（2026-09-21，iOS 模拟器 iPhone 17）：hello-fjs es2019 构建 ✓，
      `fjs run ios` 跑通真实 Vue 运行时（探针 tick 经 flutter log 可见）；
      `fjs log` / `fjs eval` 代码路径未动（tool-conn 抽取有 typecheck+vitest 覆盖）
- [x] T064 端到端真机门禁 8/8 全绿（`specs/088-devtools-debugger/spike/cdp-client-device.mjs`）：
      `fjs run ios` + `fjs debug` + CDP 断言——bundle.js scriptParsed（另有
      prelude.js / src/catalog.ts / pages/index.js 真实脚本名）/ getScriptSource
      带真实源码 / 断点解析到精确位置 / **设备 VM 命中 Debugger.paused** /
      local+closure 作用域变量可见（probeCount）/ evaluateOnCallFrame /
      console 经 consoleAPICalled 进 DevTools / resume 后继续跳动；
      真实 Chrome DevTools 前端连接同一会话成功。验收过程中给中继补了一个
      健壮性修复：DevTools 断开时自动向 app 下发 Debugger.disable（会话复位 +
      冻结解冻），否则重连的 DevTools 拿不到脚本重放
