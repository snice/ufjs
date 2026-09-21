# ufjs 架构

> 第一层第 3 篇。前置：[原理](principles.md)、[线程模型](threading-model.md)　
> 下一篇：[JSI 与原生模块](jsi-and-native-modules.md)
>
> 这篇是**分层总览 + 关键文件索引**。「为什么这样设计」在
> [principles.md](principles.md)，线程与时序的细节在
> [threading-model.md](threading-model.md)。

## 分层总览

```
┌────────────────────────────────────────────────────┐
│ JS/TS 应用层（npm 生态）                            │
│   .ts / .js / .vue SFC → esbuild 打包为单文件        │
│   依赖 vue3 等任意 npm 包（QuickJS 支持 Proxy）      │
├────────────────────────────────────────────────────┤
│ @ufjs/runtime（npm 包，打包进 bundle）                 │
│   element API（h/create/setProps/setText）          │
│   UI 帧批量提交（op writer → Uint8Array）            │
│   Vue3 自定义渲染器（createRenderer + nodeOps）      │
├──────────────── JSI 边界 ──────────────────────────┤
│ libfjs（C++，vendored PrimJS 4.1.1，spec 088 起）    │
│   LEPUS_NewCFunction 宿主函数：JS 值直传，无序列化    │
│   console / timers / uiOps / invokeHost natives     │
│   源码 eval（NUL 结尾约束）/ 字节码 ReadObject        │
│   CDP 调试器是可插拔模块（见 debugger.md）            │
├──────────────── dart:ffi（纯 C ABI）────────────────┤
│ flutter_fjs（Flutter 插件）                          │
│   NativeCallable.isolateLocal 同步回调               │
│   镜像树（MirrorTree）→ Flutter Widget               │
│   手势/文本事件 → fjs_vm_dispatch_event              │
└────────────────────────────────────────────────────┘
```

这张图画的是 **Flutter 目标**的运行时栈。Web 目标把下面两层换成浏览器
（DOM 适配层 + vue-router，见 [web.md](web.md)）；微信小程序目标是另一条
**编译期**路径——模板直译 WXML，运行时只有 `@ufjs/runtime/wx` 薄壳，
见 [miniprogram.md](miniprogram.md)。

## 一次点击的完整旅程（事件闭环）

1. Flutter `GestureDetector.onTap` → `engine.dispatchEvent(nodeId, FJS_EVENT_TAP)`
2. Dart FFI → `fjs_vm_dispatch_event`（C++）
3. C++ `JS_Call(__fjsDispatchEvent, nodeId, 1, null)` — 同步调用 JS
4. @ufjs/runtime 的事件注册表找到该节点的 onTap 处理器并执行
5. 处理器调用 `setText(...)` → op 写入帧缓冲 → `queueMicrotask(flush)`
6. dispatch 返回前 C++ 泵空微任务（`fjs_vm_pump`）→ `__fjs.fns.uiOps(frame)` 同步回调 Dart
7. Dart 应用 op 到镜像树 → `notifyListeners()` → Flutter 本帧重建

**整条链路在一次手势回调内同步完成，无跨线程、无 JSON 序列化。**

## UI 帧协议（二进制）

JS 每个微任务把节点操作聚合为一个 frame（`Uint8Array`），一次 `uiOps()` 调用提交。
小端序。操作码手写在三个地方——`packages/fjs-runtime/src/ui/ops.ts`、
`packages/flutter_fjs/lib/src/ui_ops.dart`，以及
`packages/flutter_fjs/native/tools/fjsrun.cpp` 里的帧转储——没有生成器兜底，
**必须同步修改**：

| op | 名称 | 载荷 |
|----|------|------|
| 1 | CREATE | u32 id, u16 tagLen, utf8 tag |
| 2 | REMOVE | u32 id |
| 3 | INSERT | u32 parent, u32 child, u32 index |
| 4 | REMOVE_CHILD | u32 parent, u32 child |
| 5 | SET_TEXT | u32 id, u32 len, utf8 |
| 6 | SET_PROPS | u32 id, u32 len, utf8 JSON |
| 7 | DEFINE_STYLE | u32 styleId, u32 len, utf8 JSON |
| 8 | SET_STYLE | u32 id, u32 styleId, u32 activeStyleId |
| 9 | RESET_STYLES | 无 |
| 10 | CANVAS | u32 id, u32 len, 2D 绘制命令流 |

