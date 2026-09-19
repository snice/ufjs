# 自定义渲染器：Vue 已实现，React 怎么接

> 第二层第 1 篇。前置：[原理](principles.md)、[线程模型](threading-model.md)
>
> fjs 的渲染层是**框架无关**的。Vue 只是第一个接上去的框架，它用的那套
> 底层 API（element API + op 帧）任何 UI 框架都能用。这篇讲那套 API 长什么样、
> Vue 渲染器怎么用它、以及接一个新框架要做哪几件事。

注意这条链路描述的是 Flutter 和 Web 两个目标。微信小程序目标是另一条
编译期路径（模板直译 WXML，不经过 element API / op 帧），见
[miniprogram.md](miniprogram.md)。

## 三层，框架只碰最上面一层

```
┌─────────────────────────────────────────────┐
│ 框架适配层                                    │
│   fjs-runtime/src/vue/renderer.ts   ← 约 200 行  │ ← 换框架只改这一层
│   （未来）src/react/reconciler.ts             │
├─────────────────────────────────────────────┤
│ element API（框架无关）                       │
│   fjs-runtime/src/ui/element.ts              │
│   create / insert / remove / setText /        │
│   setProps / setStyle / flush                 │
├─────────────────────────────────────────────┤
│ op 帧编码（协议）                             │
│   fjs-runtime/src/ui/ops.ts  ←→ ui_ops.dart  │
└─────────────────────────────────────────────┘
```

**关键**：中间那层已经是完整的命令式树操作 API，`examples/hello-js` 就是直接
用它写的，不涉及任何框架。接新框架 = 把该框架的 host config 映射到这 7 个函数。

## 第 1 层：op 帧协议

一个微任务内的所有操作聚合成一个 `Uint8Array`，一次 `uiOps()` 提交。
小端序，6 个 opcode：

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

- parent id `0` = 宿主隐式根容器
- props（op 6）是**扁平 JSON 对象**（`onTap: true` 标记 / value 等），
  值类型只有字符串、数字、布尔
- 样式不走 props：适配层调 `setStyle(el, style, activeStyle)`，写出的是
  驻留形式（op 7/8/9）。同一个 style 对象交给 N 个元素时只序列化一次，
  所以适配层应当**复用**样式引擎给出的不可变对象，不要每个元素拷一份
- 定义在 [`ui/ops.ts`](../packages/fjs-runtime/src/ui/ops.ts)、
  [`ui_ops.dart`](../packages/flutter_fjs/lib/src/ui_ops.dart) 与
  [`fjsrun.cpp`](../packages/flutter_fjs/native/tools/fjsrun.cpp)，
  **三个文件必须同时改**（宪法 II）

v1 用 JSON 编 props 是性能与通用性的折中：结构化编码能省一次解析，但每加一个
样式键都要动协议。真要优化，先看 [performance.md](performance.md) 的热点表。

## 第 2 层：element API

[`ui/element.ts`](../packages/fjs-runtime/src/ui/element.ts) 的全部对外面：

```ts
import { create, insert, remove, setText, setProps, createRoot, h, flush } from 'fjs';

const root = createRoot('view');           // 挂到宿主根容器（id 0）
const box  = create('view');
const txt  = create('text');

setProps(box, { style: { padding: 16, backgroundColor: '#fff' } });
setText(txt, 'hello');
insert(box, txt);
insert(root, box);
// flush 由 queueMicrotask 自动调；手动提交才需要显式调
```

`Element` 就是 `{ id: number, tag: string }` 加一点簿记 —— **JS 侧不持有任何
Widget**，Dart 侧不持有任何 JS 对象。事件处理器留在 JS 的注册表里，跨桥的只有
`onTap: true` 这样的标记。

`h(tag, props, children)` 是上面几个的组合糖，`examples/hello-js` 用它。

## 第 3 层：Vue 渲染器（参考实现）

[`vue/renderer.ts`](../packages/fjs-runtime/src/vue/renderer.ts) 约 200 行，
`createRenderer(nodeOps)` 的映射：

| Vue RendererOptions | fjs |
|---|---|
| `createElement(tag)` | `create(tag)` |
| `createText(text)` | `create('text')` + `setText` |
| `insert(child, parent, anchor)` | `insert(parent, child, index)` |
| `remove(el)` | `remove(el)` |
| `setElementText` / `setText` | `setText` |
| `patchProp(el, key, prev, next)` | 事件 → JS 注册表 + 标记；样式 → `setStyle` |
| `parentNode` / `nextSibling` | 影子簿记（`parentOf` / `childrenOf` 两张 Map）|

三处非显然的地方，接新框架时会同样遇到：

