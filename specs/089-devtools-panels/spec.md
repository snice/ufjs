# Spec: DevTools Elements / Network 面板（浏览器域桥）

- **ID**: 089-devtools-panels
- **状态**: done（2026-09-21 模拟器面板门禁全绿：174 节点元素树 / computed
  样式 / Network 请求行与 4057 字节响应体；真实 Chrome DevTools 前端可用）
- **日期**: 2026-09-21

## 1. 要解决什么

spec 088 的 `fjs debug` 只亮了 Sources / Console（断点、单步、作用域、
evaluateOnCallFrame）——PrimJS 引擎只实现 Debugger/Runtime 域。开发者还需要：

- **Elements（元素面板）**：看到当前页面的元素树（tag / 属性 / 文本），
  点开看生效样式（computed）——fjs 的"DOM"是运行时 element 树（JS 侧），
  浏览器根本不知道它的存在。
- **Network（网络面板）**：看到 `fetch()` 的请求列表（method / url / 状态 /
  headers）和响应体。fjs 的 fetch 走 `invokeHost('fjs.http.request')` 由
  Dart 宿主发出，浏览器也没有它的存在。

## 2. 不做什么（Non-goals）

- **不做元素树实时推送**（DOM.childNodeInserted 等变更事件）：v1 树是
  快照式——DevTools（重新）打开 Elements 时 `DOM.getDocument` 拉一次，
  展开节点按需拉取。运行中的 DOM 变更不会自动刷进面板（点 Elements 面板
  左上角刷新或重开 DevTools 重拉）。
- **不做样式编辑**（CSS.setStyleDeclarations / DOM.setAttributeValue 落回
  运行时）：Styles 面板只读。命中规则列表（matchedCSSRules）也不做——
  Styles 主区域给 inline + **Computed 面板给完整生效样式**（这才是排错
  时要的）。
- **不做 Overlay 高亮**（悬停高亮节点需要 Emulation/DOM.setHighlight 配合
  Flutter 侧画框，另起 spec）。
- **Network 不做瀑布流计时**（Resource timing 精确到请求/响应两点，duration
  用两端时间差）；不做请求拦截/重放（Fetch domain）；响应体上限 512KB，
  超出记长度并标记截断。
- **web 端不涉及**：浏览器构建本来就有完整 DevTools。

## 3. 用户可见的行为

`fjs debug` 照旧启动。Chrome DevTools 里：

- **Elements**：显示当前每页的元素树（`view` / `text` / `button` …），节点
  带属性（class / style / 业务 props）、文本内容；点开节点，Styles 侧栏有
  element.style（inline）与 Computed（完整生效样式，来自样式引擎
  `computedOf(id)`）。app 停在断点上时树照样可查（走的是调试通道的
  Runtime.evaluate，不依赖被冻结的 Dart 事件循环）。
- **Network**：`fetch()` 的每条请求一行：方法、URL、状态码、响应头；点开
  看 Response 体（文本/JSON 直接预览）。轮询延迟 ≤500ms。

## 4. 两端约定（宪法 I）

**豁免**（延续 spec 088）：DevTools 面板是开发者工具；web 端用浏览器自带
DevTools，页面代码零改动。已在 `docs/web.md` 登记。

## 5. 契约变更（宪法 II）

- [x] **无新 C ABI**、无新事件号、无新 UI op。全部数据走既有通道：
      - 中继 ⇄ 引擎：Runtime.evaluate（spec 088 已验证的调试通道）；
      - 运行时新增 `globalThis.__fjsDevtools` 模块（挂 globalThis 与
        `__fjsDefineUnit` 同一先例），element/renderer/fetch 三处各插一条
        纯 JS 记录调用——JS 侧内部约定，不跨边界。
- [x] dev server / dev-WS 协议：**零变更**。
- [ ] UI op 协议：不涉及
- [ ] 事件类型：不涉及

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 全绿；新增运行时 devtools 单测
   （挂一棵真实元素树断言 doc/props/text/style 输出）与中继桥测试
   （假 VM socket 应答 Runtime.evaluate，断言 CDP 响应整形）全绿。
2. 模拟器端到端：`fjs run ios` + `fjs debug` 下，CDP 客户端
   `DOM.getDocument` 返回真实元素树（tag/属性/文本）；`Network.enable` 后
   在 app 里 `fetch` dev server，面板数据出现请求行与可读响应体。
3. 真实 Chrome DevTools：Elements 树可展开、节点可选中、Computed 样式有值；
   Network 面板出现请求行、Response 可预览。
4. 断点暂停期间 Elements 仍可查询（走调试通道）。

## 7. 待澄清

- 无（方向用户已点名：网络、元素；深度以上述 §2 边界为准）。
