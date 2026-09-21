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

## 回归修复：Android 模拟器 attach 全挂（2026-09-21 会话）

现象：`fjs debug` 报 "app attached (1 session total)"，app 侧却打
"re-attach failed:"（错误串为空），DevTools 连上后 Sources 空白。复现定位出
三条叠加的根因，全部修掉：

- [x] R1 **僵尸 app 实例抢占中继的唯一 VM 槽位**——`flutter run` 被硬杀
      （终端关闭 / "Lost connection to device"）后 Android 上 app 进程存活，
      它持有的调试会话让新 app 的拨号被当"第二个 app"拒绝，且拒绝后无重试、
      错误串为空，会话级不可调试。修复：`fjs run` 在 `flutter run` 前
      `adb shell am force-stop`（iOS 用 `simctl terminate`）同包名残留实例
      （`run.ts` `stopStaleApp`）。
- [x] R2 **socket 绑在 VM 生命周期上，每次 reload 先关再重拨**——重拨会撞上
      中继还没处理完旧连接 close 的窗口（被拒/拿到半开尸体），这也是
      "1 session total + 每轮 reload 闪断"的直接来源。修复：TCP 会话进程级
      存活（`transport_close` 只摘钩子不关 socket），VM 重建后的 attach 只重装
      per-VM inspector 状态并向中继发 `{"fjs":"debug-reload"}` 标记（清
      Network 去重缓存）；中继侧 vm==null 期间缓存的前端请求不再冲进新会话
      （`devBuf` 在 resetSessionCaches 清空）。
- [x] R3 **attach 拨号连续"超时"**——真凶不在网络：native 侧 `poll()` 等
      POLLOUT 时被 ART/Flutter 打到 UI 线程的信号打断（EINTR），旧代码把
      EINTR 一律当 "connect timed out" 报失败（shell 里 `nc` 0.7s 能通、
      app 连续 5 次全挂即是佐证）。修复：poll 对 EINTR 重试、失败路径写明
      确原因（errno / refused / timed out / interrupted）；`fjs debug` 在
      检测到 adb 时用 `adb reverse tcp:<vmPort>` 把通道发布到在线 Android
      设备（加速器：拨号零延迟、USB 真机无 Wi-Fi 路由也可用；adb 从
      PATH/`ANDROID_HOME`/默认 SDK 位置解析，**没配置 adb 则静默跳过**，
      直拨路径本身就是主路径）；app 侧拨号候选 `127.0.0.1` → dev server
      host（`engine.dart` `_debugDial`），attach 失败按 0.8→6.4s 退避重拨
      （≤4 次），成功后补一次整包重载让脚本进表。用户观察到的"先
      `fjs dev` 再 `fjs run` 能连上"是 EINTR 时序的运气差，不是依赖关系。
配套：`fjs_vm_debugger_attach` 失败路径写 `FJSVM.last_error`；transport_feed
半行跨 recv 持久化（`line_buf`，>64KB 消息丢尾修复）；poll EINTR 重试；
`android/src/main/jniLibs` 预编译产物已重生成（`tool/build-android.sh`）。

验证（Android 模拟器 emulator-5554，hello-fjs）：`fjs run android` +
`fjs debug` 一次拨通（`debug channel open to 127.0.0.1:38903`）；整包 reload
前后中继始终 1 个 session（无闪断）；CDP 门禁（`cdp-gate.mjs`，同 spike 设备
门禁的 8 项断言）在两次整包 reload 后仍全绿：scriptParsed 重放 / getScriptSource /
断点解析 / Debugger.paused / probeCount 局部变量 / evaluateOnCallFrame /
console 事件 / resume 后继续跳动。`pnpm test` 104 文件全绿。

## 追加：Console 上下文名 + 跨平台僵尸（2026-09-21 晚）

- [x] C1 **DevTools 控制台的 JavaScript 上下文下拉显示 "debugger context"**——
      改为 "fjs console"：patch vendored PrimJS 字面量池
      （`debugger_struct.h` `V(debugger_context, "fjs console")`，
      已记入 VENDORED.md；不用 `SetJSDebuggerName` 运行期设置——GC 关闭期
      设置的字符串活不到 `Runtime.enable`，实测不生效）。
- [x] C2 **发现跨平台僵尸新模式**：`fjs run ios` 死掉后 iOS 模拟器里的
      Runner.app 存活，它连着同一 dev server、收到 `debug on` 后从宿主回环
      直拨（模拟器共享宿主网络），把 Android app 挤出 relay 的唯一槽位——
      此前所有"attach 成功"的探针命中的其实是 iOS 旧二进制。
      `fjs run` 的 force-stop 只覆盖本机同包名，跨设备/跨平台僵尸需要
      **relay 多会话 + DevTools 目标选择**（/json/list 每个 app 一个 target），
      记为后续项；当前 workaround：干掉不调试那端的 app，或重开 fjs debug
      碰时序。验证时已手动 kill iOS Runner（pid 37859）。
- [x] C3 验证：Android app（全新安装、字面量补丁 .so）上报
      `executionContextCreated name="fjs console"`；CDP 门禁其余断点/
      局部变量/求值/console 断言机制未动（前两轮 PASS）。

## 日志措辞修复：attach 计数被读成在线会话数（2026-09-21 深夜）

现象：app 断开重连几次后，中继打 "app attached the debug channel
(5 sessions total)"，看起来像 5 个会话挂着不释放。实际是 `vmCount` 只在
attach 时 `++`、从不递减——它本来就是"第几次拨入"的累计序号（中继单会话
设计，同一时刻最多 1 个 VM，socket 无泄漏），措辞 "N sessions total"
却让人读成在线数。

- [x] 日志改为无歧义序号：`app attached the debug channel (session #N)`
      （`cdp-server.ts`），注释写明该计数永不递减、不得读作在线数；
      断开日志不变。`@ufjs/cli` dist 已重建，`pnpm test` + typecheck 全绿。

