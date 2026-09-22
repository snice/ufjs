# Plan: 093-devtools-tree-lazy-and-live

对应 spec：`./spec.md`。改动两层（CLI 中继 + 运行时数据面），不动三张契约表。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 部分 | DevTools 只在 app 端（Flutter/桌面 fjsrun）存在；web 构建用浏览器原生 DevTools，不走这条 CDP 链路。运行时侧改动（`devtools.ts` / `host.ts` / `devtools-hooks.ts`）在共享代码里，但只被 `__FJS_DEVTOOLS__` 门控的 dev bundle 引用，release 构建 DCE 掉——与 090/092 同口径，不构成 web 行为差异。 |
| II 边界即契约 | 不涉及 | UI op 协议、natives 表、事件类型三张表都不动。CDP 方法形状由 `cdp-server.ts` 单侧定义；运行时侧若加 `cmd()` 分支，按 CDP 方法名寻址（与现有 `DOM.getDocument` 同模式）。 |
| III 同步单线程零序列化 | 涉及 | `requestChildNodes` / `getFlattenedInnerHTML` / `querySelector` 走既有 evaluate 桥（`bridgeCmd` → `Runtime.evaluate` → `__fjsDevtools.cmd`），JSON 只在中继整形一次，与 089/092 同节奏；不新增跨线程通道。 |
| IV 外观照 WeUI | 不涉及 | 不改任何标签/样式。 |
| V 静默失效是 bug | 涉及 | 三个新方法**不落兜底空应答**：找不到节点回明确的空形状（`{nodes:[]}` / `{outerHTML:''}` / `{nodeId:0}`），而不是 `{}`；`documentUpdated` 推送失败（WS 断）吞掉但记日志。 |
| VI 注释记录权衡 | 涉及 | `cdp-server.ts` 新方法处注释「为什么按需序列化而不是让前端拿 depth:1 就够」；`domInvalidated()` 的冷却与「纯属性不推」边界写清理由（092 R14 的教训）。 |
| VII JS 能包就不要下 Dart | 不涉及 | 全部改动在 JS/TS（中继 + 运行时），不新增 Dart/C++ 代码。 |
| VIII 变更落到文档 | 涉及 | `docs/debugger.md` 中继行为清单补三方法 + `documentUpdated` 触发面；`website/guide/debugging.md` 删掉「快照式，不自动推送」的过时描述；`docs/roadmap.md` 打勾。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 中继 | `packages/fjs/src/debug/cdp-server.ts` | ① `routeBridged` 把 `DOM.requestChildNodes` / `DOM.getFlattenedInnerHTML` / `DOM.querySelector` 从兜底挪到真实现；② `domInvalidated()` 加冷却（≥1s）；③ 结构变化检测 → 推 `documentUpdated` |
| JS runtime | `packages/fjs-runtime/src/devtools.ts` | `cmd()` 新增三个按需方法的分发（`DOM.requestChildNodes` / `DOM.getFlattenedInnerHTML` / `DOM.querySelector`），复用 `provider.childIds` / `buildNode` / CSS 引擎匹配 |
| JS runtime | `packages/fjs-runtime/src/devtools-hooks.ts` | `DevtoolsTreeProvider` 接口补 `childIds` 已有；若走方案 B 加 `onStructuralChange` 槽位（方案 A 则只加 `structuralVersion` 常量） |
| JS runtime | `packages/fjs-runtime/src/host.ts` | `flushNow()` 里除 `devtoolsTreeVersion++` 外，结构变化时另增 `devtoolsStructuralVersion++`（方案 A） |
| JS runtime | `packages/fjs-runtime/src/ui/element.ts` | `insert()` / `remove()` / `createRoot()` 处触发结构标记（方案 B）或仅依赖 host.ts 帧级判定（方案 A） |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | 路由 push/pop 时（`flutterRoot` 注册/删除 `pageRoots`）触发结构标记——两条方案都需要，因为页根增删不经 element API |
| 测试 | `packages/fjs/test/debug-cdp.test.ts` | 三方法形状、结构变化触发 documentUpdated、冷却、纯属性不触发 |
| 测试 | `packages/fjs-runtime/test/devtools.test.ts` | `cmd()` 新方法分发、HTML 序列化、querySelector 命中/未命中 |
| 文档 | `docs/debugger.md`、`website/guide/debugging.md`、`docs/roadmap.md` | 行为清单与过时描述更新 |

## 3. 方案

### 3.1 树按需展开（确定）

三个方法在中继侧真实现，数据从运行时桥取：

- **`DOM.requestChildNodes {nodeId}`**：`nodeId` → `toElem()` → 桥
  `DOM.requestChildNodes {id}` → 运行时按 `provider.childIds(id)` 序列化
  直接子节点 → 中继 `mapNode` → 回 `{nodeId, nodes:[…]}`。
  找不到节点回 `{nodeId, nodes:[]}`。
- **`DOM.getFlattenedInnerHTML {nodeId}`**：桥新 cmd 返回子树的 HTML
  字符串（`buildNode` 结果转 HTML：`<tag k="v">…</tag>`，文本节点
  转义），中继回 `{result: html, type: 'string'}`（按前端 sdk 期望定，
  实测确认）。
- **`DOM.querySelector {nodeId?, selector}`**：中继侧**不实现选择器
  引擎**——桥新 cmd 把选择器交给运行时，运行时复用 CSS 引擎的
  `match` 能力（`css/style.ts` 已有按选择器找元素的路径，或在
  `devtools.ts` 里用 `provider.childIds` + `styleEngine` 做一次
  深度优先匹配）→ 回 elementId → 中继转 `{nodeId: id*2+1000}`；
  未命中回 `{nodeId: 0}`（CDP 约定）。

