# Spec: AI Skills & MCP —— 让 AI 在 ufjs 应用项目里高效开发

- **ID**: 213-ai-skills-mcp
- **状态**: done
- **日期**: 2026-10-09

## 1. 要解决什么

用 ufjs 开发 App 的开发者越来越多地让 AI 编码工具（Claude Code、ZCode 等）直接写
页面。但 AI 打开一个 ufjs 项目时面对的是三个断层：

1. **知识断层**：ufjs 不是浏览器——没有 `window`/`document`/完整 CSS，标签是
   38 个白名单，事件是 props 且载荷一律字符串。这些事实埋在仓库 docs/ 的 1.3 万行
   散文里，AI 要么不知道、要么按 Web 习惯写出一堆静默失效的代码（宪法 V 的反面）。
2. **时效断层**：就算把文档塞给 AI，它读到的是网上的旧文章或旧版本拷贝，而不是
   当前安装的 `@ufjs/runtime` 的真实支持范围。
3. **操作断层**：AI 知道要 `fjs dev`、要看运行日志、要检查 UI 树，但端口号、
   WS 握手、`__fjsDevtools` 通道这些操作知识都在 CLI 源码里，AI 每次都要重新摸。

结果是：AI 写 ufjs 页面慢、错得多、跑不起来就瞎猜。

## 2. 不做什么（Non-goals）

- 不做 ufjs **仓库自身**开发的 AI 配置（spec/宪法/.claude/commands 那套已存在，
  是另一个方向）。
- 不改 op 协议、natives 表、事件类型——三张契约表零变更。
- 不做 MCP resources/prompts，只做 tools（最小面，够用为主）。
- 不做截图/screencast（roadmap 已明确不做 DevTools 实时预览，同理）。
- 不引入 `@modelcontextprotocol/sdk` 或其他新依赖。
- 不动用户项目的 AGENTS.md（`fjs ai init` 不写它）。

## 3. 用户可见的行为

开发者在 ufjs 项目里执行一次：

```bash
npx @ufjs/cli ai init
```

得到：

- `skills/ufjs-*/SKILL.md` —— 项目根目录下 4 篇技能文档（app-dev / ui / debug /
  build），人对 AI 可见、可 review；
- `.claude/skills/ufjs-*/SKILL.md` —— 同内容副本，Claude Code 自动发现；
- `.mcp.json` 与 `.agents/mcp.json` —— 注册 `ufjs` MCP server
  （`npx @ufjs/cli mcp`），Claude Code / Codex / ZCode workspace 打开项目即连接。

AI 工具接入后可以调用 14 个 MCP 工具（三组）：

```jsonc
// 知识查询（静态，与所装 runtime 版本一致）
{"name": "list_tags"}                       // 38 个标签一览
{"name": "get_tag", "arguments": {"name": "scroll-view"}}
{"name": "query_css", "arguments": {"property": "position"}}
{"name": "list_events"}
{"name": "search_docs", "arguments": {"query": "position fixed 弹层"}}
{"name": "get_doc", "arguments": {"id": "overlay-host"}}

// 项目工作流
{"name": "scaffold", "arguments": {"kind": "page", "name": "user/[id]"}}
{"name": "routes"} {"name": "doctor"}
{"name": "build", "arguments": {"profile": "release"}}

// 运行时（需 fjs dev 在跑）
{"name": "dev_status"} {"name": "get_logs"} {"name": "eval", "arguments": {"expression": "1+1"}}
{"name": "dump_tree"}   // 经 __fjsDevtools DOM.getDocument 输出缩进元素树
```

重复执行 `fjs ai init` 幂等：刷新 ufjs 自己的文件、保留用户已有条目。
`fjs create` 新项目自动执行一遍 init。

## 4. 两端约定（宪法 I）

本 spec 不新增任何用户可见的渲染能力、标签、样式、事件——它是纯工具链/知识分发
spec，Flutter 侧与 Web 侧零改动。因此无两端约定表。

但工具的**内容**必须忠实反映三端差异：`query_css` 返回的支持级别、`get_tag` 的
注意事项，数据源就是 `css/support.ts` 与 docs/css-compat.md 的既有结论，不允许
另写一份会漂移的"AI 版真相"。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

新增的契约（MCP 工具面，本 spec 自己定义、测试钉住）：

- [x] `fjs mcp` 的 JSON-RPC 子集：`initialize` / `tools/list` / `tools/call`，
      newline-delimited JSON-RPC 2.0 over stdio
- [x] 14 个工具的名字与参数形状（上文第 3 节）
- [x] `fjs ai init` 的落盘清单（skills/ + .claude/skills/ + 两个 MCP 注册文件）

## 6. 验收标准

1. 临时目录 `fjs create` 出的项目执行 `fjs ai init`：`skills/` 4 篇 +
   `.claude/skills/` 4 篇 + `.mcp.json` + `.agents/mcp.json` 就位；重复执行幂等；
   预先放一个用户自己的 `.mcp.json`（含别的 server 条目）不被破坏。
2. `printf '<initialize>\n<tools/list>\n' | node dist/cli.js mcp` 完成 handshake，
   `tools/list` 返回 14 个工具；对未知工具名返回 JSON-RPC error 而不是崩溃。
3. `get_tag('scroll-view')`、`query_css('position')` 的内容与 docs/ui-api.md、
   docs/css-compat.md 一致（测试对拍 tags.json / css support 表，不人肉比对散文）。
4. demo 起 `fjs dev` 且有端连接后：`dev_status` 报告在线；`eval '1+1'` 返回 `2`；
   `dump_tree` 输出非空元素树；无连接时每个运行时工具返回含"怎么启动"的可操作错误。
5. `pnpm --filter @ufjs/cli run typecheck` 与 `pnpm --filter @ufjs/cli run test` 通过。
6. 本仓库（ZCode）经 `.agents/mcp.json` 注册后能看到并调用 ufjs 工具（端到端）。

## 7. 待澄清

- [x] 无（载体/落盘/范围三个决策已由用户拍板：并入 @ufjs/cli、skills/ +
      .claude/skills/ + MCP 注册文件、工具全量三组）。