- parent id `0` 表示宿主隐式根容器
- canvas（op 10）里的字节是**另一套协议**：`canvas/display-list.ts` 写、
  `canvas/canvas_ops.dart` 读，这一层不解释它。绘制是**流**语义（两帧命令相
  接，不是替换），一块画布的命令由宿主保留，直到一条覆盖整块的 `clearRect`
  把它们截断
- props（op 6）是扁平 JSON 对象（onTap 标记 / value / `__navKey` 等），
  合并语义：值为 null 表示删除该键；值类型只有字符串、数字、布尔

**样式是驻留的（op 7/8/9）。** 样式引擎把同一个不可变 computed style 对象交给
所有解析结果相同的元素，所以这份 map 每帧只作为一条 DEFINE_STYLE 过一次桥，
每个元素只花 13 字节的 SET_STYLE 引用它。两个 style 槽都是**替换**语义，
`styleId` 为 0 表示清空该槽。规则：

- 某 id 的 DEFINE_STYLE 必须先于引用它的 SET_STYLE 出现
- id 单调递增，epoch 内不复用
- RESET_STYLES 结束一个 epoch 并丢弃目录

丢弃目录是安全的：SET_STYLE 在解码时就解析完毕、节点直接持有解出来的
style，目录项消失不会让任何节点悬空。引用了本解码器没见过的 id（从会话中途
开始录制的 frame log 重放）时，节点保持原样式而不是抛错。

一个 1000 行的页面切换主题，帧从约 600 KB 降到约 50 KB，Dart 侧的
`jsonDecode` 从每节点一次降到每种样式一次。

**宿主能力协商。** bundle 与 Flutter 二进制分开发布（page chunk、dev server、
pub.dev 上的 `flutter_fjs`），所以新 bundle 可能遇到老宿主。宿主建 VM 时写入
`globalThis.__fjsHost = { uiOpsVersion }`（见 `FjsEngine.uiOpsVersion`），
运行时读到 `< 2` 就回落到 op 6 的老编码；`< 3` 则不发送 canvas 命令并告警一次
（canvas 没有可回落的老编码，见 [canvas-compat.md](canvas-compat.md) §12）。
这与 `FJS_ABI_VERSION` 无关——op 帧对原生层是不透明字节。


## 重建粒度

Dart 侧把 op 帧应用到镜像树之后，**不是整棵树重建**。每个节点在
`render/renderer.dart` 里是一个 `_FjsNodeView`，它监听
`MirrorTree.listenableFor(id)` 给出的**该节点自己的信号**，而这个 widget 实例
缓存在 `MirrorNode.view` 上。

`Element.updateChild` 只在 `child.widget == newWidget` 时跳过子节点，而
`Widget.==` 被 Flutter 标成 `@nonVirtual` 的同一性比较——**不能重写**。所以
「把同一个实例交回去」是唯一能让父节点的重建停在子节点这一层的办法，缓存
就是机制本身。

`applyFrame` 把改动过的 id 收进一个脏集合，帧末由 `flushDirty()` 统一放信号
（不在 `applyFrame` 里放：一次 JS 事件可能排空好几个 op 帧，监听者绝不该看到
半应用的状态）。标脏规则里有一条不显然的：**改一个节点要连它的父节点一起标**
——`display: none` 的过滤和 `flex.dart` 读子节点的 `position` / `flexGrow`
都发生在父节点的 build 里。

配套约束：**父节点给子节点套的任何包装层都必须带上子节点的 key**。父节点
reconcile 的是包装层，包装层没 key 就退化成按位置匹配，一次重排就会让整棵
子树重建。见 `render/flex.dart` 的 `_flexChild`。

## 线程模型（v1）

摘要，完整说明见 [threading-model.md](threading-model.md)：

