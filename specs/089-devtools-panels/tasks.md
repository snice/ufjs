# Tasks: DevTools Elements / Network 面板

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 spec/plan 本体（本目录）；确认零协议增量（无新 C ABI/事件号/op/dev-WS 消息）

## 实现

- [x] T010 `fjs-runtime/src/devtools.ts`：props/text/net 记录表 + `cmd()` 入口
      （按 CDP 方法名寻址）+ globalThis 挂载 + 过期清扫
- [x] T011 `src/ui/element.ts` setProps、`src/vue/renderer.ts` setText /
      setElementText 挂记录；renderer 注册 DevtoolsTreeProvider
- [x] T012 `src/net/fetch.ts` 请求/响应钩子；响应体在应用 materialize 时记录
      （≤512KB 截断）——响应期借句柄实测拿到空字节，见 tasks 尾注
- [x] T013 `src/index.ts` 侧效导入
- [x] T014 `fjs/src/debug/cdp-server.ts`：域拦截 + evaluate 桥（内部 id 1e9 偏移）+
      DOM/CSS 整形（nodeId = elementId*2+1000）+ Network 轮询/body 缓存 +
      Page.getResourceTree 桩 + 未识别域回 `{}`

## 测试

- [x] T020 `fjs-runtime/test/devtools.test.ts`：真实元素树断言 doc/props/text/
      class/style；fetch 行的"drain 才武装"语义（mock 原生宿主 + resetModules）
- [x] T021 `fjs/test/debug-cdp.test.ts` 扩展：假 VM 应答 Runtime.evaluate，
      断言 DOM.getDocument 的桥往返与 nodeId 映射

## 验收

- [x] T030 `pnpm run typecheck` / `pnpm test`（1002 项全绿）
- [x] T031 模拟器端到端（iPhone 17，`fjs run ios` + `fjs debug`）：
      DOM.getDocument 174 节点、app tag/属性序列化、computed 样式有值、
      Network 请求行（fetch dev server 的 manifest.json）、loadingFinished、
      getResponseBody 读出 4057 字节真实清单
- [x] T032 真实 Chrome DevTools 前端连接成功（Elements/Network 面板可用）
- [x] T033 文档：toolchain.md 面板说明与限制；spec 状态收尾

## 验收过程中的关键发现（尾注）

1. **响应体不能在响应事件期借句柄**：`readHandleBytes(handle)` 在 dispatch
   处理器内借出的是空字节（app 自己稍后 materialize 才拿到 4057 字节），
   原因未深究——最终改为在 `materialize()` 记录，语义也更诚实（应用读过的
   响应体才可预览）。
2. **调试器附加期间 console 被引擎导流到 CDP**：运行时里用 console.debug
   打的调试日志不会出现在 flutter 日志——排障时要走 drain 数据或
   consoleAPICalled 采集，不能看 flutter 日志。
3. **中继的桥接 evaluate id 用 1e9 起始**且按解析后的 id 判定（不能前缀
   匹配——id 会越过边界值）。
