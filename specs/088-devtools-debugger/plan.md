# Plan: Chrome DevTools 调试器（PrimJS 路线，spike 门控）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 豁免 | 调试器是开发者工具，非页面能力；web 端用浏览器自带 DevTools，页面代码零改动。差异登记 `docs/web.md`。 |
| II 边界即契约 | 是 | fjs.h +2 函数（attach/detach），fjs.h / ffi.dart / docs 三处同步；v1 ABI 只过标量；dev-WS 下行新增 `debug on/off` 文本命令，登记 toolchain.md。 |
| III 同步单线程零序列化 | 是（关键约束） | JS 跑在 UI isolate，断点暂停时 Dart 事件循环停摆 → 调试传输必须由 C 层持有：app 作为 TCP **客户端**外连 CLI（与 dev WS 同方向，手机不开端口），暂停时 C 阻塞 poll 自己的 socket 服务 CDP 命令。调试消息不过 Dart。 |
| IV 外观照 WeUI | 否 | 无 UI。 |
| V 静默失效是 bug | 是 | attach 失败、primjs 符号缺失（旧引擎二进制）都要显式报错/降级提示，不悄悄吞；`fjs debug` 连不上 app 时打印原因。 |
| VI 注释记录权衡 | 是 | debugger.cpp 顶部注释记录"为什么传输在 C 层"、"为什么 app 是客户端"；engine id 变更记录锁版本机制。 |
| VII JS 能包就不要下 Dart | 豁免（必须 native） | 断点/单步/作用域是引擎 C 能力，JS 包不出来——与 `onPageSettled` 同类豁免（threading-model.md 已有先例）。且要下到 **C 层**而非 Dart 层（III 的约束）。 |
| VIII 变更要落到文档 | 是 | toolchain.md（`fjs debug` + debug on/off）、roadmap.md（条目迁移 + 引擎切换记录）、architecture.md、jsi-and-native-modules.md（ABI 表）。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/commands/debug.ts`（新） | `fjs debug`：CDP WS 服务 + /json/list 发现 + 字节搬运中继 + script URL 映射，只绑 127.0.0.1 |
| CLI / 构建 | `packages/fjs/src/debug/cdp-server.ts`（新） | CDP 中继实现（复用 `ws` 依赖，零新增依赖） |
| CLI / 构建 | `packages/fjs/src/dev/tool-conn.ts`（新） | 从 inspect.ts 抽出 parseCommon/connect/handshake 供 log/eval/debug 共用 |
| CLI / 构建 | `packages/fjs/src/cli.ts` | case 'debug' + usage |
| JS runtime | — | 不涉及（页面代码零改动） |
| Web 适配层 | — | 不涉及（豁免，登记 web.md） |
| C++ 引擎 | `native/primjs/`（新，替代 `native/quickjs/`） | vendor PrimJS（Apache-2.0，NOTICE 注明 tag 与 commit） |
| C++ 引擎 | `native/CMakeLists.txt` | quickjs 目标 → primjs（含 inspector 源，`ENABLE_QUICKJS_DEBUGGER=ON`） |
| C++ 引擎 | `native/src/vm.cpp` `natives.cpp` `value.cpp` `fjs_internal.h` | JS_*→LEPUS_* 移植；value.cpp 按 JSValue 8B 布局重写 |
| C++ 引擎 | `native/src/debugger.cpp`（新） | QJSDebuggerCallbacks2 实现 + C-owned TCP client + 暂停消息循环 + console_message 并入 on_log |
| C++ 引擎 | `native/include/fjs.h` | +2 函数（契约层先行） |
| C++ 引擎 | `native/tools/fjsc.cpp` `fjsrun.cpp` `test/main.cpp` | 移植 + engine id + 字节码 round-trip + GC 压力用例 |
| Dart 宿主 | `lib/src/ffi.dart` | attach/detach 绑定（OPTIONAL 语义，符号缺失降级） |
| Dart 宿主 | `lib/src/engine.dart` | `runSource` filename 换真名（bundle.js / unit id / pages/<chunk>.js）；attach 接线 |
| Dart 宿主 | `lib/src/dev_client.dart` | 下行 `debug on <port>` / `debug off` 解析 |
| 打包 | `packages/fjs/src/bundler/build.ts` | esbuild target → es2019（PrimJS ES 上限） |
| 文档 | `docs/toolchain.md` `docs/roadmap.md` `docs/architecture.md` `docs/jsi-and-native-modules.md` `docs/web.md` | 见 tasks 文档组 |

## 3. 方案

**选定**：换 PrimJS（先 spike 门控）+ C 层 TCP 传输 + CLI 薄中继 + Chrome DevTools 直连。
PrimJS 把自研方案里最难、最容易错的部分（解释器 hook、栈帧采集、作用域序列化、
evaluateOnCallFrame）整个拿掉，CDP 语义引擎内实现，宿主只管传输；由字节跳动按 Lynx
节奏维护（tag 4.1.1 / 2026-08）。CLI 侧因此没有协议翻译层——DevTools 的 CDP 消息字节
搬运给引擎，引擎回包字节搬运回 DevTools。

**spike gate**（spec §6.1-6.4）：CMake 独立构建、LEPUS API 覆盖（以 natives.cpp 的 API
面为清单实扫）、CDP 真连冒烟（断点/单步/locals/evaluateOnCallFrame/console）、Android
NDK 可行性。不过则启用备选。

**被否掉的备选**：

1. **quickjs-ng 自研 hooks**（gate 不过时的启用方案）：`fjs_debugger_impl.c` 以
   `#include` 进 quickjs.c 尾部拿 internals + ~30 行 `#ifdef FJS_DEBUGGER` hook
   （JS_CallInternal 入/出栈、每 op 旗标检查、pc2line 断点匹配、STEP_INTO/OVER/OUT
   深度判定）+ 同样的 C socket 通道 + CLI 加一层 CDP⇄私有协议翻译。核心 1.5-2.5k 行
   C，此后每次升级 quickjs-ng 重对 hook 点；上游无 debugger（quickjs-ng #757 仅讨论，
   bnoordhuis 方案未落地；sponge 移植分支断点行号是坏的）。被否原因：把最容易错的
   引擎内永久自维护，换不来自 PrimJS 的任何能力。
