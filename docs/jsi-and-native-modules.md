# JSI 机制与原生模块编写指南

> 第一层第 4 篇。前置：[原理](principles.md)、[线程模型](threading-model.md)、
> [整体架构](architecture.md)。
>
> 大多数"加一个原生能力"的需求**不需要写 C++** —— 先看
> [modules.md](modules.md) 的 Dart 侧 widget 扩展够不够用。

ufjs 的"JSI"指：JS 引擎（QuickJS-ng）以 C++ 源码嵌入应用，宿主函数
通过 `JS_NewCFunction` 直接收发 `JSValue`——**JS 与 C++ 之间没有 JSON、没有
桥接序列化**，与 React Native 的 JSI 设计目标一致。

## 三条通信通道

### 1. JS → C++：内建 natives（natives.cpp）

```js
__fjs.natives.fibonacci(10);      // 纯 C++ 函数，JSValue 直进直出
__fjs.fns.invokeHost('device');   // 转发到 Dart 宿主模块
__fjs.fns.uiOps(u8Array);         // UI 帧 → Dart（ArrayBuffer 直读）
__fjs.fns.nowMs();                // 引擎单调时钟
```

`__fjs` 有类型声明，随 `@ufjs/runtime` 发布在
`packages/fjs-runtime/src/native-global.d.ts`，工程侧靠那一行
`/// <reference types="@ufjs/runtime/ambient" />` 一起带进来（见
[vue3.md](vue3.md) 的「编辑器提示」一节）。两点由类型强制：

- `__fjs` 的类型是 `FjsNative | undefined`——web 构建没有引擎，必须先判空。
  日常代码别直接碰它，走 `fjs` 导出的 `invokeHost` / `nowMs` / `toast` /
  `hasNativeHost`，那层已经处理了没有宿主的情况。
- `invokeHost` 的可变参类型是 `FjsHostValue`（`string | number | boolean |
  null`），也就是下面那张 v1 ABI 表。传对象会在编译期就被拦下来，而不是在
  边界上静默变成 null。

这个 d.ts 是手写的，`natives.cpp` 改了要跟着改——它是这条边界唯一的类型描述。

`fibonacci` 的完整实现（`natives.cpp`，零序列化的示范）：

```cpp
static JSValue js_fibonacci(JSContext *ctx, JSValueConst this_val,
                            int argc, JSValueConst *argv) {
    int64_t n = 0;
    if (JS_ToInt64(ctx, &n, argv[0]) != 0)
        return JS_ThrowTypeError(ctx, "fibonacci(n): n must be an integer");
    return JS_NewInt64(ctx, fib(n));   // 直接构造 JSValue 返回
}
```

### 2. JS → Dart：宿主模块（invokeHost）

JS 侧：

```ts
import { invokeHost } from 'fjs';
const info = invokeHost<{ platform: string }>('device', 'get', 42);
```

Dart 侧（`engine.dart` 的 HostRegistry）：

```dart
engine.host.register('device', (args) => {
  'platform': Platform.operatingSystem,
  'args': args,
});
```

调用同步完成。参数与返回值跨越的是 tagged C 结构 `FJSValue`
（null/bool/int32/double/string），字符串为 utf8。对象/数组仍以字符串形式
跨越；**大块二进制**不再如此——见下一节的句柄机制（spec 038）。

### 2.5 二进制句柄（FJS_ABI_VERSION 2）

宿主模块的执行体在 Dart，C++ 指针 Dart 拿不到——所以「结构化对象」在这套
架构里落成的形态是 **number 句柄 + VM 内的字节表**（`FJSVM.handle_bytes`）：

```
Dart (http.dart)               C++ (FJSVM)                    JS (fetch.ts)
  bytes ──fjs_handle_put_bytes─▶ map[id] = bytes
                                ◀──fns.handleBytes(u8)──────── u8 = 请求/响应体
  bytes ◀──fjs_handle_bytes────  ──fns.readHandleBytes(id)───▶ new Uint8Array(copy)
                                ◀──fns.releaseHandle(id)─────   消费完即释放
```

- 数据只拷两次（Dart→C++ 写入、C++→JS 读出），之间只 travel int；
  fetch 的响应体 / 请求体因此告别 base64-in-JSON。通道成本对照：
  1MB 7053µs → 505µs、5MB 27748µs → 864µs（`test/handle_bench_test.dart`）。
- **id 单调递增、永不复用**，表随 `fjs_vm_destroy` 消失——旧 VM 的句柄在
  新 VM 必然 miss，`readHandleBytes` 对未知 id 直接抛错（宪法 V）。
- **保留策略**：消费即释放；未消费的响应体驻留到 VM 销毁（fetch 并发低，
  量级 = 响应体大小 × 未消费数，可接受；需要时再加过期）。
