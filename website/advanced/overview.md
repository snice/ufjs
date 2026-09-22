# 总览：五个基本决策

用 ufjs 写应用不需要懂原理。但当你想知道「为什么 `view` 默认是纵向」「为什么事件载荷是字符串」「为什么长计算会卡转场」，答案都能追溯到下面五个决策。

**一句话：把 JS 引擎编进 Flutter 应用，让 JS 直接调 C++ 函数、直接调 Dart 函数，中间没有桥、没有 JSON、没有跨线程。**

## 分层

```text
┌────────────────────────────────────────────────────┐
│ 应用层：.vue / .ts                                  │
│   esbuild 打包，依赖任意 npm 包                     │
├────────────────────────────────────────────────────┤
│ @ufjs/runtime（打包进 bundle）                      │
│   Vue 渲染器 → element API → op 帧编码              │
│   CSS 引擎、路由、fetch、Worker                     │
├──────────────── JSI 边界 ──────────────────────────┤
│ libfjs（C++，内嵌 JS 引擎：PrimJS 默认）            │
│   宿主函数直接收发 JSValue，无序列化                │
├──────────────── dart:ffi（纯 C ABI）────────────────┤
│ flutter_fjs（Flutter 插件）                         │
│   镜像树 MirrorTree → Flutter Widget                │
│   手势 → 同步派发回 JS                              │
└────────────────────────────────────────────────────┘
```

这是 App 端的栈。Web 端把下面两层换成浏览器；小程序端是编译期的另一条路径（见[Web 与小程序](./web-and-mp)）。

## 决策一：嵌引擎，不用 WebView

WebView 方案里，JS 和原生是两套运行时，所有交互都过 `postMessage` 字符串桥。ufjs 把 **JS 引擎（默认 PrimJS 4.1.1，可切 quickjs-ng）以 C++ 源码**编进 `libfjs`，和 App 链接在一起：

| | WebView | ufjs |
|---|---|---|
| 渲染 | 浏览器排版引擎 | Flutter Widget，和手写 Flutter 同一条管线 |
| JS ↔ 原生 | 字符串桥，异步 | C 函数调用，同步 |
| 包体 | 依赖系统 WebView | +约 1 MB `libfjs` |

**代价**：没有 DOM、没有浏览器排版引擎。所以 ufjs 自己实现了一个以 flex 为核心的 CSS 子集 —— 这就是 `view` 默认纵向（Flutter `Column` 的默认）、`z-index` 只在绝对定位兄弟之间生效（Flutter 本按顺序叠放）的根源。

## 决策二：JSI 式直调，不做序列化桥

宿主函数用 `JS_NewCFunction` 注册，**直接收发 `JSValue`**：

```cpp
static JSValue js_fibonacci(JSContext *ctx, JSValueConst, int argc, JSValueConst *argv) {
    int64_t n = 0;
    if (JS_ToInt64(ctx, &n, argv[0]) != 0)
        return JS_ThrowTypeError(ctx, "fibonacci(n): n must be an integer");
    return JS_NewInt64(ctx, fib(n));
}
```

JS 侧调用它就是一次普通的 C 函数调用。`invokeHost` 转发到 Dart，同样同步返回。

跨界的值被刻意限制为**标量**（`string | number | boolean | null`）：标量覆盖了绝大多数调用，而通用的对象句柄会把内存所有权规则搞复杂。这就是**事件载荷一律是字符串**、`invokeHost` 传对象要 JSON 化的原因。大块二进制是例外，走专门的句柄通道。见[JS 与原生通信](./native-bridge)。

## 决策三：UI 是二进制帧，不是逐节点调用

如果每次 `setText` 都跨一次边界，一个列表更新就是几千次调用。ufjs 的做法：**一个微任务内的所有节点操作聚合成一个 `Uint8Array`，一次提交**。

```text
create(view) ─┐
insert(...)   ├─► OpWriter 累积 ─► queueMicrotask(flush) ─► uiOps(frame) ─► Dart
setProps(...) ─┘                                              一次调用
```

Dart 侧把帧应用到一棵**镜像树**，再由镜像树驱动 Flutter 重建。JS 不持有 Widget，Dart 不持有 JS 对象，两边各管各的生命周期。见[渲染管线](./rendering)。

## 决策四：渲染层框架无关

JS 侧对外暴露的不是「Vue 支持」，而是一套**命令式 element API**：

```ts
import { create, insert, setProps, setText, createRoot } from 'fjs';

const root = createRoot('view');
const box = create('view');
setProps(box, { style: { padding: 16 } });
insert(root, box);
```

Vue 只是坐在它上面的一个适配器（约 200 行，`createRenderer(nodeOps)`）。理论上 React（`react-reconciler`）、Solid（`solid-js/universal`）接的是同一组函数。`examples/hello-js` 就是完全不用框架写的。

## 决策五：一份源码，多端运行

App 端借 Flutter 覆盖 Android、iOS、鸿蒙和桌面；另外还能编译成 Web 站点和微信小程序。三条产物路径的机制不同：

| | App | Web | 小程序 |
|---|---|---|---|
| Vue 运行时 | `@vue/runtime-core` + fjs 渲染器 | 官方 `vue` | 不打包，只有响应式 |
| `<view>` | Dart Widget（**元素**） | fjs 的 Vue 组件（**组件**） | 小程序组件 |
| `<style>` | fjs CSS 引擎 | 真 CSS | WXSS |
| 路由 | 原生 Navigator | vue-router | 小程序页面栈 |

App 和 Web 的切换点在 SFC 编译时：给 `@vue/compiler-dom` 传不同的 `isNativeTag` —— App 上内置标签是**元素**，原样交给渲染器；Web 上同一批标签是**组件**，由 DOM 适配层实现。

这条约束是 ufjs 所有功能设计的第一原则：**只做一端等于没做**。每个标签、每条样式、每个事件都有两份实现，并且两端事件载荷逐字符相同。

## 两种运行形态

| | dev | release |
|---|---|---|
| 产物 | JS 源码，HTTP 拉取 | 引擎字节码 `.fjsbundle` |
| 加载 | `JS_Eval` 解析执行 | `JS_ReadObject`，跳过解析 |
| 更新 | WebSocket 推送，页面级 / 整包两档热更新 | 随包发布 |
| 校验 | — | engine id 不匹配直接拒绝加载 |

## 接下来

- [渲染管线](./rendering)：一个 `<view>` 怎么变成屏幕上的像素
- [线程模型](./threading)：为什么一切都是同步的，一次点击的完整时序
- [JS 与原生通信](./native-bridge)：invokeHost、异步调用、fetch 的实现
- [分包、字节码与热更新](./bundling)
- [Web 与小程序](./web-and-mp)
