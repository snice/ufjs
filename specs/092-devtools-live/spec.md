# Spec: DevTools 实时化——Console 日志流 + Elements 活树

- **ID**: 092-devtools-live
- **状态**: done（2026-09-22 桌面真实引擎门禁 6/6：174 节点树 / computed
  非空 / documentUpdated 随真实变更推送；typecheck + 1017 项 vitest 全绿。
  R3 UI 预览经用户确认缓做，记入 roadmap）
- **日期**: 2026-09-22（088/089/090 上线后首轮真实项目（vant 业务 app）使用的
  三条反馈，两条做、一条缓）

## 7. 修订记录（2026-09-22 第二、三轮）

用户复测：树活了，但 Styles 侧栏**转圈不停**。这次不再用假 VM 自证，
直接驱动真实 Chrome DevTools 前端（无头 Chrome + `Target.createTarget`
建 `devtools://` 前端目标 + 在前端页面里 evaluate 其 SDK）做验收，揪出
并修掉四处，其中两处是 089 就埋着的：

1. **`getMatchedStylesForNode` 的 `inlineStyle` 被 089 包了一层
   `{style: …}`**（CDP 协议里它就是 CSS.Style 本体）。之前只在节点带
   inline 时才触发，本轮改成恒回后每个节点都中招——前端解析即抛
   TypeError，promise 永不落地，样式栏永久转圈。已剥掉。
2. **`CSS.getInlineStylesForNode` 没实现**：Styles 面板的 `element.style`
   段走的是这条（不是 getMatchedStylesForNode），掉进通用 `{}` 应答 →
   前端解析为 null → element.style 段永远空白。已补（同一桥接 cmd）。
3. **`Network.emulateNetworkConditionsByRule` 应答缺 `ruleIds`**：前端
   启动 Promise.all 里读 `ruleIds.length`，`{}` 应答直接抛
   undefined.length。补 `ruleIds: []`。`Page.getNavigationHistory` 同理
   补桩；`Page.startScreencast` 从假应答改为明确报错——假应答会让前端
   留一块永远空白的预览区（用户截图左侧的白屏区就是它），报错则整块
   隐藏。
4. **撤掉「树版本轮询 → documentUpdated」**：真实前端收到
   documentUpdated 会重启一切未决样式请求——持续变更的 app（vant 的
   定时器/动画，实测每秒一次）被轮询打成每秒整树重拉，样式栏永转。
   改为**推送 + 自愈**：只在 VM 重建（`debug-reload` 标记）和点了死
   节点（`exists:false`）时推一次。`Dom.version` cmd 保留为内省面。
   computed 的扁平数组形状曾一度被改成协议文档的单对象——真实前端
   sdk.js 实测是 for..of 迭代数组，已改回并注释依据。

验收改为双层：vitest 假 VM（协议形状/事件时序）+ 真实前端 SDK 断言
（`getMatchedStyles` parsed、`getComputedStyle` 有条目、
`getInlineStyles` 非空、前端零异常、树渲染、screencast 区隐藏）。
typecheck 全绿，vitest 1018 项全绿，dist 已重建。

### 第三轮：命中规则进入范围（用户复测「element.style 有了，匹配规则仍空」）

element.style 渲染成功后，Styles 侧栏「样式来源」（matchedCSSRules）仍空。
**边界移动**：原 non-goal「matchedCSSRules 要在热路径记规则身份」的前提
不成立——不需要热路径记录。做法：

1. `css/parser.ts` 的 `Selector` 补记源文本 `text`（解析时顺手赋值，
   零成本）；`style.ts` 新增 `matchedRulesOf(id)`：按需对**一个元素**走
   与 match cache 同源的候选桶（byClass/byTag/catchAll），过滤
   media/scope/`:active`/`:hover`，按特异性+源序排好返回——点击节奏调用，
   不缓存、不碰 compute 热路径。
2. `styleCmd` 返回加 `matched` 字段；中继拼 `matchedCSSRules`（selector
   texts、`matchingSelectors`、kebab 化声明，`origin: 'regular'`）。
