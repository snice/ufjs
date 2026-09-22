# 事件、网络与状态

## 事件

### 点击与控件事件

```vue
<view @tap="onTap" @longpress="onLongPress" />
<input :value="q" @text-changed="(t: string) => (q = t)" @submit="search" />
<switch :value="on" @value-changed="(v: string) => (on = v === '1')" />
```

**事件载荷一律是字符串**。需要结构化数据时是 JSON 串，自己 `JSON.parse`：

| 事件 | 载荷示例 |
|---|---|
| `@text-changed` / `@submit` | 输入框当前文本 |
| `@value-changed`（switch / checkbox） | `"1"` / `"0"` |
| `@value-changed`（slider） | `"42.50"` |
| `@value-changed`（checkbox-group） | `'["a","c"]'` |
| `@load`（image） | `'{"width":600,"height":400}'` |
| `@change`（swiper） | `"2"` |

这样约定是为了各端一致：Flutter 从 Dart 派发回来的、浏览器里 DOM 组件派发的、小程序里的，拿到的是逐字符相同的字符串。

::: warning v-model
`v-model` 不可用（它的实现依赖 DOM），用 `:value` + 对应事件替代。
:::

### 触摸事件

任何标签都可以监听 `touchstart` / `touchmove` / `touchend` / `touchcancel`，事件对象和浏览器同形：

```ts
import type { FjsTouchEvent } from 'fjs';

function onMove(e: FjsTouchEvent) {
  const t = e.changedTouches[0];
  t.identifier;              // 手指 id
  t.clientX; t.clientY;      // 页面坐标（逻辑像素）
  t.offsetX; t.offsetY;      // 相对本元素左上角
  e.touches;                 // 屏幕上所有手指
}
```

自己处理拖拽 / 手势的节点要加 `touch-action: none`，否则外层滚动容器会把手势抢走：

```css
.draggable { touch-action: none; }
.row { touch-action: pan-y; }   /* 竖向留给滚动，横向归自己 */
```

与浏览器的差别：没有事件委托（`target` 就是挂监听的节点）；Flutter 上 `stopPropagation()` / `preventDefault()` 是空实现，**两端都生效的是 `touch-action`**。

一帧内的多次 move 会合并成一次派发，拖拽时改 `transform` 而不是 `left/top`，就能做到跟手不掉帧。例子见 `demo/src/pages/drag.vue`、`dnd.vue`。

## 网络请求

`fetch` 在 App 上由 Dart 的 `HttpClient` 实现，API 是标准 WHATWG `fetch` 的子集：

```ts
import { fetch } from 'fjs';

const res = await fetch('https://api.example.com/items', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'hi' }),
  timeout: 5000,            // fjs 扩展
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const items = await res.json();
```

- 4xx / 5xx 会 resolve（和浏览器一致），只有网络失败、超时、abort 才 reject
- 支持 `AbortController`、二进制响应（`arrayBuffer()`）
- 没有流式 body，响应整体到达
- 全局的 `fetch` 也装好了，第三方库里的裸 `fetch` 能直接跑。但浏览器的全局 `fetch` 不认 `timeout`，**想两端完全一致就 `import { fetch } from 'fjs'`**
- **根相对 URL**（`fetch('/data/x.json')`）两端同源：dev 时向 dev server 取，release 时从打进 App 的 `public/` 资源里读

::: tip 跨域
App 端没有浏览器的同源策略，但 Web 端有。接口需要在 Web 端调用时，服务端要配 CORS。
:::

## 状态管理

### 页面内

就是 Vue：`ref`、`reactive`、`computed`、`watch`，全部照常用。

### 跨页面

App 端**每个页面是一个独立的 Vue app**（这样才能对应一个原生路由）。跨页共享状态有两种方式：

**模块级状态**：写在一个普通模块里导出，所有页面 import 它：

```ts
// src/store/session.ts
import { reactive } from 'vue';
export const session = reactive({ user: null as null | { name: string } });
```

分包构建时，被多个页面引用的模块会自动进入共享 chunk，所以它在所有页面之间是同一份。

**pinia**：

```bash
npx fjs add pinia
```

它会装包、生成 `src/plugins/pinia.ts`，并在 `package.json` 里登记 `fjs.shared`，保证所有页面拿到同一个 store。原因和细节见[添加插件](./plugins)。

### 持久化

运行时没有内置 `localStorage`。需要本地存储时，通过 Flutter 插件（比如 `shared_preferences`）提供一个宿主函数，JS 侧用 `invokeHostAsync` 调用。完整做法见[添加插件：接入 Flutter 插件](./plugins#接入-flutter-插件)。

## 定时器与动画帧

`setTimeout` / `setInterval` / `requestAnimationFrame` / `queueMicrotask` / `Promise` 都可用。它们由 Flutter 每帧（约 16ms）驱动推进。

## 提示

```ts
import { toast } from 'fjs';
toast('已保存');
```

## Worker

JS 跑在 Flutter 的 UI 线程上，一段长时间的同步计算会卡住界面。CPU 密集的任务放进 Worker：

```ts
// src/workers/sum.ts —— 构建成 /workers/sum.js
declare function postMessage(message: string): void;

onmessage = (e: MessageEvent) => {
  const n = Number(e.data);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.sqrt(i);
  postMessage(String(sum));
};
```

```ts
// 页面里
const worker = new Worker('/workers/sum.js');
worker.onmessage = (e) => console.log(e.data);
worker.postMessage('3000000');
onUnmounted(() => worker.terminate());
```

- `src/workers/` 下的每个文件会被单独打成自包含脚本，可以 import 本地模块
- Worker 里没有 Vue 和 fjs 运行时，只有 `onmessage` / `postMessage` / `console` / 定时器
- 消息是字符串，传对象自己 `JSON.stringify`
- App 上它是一个独立的 Dart isolate + 独立的 JS 引擎实例，真并行；Web 上是真正的 Web Worker；小程序上是 `wx.createWorker`（同时只能有一个）

## 调用原生能力

需要调用 Dart / Flutter 插件时：

```ts
import { invokeHost, invokeHostAsync, hasNativeHost } from 'fjs';

if (hasNativeHost) {
  const info = invokeHost<string>('device.info');                     // 同步
  const user = await invokeHostAsync<{ name: string }>('user.load', 42); // 异步
}
```

宿主函数由 Dart 侧注册。怎么写、放在哪，见[添加插件](./plugins#接入-flutter-插件)和[创建模块](./modules)。Web 端没有 Dart 宿主，所以要用 `hasNativeHost` 判断并提供浏览器端的替代实现。
