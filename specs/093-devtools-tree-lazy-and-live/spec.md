# Spec: DevTools Elements 树按需展开 + 变更自动刷新

- **ID**: 093-devtools-tree-lazy-and-live
- **状态**: draft
- **日期**: 2026-09-22（092 上线后用户复测的两条反馈：树只显示根壳、
  元素变化不自动刷新）

## 1. 要解决什么

真实项目接上 `fjs debug` 后，Chrome DevTools 的 Elements 面板有两个
体验断层（用户截图实测）：

1. **树只显示根节点。** 面板里只有
   `<view __navKey="0"><view class="shell"></view></view>` 一层壳，
   展开看不到任何子节点——哪怕手机上第二个页面已经打开、内容完整渲染。
   `DOM.getDocument` 的应答本身是完整递归树（`mapNode` / `buildNode`
   都递归，089 探针能数到 174 节点），但真实前端首拍带 `depth:1`，
   之后靠 `DOM.requestChildNodes` / `DOM.getFlattenedInnerHTML` /
   `DOM.querySelector` 按需拉深层——这三个方法在中继的兜底分支
   （`routeBridged` 末尾 `reply(ws, id, {})`）里**一律空应答**。
   面板拿到根 + `childNodeCount` 后，要子树的请求全部空手而归，于是
   永远停在第一层。协议探针 `panels-client.mjs` 自己走递归 `children`
   数节点、从不调 `requestChildNodes`，所以测试绿但真实面板会塌。

2. **元素变化不自动刷新。** `DOM.documentUpdated` 目前只在两处推：
   VM 整包重载（`debug-reload` 标记）和点了已死节点的自愈
   （`styleCmd` 的 `exists:false`）。普通元素增删 / 属性 / 文本 /
   路由切换什么都不推，也没有 `DOM.childNodeInserted` 等增量事件。
   运行时每帧递增 `devtoolsTreeVersion`（`host.ts` `flushNow()`），
   中继的 `Dom.version` 轮询第一版做过，但会把真实前端的样式面板
   打成永转（092 R14 撤掉），现在这个版本号没人消费。开发者只能
   手动刷新或重开 DevTools。

## 2. 不做什么（Non-goals）

- **不用 `documentUpdated` 推纯文本/属性变化**：092 R14 已证明整树重拉会重启全部样式请求、把 Styles 打成永转。文本走 `DOM.characterDataModified`，属性走 `DOM.attributeModified`，由同一条 1.5s 轮询排空，前端就地改一个节点。
- **不做 `DOM.childNodeInserted` 级别的结构增量**：增删节点、页根、路由、HMR 仍走一次 `documentUpdated`（1s 冷却）。
- **不恢复「每帧轮询 → documentUpdated」**：092 R14 已证明持续变更的
  app（vant 定时器/动画）会被打成每秒整树重拉、Styles 面板永转。
- **不改 UI op 协议、natives 表、事件类型**（三张契约表都不动）。
- **不动 Console / Network / 样式面板**（089/092 已交付部分）。
- **不做 screencast 预览**（092 已缓做，记在 roadmap）。
- **不改裸 element API 应用（hello-js）树为空的现状**：089 已知边界，
  provider 只在 Vue renderer 注册，本轮不扩。

## 3. 用户可见的行为

### 3.1 树按需展开

改完之后，DevTools Elements 面板展开任意节点都能看到真实子树：

1. 打开 `fjs debug` + DevTools，根面板显示
   `<view __navKey="0"><view class="shell">…`。
2. 点 shell 前的展开三角 → 能看到页面内容（NavBar / Tabs / …），
   深层节点继续展开可达。
3. 手机上切到第二个页面（路由 push），DevTools 刷新后能看到两个
   页根（`__navKey="0"` 与 `__navKey="1"`）及其完整子树。

实现上：`routeBridged` 把这三个方法从兜底挪到真实现（按
`nodeId → elementId` 映射从当前文档重新序列化）：

| 方法 | 行为 |
|---|---|
| `DOM.requestChildNodes` | 按协议（`browser_protocol.json` 实测核对）返回 **void**：应答 `{}` 后**推送 `DOM.setChildNodes {parentId, nodes}` 事件**送达子树；找不到回空 `nodes`。第一版把子树塞进应答体是错的——前端从不读该字段，只等事件，展开依旧为空 |
| `DOM.getFlattenedInnerHTML` | 协议里**不存在**此命令（全 domain 检索无 `*InnerHTML*` 命令，前端不会发）；中继保留一个无害分支（回 `{result, type:'string'}`）作探针兼容，真正承担展开的是 `requestChildNodes` → `setChildNodes` 事件 |
| `DOM.querySelector` | 在当前文档里按选择器找（复用 runtime 侧 CSS 引擎的匹配，或中继侧简化实现），回 `{nodeId}`；找不到回 `{nodeId: 0}` |