- `__fjs.fns` 上的三个方法（`handleBytes` / `readHandleBytes` /
  `releaseHandle`）与 fjs.h 的三个 C 函数都已进 natives 表与 bind 表；
  runtime 侧按 `engineInfo.abiVersion >= 2` 选择通道，旧引擎自动退回
  base64。

### 3. C++ → Dart：UI 帧回调

`fjs_set_callbacks` 安装 Dart 函数指针（`NativeCallable.isolateLocal`）：

- `on_log` — console 输出
- `on_ui_ops` — 二进制 UI 帧（协议表见 [architecture.md](architecture.md#ui-帧协议二进制)）
- `on_invoke_host` — 上面第 2 条的 C 侧入口

## 编写 C++ 原生模块（进阶）

1. 在 `native/src/natives.cpp` 增加函数并安装到 `__fjs.natives`：

```cpp
static JSValue js_battery(JSContext *ctx, JSValueConst, int, JSValueConst *) {
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "level", JS_NewFloat64(ctx, 0.87));
    return obj;
}
// install_natives():
JS_SetPropertyStr(ctx, natives, "battery",
                  JS_NewCFunction(ctx, js_battery, "battery", 0));
```

2. JS 侧（可在 @ufjs/runtime 里包一层类型定义）：

```ts
const battery = __fjs.natives.battery() as { level: number };
```

注意 QuickJS 的引用规则：`JS_New*` 返回的引用由调用方释放；从对象上
`JS_Get*` 拿到的引用需要 `JS_FreeValue`。C++ 侧返回 `JSValue` 给引擎时
不要释放。

## 内存与时序契约（fjs.h）

- `fjs_invoke_host` 的出参字符串：宿主 **malloc**，引擎在 JSValue 转换后
  **free**（Dart 侧 `package:ffi` 的 malloc 与 libc malloc 同源）。
- 入参字符串仅在本次调用内有效，宿主如需保留必须复制。
- `JS_Eval` 要求源码缓冲区 `src[len] == '\0'`——引擎层已统一处理
  （`nul_terminated()`），调用方传入裸字节即可。

## 离线验证（不启动 Flutter）

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
./build-native/fjs-test                 # 引擎自测（ALL PASS，含 CDP 调试器链路）
./build-native/fjsrun dist/app/bundle.js    # 跑你的 bundle，打印 console + UI 帧
./build-native/fjsrun --tap 3 dist/app/bundle.js   # 模拟点击节点 #3
./build-native/fjsrun --debug-connect 127.0.0.1:38903 dist/app/bundle.js --pump 60000
                                        # 接入 `fjs debug` 的调试通道（spec 088）
```

### 调试器 ABI（spec 088，OPTIONAL 符号）

`fjs.h` 只为调试器加了两个函数，遵守 `fjs_vm_heap` 的 OPTIONAL 规则：宿主
lookup 失败按"此引擎构建不支持调试"降级，不是错误。

```c
int32_t fjs_vm_debugger_attach(FJSVM *vm, const char *host, int32_t port);
int32_t fjs_vm_debugger_detach(FJSVM *vm);
```

attach 让 VM 作为 TCP **客户端**外连 `fjs debug` 的中继（与 dev WebSocket 同
方向，手机不开端口），之后 CDP 消息在 JS 线程上直接被引擎消费——运行中由
`fjs_vm_pump` 顺带轮询，断点暂停时引擎回调宿主阻塞等服务。调试流量不过
Dart，所以没有新事件号；三处同步为 `fjs.h` / `ffi.dart` /
本文件。引擎内 CDP 语义由 vendored PrimJS 提供（`native/primjs/VENDORED.md`）。

## fetch：异步宿主模块的范式

QuickJS 没有 socket，`fetch` 由 Dart 的 `HttpClient` 实现（`lib/src/http.dart`），
走的仍是上面那两条通道——**没有新的 C ABI**：

```
JS                          Dart                                   JS
fetch(url)  -> invokeHost('fjs.http.request', id, requestJson)
            <- dispatchEvent(id, 14 /* httpResponse */, resJson) -> promise 落定
ctrl.abort()-> invokeHost('fjs.http.abort', id)
```

`invokeHost` 是同步的（JSI host function），所以请求处理器只**发起**请求就返回，
UI 线程不会被网络阻塞；`id` 由 JS 侧分配，与 worker 句柄同样是一个纯数字，
Promise 存在 JS 侧的 pending 表里等事件回来。**任何需要异步返回的宿主模块都照这个
形状写**：invokeHost 交出请求 + 一个自己分配的 id，dispatchEvent 送回结果。
fetch 的这套时序已经提炼成了通用通道——见下一节 `invokeHostAsync`——
新模块通常不必再手搓 pending 表。

请求体和响应体都以 base64 跨界：v1 ABI 只有字符串，base64 能让二进制（图片、
protobuf）原样过去，`res.text()` 在 JS 侧自己做 utf8 解码。

JS 侧的表面是 WHATWG 的子集——没有流式 body，响应整体到达：

```ts
const res = await fetch('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'hi' }),
  timeout: 5000,          // fjs 扩展；标准里没有
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const items = await res.json();
```

- 4xx/5xx 和 web 一致：**resolve**，不 reject；只有传输失败（DNS、连接、超时、
  abort）才 reject。
- **根相对 URL 两端同源**：`fetch('/assets/x.glb')` 在 dev 下由 dev server
  解析（和浏览器一致）；release 下没有 dev server，落到 Flutter 资产
  `assets/fjs/public/<path>`——与 `<image>` 的解析规则完全相同
  （spec 026），缺失的文件 resolve 一个 404 而不是 reject。
- web 构建没有原生宿主，`fetch` 转发浏览器的 fetch。`timeout` 和本运行时的
  `AbortController`（QuickJS 没有，运行时自带一个）浏览器都不认识，web 这一侧
  会把它们桥接到真正的 `AbortSignal` 上，所以两端行为一致。
- `fetch` / `Headers` / `Response` / `AbortController` 也装成全局——和 timers
  一样，只在**有原生宿主时**装，且不覆盖环境已有的，第三方库里的裸 `fetch`
  因此能跑。类型不用声明：项目默认 lib 已经带了这四个名字。

  但要注意：web 上的全局 `fetch` 是**浏览器自己的**，不认 `timeout`。要两端
  完全一致就 `import { fetch } from 'fjs'`（demo 的 src/pages/api/fetch.vue 就是
  这么写的）；`RequestInit.timeout` 的类型由 `@ufjs/runtime/ambient` 合并进来。

在 demo 里可以直接看到跑起来的样子：`/api/fetch` 这一页拿 dog.ceo 和 httpbin.org
做了 7 项在线验证（json、二进制图片、POST body、自定义请求头、404、超时、
abort），Flutter 和 web 跑同一份源码。

## invokeHostAsync：通用的异步宿主调用（spec 039）

上面的 fetch 章节写的是一条 HTTP 专用通道；`invokeHostAsync` 把同一范式
提炼成所有宿主模块都能用的通用形态，让 Dart 侧 `Future` 结尾的能力
（插件读写、权限申请、三方 SDK）不用再手搓 pending 表：

```ts
import { invokeHostAsync } from 'fjs';

const user = await invokeHostAsync<{ name: string }>('user.profile', 42, 'full');
// 参数：标量原样；整体作为一个 JSON 数组串过界，Dart handler 收到解码后的
// List<Object?>。未注册的名字 / handler 抛异常 / 返回值不可 JSON 编码，
// Promise 都会 reject，不会悬挂。
```

Dart 侧在 [modules.md](modules.md) 说的 `engine.host.register` 旁多一个
`registerAsync`：

```dart
engine.host.registerAsync('user.profile', (args) async {
  final user = await userRepository.load(args[0] as int);
  return user; // 返回值必须 JSON 可编码
});
```

时序与 fetch 完全同构，事件号 32（`FJS_EVENT_ASYNC_RESULT`）：

```
JS    invokeHostAsync('user.profile', 42, 'full')
  -> invokeHost('fjs.async.invoke', callId, name, argsJson)   // 同步发起，立即返回
Dart  engine 内置 handler：查 async 表 -> handler(jsonDecode(argsJson))
  -> dispatchEvent(callId, 32, '{"ok":true,"value":…}')       // Future 结束后
JS    pending 表按 callId settle
```

约定与边界：

- **载荷字段序固定**（成功 `{"ok":true,"value":…}`、失败
  `{"ok":false,"errMsg":"…"}`，`ok` 在前），实现方是 `engine.dart` 的
  `_sendAsyncResult` 与 `fjs-runtime/src/host-async.ts`，两边对着写。
- **通道成本**：发起是同步 JSI 调用，等待发生在 Dart 事件循环上，不在
  JS↔Dart 边界上（宪法 III）；参数与返回值走 JSON 串，是 v1 ABI 的既定
  豁免（对象 JSON 字符串化）。大块二进制仍该走句柄（spec 038）。
- **web 端没有这条通道**：没有 Dart 宿主，`invokeHostAsync` reject
  （`invokeHost` 在 web 抛错是同一条边界）。模块的 web 端异步能力由模块
  自己的 JS 实现提供（浏览器 API，`@ufjs/webview` 的先例），运行时不造
  一层假注册表。
- **不做取消与超时**：宿主调用没有 HTTP 那样的中止语义，要支持就在参数里
  约定一个取消 op。唯一的静默路径是 VM 重建（reload）后迟到的 dispatch
  查无此 id 丢弃——fetch 同款。
- hello-fjs 的 `/example/interaction/async-host` 一页可以看到两端的样子：App 走
  `demo.asyncStore`（宿主 main.dart 里的假 KV 存储，每次应答 400ms），
  web 端同一页展示 reject 文案。
