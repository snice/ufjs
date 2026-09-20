# 运行时 API

业务代码能导入的 `fjs*` 模块。它们都不是真实的 npm 包名，而是构建时解析的虚拟模块，类型由 `@ufjs/runtime/ambient` 提供。

## `fjs/app`

```ts
import { createFjsApp } from 'fjs/app';

createFjsApp({ routes, plugins, shell, transition, setup }).mount();
```

选项见[配置 · createFjsApp](/reference/config#createfjsapp-选项)。

## `fjs/pages` / `fjs/plugins`

```ts
import { routes } from 'fjs/pages';     // src/pages 生成的路由表
import { plugins } from 'fjs/plugins';  // src/plugins + 模块组件
```

`routes` 是当前平台真正存在的页面，每项有 `path`、`name`、`meta` 等字段，可以直接用来渲染目录。

## `fjs/router`

```ts
import { useRouter, useRoute, onPageSettled } from 'fjs/router';
import type { RouteLocation } from 'fjs/router';
```

| API | 说明 |
|---|---|
| `useRouter()` | `push(to)` / `replace(to)` / `back()` / `go(-n)` |
| `useRoute()` | 当前页面的 route：`path` `fullPath` `params` `query` `meta`（响应式） |
| `onPageSettled(cb)` | 本页转场动画结束后调用一次 |

`to` 可以是路径字符串，或 `{ path, query }` / `{ name, params, query }`。详见[页面与路由](/guide/routing)。

## `fjs`

### 宿主通信

| API | 说明 |
|---|---|
| `hasNativeHost: boolean` | 是否跑在 App 里（有 Dart 宿主） |
| `invokeHost<T>(name, ...args)` | 同步调用 Dart 宿主函数。参数只能是 `string \| number \| boolean \| null`。无宿主时抛错 |
| `invokeHostAsync<T>(name, ...args)` | 异步调用，返回 Promise。无宿主时 reject |
| `engineInfo` | 引擎信息（ABI 版本等） |

### 网络

| API | 说明 |
|---|---|
| `fetch(url, init?)` | WHATWG fetch 子集，额外支持 `init.timeout`（毫秒）。两端行为一致 |
| `Headers` / `Response` / `AbortController` | 配套类型 |

App 端这些也装成了全局对象，第三方库里的裸 `fetch` 可以直接用。

### 其它

| API | 说明 |
|---|---|
| `toast(message)` | 轻提示 |
| `nowMs()` | 引擎单调时钟（毫秒） |
| `Worker` | `new Worker('/workers/<name>.js')`，对应 `src/workers/<name>.ts` |
| `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` | 同全局 |

### 类型

| 类型 | 说明 |
|---|---|
| `FjsTouchEvent` | 触摸事件对象：`touches` `changedTouches` `targetTouches` `timeStamp` `target` |
| `FjsCanvasApi` | `<canvas ref>` 拿到的对象：`getContext('2d')` `toDataURL()` `width` `height` |
| `FjsHostValue` | `string \| number \| boolean \| null` |

### element API（不用框架时）

```ts
import { h, create, createRoot, insert, remove, setText, setProps, setStyle, flush } from 'fjs';
```

| API | 说明 |
|---|---|
| `createRoot(tag?)` | 创建挂在宿主根容器上的根元素 |
| `create(tag)` | 创建元素 |
| `h(tag, props?, children?)` | 创建并设置属性、子节点 |
| `insert(parent, child, index?)` | 插入 |
| `remove(el)` | 移除（连同子树） |
| `setText(el, text)` | 设置文本 |
| `setProps(el, props)` | 合并属性；值为 `null` 删除；`onTap` 等函数进事件注册表 |
| `setStyle(el, style, activeStyle?)` | 设置样式 |
| `flush()` | 立即提交当前帧（通常由微任务自动完成） |

用法见 `examples/hello-js` 和[渲染管线](/advanced/rendering)。

### 元素上的 DOM 形状 API

任何元素（经 `ref` 拿到的、或作为事件 `target` 的）都带一小组 DOM 形状的成员，按 DOM 写法的组件库（vant）不需要 fjs 适配就能操作：

| 成员 | 说明 |
|---|---|
| `el.style` | DOM 式写入面（`el.style.opacity = 0.5`），走内联层、与 `:style` 绑定共用同一份记录。不是真的 CSSStyleDeclaration —— 读不到层叠结果，只有内联值 |
| `el.getBoundingClientRect()` | border box 在窗口坐标系的位置与尺寸，同步返回。未布局的节点全零；页面已挂上之后读它会强制同步重排（同一 tick 里取消 `display:none` 再量高度能拿到新值）。**App 上页面刚 push 进来的当次不强制重排**（避免把整页 layout 叠在转场的 JS 栈上），第一拍可能量到 0，下一帧才正常 |
| `el.offsetWidth` / `offsetHeight` / `offsetLeft` / `offsetTop` / `offsetParent` | 与 `getBoundingClientRect` 同一份布局。border box 尺寸与相对最近定位祖先的偏移；没有定位祖先时 `offsetParent` 为 null |
| `el.addEventListener` / `removeEventListener(type, listener)` | 事件名同 `on<Name>` prop（`'touchmove'` ↔ `@touchmove`）；`passive` / `capture` 选项忽略 |
| `el.contains(other)` | `other` 是自身或后代时为 true。`position: fixed` 的元素挂在弹层宿主下，不再算逻辑父元素的后代 |
| `input` / `textarea` 的 `focus()` / `blur()` | DOM 式控件焦点；非控件元素调用是空操作 |
| `input` / `textarea` 的 `value` | DOM 式读写：读得到当前文本，写会推到原生输入框；`setSelectionRange()` 是空操作 |

## `vue`

照常 `import { ref, computed, watch, onMounted } from 'vue'`。构建时 `vue` 被 alias 到 `@vue/runtime-core`（App）/ 官方 `vue`（Web）/ `@ufjs/runtime/wx`（小程序）。

App 端由 vue-shim 补齐了几个 runtime-dom 才有的导出：`<Transition>`（fjs 版：enter/leave 类切换 + animation / transition 补间）、`vShow`（只碰内联 `display` 一项）、`withKeys`（直通）、`<TransitionGroup>`（纯透传）。

不可用：`v-model` 指令、`vue-router`（用 `fjs/router`）、`createApp`（挂第二个根需要真实 DOM 容器，会指名抛错 —— 组件库的命令式 Toast / Dialog 因此不可用，改用组件式）、直接操作 DOM 的 API（App 端没有 `window` / `document` 全局，runtime 也不模拟）。

## 内置标签

标签、属性、事件的完整清单见[内置组件](/guide/components)和仓库的 [UI API 参考](https://github.com/snice/ufjs/blob/main/docs/ui-api.md)。
