# 线程模型与执行时序

> 第一层第 2 篇。上一篇：[原理](principles.md)　下一篇：[整体架构](architecture.md)
>
> 一句话：**JS 全部跑在 Flutter 的 UI isolate 上，所有原生调用同步返回；
> 唯一的真并行是 Worker，它是另一个 isolate 里的另一个 QuickJS runtime。**

## 主线程：一个 isolate，一个 VM

```
Flutter UI isolate
├── Flutter 渲染管线（build / layout / paint）
├── FjsEngine ──► libfjs ──► QuickJS runtime + context
└── Timer.periodic(16ms) ──► fjs_vm_pump()
```

- JS 没有自己的线程。`JS_Eval`、事件派发、微任务泵**全在 UI 线程上执行**。
- Dart→C++ 的回调用 `NativeCallable.isolateLocal`，按定义只能被拥有该
  isolate 的线程调用 —— 这条约束把"从别的线程回调 JS"直接堵死了。
- v1 每个进程一个 engine，VM 实例持有线程宿主单例（`HostBridge.install`）。

**代价**：一段长 JS 计算会卡帧，和在 Flutter 里写同步死循环一样。
把它挪到 Worker 是唯一解。

## 泵（pump）：JS 的异步是怎么推进的

QuickJS 自己不带事件循环。Dart 侧每 16ms（≈ 一帧）调一次
[`engine.dart:414`](../packages/flutter_fjs/lib/src/engine.dart) 的
`pump()`，它做两件事：

1. 执行到期的 timer（`setTimeout` / `setInterval`）
2. 排空 promise 微任务队列

单次 pump 有 **10000 次上限**，防止 `Promise.resolve().then` 自我调度的
微任务风暴把这一帧锁死。

```dart
Timer.periodic(const Duration(milliseconds: 16), (_) {
  if (!_disposed) pump();          // bind.pump(vm, bind.now(vm))
});
```

时间由引擎的单调时钟给（`fjs_vm_now`），不是 `Date.now()` —— 系统时间被改
不会让 timer 错乱。

## 转场期间不要干重活

JS 跑在 UI isolate 上，所以一段同步计算就是一次卡帧——这条在路由转场时最要命：
页面刚 push 进来的那几百毫秒，正是 Navigator 在跑动画。引擎已经替你挡了半步，
`_mountPushedRoute` 会 `await endOfFrame` 再挂载，让 Navigator 先画出转场的第
一帧；但它只等**一帧**，够转场「开始」，不够转场「结束」。

所以重活要自己等：

```ts
import { onPageSettled } from 'fjs/router';

onPageSettled(() => buildTheExpensiveThing());
```