### 3.2 变更自动刷新

改完之后，结构变化不需要手动刷新：

1. 路由 push 到第二页 → DevTools 面板**在一次静默窗口内**自动重拉树，
   用户看到两个页根（或至少新页根出现）。
2. HMR / 整包 reload → 已有 `debug-reload` → `documentUpdated`，行为不变。
3. 元素插入/删除（非路由）→ 同样触发一次 `documentUpdated`。
4. 纯文本变化（按钮把 `count: 0` 改成 `count: 1`）在同一轮询窗口内更新
   对应文本节点，且**不**推 `documentUpdated`。属性变化同理走
   `attributeModified`。队列溢出（单次排空超过 200 条）才退回一次
   `documentUpdated`。纯样式变化仍点节点时靠 `exists:false` 自愈（092 已有）。

实现方向（择一，plan 阶段定）：

- **方案 A（推荐）**：中继在 `getDocument` 应答后开始低频轮询
  `Dom.version`（例如 1–2s，而不是 500ms），**只在版本号跨过一个
  「结构版本」阈值时**推 `documentUpdated`。运行时侧需要区分
  `structuralVersion`（insert/remove/根增删/路由）与普通 `treeVersion`
  （帧批次），只有前者参与轮询判定。
- **方案 B**：在 element API 的 `insert`/`remove`/`createRoot` 点调一个
  新 hook（`devtoolsSlots.onStructuralChange?.()`），中继通过
  `Runtime.addBinding` 或轮询感知。B 更实时但要动运行时槽位表。

无论哪个方案：**推完 `documentUpdated` 后必须冷却**（例如 ≥1s 内不重
推），并保留 092 的两条既有触发点不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 树 provider 来自 Vue renderer（`pageRoots`/`childrenOf`）；`__navKey` 页根保活，路由切换只改 `__navHidden` | web 构建不走这条 CDP 链路（浏览器自带 DevTools），无对应改动 |
| 事件载荷 | CDP 事件：`DOM.documentUpdated {}`、`DOM.setChildNodes {nodeId, nodes}`、`DOM.characterDataModified {nodeId, characterData}`、`DOM.attributeModified {nodeId, name, value}`、`DOM.getFlattenedInnerHTML {outerHTML}` | 不涉及 |
| 已知差异 | 裸 element API 应用（hello-js）provider 未注册，树为空——089 边界，本轮不改 | web 侧用浏览器原生 Elements，不受本 spec 影响 |

DevTools 是开发机上的桌面 Chrome，不存在「Flutter 端与 Web 端对拍」
的运行时问题；验收以**真实 Chrome DevTools 前端**为准（沿用 092 的
无头 Chrome + 前端 SDK evaluate 方法）。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）——不涉及
- [ ] 事件类型（`element.ts` + `fjs.h`）——不涉及
- [x] 都不涉及（CDP 方法形状由 `cdp-server.ts` 单侧定义，运行时侧
  `devtools.ts` `cmd()` 如需新方法才动，届时按 CDP 方法名寻址）

## 6. 验收标准

可执行、可判定的条目：

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过（含新增用例）。
3. `packages/fjs/test/debug-cdp.test.ts` 新增：假 VM 场景下
   `DOM.requestChildNodes` 返回非空 children、
   `DOM.getFlattenedInnerHTML` 返回含子标签的 HTML、
   `DOM.querySelector` 命中返回 nodeId / 未命中回 0。
4. `packages/fjs/test/debug-cdp.test.ts` 新增：结构变化（模拟版本号
   跨阈值）触发一次 `DOM.documentUpdated`，且 1s 冷却内不重推；
   纯文本/属性变化推 `characterDataModified` / `attributeModified`，
   不推 `documentUpdated`。
5. 真实前端终验（沿用 092 的无头 Chrome + 前端 SDK evaluate）：
   - Elements 面板展开 shell 能看到至少 3 层深的子节点；
   - 面板打开期间在 app 侧触发一次路由 push，面板在不手动刷新的
     情况下出现新页根（或在 ≤2s 内自动重拉）；
   - 前端 console 零异常、Styles 侧栏不出现永转（092 回归项）。
6. `docs/debugger.md` 的中继行为清单补上这三个方法与新的
   `documentUpdated` 触发面。

## 7. 待澄清

- [ ] 无（方案 A/B 在 plan 阶段定，spec 只锁行为与验收）
