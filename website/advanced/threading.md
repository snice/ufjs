# 线程模型与一次点击

**JS 全部跑在 Flutter 的 UI isolate 上，所有原生调用同步返回；唯一的真并行是 Worker。**

这是 ufjs 最重要的一个设计选择，它带来了「点击到上屏只有一帧」的响应速度，也带来了「长计算会卡界面」的约束。

## 一个 isolate，一个 VM

```text
Flutter UI isolate
├── Flutter 渲染管线（build / layout / paint）
├── FjsEngine ──► libfjs ──► QuickJS runtime + context
└── Timer.periodic(16ms) ──► fjs_vm_pump()
```

- JS 没有自己的线程。执行代码、派发事件、推进微任务，**全在 UI 线程上**
- Dart → C++ 的回调用 `NativeCallable.isolateLocal`，只能被拥有这个 isolate 的线程调用 —— 从设计上堵死了「从别的线程回调 JS」
- 一个进程一个引擎

## 泵：JS 的异步是怎么推进的

QuickJS 自己没有事件循环。Dart 每 16ms（约一帧）调一次 `pump()`：

1. 执行到期的 `setTimeout` / `setInterval`
2. 排空 Promise 微任务队列

单次 pump 有 10000 次上限，防止自我调度的微任务风暴锁死这一帧。时间来自引擎的单调时钟，系统时间被改不会让定时器错乱。

## 一次点击的完整时序

**从手指落下到界面更新，全部在一次手势回调内同步完成：**

```text
① Flutter GestureDetector.onTap                          UI 线程
        │
② engine.dispatchEvent(nodeId, TAP)                     Dart
        │  dart:ffi
③ fjs_vm_dispatch_event(...)                            C++
        │  JS_Call(__fjsDispatchEvent, ...)   ← 同步调 JS
④ 事件注册表找到 @tap 处理器并执行                       JS
        │
⑤ count.value++ → Vue patch → setText(...)
        │  op 写入帧缓冲，queueMicrotask(flush)
⑥ dispatch 返回前 C++ 泵空微任务
        │  flush() ──► uiOps(frame)          ← 同步回调 Dart
⑦ Dart 应用 op 到镜像树 → 标脏节点                       Dart
        │
⑧ Flutter 本帧重建
```

关键在 ⑥：**微任务在 `dispatch_event` 返回之前就泵空了**，所以 Vue 的更新和这次点击落在同一帧。如果等下一次 16ms 的周期泵，就会慢一帧。

### 为什么按压态不走这条链

即使全同步，走一圈也要一帧。按下高亮对延迟最敏感，所以 `:active` 的样式在 CSS 引擎里**提前算好**，随普通样式一起下发；按下时由 Flutter 节点自己就地切换，根本不回 JS。

## 代价：长计算会卡帧

JS 在 UI 线程上，一段 50ms 的同步计算就是三帧卡顿，和在 Flutter 里写同步死循环一样。两个应对：

### 1. 转场期间不做重活

页面刚 push 进来的几百毫秒，Navigator 正在跑转场动画。首屏建图表、解析大 JSON 如果落在这里，用户看到的就是转场卡住。

```ts
import { onPageSettled } from 'fjs/router';

onPageSettled(() => buildTheExpensiveThing());
```

「转场结束了没有」是 Flutter Navigator 的状态，JS 看不见，所以这是少数必须下沉到 Dart 的能力：路由动画结束时派一个 `NAV_SETTLED` 事件回来。Web 端对应的是 `<Transition>` 的 `afterEnter`。

实测三张图表的首帧渲染约 210ms：不等转场，每次 push 都会丢掉约 205ms 的动画帧；等转场，动画的 20 帧全部干净。

`<canvas defer-resize>` 是同样的开关：首次 `@resize` 等转场结束再派。

### 2. 真正的计算放 Worker

```text
UI isolate                          Worker isolate
FjsEngine / QuickJS #1   ◄── SendPort ──►   QuickJS #2
   16ms pump                                   8ms pump
```

Worker 是 `Isolate.spawn` 出来的另一个 isolate，里面是**独立的 QuickJS runtime**，自己每 8ms 泵一次。两个 runtime 不共享任何 JS 对象，通信只有 `postMessage` 的字符串。用法见[Worker](/guide/events-and-data#worker)。

## 异步的宿主调用

`invokeHost` 是同步的，但网络请求不能同步等。做法是把「发起」和「回结果」拆成两条已有的同步通道：

```text
JS    fetch(url)
        └─ invokeHost('fjs.http.request', id, req)   ← 同步返回，只是登记
Dart                         HttpClient 异步执行
        dispatchEvent(id, httpResponse, res)  ──►  JS 侧 Promise 落定
```

`id` 由 JS 分配，Promise 存在 JS 侧的 pending 表里。`invokeHostAsync` 把这个形状通用化了，所有返回 `Future` 的 Dart 能力都能用。见[JS 与原生通信](./native-bridge)。

## 生命周期

```text
FjsEngine()            → 创建 QuickJS runtime + context，安装原生函数
addPrelude(chunk)      → 执行共享 chunk；每次 reset 自动重放
runBundle              → 执行入口 → 泵微任务 → 首帧 op 落到镜像树
startEventLoop         → 启动 16ms 周期泵
connectDev(host, port) → HTTP 拉 bundle；WebSocket 收热更新
reset()                → 销毁并重建 VM（完整 reload）
dispose                → 销毁 VM
```

## 画布的两个时钟

WebGL 画布有一个额外的细节：GL 命令的**执行**可能在一帧内发生多次（同步的 GL 查询需要先把命令冲给宿主执行），而**呈现**（`eglSwapBuffers`）每个 Flutter 帧最多一次，且在帧边界上。把两者分开，页面才能放心地在 `draw()` 中途做 GL 查询。
