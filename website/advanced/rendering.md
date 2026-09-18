# 渲染管线

这一篇跟着一次渲染走完全程：Vue 组件 → element API → 二进制帧 → Dart 镜像树 → Flutter Widget。

```text
Vue 组件 ─ patch ─► nodeOps ─► element API ─► OpWriter ─► Uint8Array
                                   │                          │ uiOps()
                              CSS 引擎算样式                  ▼
                                                   Dart：applyFrame → MirrorTree
                                                              │ 按节点通知
                                                              ▼
                                                   _FjsNodeView.build → Widget
```

## 第 1 层：Vue 渲染器

`packages/fjs-runtime/src/vue/renderer.ts` 用 Vue 的 `createRenderer` 实现了一组 nodeOps：

| Vue 调用 | fjs |
|---|---|
| `createElement(tag)` | `create(tag)` |
| `createText(text)` | `create('text')` + `setText` |
| `insert(child, parent, anchor)` | `insert(parent, child, index)` |
| `remove(el)` | `remove(el)` |
| `patchProp(el, key, prev, next)` | 事件 → JS 注册表；样式 → CSS 引擎 → `setStyle` |
| `parentNode` / `nextSibling` | 渲染器自己维护的影子父子关系 |

三个不那么显然的实现点：

1. **影子树**。真实的树在 Dart 那边，JS 侧的 Element 只是 `{ id, tag }`。但 Vue 的 diff 会问 `parentNode` / `nextSibling`，所以渲染器维护了 `parentOf` / `childrenOf` 两张 Map。CSS 引擎做选择器匹配也用它。
2. **事件不跨桥**。`@tap="fn"` 的函数存在 JS 侧注册表里（键是 `节点id:事件类型`），props 里只发一个 `onTap: true` 标记。Dart 看到标记就挂 `GestureDetector`，触发时回派 `dispatchEvent(nodeId, type)`，JS 查表调用。所以**换一个闭包不产生任何跨桥流量**。
3. **CSS 引擎挂在渲染器上**。`<style>` 块在构建时被原样注入运行时的 `StyleEngine`，它用影子树做选择器匹配、继承、`:active` 预计算，结果通过 `setStyle` 下发。

## 第 2 层：element API

`packages/fjs-runtime/src/ui/element.ts` 是框架无关的命令式 API：`create` / `insert` / `remove` / `setText` / `setProps` / `setStyle` / `flush`。每个调用不直接跨桥，而是往当前帧的缓冲里写一条 op，并用 `queueMicrotask(flush)` 安排提交。

## 第 3 层：op 帧协议

一个微任务内的所有操作聚合成一个 `Uint8Array`，小端序：

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
| 9 | RESET_STYLES | — |
| 10 | CANVAS | u32 id, u32 len, 2D 绘制命令流 |

- parent id `0` 是宿主的隐式根容器
- props 是扁平 JSON，值只有字符串、数字、布尔；`null` 表示删除该键

### 样式驻留

样式不走 props，而是**驻留**的（op 7 / 8）：CSS 引擎把解析结果相同的元素交给**同一个不可变 style 对象**，这份对象每帧只作为一条 `DEFINE_STYLE` 过一次桥，每个元素只花 13 字节的 `SET_STYLE` 引用它。

效果：1000 行的页面切换主题，帧大小从约 600 KB 降到约 50 KB，Dart 侧的 JSON 解析从每节点一次降到每种样式一次。

`SET_STYLE` 同时携带 `activeStyleId`：`:active` 的按压样式提前算好一起下发，所以按下时 Flutter 直接切换，不用回 JS。

### 版本协商

bundle 和 Flutter 二进制是分开发布的，新 bundle 可能遇到老宿主。宿主创建 VM 时写入 `globalThis.__fjsHost = { uiOpsVersion }`，运行时读到老版本就回落到老编码。

## 第 4 层：镜像树

Dart 侧 `lib/src/mirror_tree.dart` 维护一棵和 JS 侧一一对应的节点树 `MirrorNode`（tag、props、style、text、children）。`applyFrame` 把 op 逐条应用上去，并把改动过的节点 id 收进一个脏集合。

帧末统一 `flushDirty()` 发通知，而不是边应用边通知 —— 一次 JS 事件可能产生好几个帧，监听者不该看到半应用的状态。

## 第 5 层：Widget

`lib/src/render/renderer.dart` 把每个节点渲染成一个 `_FjsNodeView`，它**只监听自己这个节点**的变化信号。一个 `setText` 只会让那一个文本节点重建，而不是整棵树。

这里有个 Flutter 层面的关键点：`Element.updateChild` 只在 `child.widget == newWidget` 时跳过子节点，而 `Widget.==` 是不可重写的同一性比较。所以 **Widget 实例被缓存在 `MirrorNode.view` 上**，父节点重建时把同一个实例交回去，重建就停在子节点这一层。

标签到 Widget 的映射：

| 标签 | 实现 |
|---|---|
| `view` | `render/flex.dart`：Flex + 装饰 + 定位 |
| `text` | `Text` / `Text.rich` |
| `scroll-view` | `SingleChildScrollView`（有吸顶时换成 sliver） |
| `list-view` | `ListView.builder` |
| `image` | `Image` + `cached_network_image` |
| 自定义标签 | `engine.components.register(tag, builder)` 注册的 Dart builder |

部分标签（`canvas`、`textarea`、`picker`、`form`、`rich-text`）不是 Dart 标签，而是**用 JS 组件把其它标签拼出来的**，两端共用同一份实现。能在 JS 侧包出来的能力就不下沉到 Dart，这是 ufjs 控制维护成本的方式。

## 自己试试：不用 Vue

```ts
import { h, createRoot, setText } from 'fjs';

const root = createRoot('view');
const label = h('text', { style: { fontSize: 20 } }, 'hi');
root.appendChild(label);

let n = 0;
root.appendChild(h('button', { onTap: () => setText(label, `taps: ${++n}`) }, '+1'));
```

`npx @ufjs/cli create my-app --template ts` 生成的就是这种项目。它能帮你直观地理解 Vue 渲染器在替你做什么。

## 接入别的框架

React、Solid 或自研框架只需要写一个适配层，映射到 element API，复用同一个 CSS 引擎和影子树。步骤见仓库文档 [自定义渲染器](https://github.com/snice/ufjs/blob/main/docs/custom-renderer.md)。
