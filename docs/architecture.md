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
│   libfjs-style：样式引擎逐元素的那一半（specs/150）   │
│     纯 C++、不依赖 JS 引擎，两个引擎 flavor 共用       │
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

**样式引擎分两半（specs/150）。** Flutter 目标上，样式引擎逐元素的工作在
C++ 里：`packages/flutter_fjs/native/style/`（libfjs-style，C ABI 见
`fjs_style.h`，不含任何 JS 引擎头文件，PrimJS / quickjs-ng 两个 flavor 链接
同一个库，natives.cpp 里一层薄绑定）。CSS 语义仍只有一份，在 TS：

```
渲染器 ──ensure / setClasses / addScope / 属性 / inline──► css/style.ts (StyleEngine)
                                                            │ native 分支：只写样式输入 op
                                                            ▼
            ┌──────────────── 一帧 (uiOps) ────────────────────────────┐
JS op 缓冲 ─┤ 结构 op（Create/Insert/Remove…）+ 样式输入 op（0x40–0x4b）   │
            └───────────────────────┬──────────────────────────────────┘
                                    ▼ libfjs-style（C++）
          元素树（读结构 op）· 签名 / chain 缓存 · 候选桶 + 选择器匹配
          · 脏标记与 flush · match / compute 缓存 · 线上 style 表
                 │ 未命中才回调（每页「不同样式数」次）
                 ├─► defineMatch(hits) → StyleEngine.buildMatch（cascade）
                 ├─► compute(subject)  → StyleEngine.computeResult（继承 / var / em / keyframes …）
                 └─► styled(el)        → 渲染器副作用（fixed 提升、模态遮罩、伪元素盒）
                                    ▼
          输出帧 = 结构 op 原样 + SET_STYLE / DEFINE_STYLE / SET_HOVER_STYLE ──► Dart（协议不变）
```

- 样式输入 op（`ops.ts` 的 `UiOp.Style*`，布局见 `fjs_style.h`）在 uiOps 里被
  消费掉，**Dart 永远见不到**；0x40 起的 opcode 为它们保留。
- 逐元素的输入（EL / CLASSES / SCOPE / INLINE / FORGET / RESTYLE）不写进字节帧，而是写进 OpWriter 的 Uint32
  词缓冲，随帧作为 `frame.fjsStyle` 交给 uiOps（`fjs_style_process_words`，词流先于字节流消费——它只改逐元素
  状态，帧末 flush 才读，与结构 op 的相对顺序无关）。解释器下一次字节写与一次词写同价，EL 从 14 次写降到 6 次
  （specs/151）。后端还留一个「待写元素槽」：createElement 之后紧跟的 setScopeId / class 折进同一条 EL。
- Vapor 的模板克隆（specs/152）：外壳第一次 `cloneNode` 时把只含 class / scope / 静态文字 / 锚点的模板注册成
  `W_TEMPLATE`，之后每个实例一条 `W_CLONE(模板, 首 id)`；libfjs-style 在输出帧开头写出这棵子树的 Create /
  SetProps / SetText / Insert（Dart 协议不变）并直接登记样式，JS 只建 host 与外壳节点、做渲染器记账
  （`renderer.ts` `prepareClone` / `cloneTemplate`，`vapor/dom.ts` `planClone`）。其余模板逐节点。
- VDOM 的模板块（specs/153）：Flutter 构建的模板编译多一个 nodeTransform（`@ufjs/cli`
  `template/clone-blocks.ts`），把「原生元素、只有静态 class（块根另可有 key）、内容要么是同类子元素要么是文字」
  的最大子树编成一个 vnode：`createVNode(_hoisted_N, { key, t })`，`_hoisted_N = fjsTemplate(节点表)`（从 'vue'
  shim 导入），`t` 是动态文字。`fjsTemplate` 的类型走 runtime-core 的 Teleport 协议（`__isTeleport` +
  `process` / `move` / `remove`），整棵子树不经 mountElement：可克隆时一次 `cloneTemplate` + 动态文字
  `setElementText`，否则按 mountElement 的顺序逐节点建（`vue/template-block.ts`）。模板根、带事件 / 绑定 /
  指令 / 组件 / v-if / v-for 的子树不改写。
- 文字引用（specs/155）：libfjs-style 挂上之后，`setText` 不再把字符串逐字节写进帧，而是写 `TEXT(id, 下标)`
  （0x4c），字符串放进随帧的 `fjsText` 数组；natives 把它们转成 C 字符串交给 `fjs_style_process_frame`，
  libfjs-style 在字节流原位展开成 SetText 并滤掉 Flutter 画不了的控制字符。Dart 收到的字节不变；strip 路径同样展开。
- C++ 铸的线上 style id 从 `0x40000000` 起，不与 JS op 写入器（锚点、伪元素盒）
  的 id 冲突。