1. **影子父子关系**。Vue 的规范化流程会问 `parentNode` / `nextSibling`，
   但 fjs 的 Element 里没有真实树（真实树在 Dart 那边）。所以渲染器自己维护
   `parentOf: Map<id, id>` 和 `childrenOf: Map<id, id[]>`。移动节点是
   "detach 但保留子树簿记" + "重新 insert"，不是 remove+create。

   **`remove` 只会被调用在子树的根上**，后代是隐式跟着走的，框架再也不会提起
   它们。原生侧不用管（一条 Remove op 会带走整棵），但渲染器自己的簿记和
   `StyleEngine.forget` 必须自己往下走完——否则每个卸载掉的页面都把元素永远留
   在引擎里，之后每次重排都还在走它们。

2. **事件不跨桥**。`patchProp` 遇到 `onTap` 这类 key，把函数存进
   `element.ts` 的 handler 注册表（key 是 `nodeId:eventType`），props 里只放
   `onTap: true`。Dart 侧看到标记就挂 GestureDetector，触发时
   `dispatchEvent(nodeId, type)` 回来查表。

3. **CSS 引擎挂在渲染器上**。`<style scoped>` 块交给
   [`css/style.ts`](../packages/fjs-runtime/src/css/style.ts) 的 `StyleEngine`，
   它用上面那两张 Map 做选择器匹配和继承，算完通过回调
   `setStyle(el, style, activeStyle)` 下发。**这一层是框架无关的**，
   React 适配层可以直接复用同一个 StyleEngine 实例。

## 接一个新框架（以 React 为例）

roadmap 里的 `fjs/react` 要做的事，按顺序：

### 1. 写 reconciler host config

`react-reconciler` 的 host config 和 Vue 的 nodeOps 一一对应：

| react-reconciler | fjs |
|---|---|
| `createInstance(type, props)` | `create(type)` + `setProps` |
| `createTextInstance(text)` | `create('text')` + `setText` |
| `appendChild` / `appendInitialChild` | `insert(parent, child)` |
| `insertBefore(parent, child, before)` | `insert(parent, child, indexOf(before))` |
| `removeChild` | `remove` |
| `commitTextUpdate` | `setText` |
| `commitUpdate` | diff props → `setProps` / `setStyle` |
| `getPublicInstance` | 返回 `Element` |

复用 `element.ts` 里现成的函数，**不要另写一套 op 编码**。

### 2. 复用影子簿记与 StyleEngine

把 `parentOf` / `childrenOf` 从 `vue/renderer.ts` 提到一个共享模块
（例如 `ui/tree.ts`），Vue 和 React 两个适配层共用，StyleEngine 也从那里
取树结构。这是接 React 时第一件要做的重构。
`vue/renderer.ts` 里挂在元素上的 DOM 式 `contains()`（specs/072）读的就是
这份簿记，抽取时随之下沉到框架无关层。

### 3. 事件适配

React 的 props 是 `onTap={fn}`（驼峰），和 Vue 的 `onTap` 一致，直接进同一个
注册表。React 的合成事件系统**不要接** —— fjs 的事件是从 Dart 派发进来的，
没有 DOM 冒泡（`stopPropagation` 在 Flutter 侧是空实现，见
[ui-api.md](ui-api.md#触摸事件对齐-dom)）。

### 4. 两端同源（宪法 I）

Flutter 侧接上还只是一半。Web 目标上 React 要用 `react-dom`，内置标签得有
一份 React 组件实现，对应现在
[`web/components/`](../packages/fjs-runtime/src/web/components/) 里的 Vue 组件。
事件载荷同样**一律字符串**。

### 5. 构建链

- `packages/fjs/src/bundler/` 加 JSX/TSX 处理（esbuild 原生支持，配 `jsx` 选项）
- `vue` 被 alias 到 `@vue/runtime-core` 是为了不拉进 DOM 运行时，
  React 侧同理要把 `react-dom` 挡在 Flutter 目标之外
- 包导出加 `@ufjs/runtime/react`

### 6. 类型与模板

`fjs create --template react` + `GlobalComponents` 等价物（React 里是
`JSX.IntrinsicElements` 增强），数据源同样是
[`tags.json`](../packages/fjs-runtime/src/tags.ts)。

## 检查清单

接新框架前对着这张表确认，每一条都在宪法里：

- [ ] 只改适配层，没有另写 op 编码
- [ ] 影子树簿记与 StyleEngine 是共享的，不是复制的
- [ ] 事件处理器留在 JS 注册表，跨桥只有标记
- [ ] Flutter 和 Web 两端都实现了，事件载荷是字符串
- [ ] `tags.json` 是标签清单的唯一来源
- [ ] 新增的权衡在代码注释里写了"为什么"

## 相关

- [UI API 参考](ui-api.md) —— 标签、事件、样式的完整清单
- [Vue 3 集成](vue3.md) —— 使用者视角
- [Web CSS 兼容清单](css-compat.md)
- [整体架构](architecture.md)