3. **合成样式表必须在 `CSS.enable` 之后推送，不能在 WS 连接时推**：
   前端 CSSModel 在构造函数里先 `registerCSSDispatcher` 再 `enable()`，
   连接瞬间推的 `CSS.styleSheetAdded` 会输给模型创建时机——同一份代码
   时而注册时而丢（两次真实前端对拍之间就是这个竞态）。现在
   `CSS.enable` 应答后推一次（`CSS.disable` 重置），`styleSheetId`
   固定 `fjs-main`；规则的 header 解析不到时前端会把规则丢出
   `nodeStyles()`。

真实前端终验（无头 Chrome + 前端 SDK evaluate，连续两跑一致）：wire 上
`.shell` 规则含 `flex-grow` / `background-color:var(--fjs-page)`、
`styleSheetHeaderForId('fjs-main')` 命中、`CSSMatchedStyles.nodeStyles()`
含该规则（header 挂上）。

## 1. 要解决什么

真实项目接上 `fjs debug` 后暴露的两个体验断层：

1. **DevTools Console 看不到 app 的运行日志。** 终端里 `flutter: [js:info]
   [dev] GET /pages/x.deps.json …`、`[nav] mounted …` 这些行全是 **Dart 侧**
   （engine.dart / dev_client.dart 自己打的进度日志），走 `onLog` 回调到宿主
   debugPrint，从不进 dev socket——所以 `fjs log` 看不到、CDP 更看不到。
   开发者调样式时要在终端和 DevTools 两处来回看。
2. **Elements 树是死快照，选中后样式面板常常是空的。** 089 的树只在
   DevTools 打开时 `DOM.getDocument` 拉一次；此后每次整包 reload / HMR /
   页面挂载，元素 id 全部换血，DevTools 里的旧树原样留着——点旧节点，
   `computedOf(id)` 查不到（id 已易主或不存在）→ Styles / 计算样式全空，
   且没有任何提示。首连时机不巧（app 还没挂完页）拿到的就是 shell 空树，
   之后永远不更新。这是 089「不做实时推送」边界的反噬：不推送可以，
   但陈旧必须**自愈**。

## 2. 方案

### 2.1 Console 日志流（R1）

- **Dart 侧**（`flutter_fjs/src/engine.dart`）：引擎内部日志点（nav/dev/
  debug/worker 等约 28 处）从直调 `onLog?.call(...)` 改为统一走
  `_log(level, msg)`——`_log` 本来就是「onLog + dev socket」双写的汇聚点
  （native console 线已走它）。Dart 内部日志从此也进 dev socket。
- **CLI 侧**（`fjs debug` 的 tool 链接）：dev server 本来就把
  `{fjs:'log', level, text}` 广播给所有 tool——`fjs debug` 收下后交给中继
  新增的 `consoleLine(level, text)`，合成 CDP
  `Runtime.consoleAPICalled`（type 按 level 映射 debug/info/warning/error）
  推给 DevTools。
- **合成上下文**：中继在 DevTools 连上时先发一条自己的
  `Runtime.executionContextCreated`（name "fjs host"，独立 id），
  合成日志挂在这个上下文下——引擎自己的 "fjs console" 上下文
  （spec 088 C1）不受影响，控制台下拉里两者并存、语义正确。
- **不重复**：PrimJS 附加期间引擎把 JS console 导流进 CDP（spec 088 T024），
  log 通道收不到——两条来源天然互补不重叠；quickjs flavor（无 inspector）
  下 JS console 走 log 通道，由本特性第一次送进 DevTools Console。
  `fjs eval` 的应答行（`\u0000fjs-eval:` 前缀）照 dev server 的先例过滤。

### 2.2 Elements 活树（R2）

- **版本号**：运行时在 UI 帧落地点（`host.ts` `flushNow()`，一切变更的
  唯一汇聚点）对树版本 `++`（devtools-hooks 里一个常量对象，随帧批，
  零每-op 开销）。`__fjsDevtools.cmd('Dom.version')` 返回它；
  `styleCmd` 附带 `exists`（id 是否还在树里）。
