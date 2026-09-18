# JS 与原生通信

大多数「加一个原生能力」的需求**不需要写 C++**：用[模块](/guide/modules)写 Dart 宿主函数或 Flutter Widget 就够了。这一篇讲这些通道底下是什么。

## 三条通道

```text
JS ──► C++      __fjs.natives.*       内建原生函数，JSValue 直进直出
JS ──► Dart     __fjs.fns.invokeHost  转发到 Dart 宿主模块
C++ ──► Dart    回调函数指针          console 日志、UI 帧、invokeHost 的 C 侧入口
Dart ──► JS     dispatchEvent         事件、异步结果
```

### JS → C++：内建 natives

```js
__fjs.natives.fibonacci(10);      // 纯 C++ 函数
__fjs.fns.invokeHost('device');   // 转发到 Dart
__fjs.fns.uiOps(u8Array);         // UI 帧（直接读 ArrayBuffer）
__fjs.fns.nowMs();                // 引擎单调时钟
```

`__fjs` 的类型是 `FjsNative | undefined`（Web 端没有引擎）。业务代码不要直接碰它，用 `fjs` 导出的 `invokeHost` / `nowMs` / `toast` / `hasNativeHost`。

### JS → Dart：宿主函数

```ts
import { invokeHost } from 'fjs';
const info = invokeHost<{ platform: string }>('device', 'get', 42);
```

```dart
engine.host.register('device', (args) => {
  'platform': Platform.operatingSystem,
  'args': args,
});
```

调用同步完成，参数和返回值穿过一个 C 结构 `FJSValue`（null / bool / int32 / double / string）。

**为什么只过标量**：宿主函数的执行体在 Dart，C++ 指针对它没有意义；通用的对象句柄会把内存所有权规则搞得很复杂。标量已经覆盖绝大多数调用，对象用 JSON 字符串。这也是 TypeScript 类型 `FjsHostValue = string | number | boolean | null` 的来源 —— 传对象会在编译期被拦下，而不是运行时静默变成 null。

### 二进制句柄

大块二进制（图片、fetch 的请求体 / 响应体）如果 base64 进 JSON，开销很大。所以有一条专门的通道：**number 句柄 + VM 内的字节表**。

```text
Dart                      C++ (VM)                   JS
bytes ─put_bytes─►  map[id] = bytes
                                      ◄─readHandleBytes(id)─  new Uint8Array(copy)
                                      ◄─releaseHandle(id)───  用完即释放
```

数据只拷两次，中间只有一个整数跨界。1 MB 从 7053µs 降到 505µs，5 MB 从 27748µs 降到 864µs。句柄 id 单调递增、永不复用，VM 重建时整张表一起消失。

## 异步调用：`invokeHostAsync`

Dart 侧返回 `Future` 的能力（插件读写、权限、SDK）用它：

```ts
import { invokeHostAsync } from 'fjs';
const user = await invokeHostAsync<{ name: string }>('user.profile', 42);
```

```dart
engine.host.registerAsync('user.profile', (args) async {
  return await repo.load(args[0] as int);   // 返回值必须能 JSON 编码
});
```

实现上它就是 fetch 那套时序的通用版：

```text
JS    invokeHostAsync('user.profile', 42)
  → invokeHost('fjs.async.invoke', callId, name, argsJson)   同步发起，立即返回
Dart  查 async 表 → handler(args)
  → Future 结束后 dispatchEvent(callId, ASYNC_RESULT, '{"ok":true,"value":…}')
JS    pending 表按 callId 落定 Promise
```

- 等待发生在 Dart 事件循环上，不占 JS↔Dart 边界
- 未注册、handler 抛异常、返回值不可编码 → reject，不会挂住
- 不支持取消和超时；VM 重建后迟到的结果会被丢弃
- Web 端没有这条通道，直接 reject

## fetch 是怎么实现的

QuickJS 没有 socket，`fetch` 由 Dart 的 `HttpClient` 实现，走的仍然是上面两条通道，**没有新增任何 C 接口**：

```text
fetch(url)   → invokeHost('fjs.http.request', id, requestJson)
             ← dispatchEvent(id, httpResponse, resJson) → Promise 落定
ctrl.abort() → invokeHost('fjs.http.abort', id)
```

根相对 URL（`/data/x.json`）在 dev 时由 dev server 解析，release 时落到 Flutter asset `assets/fjs/public/`，和 `<image>` 的规则完全相同 —— 所以同一份代码在浏览器和 App 上取到同一个文件。

## 写 C++ 原生函数（进阶）

只有在需要极致性能、且必须在 C++ 里完成时才这样做。在 `packages/flutter_fjs/native/src/natives.cpp` 里：

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

要注意：

- QuickJS 引用计数规则：`JS_New*` 返回的引用由调用方负责；`JS_Get*` 拿到的要 `JS_FreeValue`；返回给引擎的 `JSValue` 不要释放
- `packages/fjs-runtime/src/native-global.d.ts` 是这条边界唯一的类型描述，是手写的，要同步更新
- 这意味着要重新编译 `libfjs`，并重新生成预编译产物，只能在 ufjs 仓库里做。见[本地开发 ufjs](/source/contributing)

## 对照表

| 需求 | 用什么 |
|---|---|
| 调一个 Dart 函数，当场返回 | `engine.host.register` + `invokeHost` |
| 调 Flutter 插件，返回 Future | `engine.host.registerAsync` + `invokeHostAsync` |
| 一个真正的 Flutter Widget | `engine.components.register` + 模块 `widgets` |
| 原生侧主动通知 JS | 自定义标签的 `dispatch(node.id, event)` |
| 极致性能的纯计算 | C++ natives（改引擎） |
