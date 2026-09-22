# Tasks: 092-devtools-live

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 运行时（树版本 + cmd 面）

- [x] T010 `devtools-hooks.ts`：+`devtoolsTreeVersion` 常量对象
- [x] T011 `host.ts` `flushNow()`：帧发出后版本 `++`
- [x] T012 `devtools.ts`：`Dom.version` cmd、`styleCmd` +`exists`、
      version 字面量 '092-1'

## CLI（中继 consoleLine + 活树）

- [x] T020 `cdp-server.ts`：合成 executionContext（"fjs host"，id 424242）+
      `consoleLine`（level 映射 debug/info/warning/error、eval-echo 过滤）
- [x] T021 `cdp-server.ts`：Dom.version 500ms 轮询 → `DOM.documentUpdated`
      （首读静默基线；未知 cmd 一次即停降级；no-vm/超时按瞬时跳过；
      vm 换人重置基线；`debug-reload` 标记即时推送并置 -1 哨兵强制
      新基线也发事件）
- [x] T022 `cdp-server.ts`：styleCmd `exists===false` 自愈补推；
      matched 恒回 inlineStyle（空也回，Styles 面板至少渲染
      `element.style {}` 段）
- [x] T023 `debug.ts`：tool 链接挂 `{fjs:'log'}` 监听 → `relay.consoleLine`
      （dev server 零改动——tool 广播本来就有）

## Dart

- [x] T030 `engine.dart`：内部日志点统一走 `_log`（28 处机械替换，
      `_log` 本体保持 onLog + sendLog 双写；`flutter analyze` 干净）

## 测试

- [x] T040 `fjs-runtime/test/devtools.test.ts`：Dom.version 随帧递增、
      styleCmd exists 真/假两态
- [x] T041 `fjs/test/debug-cdp.test.ts` 新 describe（6 项）：合成上下文 +
      consoleLine 合成/level 映射/eval-echo 过滤、轮询 → documentUpdated
      （基线静默 + 变更推送）、未知 cmd 降级停轮询、debug-reload 即时
      推送、exists 自愈、matched 空 inline 也回。调试中发现并修掉测试
      自身的会话级联：message 监听必须在 open 前注册（上下文事件是
      连接处理器内推的），否则首个 waitFor 超时后 close 不执行，残留
      会话把单会话中继占死、后续用例全挂

## 验收

- [x] T060 `pnpm run typecheck` 全绿；`pnpm test` 1017 项全绿
      （30+71+3+1 文件；fjs 333 / runtime 618 / webview 36 / webgl 30）
- [x] T061 `@ufjs/cli` dist 重建（`fjs debug` 生效）
- [x] T062 桌面链路（fjsrun --debug-connect + CDP 探针，hello-fjs
      `fjs build --devtools` 单 bundle，真实 PrimJS 引擎）：6/6 PASS——
      合成上下文 / getDocument 174 节点真实树 / view.shell（与用户截图
      同名节点）computed 非空（flexGrow、backgroundColor）/ 3 秒内
      3 次 documentUpdated（每秒一次的真实树变更）/ inlineStyle 恒在。
      过程发现：Elements 数据面依赖 Vue renderer 注册 provider，
      裸 element API 应用（hello-js）树为空——与 089 的 Vue 边界一致，
      不是回归
- [x] T063 真实 Chrome DevTools 面板验证转为用户侧回归（本轮无设备会话）；
      事件面（executionContextCreated / consoleAPICalled /
      documentUpdated / 样式应答）已全部在桌面真实引擎 + vitest 两层覆盖
- [x] T064 文档：toolchain.md「断点调试」更新 Elements 活树 + Console
      收流；debugger.md 中继行为清单补两条（documentUpdated 触发面、
      合成上下文与 console 合成）；roadmap.md 新增本节并记录 R3
      （screencast 预览）缓做缘由

## 第二轮：真实 Chrome DevTools 前端对拍（用户复测样式仍空）

- [x] R10 验收方式升级：无头 Chrome + `Target.createTarget` 建
      devtools:// 前端目标，在前端页面里 evaluate 其 SDK 做断言——
      假 VM 测试只能证协议自洽，证不了前端真解析
- [x] R11 修 `getMatchedStylesForNode` inlineStyle 形状（剥掉 089 的
      `{style:…}` 包装，前端解析即抛异常 → 永久转圈的直接根因）
- [x] R12 补 `CSS.getInlineStylesForNode`（element.style 段的数据源，
      此前落进通用 `{}` 应答 → 恒 null）
- [x] R13 补 `Network.emulateNetworkConditionsByRule` 的 `ruleIds: []`
      与 `Page.getNavigationHistory` 桩；`Page.startScreencast` 改明确
      报错（假应答留下的空白预览区即用户截图左侧白块）
- [x] R14 撤掉轮询推 documentUpdated（真实前端收到即重启全部样式请求，
      持续变更的 app 被打成永转）；保留 debug-reload 推送 + 死节点
      点击自愈；`Dom.version` 保留为内省面
- [x] R15 终验（真实前端 SDK 断言）：matched parsed / computed 2 条
      （flexGrow、backgroundColor）/ getInlineStyles 非空（--fjs-*
      全量在 wire 上）/ 前端零异常 / 树渲染 / screencast 区隐藏；
      typecheck 全绿，vitest 1018 项全绿，dist 已重建

## 第三轮：命中规则（用户复测 element.style 有、匹配规则仍空）

- [x] R20 `css/parser.ts`：`Selector` 补记源文本 `text`（解析时顺手
      赋值，供前端显示 `.shell` 这类选择器原文）
- [x] R21 `css/style.ts`：`matchedRulesOf(id)` 按需收集——与 match
      cache 同源的候选桶（byClass/byTag/catchAll），过滤 media/scope/
      `:active`/`:hover`，按特异性+源序排好；点击节奏调用，不缓存、
      不碰 compute 热路径（边界移动的依据，spec §3/§7 已修订）；
      单测 4 条（`css-matched-rules.test.ts`）
- [x] R22 `devtools.ts` styleCmd 加 `matched` 字段（version → `092-1`）；
      中继 `cdp-server.ts` 拼 `matchedCSSRules`（selector texts /
      matchingSelectors / kebab 声明 / origin regular）；假 VM 单测
      （`builds matchedCSSRules from the runtime matched list`）
- [x] R23 修合成样式表竞态：`CSS.styleSheetAdded` 不再在 WS 连接时推，
      改为 `CSS.enable` 应答后推一次（`CSS.disable` 重置）——前端
      CSSModel 构造函数里先注册 dispatcher 再 enable，连接时推送会
      输给模型创建时机（同一代码两跑时而注册时而丢的根因）；单测
      （`announces the synthetic stylesheet on CSS.enable`）
- [x] R24 真实前端终验（无头 Chrome + 前端 SDK evaluate，连续两跑一致）：
      wire `.shell` 规则含 flex-grow / background-color、
      `styleSheetHeaderForId('fjs-main')` 命中、`CSSMatchedStyles
      .nodeStyles()` 含该规则且 header 挂上
- [x] R25 全量门：typecheck 全绿；`pnpm test` 1024 项全绿（fjs 336 /
      runtime 622 / webgl 30 / webview 36）；`@ufjs/cli` dist 重建
- [x] R26 文档追记：spec §3 non-goals 划掉 matchedCSSRules（边界移动
      说明）、§7 第三轮修订记录、§4 契约改三个寻址；debugger.md 补
      matchedRules 应答与 CSS.enable 推送时机；toolchain.md Styles
      侧栏补命中规则；roadmap.md matchedCSSRules 移入已完成（UI
      预览仍缓做）