「转场结束了没有」这件事 **JS 侧看不见**——它是 Flutter Navigator 动画的状态，
所以这是少数必须下到 Dart 的能力之一（宪法 VII）：路由 `didPush()` 的
`TickerFuture` 结算时派一个 `FJS_EVENT_NAV_SETTLED`。web 侧对应的是
`<Transition>` 的 `afterEnter`。契约见 [ui-api.md](ui-api.md#页面onpagesettled)。

`<canvas>` 有现成的开关：加 `defer-resize`，首次 `@resize` 就等转场结束再派
（默认不延迟）。

引擎还挡了另半步（specs/086）：`navMount` 当次的 `getBoundingClientRect` /
`offset*` **不**做强制同步 `flushLayout`。否则 vant 在 `onMounted` 里量一次
尺寸，就会把刚推入的整页 layout 叠在 JS 栈上，把转场冻住（vant-form 实测
~160ms）。那一拍未 layout 的节点读到全零；`dispatchEvent` 返回后既有的
notify 让下一帧正常 build/layout。页面挂上之后的同 tick 量高（collapse）
不受影响。

实测代价：三张 F2 图的首帧渲染约 210ms，不等转场的话每次 push 都固定丢掉
约 205ms 的帧（specs/027 §6c）。


## 一次点击的完整时序（全同步）

这是理解整个系统最重要的一张图。**从手指落下到界面更新，全部发生在
一次手势回调内，不跨线程、不过 JSON。**

```
① Flutter GestureDetector.onTap
        │  UI 线程
        ▼
② engine.dispatchEvent(nodeId, FJS_EVENT_TAP)        Dart
        │  dart:ffi（纯 C ABI）
        ▼
③ fjs_vm_dispatch_event(...)                          C++
        │  JS_Call(__fjsDispatchEvent, ...)  ← 同步调用 JS
        ▼
④ @ufjs/runtime 事件注册表找到 onTap 处理器并执行      JS
        │
⑤ 处理器调 setText(...) ──► op 写入帧缓冲
        │                   queueMicrotask(flush)
        ▼
⑥ dispatch 返回前 C++ 泵空微任务（fjs_vm_pump）
        │  flush() ──► __fjs.fns.uiOps(frame)  ← 同步回调 Dart
        ▼
⑦ Dart 把 op 应用到镜像树 ──► notifyListeners()        Dart
        │
        ▼
⑧ Flutter 本帧重建
```

关键在 ⑥：**微任务在 `dispatch_event` 返回之前就被泵空了**，所以 UI 更新
和这次手势在同一帧。如果等下一次 16ms 的周期泵，点击就会慢一帧。

### 为什么按压态（`:active`）不走这条链

按下高亮如果按上面这条链走一圈，即使全同步也要一帧。所以
`:active` 的样式在 CSS 引擎里**提前算好**，随 `activeStyle` 一起下发给
Dart；按下时由**节点自己**就地切换，根本不回 JS。见
[vue3.md](vue3.md#style--style-scoped) 和 [css-compat.md](css-compat.md)。

## fetch：异步宿主调用的范式

`invokeHost` 是同步的，但网络不能同步等。做法是把"发起"和"回结果"拆成
两条已有通道，**不新增任何 C ABI**：

```
JS                              Dart                              JS
fetch(url)
  └─ invokeHost('fjs.http.request', id, reqJson)   ← 同步返回，只是登记
                                  │  HttpClient 异步跑
                                  ▼
       dispatchEvent(id, 14 /* httpResponse */, resJson) ──► promise 落定
ctrl.abort()
  └─ invokeHost('fjs.http.abort', id)
```

`id` 由 JS 侧分配，Promise 存在 JS 侧的 pending 表里。**任何需要异步返回的
宿主模块都照这个形状写**（宪法 II）。实现在
[`lib/src/http.dart`](../packages/flutter_fjs/lib/src/http.dart) 和
[`net/fetch.ts`](../packages/fjs-runtime/src/net/fetch.ts)。

## Worker：真正的并行

worker 是**文件**（specs/049）：代码放 `src/workers/<name>.ts|js`（可 import 本地模块，构建期
打成自包含脚本 `/workers/<name>.js`），页面写 `new Worker('/workers/<name>.js')`。三端都只收这个
路径——小程序的 `wx.createWorker` 只认真实文件且没有 eval，所以旧的「传代码字符串」写法已移除。

Flutter 上 JS 先按根路径 `fetch` 到脚本（dev 连着时从 dev server，release 从
`assets/fjs/public/workers/`，同图片），再交给 Dart：`Isolate.spawn` 一个新 isolate，里面起一个
**独立的 QuickJS runtime**，用 8ms 的 `Timer.periodic` 自己泵
（[`worker.dart:187`](../packages/flutter_fjs/lib/src/worker.dart)）。

```
UI isolate                          Worker isolate
FjsEngine / QuickJS #1   ◄── SendPort ──►   QuickJS #2
   16ms pump                                   8ms pump
```

- 两个 runtime **不共享任何 JS 对象**，通信只有 `postMessage` 的字符串。
- API 是 Web Worker 风格（`postMessage` / `onmessage` / `terminate`）。
- Web 目标上就是真的 Web Worker（路径即 URL）。
- 小程序上是 `wx.createWorker`，同时只能有一个：建新的会先终止旧的并告警一次，页面离开时应 `terminate()`。
- 长任务（大列表排序、解析）放这里，见
  [performance.md](performance.md#worker-加速) 和 `examples/bench`。

## 生命周期

```
FjsEngine()            → fjs_vm_create（runtime + context + natives 安装）
addPrelude(chunk)      → 共享块 eval；每次 reset 自动重放
runSource / runBundle  → eval → 泵微任务 → 首帧 UI ops 落到镜像树
startEventLoop         → 启动 16ms 周期泵
connectDev(host, port) → HTTP 拉 bundle；WS 收 reload → reset() 重建 VM
dispose                → fjs_vm_destroy
```

`reset()` 销毁整个 VM，全局对象随之消失。所以分包出来的共享 prelude 由
engine 在新 VM 里**重新 eval**，宿主不需要自己排序 —— 这是 dev 热重载能
只推变更 chunk 的前提，见 [code-splitting.md](code-splitting.md)。

## 画布的两个时钟：执行与呈现

`<canvas>` 拿到 webgl context 之后（`@ufjs/webgl`，见
[canvas-compat.md](canvas-compat.md)），GL 指令编码进 op 11 的字节流，
到宿主侧走的是**两个互相独立的时钟**，不要把它们焊在一起：

| | 什么时候发生 | 谁触发 |
|---|---|---|
| **执行** | chunk 到达就执行，一帧内可能发生多次 | 每帧的 pump；以及 JS 侧的同步 GL 查询 |
| **呈现** | 每个 Flutter 帧至多一次，且必须在该节点的 `Texture` layer 建出来之后 | post-frame 回调 |

「一帧内可能多次」不是实现细节，是同步 ABI 的必然结果：`getAttribLocation`
这类查询必须走 GL 才能答（它的返回值是驱动的属性槽下标，不能像 uniform
location 那样发个不透明句柄，见 spec 021 §3.4），而查询要同步返回，就得先把
当前命令流冲给宿主执行。于是页面在 `draw()` 里查一次，这一个页面帧就分两批
到达宿主。

呈现之所以必须收在帧边界上、且一帧只能一次：宿主的 present 是
`eglSwapBuffers`，EGL 默认 `EGL_BUFFER_DESTROYED` —— **swap 之后后缓冲内容
未定义**。所以

- 一帧 swap 两次 = 第二次推上去的是一块已被丢弃的缓冲，把刚呈现好的盖掉；
- 一个页面帧跨两次 swap = 清屏落在一个缓冲、几何画在另一个缓冲的未定义内容
  上（还带着上一帧的深度）。

`present` 因此在 swap 前先把已到达的 chunk 全部执行掉，保证一个页面帧不跨
缓冲。**页面可以放心在 `draw()` 中途做 GL 查询**，代价只是那一帧多一次
同步往返。

这两条错误状态只在**按需渲染**的页面上现形（画一帧就停，错的那帧一直挂在
屏幕上）；连续渲染的页面 16ms 后就被下一帧盖过去了。spec 023 的两个 glTF
查看器是仓库里仅有的按需渲染页，spec 028 的四条缺陷全是它们暴露的。

## 现状与计划

| | 现在 | 计划 |
|---|---|---|
| 主线程 JS | UI isolate，同步 | 不变（这是设计目标）|
| 异步宿主调用 | fetch 范式手写 | `invokeHostAsync`（Promise 化）|
| 热重载 | 模块级 HMR 已达成（spec 037）：unit 热替换 / page 热替换 / 全量 reset 三级 | 组件级状态保留（另一量级） |
| 多 engine | 一进程一个 | — |

见 [roadmap.md](roadmap.md)。