- **中继轮询**：DevTools 会话存活期间每 500ms evaluate 一次
  `Dom.version`（与 Network.drain 同一通道、同一节奏，断点暂停期可用）。
  版本变化 → 推 `DOM.documentUpdated`——DevTools 前端收到即自动重拉
  `DOM.getDocument`，Elements 树、$0 选择、样式面板全部换新。
  旧运行时（无该 cmd）第一次报错即停轮询，优雅降级为今天的死快照。
- **即时推送**：app 的 `{"fjs":"debug-reload"}` 标记（VM 重建，中继已拦截）
  在清缓存的同时直接推 `DOM.documentUpdated`，不等轮询。
- **陈旧自愈兜底**：`CSS.get*StylesForNode` 应答里 `exists === false`
  （选中节点已不在树里）→ 中继除应答空样式外补推一次
  `DOM.documentUpdated`——即使轮询因故失效，点一下旧节点也会触发刷新。
- **顺带**：`getMatchedStylesForNode` 恒回 inlineStyle（空也回），
  Styles 面板至少渲染 `element.style {}` 段，不再整栏空白。

### 2.3 左侧 UI 预览（R3）——本 spec 不做

DevTools 左侧的实时画面需要 `Page.startScreencast`：帧来自 **Flutter 渲染
树**，得在 Dart 侧做 RepaintBoundary 截屏管线（限帧、缩放、base64），
且 debug TCP 由 native 引擎独占，还要给 Dart 开一条到中继的旁路通道。
独立成 spec 值得做，塞进本 spec 不值得——**明确缓**，记入 roadmap。

## 3. 不做什么（Non-goals）

- ~~matchedCSSRules（Styles 面板的命中规则列表）~~：**第三轮移出
  non-goal**——按需单元素收集（`matchedRulesOf`）不碰热路径，不需要
  089 当初担心的「级联缓存记规则身份」，见 §7 第三轮。
- Overlay 高亮 / 样式编辑落回运行时（089 边界不动）。
- 元素级增量推送（childNodeInserted 等）：documentUpdated 整树刷新
  对开发节奏足够，增量协议复杂度不成比例。
- R3 screencast（见 §2.3）。

## 4. 契约变更（宪法 II）

- [x] 无新 C ABI、无新 UI op、无新 dev-WS 消息类型。全部复用既有通道：
      树版本走调试通道的 Runtime.evaluate（089 先例）；日志行走 dev server
      既有的 `{fjs:'log'}` tool 广播（`fjs log` 同源）；Dart 侧只是把
      本来就存在的 `_log` 汇聚点接全。
- [x] `__fjsDevtools.cmd` 面加三个寻址（`Dom.version`、styleCmd 的
      `exists` 与 `matched` 字段）——JS 侧内部约定，中继与运行时同仓
      同步发版。
- [ ] UI op 协议 / 事件类型 / natives 表：不涉及。

## 5. 验收标准

1. `pnpm run typecheck`、`pnpm test` 全绿；中继测试新覆盖：consoleLine
   合成（含 level 映射与 eval-echo 过滤）、Dom.version 轮询 →
   documentUpdated、debug-reload 即时推送、陈旧 exists 自愈、旧运行时
   降级；运行时测试覆盖 Dom.version / exists / 帧落地版本号递增。
2. 桌面链路（fjsrun --debug-connect + CDP 探针）：app 启动挂页后中继
   推 documentUpdated（首连早于挂页也能拿到满树）；选中真实节点
   Computed 有值。
3. 真实 Chrome DevTools：终端里的 `[dev]` / `[nav]` / `[fjs/debug]` 日志
   出现在 Console 面板；reload / HMR 后 Elements 树自动更新，点节点
   Styles / 计算样式有数据。
4. 旧产物降级不劣化：旧运行时 + 新中继 = 现状（死快照），无报错刷屏。

## 6. 待澄清

- 无（R3 经用户确认「难度高先过」，已记录为后续 spec 方向）。