- JS 侧分三个文件（specs/172）：`css/style-core.ts` 是 CSS 语义（样式表、层叠、
  `buildMatch` / `computeResult`、inline 记录），两种引擎共用；`css/style-native.ts`
  （`NativeStyleEngine`）把逐元素入口全交给 libfjs-style；`css/style.ts`
  （`StyleEngine`）是 TS 逐元素引擎。Flutter 构建由 `__FJS_TS_STYLE__ = false` 只打包
  前者，宿主没有 `styleAttach` 就报错。
- `fjs build --ts-style` 才带上 TS 引擎：这时宿主有 `styleAttach` 仍默认走 native；
  `globalThis.__fjsNativeStyle` 在渲染器加载前设成 `false` 回到纯 TS 引擎，设成
  `'verify'` 两个引擎同时跑、每帧比对每个重算过的元素（`styleEngine.verifyStats`，
  不一致逐个打印）——任何 app 在 fjsrun / 真机上都能当对拍用例。web、小程序、vitest
  没有 natives，照旧 TS。
- SEED_CHAIN / SEED_COMPUTE（0x4a / 0x4b）是已移除的构建期样式快照（specs/119 →
  172）留下的 op，C++ 仍识别，JS 不再发送。
- 帧被拒（协议 bug 或回调抛错）时，C++ 把该帧剔掉样式 op 交给 Dart（不丢结构），
  之后断开并只做剔除，错误抛给 JS——样式停在那一刻，但不会静默错乱。
- 自定义 `setOpSink` 若吞掉帧不转给宿主，native 下就没有样式：包一层时要转发
  （`setOpSink` 返回上一个 sink）。

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

### 只改绘制的更新（specs/194）

粒度再往下一层：**「节点变了」不等于「节点的 widget 链需要重建」**。主题切换时每个节点都变了，但变的几乎全是颜色——
布局不变，widget 链的形状不变，重建它们（嵌套 build 约占一次 107 ms 切换的 80–100 ms）只为了表达「换个颜色重画」。

`SET_STYLE` 解码时（`MirrorTree.applyFrame`）比较节点新旧样式 entry（`render/paint_only.dart` 的 `classifyPaintOnly`）：
差集只含 `backgroundColor` / `color` / `borderColor`，其余键值全等，才算「只改绘制」。这样的更新**既不标节点也不标父节点**
（父节点的 build 读的是孩子的 `display` / `position` / `flexGrow`，换色不涉及），记入 `_paintOnly`；帧末 `flushDirty` 里、
在放任何信号之前，`applyPaintOnly` 沿节点自己的包装链（遇到多孩子容器即停，不会把别的节点的装饰当成自己的）找到
`RenderDecoratedBox` 换 `BoxDecoration.color`、找到 `RenderFjsParagraph` 换 span，只 `markNeedsPaint`。

文字的换色是**惰性**的（`RenderFjsParagraph.recolorPaintOnly`）：新颜色在共享段落缓存里是新键，立刻取 painter 等于把
几千个段落当场重排；Flutter 自己的 `TextPainter` 也把这件事推迟到 paint，所以只有被画出来的段落付钱。
Flutter 的 `RenderComparison.paint` 保证度量不变，不需要再校验尺寸；也**不走** `RenderParagraph.text` 的 setter
（它会 `markNeedsSemanticsUpdate`，换色不改任何标签：语义客户端在场时，2000 个段落重新收集语义曾占一次切换的 22 ms / 33 ms）。

回退（走原来的整链重建，并按原因计入 `FjsPaintOnlyStats.fallbacks`）——**拿不准一律回退，不近似**：键集合变化、非绘制键变化、
`transition` / `animation*`、可见边框、背景图 / 渐变、`:hover`、`:active` 变体不是纯换色、`view` 带裸文本、`htmlBlock`、
富文本、非 `view` / `text` 的标签、按下期间（`MirrorNode.pressed`）、`pressWithOwner`、节点未挂载。同一帧里别的 op 已经要求
整链重建（`_dirty` 里有它）也不走快路径。

元素持有的旧 widget 与 RenderObject 的新颜色暂时不一致是安全的：之后任何一次重建都从 `node.style`（已是新值）造新 widget，
`updateRenderObject` 把 RO 设成同一个值；`_FjsNodeView` 里面没有任何缓存。

开关：`FjsPaintOnly` 默认开；`--dart-define=FJS_PAINT_ONLY=off` 或 dev 构建里 `invokeHost('fjs.dev.paintOnly', 'on' | 'off')`
（hello-js 的 `__themeBench.setPaintOnly`）。关键文件：`render/paint_only.dart`、`mirror_tree.dart`（`classify` 接入点与
`flushDirty`）、`render/paragraph.dart`（`recolorPaintOnly`）。对拍：`test/paint_only_test.dart`；基准：
`test/theme_switch_bench_test.dart`。

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

## 自绘表面：纯展示子树不建 widget（specs/192 / 193）

