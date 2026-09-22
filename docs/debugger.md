# 调试器内部实现

> 第四层第 14.5 篇。**怎么用**在
> [toolchain.md §断点调试](toolchain.md#断点调试fjs-debug)——本篇不重复用法，
> 只讲这套东西是怎么搭起来的、边界在哪、改哪里。
> 前置：[架构](architecture.md)、[JSI 与原生模块](jsi-and-native-modules.md)。
>
> 一句话：**CDP 语义由 PrimJS 自带的 inspector 实现，中继只搬字节；而这套
> inspector 连同传输一起装在一个可插拔的 .so 里，release 物理不存在。**

## 1. 全链路

```
Chrome DevTools 前端
   │  CDP over WebSocket（ws://127.0.0.1:38902/cdp，只绑回环）
   ▼
fjs debug 中继（packages/fjs/src/debug/cdp-server.ts，跑在开发机上）
   │           ├─ Debugger.* / Runtime.* / Profiler.*  ──→ 原样透传
   │           └─ DOM / CSS / Network / Page …（浏览器域）
   │                 └─→ 翻译成 Runtime.evaluate('__fjsDevtools.cmd(…)')
   │  换行分帧的 CDP 字节流 over TCP（:38903，VM 主动拨出）
   ▼
libfjs_debugger.so（设备上，可插拔模块）
   │  socket 传输 + PrimJS inspector 全套 + attach/detach 编排
   │  attach 时把 6 个函数指针填进引擎的钩子表
   ▼
libfjs.so（纯引擎：PrimJS 4.1.1 + 一张空钩子表 + 一个传输槽位）
```

两条数据通路，别混起来：

- **调试通路**（spec 088）：断点、栈帧、作用域、求值、console。**语义全在
  设备侧**（PrimJS inspector），中继不解析内容。整条路跑在 JS 线程上，
  不经过 Dart。
- **数据平面**（spec 089）：Elements 与 Network 面板。引擎不懂 DOM，这两个
  域由中继桥接到**运行时里的** `__fjsDevtools`，本质是在调试通路上跑
  `Runtime.evaluate`。

## 2. 五个设计决策

| 决策 | 为什么 |
|---|---|
| 换引擎到 PrimJS，而不是给 quickjs-ng 自研 hooks | quickjs-ng 唯一的执行控制钩子是 `JS_SetInterruptHandler`，没有断点/栈帧/作用域 API；PrimJS 自带完整 CDP 实现，宿主只需提供传输（spec 088 §1） |
| 传输放在 C 层，不用 Dart 的 WebSocket | 断点暂停时 Dart 事件循环正阻塞在 JS 调用里，Dart 侧收不了包。传输必须在被阻塞的那条线程上自己收发 |
| VM 拨出，DevTools 侧只绑 `127.0.0.1` | 手机不开端口（与 dev WebSocket 同方向）；CDP 能求值任意代码，不能像 dev server 那样绑 `0.0.0.0` |
| 调试器做成独立 .so，而不是编译开关 | 一份引擎产物走所有构建，release 靠**不打包这个文件**来保证没有调试器——不依赖宏是否正确定义（spec 090 §2） |
| 浏览器域由中继桥接，而不是在引擎里实现 | 引擎里没有 DOM 概念。桥接层是纯 JS，改一个面板不用重编原生 |

spec 090 §2.1 记了一次推翻：初版把 inspector 留在引擎里只拆传输，release
只减 2%；实测引擎→inspector 只有 6 个符号 10 个调用点，于是把整个语义层
（~430 KB）挪进模块，Android arm64 `libfjs.so` 2.21 MB → 1.85 MB，桌面 −26%。

## 3. 四条契约（宪法 II：改一侧必改另一侧）

### 3.1 引擎 ↔ 模块：传输槽位

`packages/flutter_fjs/native/include/fjs.h` L240-268。引擎持有一个槽位，
模块在 attach 时装进去：

```246:256:packages/flutter_fjs/native/include/fjs.h
typedef struct FjsDebuggerTransport FjsDebuggerTransport;
struct FjsDebuggerTransport {
    void *opaque;
    /* Called from fjs_vm_pump: feed any queued frontend lines. */
    void (*feed)(void *opaque, FJSVM *vm);
    /* Called when the frontend sends Debugger.resume: the transport must
     * unblock its pause loop so the engine can continue. */
    void (*quit)(void *opaque);
    /* Called once at VM teardown, before the context is freed. */
    void (*close)(void *opaque);
};
```

`fjs_vm_debugger_attach/detach` 的声明留在 `fjs.h`，但**由模块导出，不是
libfjs**。两个符号都是 OPTIONAL（`fjs_vm_heap` 的老规矩）：lookup 不到就是
"本构建不支持调试"，不是错误。三处同步：`fjs.h` / `lib/src/ffi.dart` /
[jsi-and-native-modules.md §调试器 ABI](jsi-and-native-modules.md#调试器-abispec-088optional-符号)。

### 3.2 解释器 ↔ inspector：六入口钩子表

vendored PrimJS 的本地补丁（记在 `native/primjs/VENDORED.md`）。解释器里
10 个调用点（`quickjs.cc` 8 处 + `quickjs_gc.cc` 2 处）不再直接调 inspector，
改为经 `inspector_hooks.h` 的函数表转发：

```36:59:packages/flutter_fjs/native/primjs/src/interpreter/quickjs/include/inspector_hooks.h
typedef struct QJSInspectorHooks {
  // inspector/interface.h: DoInspectorCheck
  void (*inspector_check)(LEPUSContext *ctx);
  // quickjs-inner.h: DebuggerPause
  void (*debugger_pause)(LEPUSContext *ctx, LEPUSValue val, const uint8_t *pc);
  // inspector/interface.h: HandleDebuggerException
  void (*debugger_exception)(LEPUSContext *ctx);
  // inspector/debugger_inner.h: AdjustBreakpoints
  void (*adjust_breakpoints)(LEPUSContext *ctx, struct LEPUSScriptSource *s);
  // ... parse_script / set_function_bytecode_script ...
} QJSInspectorHooks;

// NULL until a debugger module installs itself; back to NULL after detach.
QJS_EXPORT_FOR_DEVTOOL extern const QJSInspectorHooks *qjs_inspector_hooks;

QJS_EXPORT_FOR_DEVTOOL void QJSSetInspectorHooks(const QJSInspectorHooks *h);
```

表为空 = 调试器物理不可达。10 处调用点**本来就**包在
`#ifdef ENABLE_QUICKJS_DEBUGGER` + 运行时开关里，改走函数表没有引入新的热
路径分支。两侧都带 `ENABLE_QUICKJS_DEBUGGER` 编译，结构布局一致，所以
`.fjsbundle` 字节码格式不受影响。

### 3.3 dev server ↔ app：两条纯文本下行命令

与 `eval` / `perf` / `reload` 同级，平时零流量：

| 命令 | 下发时机 | app 侧动作 |
|---|---|---|
| `debug on <port>` | 注册中继时下发给在线的 app；之后每个 app 连上来时补发 | `onDebugAttach` → 整包重载 → attach |
| `debug off` | `fjs debug` Ctrl-C 退出，或它的连接断掉 | `onDebugDetach` → detach |

**中继是服务端的一份状态，不是一次广播**，这点很关键：`fjs run ios` 编译
几分钟，app 几乎总是晚于 `fjs debug` 才连上来，一次性广播等于没发。

1. app 连上 dev server 后先自报身份 `{fjs:'app'}`（`dev_client.dart`
   `_openSocket`）。浏览器页面**不会**自报——web 的 reload snippet 把任何
   未知消息都当 reload，给它发 `debug on` 会导致重载循环。
2. `fjs debug` 作为 tool 连上来，发 `{fjs:'debug-relay', on, port}`。
   server 把它记进 `DebugRelayRegistry`（`packages/fjs/src/dev/debug-relay.ts`），
   同时推给已在线的 app。
3. 之后任何 app 自报身份时，server 用 `greeting()` 补发 `debug on <port>`。
4. 中继的生命周期挂在那条 tool 连接上：`fjs debug` 断开 = 端口没人听了，
   注册随之作废并给 app 发 `debug off`。别的 tool（`fjs log`）来去不影响。

CLI 侧对称地用 `keepDevServerLinked()`（`dev/tool-conn.ts`）保持这条连接，
dev server 重启就重连并重新注册——否则中继还活着、Chrome 也能连上，只是
永远没人告诉 app 往哪拨，看起来就是"调试器坏了"。

### 3.4 中继 ↔ 运行时：`__fjsDevtools.cmd`

运行时挂一个全局，签名是"字符串进、JSON 字符串出"，方便中继用
`Runtime.evaluate` 直接拿结果：

```274:278:packages/fjs-runtime/src/devtools.ts
  g.__fjsDevtools = {
    version: '092-1',
    cmd: (method: string, paramsJson: string): string =>
      JSON.stringify(cmd(method, paramsJson)),
  };
```

支持的 method：`DOM.getDocument`、`Dom.version`、`Dom.structuralVersion`、
`Dom.drainContent`（排空自上次拉取以来的文本/属性编辑）、
`DOM.requestChildNodes`、`DOM.getFlattenedInnerHTML`、`DOM.querySelector`
（后三个是按需展开树的懒访问，见 §5 中继层的行为清单，spec 093）、
`CSS.getComputedStyleForNode`、`CSS.getMatchedStylesForNode`（同一个
cmd 同时答 inline 与命中规则，中继拆成两种 CDP 形状）、
`CSS.getInlineStylesForNode`、`Network.drain`、`Network.getResponseBody`。
**加面板能力就是往这张表里加一条，再在中继侧加对应的 CDP 方法路由。**

## 4. 原生层：引擎与模块

### 4.1 产物

| target（`native/CMakeLists.txt`） | 内容 | 产物 |
|---|---|---|
| `fjs` | `vm.cpp` / `natives.cpp` / `value.cpp` / `debugger-glue.cpp` + `quickjs` | `libfjs.so`、`libfjs.a` |
| `fjs_debugger` | `debugger-plugin.cpp` + `quickjs_inspector`（OBJECT） | `libfjs_debugger.so` |
| `fjs_debugger_core` | 同上，静态归档 | Apple 用 |

父 CMake 强制 `ENABLE_QUICKJS_DEBUGGER=ON` + `PRIMJS_INSPECTOR_AS_MODULE=ON`
+ `FJS_EXPORT_ENGINE_INTERNALS`（`native/CMakeLists.txt` L33-37）。最后一个
宏是因为 inspector 现在跨 .so 边界调引擎内部：反向有 101 个符号，其中 23 个
原本是 `QJS_HIDE` 的，必须放开可见性；另有 7 个 GC 写屏障只有 inspector 在
用，引擎侧要留一个取地址的锚点（`inspector_hooks.cc` 的 `qjs_inspector_gc_anchor`），
否则 `gc/collector.cc` 根本不会被链进来。

引擎侧只剩 `native/src/debugger-glue.cpp`：装/卸传输槽位、在 pump 里喂一次、
在 VM 销毁时关掉。没装传输时整个文件是惰性的。

### 4.2 attach 之后发生什么

`native/src/debugger-plugin.cpp`：

1. `connect()` 到中继的 VM 通道——**app 拨向开发机**，不是被连。拨号地址有
   两个候选，依次尝试：先 `127.0.0.1`（`fjs debug` 在检测到 adb 时用
   `adb reverse tcp:<vmPort>` 把通道发布到每台在线 Android 设备上——这是
   **可选加速器**，换来的好处是拨号零延迟、且 USB 真机在没有 Wi-Fi 路由时
   也能调试；adb 从 PATH、`ANDROID_HOME` 和各平台默认 SDK 位置解析，找不到
   就静默跳过），不通（iOS 真机、无隧道的设备——设备本地回环上没有监听会
   立刻 ECONNREFUSED，不会白等）再拨 dev server 的 host。两个候选都已实测
   稳定。曾经"连续 5 次全部 2s 超时"的真凶不在网络：`poll()` 被 ART/Flutter
   打到 UI 线程的信号打断（EINTR），旧代码把 EINTR 当超时报了失败——shell
   里 `nc` 0.7s 能通就是佐证。现在 poll 对 EINTR 重试。
2. 首次拨通后 **TCP 会话跨 reload 存活**（`transport_close` 在 VM 销毁时只
   摘钩子、不关 socket）。VM 重建后的 attach 不再重拨，只重装 per-VM 的
   inspector 状态，并给中继发一行 `{"fjs":"debug-reload"}`——app 的 fetch id
   从 1 重新计数，中继据此清掉 Network 面板的去重缓存。这消掉了旧版"每次
   reload 先关 socket 再重拨"的两类故障：重拨撞上中继还没处理完旧连接的
   close（被当第二个 app 拒掉），以及槽位被残留 app 实例抢走后当前 app 永久
   失去调试通道。
3. `QJSDebuggerInitialize(ctx)` + `PrepareQJSDebuggerForSharedContext(ctx, funcs, 23, true)`
   注册 23 槽的 `QJSDebuggerCallbacks2`（宏顺序的 `void**` 数组）。
4. `QJSSetInspectorHooks(&kInspectorHooks)` 填六入口；`fjs_debugger_set_transport(vm, &kTransport)` 装传输。
5. 此后两种消息路径：
   - **运行中**：`fjs_vm_pump` 第 0 步调 `transport_feed` → `poll` socket →
     按行切（半行跨 recv 存在 `line_buf`，>64KB 的消息不再丢尾）→
     `PushAndProcessProtocolMessages`。
   - **暂停中**：引擎回调 `cb_run_message_loop_on_pause`，插件在这里
     **阻塞**收包 → `ProcessPausedMessages`，直到引擎处理完 `Debugger.resume`
     调 `cb_quit_message_loop_on_pause`。这就是"断点期间 UI 冻结"的实现——
     暂停的是 JS 所在的 UI isolate（见 [threading-model.md](threading-model.md)）。

失败路径一律把原因写进引擎的 `last_error`（"refused: errno 111"、"connect
timed out"），Dart 侧 `_reattachDebugger` 打出原因并按 0.8s→1.6s→3.2s→6.4s
退避重拨（最多 4 次；重拨成功后补一次整包重载，让脚本进新 VM 的脚本表）。
`debug off`（detach）清空钩子表、关 socket；VM 销毁只摘钩子、留 socket。
Windows 没有传输实现，attach 直接返回 -1。

### 4.3 release 怎么保证没有调试器

| 平台 | 机制 |
|---|---|
| Android | `android/build.gradle` L55-59：release 任务从 jniLibs 排除 `**/libfjs_debugger.so`；`-PfjsKeepDebugger=true` 可保留 |
| iOS / macOS | `fjs_debugger.xcframework` 是静态归档，只有 `ios/Classes/FlutterFjsPlugin.m` L36-50 的 `#if DEBUG` keep-alive 表引用它，Release/Profile 一个 member 都不拉 |
| ohos | `ohos/build-profile.json5` 的 `buildModeBinder` 把 release/profile 绑到带 `nativeLib.filter.excludes` 的配置，插件 HAR 里就没这个文件 |
| 桌面 | `fjsrun` / `fjs-test` 只链 `libfjs`，用 `native/tools/debugger-module.h` 的 dlopen 找邻接的模块，找不到就报"本构建无调试器" |

Dart 侧对称（`lib/src/ffi.dart` L205-263）：非 `kDebugMode` 直接不找；
Android/ohos 用 `DynamicLibrary.open('libfjs_debugger.so')`，Apple 用
`DynamicLibrary.process()`；任何一步失败都把 `debuggerAttach` 置 null，
`debuggerAttachHost` 返回 -1、`debuggerDetachVm` 静默 no-op。

### 4.4 为什么 attach 要重载一遍

脚本只有在 debugger 已启用时 eval 才会进 inspector 的脚本表。所以
`onDebugAttach` 存下端口后整包重载，`_reattachDebugger` 在 **shared.js 和
bundle 的 eval 之前**完成 attach。`addPrelude` 会立刻执行：把它排在 attach
前面的话，store / shell / 插件不进脚本表，Sources 里就看不到被 import 的
`.ts` / `.vue`（page chunk 和 `main.ts` 仍在，因为它们在 attach 之后才跑）。
之后 DevTools 无论什么时候连上来，`Debugger.enable` 都会补发全部
`scriptParsed`，连接先后无所谓。

断点按 **url + 行号**匹配，url 就是 eval 时传的文件名，所以文件名必须是
真名而不是 `<eval>`：`bundle.js`、`pages/<chunk>.js`、`shared.js`、
`fjs-eval.js`。这些名字不用源路径——source map 的 `sources` 已经是
`src/components/Foo.vue`，两边同名时 DevTools 会把产物和原文当成同一个
脚本（spec 094）。

## 5. 中继层（`fjs debug`）

`packages/fjs/src/commands/debug.ts` + `packages/fjs/src/debug/cdp-server.ts`。

| 端口 | 谁监听 | 谁连 | 绑定 | flag |
|---|---|---|---|---|
| 38902 | 中继（HTTP + WS） | Chrome DevTools | `127.0.0.1` | `--cdp-port` |
| 38903 | 中继（TCP） | app VM 拨出 | `0.0.0.0` | `--vm-port` |
| 38900 | dev server | 中继作为 tool 连入 | — | `--port` / `--host` |

两侧都只允许一个连接（第二个 DevTools 收 close 1013，第二个 VM 被 destroy）。
VM 侧的"一个"指的是**进程**不是 app：`fjs run` 被硬杀（终端关闭、"Lost
connection to device"）会留下还活着的 app 实例，它的调试会话占着槽位，新
app 的拨号就被拒——所以 `fjs run` 在 `flutter run` 之前对目标设备
force-stop 同包名的残留实例，app 侧对失败的 attach 做退避重拨兜底。
HTTP 侧服务 `/json/version`、`/json/list`、`/json`——这是 `chrome://inspect`
的发现端点，但实测那条路不可靠，横幅打印的是 `devtools://…?ws=…` 直连命令。

**分流**：`Debugger.*` / `Runtime.*` 等引擎域原样透传；`DOM` / `CSS` /
`Overlay` / `Emulation` / `Page` / `Network` / `Console` / `Log` /
`Performance` 被拦下来走桥接（`cdp-server.ts` 的 `BRIDGED`，L58）。桥接用的
`Runtime.evaluate` id 从 `1_000_000_000` 起，避免撞 DevTools 自己的 id，
5 秒超时。

几个只在中继里存在的行为：

- **Elements 的 nodeId 是算术映射**：element `id*2+1000`、text `id*2+1001`、
  document 固定 1。不需要失效表。`DOM.documentUpdated` 的触发面（spec 093）：
  ① 世界重置——app 的 `debug-reload` 标记（VM 重建）；② 死节点自愈——点了
  已不存在的旧节点（styleCmd 的 `exists:false`）；  ③ **结构变化**——中继在
  `DOM.getDocument` 应答后起 1.5s 低频轮询 `Dom.structuralVersion`（运行时侧
  只在 element insert/remove 与页根 flutterRoot/releaseRoot 递增的计数器），
  跨阈值推一次。基线是**这次快照里的版本号**（`structuralVersion` 随
  getDocument 一起返回），不是第一次轮询读到的值——后者会把打开面板后、
  首拍轮询前的路由 push 当成“已经在树上”，第二页根（`__navKey="1"`）
  再也不出现。冷却吞掉的那次推送不推进基线，下一拍会补推。**纯属性/文本变化不递增该计数器、也不推 `documentUpdated`**——真实
  前端收到 `documentUpdated` 会重启一切未决的样式请求，频繁推送等于样式
  面板永远转圈（092 第一版按帧轮询实测踩坑）。同一条 1.5s 轮询改为排空
  `Dom.drainContent`：文本推 `DOM.characterDataModified`（nodeId =
  `id*2+1001`），属性推 `DOM.attributeModified`（nodeId = `id*2+1000`），
  前端就地改一个节点。结构重拉已经发出时丢掉这批编辑，避免和整树重拉赛跑；
  单次超过 200 条则退回一次 `documentUpdated`。首次 `getDocument` 之前的
  写入已经在快照里，不入队。三条 `documentUpdated` 触发路径共用 **1s 冷却**
  （`INVALIDATE_COOLDOWN_MS`），v-for 批量插入在冷却窗口内折叠成一次推送。
  另有两处按真实前端源码对齐的应答形状：`inlineStyle` 是 CSS.Style
  本体（包一层 `{style:…}` 前端解析即抛异常，转圈）；`computedStyle`
  是扁平 `[{name,value}]` 数组（这版前端 SDK 直接 for..of 迭代它）。
- **按需展开树的懒方法**（spec 093，修「面板只显示根壳、展开为空」）：
  真实前端首拍 `DOM.getDocument` 带 `depth:1`，之后靠按需方法拉深层，
  它们**不落兜底空应答**，而是从当前文档重新序列化。协议形状按
  `browser_protocol.json` 实测核对（第一版把子树塞进 `requestChildNodes`
  的应答体是错的——该命令按协议返回 **void**，前端只等随后的事件）：
  - `DOM.requestChildNodes {nodeId}` → 应答 `{}`，随后推送
    **`DOM.setChildNodes {parentId, nodes}` 事件**（`nodes` 为该节点子树
    的 `mapNode` 序列化；找不到回空 `nodes`）；
  - `DOM.querySelector {nodeId?, selector}` → 命中回 `nodeId`、未命中回
    `nodeId:0`（CDP 约定），选择器在运行时侧用最小匹配器解析（支持
    tag/#id/.class/[attr] 与后代组合器，`:pseudo` 剥掉不求值——静态快照没有
    hover//active 态，与 `matchedRulesOf` 同口径）；
  - `DOM.getFlattenedInnerHTML` 在当前协议里**不存在**（全 domain 无
    `*InnerHTML*` 命令，前端不会发）；中继保留一个无害的探针分支
    （回 `{result, type:'string'}`），不承担展开职责。
- **命中规则与合成样式表**（spec 092 第三轮）：`CSS.getMatchedStylesForNode`
  的 `matchedCSSRules` 由运行时 `matchedRulesOf(id)` 按需产出——点击节奏
  对单个元素走 match cache 同源的候选桶，不缓存、不碰 compute 热路径；
  selector 带源文本（`Selector.text`），声明是 kebab 化的
  `[{name,value}]`，`origin: 'regular'`。规则挂在合成样式表
  `styleSheetId: 'fjs-main'` 上，这张表的 `CSS.styleSheetAdded`
  **必须在应答 `CSS.enable` 之后推，不能在 WS 连接时推**：前端 CSSModel
  在构造函数里先注册 dispatcher 再发 `enable()`，连接时推送会输给模型
  创建时机，表现为同一份代码有时规则在、有时整栏空（`CSS.disable`
  重置重发）。
- **Console 合成事件**（spec 092）：中继在 DevTools 连上时先发一条自己的
  `Runtime.executionContextCreated`（"fjs host"，id 固定 424242），`fjs debug`
  把 dev server 广播的 `{fjs:'log'}` 行交给 `consoleLine()` 合成
  `Runtime.consoleAPICalled`——Dart 侧进度日志（`[dev]`/`[nav]`）由此进
  DevTools Console，与引擎自己合成的 JS console（上下文 "fjs engine"）
  并存不重叠：调试器附加期间引擎导流 console，log 通道收不到 JS 行。
- **Page 域的补桩**（spec 092）：`getNavigationHistory` 回一条 fjs://app
  记录（空 `{}` 会让 screencast 面板的 requestNavigationHistory 抛
  undefined.length）；`startScreencast` 明确报错拒绝（Flutter 侧截屏管线
  未做，roadmap）——假应答会让前端留一块永远空白的预览区。
- **Network 是 500ms 轮询** `Network.drain`，把结果合成
  `requestWillBeSent` / `responseReceived` / `loadingFinished` 三个事件；
  `emulateNetworkConditionsByRule` 的应答必须带 `ruleIds: []`（前端启动
  时读它的 length）。
- **响应体由中继缓存**：`Network.getResponseBody` 答的是 relay 侧
  `bodyCache`，不回设备。没缓存时明确报错（太大 / 早于本次会话），
  不是静默空体。
- **DevTools 断开时补发 `Debugger.disable`**（L514-526）并清空缓存：会话
  复位让重连能重放脚本，同时把停在断点上的 app 解冻——调试器都没了，冻结
  没有意义。

桌面彩排不需要设备：`fjsrun --debug-connect 127.0.0.1:38903 dist/bundle.js --pump 60000`
走的是同一套链路（`native/tools/fjsrun.cpp` L191-214），attach 同样发生在
eval 之前。

## 6. 运行时数据平面

两个文件，分工是"槽位在所有构建里，实现只在 dev 构建里"：

| 文件 | 进哪些包 | 作用 |
|---|---|---|
| `packages/fjs-runtime/src/devtools-hooks.ts` | **全部** | 一组 no-op 槽位 + 类型 |
| `packages/fjs-runtime/src/devtools.ts` | 仅 dev / `--devtools` | 真实现 + `__fjsDevtools` 全局 |

调用点直接调槽位，不 import 数据平面——静态 import 会把整个数据平面拖进
release 包：

| 调用点 | 槽位 |
|---|---|
| `ui/element.ts` L630 | `recordProps` |
| `vue/renderer.ts` L762 / L768 | `recordText` |
| `vue/renderer.ts` L1177 | `provider`（Elements 用的影子树） |
| `net/fetch.ts` L433 / L362 / L192 | `netRequest` / `netResponse` / `netBodyMaterialized` |

门控是 esbuild define `__FJS_DEVTOOLS__`（`packages/fjs/src/bundler/build.ts`
的 `fjsDefines()`）：`fjs dev` 和 `fjs build --devtools` 置 true，普通
`fjs build` 与 web 构建置 false，`devtools.ts` L233-241 的 boot 调用被替换成
常量条件，整个模块随之 DCE。**release 的残留成本是每个调用点一次空函数
调用**（fetch 的两处还会构造一个参数对象），数据平面本体一个字节都不在包里。

两个与"何时记录"有关的细节，改这块之前先读：

- `netActive` 在首次 `Network.drain` 之前是 false——面板没打开就不记。
- 响应体在 **app 自己读**（`text()/json()/arrayBuffer()` → `materialize()`）
  时才记录，不是响应到达时。这样既躲开新句柄的空借用竞态，也不会为没人读
  的大响应做投机拷贝。上限 512 KB，超出只记长度。

## 7. 怎么验证

| 手段 | 位置 | 覆盖 |
|---|---|---|
| 原生 loopback 全链路 | `native/test/main.cpp` L286-372（`FJS_DEBUGGER` 下） | dlopen 模块 → 本机 listener → attach → `setBreakpointByUrl` → 命中 → 另一线程发 `resume` → 断言脚本跑完 |
| 中继单测 | `packages/fjs/test/debug-cdp.test.ts` | 发现端点、双向分帧转发、`DOM.getDocument` 经 evaluate 桥、第二个 DevTools 被拒、`fjs-map:` 内联 |
| Vue source map | `packages/fjs/test/vue-sourcemap.test.ts`、`dev-reload.test.ts` | script / template 行映回 `.vue`；dev 才写 map；page chunk 与 `shared.js` 都盖章 |
| 数据平面单测 | `packages/fjs-runtime/test/devtools.test.ts` | 元素树序列化、computed/inline 样式、drain arming、body 在 materialize 时落库、512 KB 路径 |
| 桌面彩排 | `fjsrun --debug-connect` + `fjs debug` | 不用设备跑通断点/面板 |
| 设备端到端（手动） | `specs/088-devtools-debugger/spike/cdp-client-device.mjs`、`specs/089-devtools-panels/panels-client.mjs` | 真机/模拟器断点与面板 |
| 产物矩阵（手动） | `nm libfjs.so \| grep QJSDebuggerInitialize` 应为空；`fjs build` 产物 grep 不到 `__fjsDevtools` | spec 090 验收 §5.2 |

## 8. 边界与已知坑

- **只调 dev 源码模式的主 VM**。release 字节码、Worker（独立 isolate +
  独立 runtime）、小程序端都不在范围内；web 端用浏览器自带 DevTools
  （[web.md 已知差异](web.md#已知差异)登记了这一行）。
- **dev 有 Vue SFC source map**（spec 094）。`fjs dev` 给 bundle、page
  chunk、`shared.js` 写 `.js.map`，脚本末尾是 `//# sourceMappingURL=fjs-map:<路径>`。
  PrimJS 只把这个字符串放进 `scriptParsed.sourceMapURL`，不解释 map。
  中继在转发给 Chrome 之前把 `fjs-map:` 读成 data URL——DevTools 跑在
  `devtools://`，不会自己去拉 dev server，而 `Network.*` 又被中继桥接走了。
  Sources 里因此能打开 `.vue` 和项目 `.ts` / `.js`（页面在 page chunk 里，
  shell / store / 插件在 `shared.js` 里，路径按脚本 URL 折回 `src/...`）。
  断点下在 `<script setup>` 和这些模块的可执行行上。`node_modules` 里的
  `pinia` / `vue` / `vant` 不进 map。
  `<style>` 不在 map 里。template 行有映射就停，没有独立语句的行不停。
  `fjs build` / 字节码不写 map。路径里的空格会被编码，因为引擎的
  magic-comment 扫描拒绝空格。
- **`chrome://inspect` 不可靠**：填 `localhost:38902` 必然失败（macOS 先解析
  到 `::1`，中继只监听 IPv4 回环），填对了也未必出现且不报错。用直连命令。
- **调试器附加期间 `console.log` 走 CDP**，被合成 `Runtime.consoleAPICalled`
  送进 DevTools，`fjs log` 那条通路可能就收不到这些行了。
- **`native/primjs/PRIMJS_VERSION` 文件内容（`2.11.1-rc.1`）不是实际版本**。
  以 vendoring 的 git tag `4.1.1` 为准，`fjs_engine_id()` 里编码的是
  `primjs-4.1.1`——这个字符串是 `.fjsbundle` 的锁版本值，动它就要重编所有
  字节码产物。
- app 构建的 esbuild target 因为 PrimJS 的语法上限定在 `es2019`
  （`bundler/build.ts`），web 构建仍是 `es2020`。

## 9. 改这块的入口

| 我要… | 从哪开始 |
|---|---|
| 给 Elements/Network 加一项数据 | `devtools.ts` 的 `cmd()` 加 method + `cdp-server.ts` 的 `routeBridged` 加路由；要新采集点就先在 `devtools-hooks.ts` 加槽位 |
| 接 VS Code / DAP 前端 | 只动中继：CDP 是标准协议，引擎侧和设备侧不用改 |
| 加一个平台的 release 剔除 | 照 §4.3 的表补一行，验收看 §7 的产物矩阵 |
| 改 attach/detach 的 C ABI | `fjs.h` + `ffi.dart` + [jsi-and-native-modules.md](jsi-and-native-modules.md) 三处同步，注意 OPTIONAL 语义 |
| 升级 vendored PrimJS | 先读 `native/primjs/VENDORED.md` 的本地补丁清单（钩子表、`base_export.h` 可见性、CMake 拆 target），这几处每次都要重打 |
