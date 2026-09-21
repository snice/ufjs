# Spec: Chrome DevTools 调试器（PrimJS 路线，spike 门控）

- **ID**: 088-devtools-debugger
- **状态**: done（2026-09-21 设备门禁 8/8 全绿：iOS 模拟器跑真实 hello-fjs，
  `fjs run ios` + `fjs debug` + CDP 断言 + 真实 Chrome DevTools 前端连接）
- **日期**: 2026-09-20

## 1. 要解决什么

设备端 JS 的 bug 今天只有两种查法：`console.log` 和 `fjs eval`。没有断点、
没有调用栈、看不了局部变量——页面在真机上才出现的逻辑错误（时序、手势、
路由参数）只能靠打日志反复重跑。roadmap 远期条目（docs/roadmap.md:717-718）
记录了这条：`fjs log` / `fjs eval` 已经把 dev socket 变成双向通道，断点和
堆栈是它的超集。

引擎侧的现状是零基础：vendored quickjs-ng 0.9.0 没有任何 debugger 模块
（唯一的执行控制钩子是 `JS_SetInterruptHandler`，无断点/栈帧/作用域 API），
社区也没有可用移植（sponge 的 quickjs-ng 分支断点行号是坏的，未开 PR）。
直接可行的路线是换用 Lynx 系的 PrimJS 引擎（quickjs 分叉）：它内置完整
CDP 调试器（断点/条件断点/单步/调用栈/作用域变量/evaluateOnCallFrame/
console 堆栈），接入模型为 V8 inspector 式——宿主实现
`QJSDebuggerCallbacks2` 回调并用 `dispatchProtocolMessage` 喂 CDP 消息，
传输层归宿主。

**先 spike 后迁移**：spike 验证（a）CMake 独立构建、（b）LEPUS_* API 对
fjs 所用 API 面的覆盖、（c）CDP 真连冒烟。gate 不过则回退 quickjs-ng
自研 hooks 方案（见 plan.md §3 被否方案一节，即备选启用方案）。

## 2. 不做什么（Non-goals）

- **release 字节码调试**。v1 只调 dev 源码模式（`fjs dev`/`fjs run`）。
  生产包没有 dev server，也没有调试通道的生存空间。
- **Worker VM 调试**。Worker 是独立 isolate + 独立 runtime，v1 只调主 VM。
- **小程序端**。`fjs build --mp` 有微信开发者工具自家的调试器。
- **Web 端**。浏览器构建用浏览器自带 DevTools（页面代码零改动，见 §4）。
- **Vue SFC source map**。v1 调试的是编译后的 JS（与今天大多数小程序
  工具链一致）。PrimJS 的 scriptParsed 带 sourceMapURL 字段，后续可为
  units 构建补 map，另起 spec。
- **VS Code / DAP 前端**。CDP 是标准协议，中继层是字节搬运，以后接任何
  前端都不用改引擎侧；v1 只做 Chrome DevTools。
- **不采用 lynx-devtool 桌面应用**。其前端是 fork 的 Chrome DevTools，
  但桌面端绑定 Lynx 页面会话模型，设备端要嵌 LynxDevtool agent——为
  JS 调试引入半个 Lynx 不值，Chrome DevTools 直连体验相同。

## 3. 用户可见的行为

页面代码**零改动**。开发者流程：

```bash
fjs run android          # 或 fjs dev + 手动跑 app（现有流程不变）
fjs debug                # 新命令：起 CDP 中继（默认 127.0.0.1:38902）
# 终端打印：Open chrome://inspect → Configure… → 添加 127.0.0.1:38902 → inspect
```

Chrome DevTools 打开后：

- Sources 面板出现当前 dev 构建的脚本（`bundle.js` 或 units 模式下按
  unit id 分文件，如 `src/pages/index.vue`）；
- 点行号设断点 → 手机上触发该代码 → DevTools 停在断点，右侧能看到
  Call Stack、Scope（局部变量）、Watch；