- **JS 全部运行在 Flutter UI isolate 线程**，原生调用全部同步。
- Dart 通过 16ms `Timer.periodic` 驱动 `fjs_vm_pump(fjs_vm_now(vm))`：
  执行到期 timers + promise 微任务（上限 10000 次/帧，防止微任务风暴卡帧）。
- 回调使用 `NativeCallable.isolateLocal`（仅限拥有 isolate 的线程调用）。
- VM 实例持有线程宿主单例（`HostBridge.install`），v1 每个进程一个 engine。
- 真并行只有 Worker：Dart `Isolate.spawn` + 独立 QuickJS runtime（8ms 自泵），
  两个 runtime 不共享任何 JS 对象。

## 生命周期

```
FjsEngine() → fjs_vm_create（QuickJS runtime + context + natives）
addPrelude(chunk) → 共享块 eval（每次 reset 自动重放，见 docs/toolchain.md）
runSource/runBundle → eval → 泵微任务 → （首帧 UI ops 到镜像树）
startEventLoop → 周期性 pump
connectDev(host, port) → HTTP 拉 bundle → WS 监听 reload → reset() 重建 VM
dispose → fjs_vm_destroy
```

`reset()` 销毁 VM 并清空镜像树，全局对象随之消失，因此 prelude（分包出来的
共享运行时）由 engine 在新 VM 里重新 eval，宿主不必自己排序。

## 关键文件索引

| 层 | 文件 |
|----|------|
| C ABI | `packages/flutter_fjs/native/include/fjs.h` |
| VM/字节码 | `packages/flutter_fjs/native/src/vm.cpp` |
| natives（JSI）| `packages/flutter_fjs/native/src/natives.cpp` |
| FFI 绑定 | `packages/flutter_fjs/lib/src/ffi.dart` |
| 引擎宿主 | `packages/flutter_fjs/lib/src/engine.dart` |
| 镜像树 | `packages/flutter_fjs/lib/src/mirror_tree.dart` |
| 渲染层 | `packages/flutter_fjs/lib/src/render/`（renderer 分发 + flex/decoration/gesture/style）|
| 单个标签组件 | `packages/flutter_fjs/lib/src/widgets/` |
| 注册表 | `packages/flutter_fjs/lib/src/registry/`（host 模块 / Dart 组件）|
| canvas（Dart）| `packages/flutter_fjs/lib/src/canvas/`（显示列表解码 / 保留 / 回放 / measureText 等 host 模块）|
| canvas（JS）| `packages/fjs-runtime/src/canvas/`（2D 状态机 / 命令编码 / getContext 注册表）|
| op 编码（JS）| `packages/fjs-runtime/src/ui/ops.ts` |
| element API | `packages/fjs-runtime/src/ui/element.ts` |
| Vue 渲染器 | `packages/fjs-runtime/src/vue/renderer.ts` |
| 小程序编译 | `packages/fjs/src/mp/`（wxml / script / css / project / build）|
| wx 运行时 | `packages/fjs-runtime/src/wx/`（vue shim、instance、events、router、fetch）|
| CLI | `packages/fjs/src/bundler/build.ts`、`packages/fjs/src/dev/server.ts` |

### CLI 的目录

`packages/fjs/src` 下按职责分包，`cli.ts` 和 `vite.ts` 留在根上，因为它们是
esbuild 的两个 entry point（对应 `dist/cli.js` 和 `dist/vite.js`）：

| 目录 | 放什么 |
|------|--------|
| `commands/` | 一个 CLI 动词一个文件：add、create、doctor、host、icon、run… |
| `bundler/` | esbuild 层：`build.ts`（含 buildBundle）、`vue-plugin.ts`、`analyze.ts` |
| `dev/` | dev server 及其零件：`server.ts`、`keys.ts`、`discovery.ts`、`qrcode.ts` |
| `mp/` | 小程序编译：`wxml.ts`（模板 AST→WXML）、`script.ts`、`css.ts`、`project.ts`、`build.ts`，见 [miniprogram.md](miniprogram.md) |
| `project/` | 读写用户工程：`config.ts`（package.json 的 `fjs` 字段）、`pages.ts`、`plugins.ts` |
| `registry/` | `fjs add` 的数据：`packages.json` + 加载它的 `index.ts` |
