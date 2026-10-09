# AI 接入：Skills & MCP

让 AI 编码工具（Claude Code、ZCode、Codex、Cursor…）在 ufjs 项目里高效工作。
两条腿：

- **Skills** —— 落在项目里的工作流知识（怎么跑、怎么调、怎么避坑），AI 工具
  按需加载；
- **MCP** —— 一个随 `@ufjs/cli` 分发的 MCP server（`fjs mcp`），把
  「当前安装版本的 runtime 支持什么」变成 AI 可查询的结构化事实，并把
  dev server / 构建包成工具调用。

```bash
cd my-app
npx @ufjs/cli ai init
```

## `fjs ai init` 写了什么

| 位置 | 内容 | 给谁用 |
|------|------|--------|
| `skills/ufjs-*/SKILL.md` | 4 篇技能：app-dev / ui / debug / build | 人与所有 AI 工具（根目录可见可 review） |
| `.claude/skills/ufjs-*/SKILL.md` | 同内容的副本 | Claude Code |
| `.mcp.json` | `mcpServers.ufjs` → `npx @ufjs/cli mcp` | Claude Code / Codex 等 |
| `.agents/mcp.json` | 同上 | ZCode 及 `.agents` 跨工具约定 |

幂等规则：`ufjs-*` 技能目录整体属于 ufjs，升级后重跑 init 即刷新；`.mcp.json`
里**只增改 `mcpServers.ufjs` 一个键**，你自己的 server 条目和其他顶层键原样保留；
文件 JSON 损坏时 init 报错退出而不覆盖。`fjs create` 的新项目自动执行一遍。

升级 `@ufjs/cli` / `@ufjs/runtime` 后重跑一次 `npx @ufjs/cli ai init`——
知识工具的数据是构建期内联的快照，旧版本 CLI 会答旧事实。

## MCP 工具（14 个）

**知识查询**（回答的是你安装的 runtime 版本的真实支持范围，来自与 runtime /
linter 同源的快照，不是训练记忆）：

| 工具 | 回答什么 |
|------|---------|
| `list_tags` | 38 个白名单标签（31 内置 + 7 JS 组件） |
| `get_tag {name}` | 单个标签的 props / 事件 / 坑，引用 ui-api.md 原文 |
| `query_css {property, value?, context?}` | 某条 CSS 在 App 端 drop / warn / likely-ok |
| `list_events` | 事件 prop 表 + 载荷形状文档 |
| `search_docs {query}` | 全文检索内置文档集，返回排名与摘录 |
| `get_doc {id}` | 读整篇：ui-api / css-compat / vue3 / routing / modules / miniprogram / overlay-host / third-party-components / canvas-compat / fjs-go / toolchain |

**项目工作流**：

| 工具 | 做什么 |
|------|--------|
| `scaffold {kind, name}` | `fjs create page\|component\|module`（含 `user/[id]` 动态路由） |
| `routes` | 页面与路由表 |
| `doctor` | 环境体检 |
| `build {profile}` | debug / web / mp / pages / release 出包，返回产物与错误 |

**运行时**（要求 `fjs dev` 在跑；`--web` 模式记得传 `port: 5173`）：

| 工具 | 做什么 |
|------|--------|
| `dev_status {port?}` | dev server 在不在、几个端连着 |
| `get_logs {durationMs?, minLevel?}` | 收一段 console 输出 |
| `eval {expression}` | 在运行中的 VM 求值（与 `fjs eval` 同一条通道） |
| `dump_tree` | App 端当前元素树（devtools 数据面；web 构建刻意不带，浏览器有自己的 DevTools） |

## 各 AI 工具的接入方式

- **Claude Code / Codex**：读 `.mcp.json`，打开项目即自动连接；技能读
  `.claude/skills/`。
- **ZCode**：读 `.agents/mcp.json`（workspace 级自动连接）；技能与 AGENTS.md
  按其发现顺序加载。
- **其他工具**：把 `npx @ufjs/cli mcp` 注册为 stdio MCP server、把 `skills/`
  目录指为技能/规则目录即可——两个文件都是各工具的通用格式。

## 设计取舍

- **快照内联**：知识数据由 `@ufjs/cli` 构建时从 `tags.json` / `css/support.ts` /
  `element.ts` 与 docs/ 生成（`src/mcp/snapshot.mjs`），与 bundler 内联
  tags.json 同一防漂移思路——工具答案永远和安装版本的代码一致。
- **手写 JSON-RPC**：MCP stdio 只实现 initialize / tools/list / tools/call /
  ping，不引入 SDK 依赖；CLI 的唯一运行时依赖仍是 `ws`。
- **零新协议**：运行时工具复用 `fjs log` / `fjs eval` 的 tool 通道
  （`dev/tool-conn.ts`），dump_tree 走 `__fjsDevtools` 数据面。

## 验证安装

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | npx @ufjs/cli mcp
```

第一条回 `serverInfo.name: "ufjs"`，第二条列 14 个工具。AI 工具侧看到
`ufjs` server 即接入成功。