- Console 可在暂停帧上求值（evaluateOnCallFrame）；
- 单步（step over/into/out）、resume；
- app 暂停期间 UI 冻结，resume 后恢复——这是"暂停 JS 线程"的预期语义，
  文档要写明。

## 4. 两端约定（宪法 I）

**豁免**：调试器是开发者工具，不是面向页面作者的能力。web 构建本来就有
浏览器自带 DevTools，页面源码零改动，"两端同源"的精神（页面不改跑两端）
天然满足。需在 `docs/web.md` 差异表登记一行：`fjs debug` 仅服务 app 端。

## 5. 契约变更（宪法 II）

- [x] **fjs.h 新增 2 个函数**：`fjs_vm_debugger_attach(vm, host, port)` /
      `fjs_vm_debugger_detach(vm)`。三处同步：`native/include/fjs.h`、
      `lib/src/ffi.dart`、`docs/jsi-and-native-modules.md` ABI 表。
      参照 `fjs_vm_heap` 先例标注 OPTIONAL 语义（旧引擎二进制无此符号时
      Dart 侧降级为"不支持调试"）。v1 ABI 只过标量，符合。
- [ ] UI op 协议：不涉及
- [ ] 事件类型：不涉及（调试消息不过 Dart，不新增事件号）
- [ ] natives 表（JS 全局函数）：不涉及
- [x] **engine id 字符串**：`quickjs-ng-0.9.0` → `primjs-4.1.1`
      （.fjsbundle 锁版本值变更，机制不变；fjsc 与运行时同源重编）。
      若 spike 定的 tag 不同，以实际为准更新本条。
- [x] **dev-WS 下行新增纯文本命令**：`debug on <port>` / `debug off`
      （与 `eval`/`perf`/`reload` 同级；`fjs debug` 启动时下发，平时
      零流量）。登记 `docs/toolchain.md`。

## 6. 验收标准

**Spike gate（两条都过才进入引擎迁移，否则回退自研方案）**：

1. primjs tag CMake 独立构建成功（`ENABLE_QUICKJS_DEBUGGER=ON`，host
   macOS，引擎 + inspector 静态库 + qjs 工具）。
2. mini-host 冒烟在 primjs 上全绿：eval 源码、timers、console.log 回调、
   字节码 round-trip（等价 fjs-test 覆盖面）+ `QJSDebuggerCallbacks2`
   桩可注册、`dispatchProtocolMessage` 可通。
3. CDP 真连冒烟：mini-host + node 中继 + Chrome DevTools，命中断点、
   单步一次、Scope 面板看到局部变量、evaluateOnCallFrame 求值成功、
   console 一条消息到达 DevTools。
4. Android NDK 构建可行性确认（arm64 必须过；armv7/32 位若不支持，
   在本 spec"不做"补记"仅 arm64+"）。

**正式验收**：

5. `cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j`
   成功，`./build-native/fjs-test` 全绿（含新增 debugger 桩单测）。
6. `pnpm run typecheck`、`pnpm test` 全绿。
7. demo 与 hello-fjs `fjs build` 产物在真机/模拟器跑通（引擎迁移回归），
   `fjs run` 热重载、`fjs log`、`fjs eval` 不回归。
8. 端到端演示：`fjs dev` + `fjs debug` + chrome://inspect 真机断点、
   单步、作用域变量、evaluateOnCallFrame、console 全部可用。

## 7. 待澄清

- [x] 引擎路线：先 spike 再定（用户已拍板，gate 见 §6.1-6.4）。
- [x] 调试前端：Chrome DevTools 直连（用户已拍板）。
- [x] §6.1-6.4 spike gate：2026-09-20 全部通过（CMake host/arm64/v7a、
      mini-host、CDP 八项冒烟、真实 Chrome DevTools 前端连接），
      按 plan §3 走 PrimJS 迁移。细节见 `spike/README.md`。
- 无其余待澄清。