渲染层的成本随节点数线性增长：每节点一个 widget + element + RenderObject，4050 节点的挂载帧里 build 约占 75%、layout
约 19%、paint 约 5%（specs/192 占比表）。**纯展示子树**（只有 `view` / `text`，没有事件、`id`、`:active`、transition、
也没有表里之外的样式键）改由 **一个** RenderObject 排版并绘制：

```
mirror 树 ──(门控)──► 自绘根 ──► FlatEngine（SoA 节点 + 约束传递排版）──► 一个 RenderFlatSurface（画矩形 / 圆角 / 文字）
```

| 部分 | 文件 | 说明 |
|---|---|---|
| 门控 | `lib/src/flat/flat_gate.dart` | 以**最顶层可进入的节点**为自绘根；子树纯度与节点数缓存在 `MirrorNode.flatPure/flatSize`，`flushDirty` 沿父链清缓存；`FjsFlatMode { auto, off, force }` |
| 样式白名单 | `lib/src/flat/flat_style.dart` | 受支持的键（子集见 [css-compat.md](css-compat.md#自绘表面的样式子集)）；子集外的键 / 值让整个子树**回退**现有渲染器，不近似 |
| 排版 | `lib/src/flat/flat_layout.dart` | **不是 CSS flexbox**：逐函数镜像现有路径的 widget 链（`margin → 定宽高 → padding → RenderFlex`，含 Flexible、`FjsShrinkStretchFlex` 两趟、`startsNow`），`BoxConstraints` 进 `Size` 出；增量（脏链 + 约束缓存，只重排受影响的路径） |
| 表面 | `lib/src/flat/flat_surface.dart` | `RenderFlatSurface`；视口裁剪（`render/cull.dart` 的 `fjsVisibleWindowOf`，滚动时重绘）；`fjs.ui.rect` 经 `MirrorNode.flatHost` 回答子树内节点的几何 |
| 文字 | `render/paragraph.dart` 的 `FjsSharedPainter`、`widgets/text.dart` 的 `fjsPlainTextSpec` | 与 `_FjsText.build` 同源的键，落到 specs/190 的共享段落缓存，盒子大小逐盒一致 |

行为契约：**画面与现有渲染器逐像素一致**。这条由 `test/flat_parity_test.dart`（生成式 + 手写）、
`test/flat_incremental_test.dart`（随机变更序列，增量 == 全量）、`test/flat_geometry_test.dart`、
`test/flat_cull_test.dart` 守住；一个样式键进白名单当且仅当有对拍用例。

三个开关（只在 Dart 侧，页面源码不变）：

- `FjsFlatMode.auto`（默认）：门控满足、**没有语义客户端**、子树 ≥ `fjsFlatMinNodes`（16）才自绘。
  自绘不生成语义，所以 VoiceOver / TalkBack 开着时整体回退（`SemanticsBinding` 变化时 `FjsView` 会让全树重新过门控）。
- `off`：永不自绘（`--dart-define=FJS_FLAT=off`）；`force`：忽略语义与节点数阈值（测试 / 基准 /
  模拟器，**模拟器与 flutter_test 里语义客户端一直在**，`auto` 在那里不会自绘）。
- dev 构建里 JS 可调 `invokeHost('fjs.dev.flat', 'auto' | 'off' | 'force')` 免重编 A/B（hello-js 的
  `__flat4050.setFlat`）；release 构建不注册。

C++ 排版**不进主线**：specs/192 的 C++ 探针（代码未保留，数据在 specs/192、193 的 spec.md）mount 1.9–2.0 ms、无增量；
Dart 版共享文字 spec / painter 后 mount 2.5–2.7 ms（C++ 的 132–136%）、改 1 格 0.95 ms（48–51%），
未超过事先定下的 1.5 倍判据，省掉 `native/` 改动与预编译产物重建。数据见
[performance.md](performance.md#自绘表面纯展示子树不建-widgetspecs192--193)。

## 关键文件索引

| 层 | 文件 |
|----|------|
| C ABI | `packages/flutter_fjs/native/include/fjs.h` |
| VM/字节码 | `packages/flutter_fjs/native/src/vm.cpp` |
| natives（JSI）| `packages/flutter_fjs/native/src/natives.cpp` |
| libfjs-style（C++）| `packages/flutter_fjs/native/style/`（`include/fjs_style.h` 是唯一 ABI 描述，`test/style_test.cpp`）|
| 样式引擎（TS）| `packages/fjs-runtime/src/css/style.ts`（语义与纯 TS 路径）、`css/native-style.ts`（native 后端）|
| FFI 绑定 | `packages/flutter_fjs/lib/src/ffi.dart` |
| 引擎宿主 | `packages/flutter_fjs/lib/src/engine.dart` |
| 镜像树 | `packages/flutter_fjs/lib/src/mirror_tree.dart` |
| 渲染层 | `packages/flutter_fjs/lib/src/render/`（renderer 分发 + flex/decoration/gesture/style）|
| 自绘表面 | `packages/flutter_fjs/lib/src/flat/`（门控 / 样式白名单 / 排版引擎 / RenderFlatSurface）|
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