2. **lynx-devtool 整体采用**：桌面端是 Electron + fork 的 Chrome DevTools，设备端要嵌
   LynxDevtool agent，绑定 Lynx 页面会话模型（元素树/多视图 view_id），纯 JS VM 场景
   无官方支持，需逆向会话握手。被否原因：为 JS 调试引入半个 Lynx；其价值（CDP 前端）
   已被"自建薄中继 + chrome://inspect"覆盖。
3. **直接换 PrimJS 不做 spike**：LEPUS API 覆盖面、CMake 坑（无条件 `-DEMSCRIPTEN`）、
   32 位支持等未知问题会推迟到中段才暴露。被否原因：spike 只要 1-2 天，风险前置。
4. **调试传输走 Dart/dev-WS**：暂停时 UI isolate 阻塞在 JS 栈里，WS 消息收不进来
   （engine.dart dev.onEval 同步调 runSource 即证据）。Dart 帮助 isolate 也救不了：
   NativeCallable.isolateLocal 单 isolate 契约（fjs.h 线程契约）。被否原因：物理上不通，
   传输必须 C 层持有。
5. **暂停 = 中断展开（interrupt + unwind）**：QuickJS 解释器状态在 C 栈上，一旦返回
   无法恢复现场，"断点"变成"杀掉本次执行"。被否原因：不能 resume 的调试器没有意义。

## 4. 风险

- **LEPUS API 无非 Lynx 官方宿主示例**：spike 用编译器实扫 natives.cpp 的 API 面逐一
  对应，缺的（如有）在 gate 前暴露。
- **ES2019 上限**：esbuild target 降级（`?.`/`??`/类字段等被 lower），需全量回归
  demo/hello-fjs/bench；运行时源码里若有引擎不支持的运行期特性会在真机立刻暴露。
- **tracing GC 取代引用计数**：析构时机变化，fjs-test 补 GC 压力用例；handle 表
  （spec 038）语义复查。
- **32 位 Android**：PrimJS "compatible memory management 默认 arm64"，armv7 待
  spike 确认；不支持则在 spec"不做"注明仅 arm64+。
- **暂停期间 UI 冻结**：预期语义（暂停 JS 线程），文档写明；HMR 消息同样被延迟到
  resume 后处理，属预期。
- **PrimJS API churn**：QJSDebuggerCallbacks2 已迭代到 v2；vendor 锁 tag，升级成本
  写进 roadmap 维护说明。
- **静默失效点**：旧引擎二进制缺调试符号（Dart 侧查符号降级 + warnOnce）、
  `fjs debug` 起 38902 被占（换端口并提示）、VM TCP 连不上（CLI 侧提示 app 未带
  调试通道，检查 `fjs run` 是否重新安装过 debug 版 native）。

## 5. 验证路径

```bash
# spike（gate）
git clone --depth 1 --branch 4.1.1 https://github.com/lynx-family/primjs /tmp/fjs-spike/primjs
cmake -B /tmp/fjs-spike/build -DENABLE_QUICKJS_DEBUGGER=ON -DCMAKE_BUILD_TYPE=Release \
      -S /tmp/fjs-spike/primjs && cmake --build /tmp/fjs-spike/build -j
# mini-host + node 中继 + Chrome DevTools 冒烟（tasks T011/T012）

# 引擎迁移后
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
./build-native/fjs-test
cd ../../.. && pnpm run typecheck && pnpm test
pnpm --filter demo run build:release && pnpm --filter hello-fjs run build:pages

# 端到端
fjs dev            # 终端 A
fjs debug          # 终端 B（127.0.0.1:38902）
# Chrome: chrome://inspect → Configure → 127.0.0.1:38902 → inspect → 断点演示
```