`DOM.getDocument` 保持现状（整树递归），depth 参数继续忽略——三个
按需方法是给「前端已缓存部分树、要补深层」的场景兜底，不是替代
getDocument。

### 3.2 结构变化 → documentUpdated（选定方案 A）

**方案 A：结构版本 + 中继轮询（选它）**

- 运行时：`devtools-hooks.ts` 加 `devtoolsStructuralVersion = { value: 0 }`。
  递增点：
  1. `host.ts` `flushNow()` 里，如果本帧的 writer 操作里含
     `insert` / `remove` / `create`（writer 能否区分见风险节），
     或更简单：`vue/renderer.ts` 的 `flutterRoot()`（`pageRoots.set`）
     与 `releaseRoot`（`pageRoots.delete`）处直接 `++`——路由增删页根
     是最主要的结构变化；
  2. `element.ts` `insert()` / `remove()` 处 `++`（覆盖非路由的增删）。
- 中继：`cdp-server.ts` 在 `DOM.getDocument` 应答后启动一个低频轮询
  （复用既有 `startNetPoll` 的定时器模式，周期 1–2s）：桥
  `Dom.version`（现成 cmd，返回 `{version}`）→ 若结构版本跨阈值
  （记录上次值，`!==` 即变）→ `domInvalidated()` 推一次
  `documentUpdated` → 更新基线。轮询只在 DevTools WS 存活时跑，
  WS 断开停。
- **冷却**：`domInvalidated()` 记 `lastInvalidateAt`，距上次 <1s
  直接 return——防连续结构变化（如 v-for 批量插入）打成风暴。
- **纯属性/文本不触发**：它们不递增 `structuralVersion`，轮询
  永远看不到变化，自然不推——保护 Styles 面板（092 R14 教训）。

**被否掉的方案**

- **方案 B（element API 直接 hook 推送）**：`insert`/`remove` 处直接
  调 `devtoolsSlots.onStructuralChange?.()`，中继收到即推。否：运行时
  无法直接 push CDP 事件（中继和运行时是两个进程/线程，靠 evaluate
  拉），B 实际还是要中继轮询一个「已置脏」标志——绕回 A 且多一层
  槽位；且批量插入会一帧多次置脏，还是要冷却。A 用现成的
  `Dom.version` 通道，零新增槽位。
- **恢复 092 的 500ms 全量轮询**：已被 R14 证伪（Styles 永转），否。
- **实现 `DOM.childNodeInserted` 等增量事件**：spec non-goal，
  增量协议形状要单独验证，否。

### 3.3 顺序

1. 运行时：`devtools-hooks.ts` 加结构版本常量 → `host.ts` /
   `element.ts` / `vue/renderer.ts` 三处递增点 → `devtools.ts`
   `cmd()` 三分支（含 HTML 序列化与选择器匹配）。
2. 中继：`routeBridged` 三方法实现 → `domInvalidated()` 冷却 →
   结构版本轮询。
3. 测试：runtime 单测（cmd 分发/序列化/匹配）→ 中继单测
   （三方法形状、轮询触发、冷却、纯属性不触发）。
4. 真实前端终验（无头 Chrome + SDK evaluate，沿用 092 脚手架）。
5. 文档 + dist 重建（`pnpm --filter @ufjs/cli run build`）。

## 4. 风险

- **writer 能否区分结构操作**：若 `flushNow()` 只看帧级信号，
  无法区分「本帧只改了属性」还是「有 insert/remove」。缓解：不在
  `flushNow` 判定，直接在 `element.ts` 的 `insert`/`remove` 和
  `vue/renderer.ts` 的页根增删处递增——这些是精确调用点，代价是
  多一个可选链调用（release 构建 DCE 掉）。
- **轮询与 092 的 Net 轮询/样式请求并发**：同一 evaluate 通道，
  1–2s 一次、应答极小（一个 number），风险低；若失败吞掉降级，
  不影响面板（面板本来就有手动刷新兜底）。
- **`documentUpdated` 打断选中**：推一次前端整树重拉、丢当前选中
  ——路由切换后重选是可接受代价（092 已有此语义，本次只是让更多
  结构变化走到这条路）。
- **选择器匹配的语义边界**：fjs 不是完整 CSSOM，`:hover`/媒体查询
  等伪态在静态匹配时应跳过（与 `matchedRulesOf` 同口径，092 已
  处理过 media/scope/`:active`/`:hover` 过滤）。
- **`getFlattenedInnerHTML` 的形状**：前端 sdk 期望 `{result, type}`
  还是 `{outerHTML}` 需实测定——先按 CDP 协议文档 `{result, type:
  'string'}` 实现，真实前端对拍时若解析失败再调整（092 踩过
  `inlineStyle` 包装的坑，形状必须对真实 sdk）。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test                                    # 全量 vitest
pnpm --filter @ufjs/cli run build            # dist 重建（devtools.ts 打进 bundle）

# 单测重点
pnpm --filter @ufjs/runtime test devtools    # cmd 分发 / HTML / selector
pnpm --filter @ufjs/cli test debug-cdp       # 三方法 / 轮询 / 冷却

# 真实前端终验（沿用 092 的无头 Chrome + 前端 SDK evaluate 脚手架）
# 1. fjs dev + fjs debug + fjs run（或 fjs-go 连接）
# 2. 打开 devtools://…/inspector.html?ws=127.0.0.1:38902/cdp
# 3. 断言：展开 shell ≥3 层；路由 push ≤2s 自动出现新页根；
#    前端 console 零异常；Styles 侧栏不永转（092 回归）
```
