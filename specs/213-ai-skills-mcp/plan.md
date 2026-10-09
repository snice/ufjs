# Plan: AI Skills & MCP

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 不新增渲染能力；知识内容直接取自两端既有的真相源（tags.json / css support / docs），不另造会漂移的第二份 |
| II 边界即契约 | 是（新契约） | op/natives/事件三张表零变更；新增的 MCP JSON-RPC 子集、14 个工具名、init 落盘清单是本 spec 自己的新契约，用协议测试钉住 |
| III 同步单线程零序列化 | 否 | MCP server 跑在 Node 侧（工具链层），不进 JS 引擎运行时；不碰 UI isolate 时序 |
| IV 外观照 WeUI | 否 | 不涉及样式 |
| V 静默失效是 bug | 是 | 运行时工具在无 dev server / 无 app 连接 / devtools 未注入时必须返回可操作的错误（怎么启动、缺什么），不返回空结果装成功 |
| VI 注释记录权衡 | 是 | server 顶部注释记录"手写 JSON-RPC 而不用 SDK"的权衡；知识快照脚本注释记录"构建期内联防漂移"的理由 |
| VII JS 能包就不要下 Dart | 是（精神） | 全部实现在 TS/Node（CLI 层），零 Dart、零 C++ 改动 |
| VIII 变更落到文档 | 是 | 新增 docs/ai.md；README、docs/toolchain.md、docs/README.md 补条目；roadmap 打勾 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/package.json` | build 脚本增加知识快照生成步骤 |
| CLI / 构建 | `packages/fjs/src/mcp/knowledge.ts` | 新：构建期生成的知识快照（类型 + 由脚本填充） |
| CLI / 构建 | `packages/fjs/src/mcp/snapshot.mjs` | 新：构建期脚本，读 fjs-runtime 源码 + docs/ 生成快照 |
| CLI / 构建 | `packages/fjs/src/mcp/server.ts` | 新：stdio JSON-RPC 骨架 + 工具注册 |
| CLI / 构建 | `packages/fjs/src/mcp/tools-knowledge.ts` | 新：知识查询 5+1 工具 |
| CLI / 构建 | `packages/fjs/src/mcp/tools-workflow.ts` | 新：scaffold/routes/doctor/build |
| CLI / 构建 | `packages/fjs/src/mcp/tools-runtime.ts` | 新：dev_status/get_logs/eval/dump_tree（复用 dev/tool-conn） |
| CLI / 构建 | `packages/fjs/src/commands/mcp.ts` | 新：`fjs mcp` 命令入口 |
| CLI / 构建 | `packages/fjs/src/commands/ai.ts` | 新：`fjs ai init`（幂等落盘） |
| CLI / 构建 | `packages/fjs/src/cli.ts` | 注册 `mcp`、`ai` 两个子命令 + usage |
| CLI / 构建 | `packages/fjs/skills/ufjs-*/SKILL.md` | 新：4 篇技能源文件（构建时拷进 dist） |
| CLI / 构建 | `packages/fjs/test/mcp-*.test.ts` | 新：协议/工具/init 测试 |
| JS runtime | — | 零改动（只读其源码做快照） |
| Web 适配层 | — | 零改动 |
| C++ 引擎 | — | 零改动 |
| Dart 宿主 | — | 零改动 |
| 文档 | `docs/ai.md`、`docs/README.md`、`docs/toolchain.md`、`README.md`、`docs/roadmap.md` | 新增/补条目 |

## 3. 方案

**MCP server 手写 JSON-RPC**：stdio 上 newline-delimited JSON-RPC 2.0，只实现
`initialize`（回显客户端 protocolVersion）、`notifications/initialized`、
`tools/list`、`tools/call`、`ping`，未知方法回 `-32601`，工具抛错回 `isError:
true` 的结果（MCP 惯例，工具级错误不是协议错误）。
被否备选：`@modelcontextprotocol/sdk`——新增依赖，stdio 子集手写约 200 行且更
好测；协议若未来大改，届时再评估。

**知识快照构建期内联**（本 spec 的核心防漂移手段）：`snapshot.mjs` 在
`pnpm --filter @ufjs/cli run build` 时执行，读四类源：

1. `fjs-runtime/src/tags.json` + `component-tags.json` —— 标签全集与 JS 组件标记；
2. `fjs-runtime/src/css/support.ts` —— CSS 支持级别表（import 后序列化）；
3. `fjs-runtime/src/ui/element.ts` 的 `EventType` —— 事件名表（正则提取或
   import；选 import+eval 不可行则退化为正则，测试对拍防呆）；
4. docs/ 指定篇目的全文 —— `ui-api`、`css-compat`、`vue3`、`routing`、
   `modules`、`miniprogram`、`overlay-host`、`third-party-components`、
   `canvas-compat`、`fjs-go`、`toolchain`（每篇截断上限防 dist 膨胀）。

产物 `src/mcp/knowledge.gen.ts`（生成物，进 dist、不进 git）导出一份
`KnowledgeSnapshot`，带 `ufjsVersion`。工具实现只读快照——版本同步零维护。
被否备选：运行时直接读 `node_modules/@ufjs/runtime/src/...`——依赖安装形态
（pnpm 符号链接、bun、离线包）不可控；docs/ 根本不在 npm 包里。

**运行时工具复用 tool-conn**：`connectDevServer` + `handshakeTool` 与
`fjs log`/`fjs eval` 同一条路。`get_logs` 用一次性连接收 N 秒/缓冲上限的快照
（带游标续读），不做长驻订阅（MCP 工具调用是请求-响应形状）。`dump_tree` 走
`fjs eval` 通道求值 `__fjsDevtools.cmd('DOM.getDocument')`，把结果格式化成
缩进树文本。

**`fjs ai init` 幂等合并**：skills 用"ufjs 拥有的目录"为粒度整体覆盖
（`skills/ufjs-app-dev/` 整目录是我们的，用户自己的目录不碰）；`.mcp.json` /
`.agents/mcp.json` 做 JSON 深合并，只 upsert `mcpServers.ufjs` 键，其他键保留；
已有文件解析失败时报错退出而不覆盖。写入前打印将动的文件清单。

**版本标记与刷新**：SKILL.md frontmatter 写 `ufjs-version`；init 时版本不同
即刷新，相同即跳过（`--force` 强制）。`fjs create` 收尾自动跑一遍 init。

## 4. 风险

- **快照与散文漂移**：docs/ 是手写的，support.ts 是代码——两者冲突时快照以
  代码为准（CSS/事件），文档仅作 `search_docs` 语料。测试里对拍
  tags.json↔快照，防生成脚本悄悄失效。
- **`__fjsDevtools` 未注入**（release 构建或老宿主）：`dump_tree` 必须显式报
  "dev 构建才注入，请用 fjs dev / --devtools"，不能静默返回空树（宪法 V）。
- **MCP 协议版本协商**：客户端可能带不同 protocolVersion；策略是回显请求里的
  版本（stdio 常见做法），对不认识的形状报错而非猜测。
- **dist 膨胀**：docs 全文内联可能几百 KB；设每篇截断上限并在快照里记录截断
  发生（`truncated: true`），`get_doc` 返回时注明。
- **esbuild 只打包入口**：`knowledge.gen.ts` 是生成物，必须保证 build 顺序
  （先快照后 esbuild），否则 CI 上 `prepare` 脚本编出空快照——用 npm script
  串行保证，并在 server 启动时校验快照非空、缺失时报错提示重跑 build。

## 5. 验证路径

```bash
# 构建 + 单测
pnpm --filter @ufjs/cli run build
pnpm --filter @ufjs/cli run test

# 协议冒烟：handshake + tools/list
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node packages/fjs/dist/cli.js mcp

# 端到端：临时项目 init → 幂等 → 保留用户条目
tmp=$(mktemp -d) && cd "$tmp" && node <repo>/packages/fjs/dist/cli.js create demo --template vue3-vite
cd demo && node <repo>/packages/fjs/dist/cli.js ai init && node <repo>/packages/fjs/dist/cli.js ai init

# 运行时工具：起 dev + 连端后走 MCP 调 eval/dump_tree（手动或由测试桩验证协议形状）
cd <repo>/demo && npx fjs dev   # 另一端连接后
```
