# Plan: DevTools Elements / Network 面板（浏览器域桥）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 豁免 | 开发者工具（延续 088）；web 端用浏览器自带 DevTools，web.md 已登记 |
| II 边界即契约 | 否（关键收益） | 无新 C ABI / 事件号 / op / dev-WS 消息；运行时内部模块 + 中继字节层 |
| III 同步单线程零序列化 | 满足 | 桥走调试通道的 Runtime.evaluate（088 已验证）；JSON 只在中继整形 |
| IV 外观照 WeUI | 否 | 无 UI |
| V 静默失效是 bug | 是 | 引擎对未知域会回空结果——中继必须**拦在引擎之前**；VM 未连/eval 失败时 DevTools 侧要收到显式错误而非悬挂 |
| VI 注释记录权衡 | 是 | devtools.ts / cdp-server.ts 头注释记录"为什么走 evaluate 桥而不是引擎内实现/独立协议" |
| VII JS 能包就不要下 Dart | 满足 | 元素树/样式/fetch 生命周期 JS 侧全有——正是"JS 能包"的情形，一行 Dart 不动 |
| VIII 变更要落到文档 | 是 | toolchain.md 面板说明 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `src/devtools.ts`（新） | `__fjsDevtools`：doc/node/style/netDrain/netBody + props/text/net 记录表 |
| JS runtime | `src/ui/element.ts` | setProps 处挂一条 props 记录调用 |
| JS runtime | `src/vue/renderer.ts` | 导出树访问器；setText nodeOp 挂文本记录 |
| JS runtime | `src/net/fetch.ts` | 请求/响应两处插 net 事件 |
| JS runtime | `src/index.ts` | 侧效导入 devtools |
| CLI | `src/debug/cdp-server.ts` | 域拦截路由 + evaluate 桥 + nodeId 映射 + Network 轮询/body 缓存 |
| 测试 | `packages/fjs-runtime/test/devtools.test.ts`、`packages/fjs/test/debug-cdp.test.ts` | 树序列化单测；桥往返测试 |
| 文档 | `docs/toolchain.md` | 面板说明与限制 |

## 3. 方案

**核心：中继域桥。** PrimJS 引擎对未知 CDP 域只会回空结果，所以 DOM/CSS/
Network/Page/Overlay/Emulation/Console/Log 等浏览器域必须在中继**拦在引擎
之前**；Debugger/Runtime 原样透传。桥的实现 = 把 `{method, params}` 变成一条
`Runtime.evaluate`：

```js
(function(){ try {
  return JSON.stringify(__fjsDevtools.cmd("DOM.getDocument", '<params json>'));
} catch (e) { return JSON.stringify({__error: String(e && e.message || e)}); } })()
```

内部 id 用 `1e9+` 偏移避免与 DevTools 的 id 冲突；返回的 JSON 在中继整形为
各域的 CDP 响应/事件。选定 evaluate 桥而非"引擎内实现/独立协议/dev-WS 通道"
的原因：调试通道在**暂停时仍然活着**（Elements 恰在暂停时最有用）、fjsrun
桌面 VM 同样适用、以及宪法 II——零协议增量。

- **Elements**：`doc()` 从 renderer 的 `pageRoots`+`childrenOf`+`elementsById`
  序列化整树（props 记录在 element.setProps 挂、文本在 setText nodeOp 挂、
  class 从 `classesOf`）；`style(id)` 给 `computedOf`+`inlineRecord`。中继把
  doc 映射成 `DOM.getDocument` 的嵌套节点（nodeId = elementId+1000，document=1），
  `CSS.getComputedStyleForNode` 直接喂 computedOf，inline 喂 matchedStyles。
- **Network**：fetch.ts 请求/响应两处推事件进 devtools 队列；`Network.enable`
  后中继每 500ms `netDrain()` 轮询，整形为 requestWillBeSent / responseReceived /
  loadingFinished；响应体（≤512KB）随事件缓存，`getResponseBody` 从缓存答。

**被否掉的备选**：
1. *引擎内实现 DOM/Network 域*——PrimJS 不含这些域，改引擎 = 永久维护 Lynx
   不会要的东西；且 Network 本来就不是引擎的职责。
2. *dev-WS 上加专用检查协议（app 推元素树/网络事件）*——多一条协议、多一处
   三端同步，且暂停时 dev-WS 死了（UI isolate 阻塞），恰是最需要树的时候不可用。
3. *Lynx 的 devtools-frontend fork*——引入整套 Lynx 定制前端（见 088 plan §3.2）。

## 4. 风险

- **树快照过期**：DOM 变更不推送（§spec 2），文档写明"重开 Elements 刷新"。
- **未知域清单**：DevTools 可能发中继没实现的方法（getBoxModel 等）——桥对
  未识别方法回 `{}`（空结果），DevTools 面板降级可用；持续观察补齐。
- **props/text 记录的内存**：map 随节点数增长——doc() 时顺手清扫已不在
  elementsById 里的条目。
- **fetch body 抢占**：ABI≥2 时响应体是句柄，devtools 只记 base64 路径的
  文本或句柄的长度，绝不在应用 materialize 前读走字节。
- **大响应**：>512KB 只记长度 + truncated 标记。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
# 模拟器（fjs run ios 跑着，dev server 自动热更 runtime 变更）：
fjs debug &            # 若未在跑
node specs/089-devtools-panels/panels-client.mjs
#   DOM.getDocument → 元素树；Network.enable → fetch 后出现请求行与响应体
# 真实 Chrome：devtools://devtools/bundled/inspector.html?ws=127.0.0.1:38902/cdp
#   Elements 树 + Computed 样式；Network 请求行 + Response 预览
```
