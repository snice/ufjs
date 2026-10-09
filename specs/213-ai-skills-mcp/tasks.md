# Tasks: AI Skills & MCP

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `packages/fjs/src/mcp/snapshot.mjs`：构建期脚本，产出
      `src/mcp/knowledge.gen.ts`（tags / component-tags / CSS 支持表 / 事件表 /
      docs 语料 + ufjsVersion + 截断标记）
- [x] T002 `packages/fjs/package.json` build 脚本串入快照步骤（先快照后 esbuild）；
      根 `.gitignore` 收录 `knowledge.gen.ts`；快照脚本同时把 `skills/` 拷进 dist
- [x] T003 MCP JSON-RPC 子集契约定型：`src/mcp/server.ts` 的
      initialize/tools/list/tools/call/ping 与错误形状（协议测试钉住）

## 实现

- [x] T010 `src/mcp/tools-knowledge.ts`：
      list_tags / get_tag / query_css / list_events / search_docs / get_doc
- [x] T011 `src/mcp/tools-workflow.ts`：scaffold / routes / doctor / build
      （spawn 本包 CLI，捕获管道，非零退出/超时作为结果返回）
- [x] T012 `src/mcp/tools-runtime.ts`：dev_status / get_logs / eval / dump_tree
      （复用 `dev/tool-conn.ts`；inspect.ts 抽出可复用的 `evalViaSocket`；
      dev_status 以 WS 握手为权威探针——`--web` 模式没有 /manifest.json；
      dump_tree 经 `__fjsDevtools.cmd('DOM.getDocument')` 格式化缩进树）
- [x] T013 `packages/fjs/skills/ufjs-app-dev|ui|debug|build/SKILL.md` 四篇
      （中文、薄、事实查询指向 MCP 工具、frontmatter 带 ufjs-version 戳）
- [x] T014 `src/commands/ai.ts`：`fjs ai init` —— skills 双落盘（skills/ 与
      .claude/skills/）、.mcp.json 与 .agents/mcp.json 深合并、幂等、--force、
      损坏 JSON 报错不覆盖；`fjs create` 收尾自动执行
- [x] T015 `src/cli.ts` 注册 `mcp` / `ai` 子命令 + usage 文本

## 两端对齐

- [x] T020 本 spec 不涉及渲染两端；对齐动作 = 快照数据源与
      tags.json / css/support.ts / element.ts 的一致性测试（T030 承担）

## 测试

- [x] T030 `test/mcp-knowledge.test.ts`：快照非空、与 tags.json 对拍、
      query_css 覆盖 drop/warn/likely-ok/transition/keyframes、事件表对拍
- [x] T031 `test/mcp-protocol.test.ts`：握手回显、notifications 不应答、
      tools/list 14 个、tools/call 正反例（isError）、未知方法 -32601、
      非法信封 -32600、dist 起真进程的 stdio 三连冒烟
- [x] T032 `test/mcp-runtime.test.ts`：stub dev server（HTTP manifest + WS
      tool 通道，协议与 `fjs log`/`fjs eval` 同源）下 dev_status/get_logs/
      eval/dump_tree 正反例 + evalViaSocket 监听器不泄漏；死端口给可操作错误
- [x] T033 `test/ai-init.test.ts`：落盘清单（10 文件）、frontmatter 版本戳、
      幂等、用户 .mcp.json 条目保留、损坏 JSON 不覆盖、版本升级即刷新、
      `fjs create` 一步到位
- [x] T034 快照自防：server 空工具表启动报可操作错误；快照生成失败在
      build 阶段即炸（esbuild 找不到 knowledge.gen.ts）

## 文档

- [x] T040 新增 `docs/ai.md`：接入指南（init 写什么、14 工具表、各 AI 工具
      注册方式、设计取舍、验证命令）
- [x] T041 `docs/README.md` 文档地图与"按任务找文档"加 `ai.md`；
      `docs/toolchain.md` 加 `fjs ai init` / `fjs mcp` 一节；根 `README.md`
      命令表加一行
- [x] T042 `docs/roadmap.md` 记录交付（"AI Skills & MCP（已完成 2026-10，
      specs/213）"）与不做清单

## 验收

- [x] T050 `pnpm run typecheck` —— 全 workspace 0 错误
- [x] T051 `pnpm test` —— fjs 511 ✔ / fjs-runtime 1011 ✔ / webview 36 ✔ /
      webgl 30 ✔ / liquidglass 6 ✔ / hooks 6 ✔，0 失败
      （autoimport 有一个与本次改动无关的并行负载偶发超时，单跑即过）
- [x] T052 spec.md 第 6 节逐条核对：

  1. 临时项目端到端：`fjs create` 后 `skills/`（4 篇）+ `.claude/skills/`（4 篇）
     + `.mcp.json` + `.agents/mcp.json` 就位；二次 `ai init` 输出
     `ai pack up to date; nothing written`；预置用户 `.mcp.json`
     （`mcpServers.mine` + 顶层 `note` 键）后 init，两者原样保留、仅新增 `ufjs`；
     损坏 JSON 时报 `will not overwrite` 且文件未动。✅
  2. 协议冒烟：initialize → `ufjs 0.1.7 / protocolVersion 2024-11-05`；
     tools/list → 14 个工具（list_tags…dump_tree）；未知工具 -32602、
     未知方法 -32601。✅
  3. 知识一致性：`get_tag('scroll-view')` 引 `SingleChildScrollView` 表行 +
     ui-api 专节；`query_css('word-break')` drop、`display:grid` drop、
     `100vw` drop、`max-content` warn、`position:fixed` likely-ok——全部来自
     support.ts 快照并有对拍测试。✅
  4. 运行时真链路：demo `fjs dev --web`（5173）+ 浏览器页面连上后，
     `dev_status` → `apps connected: 1`；`eval '1+1'` → `2`；`get_logs` 空闲时
     如实报 no output；`dump_tree` 在 web 构建上给出准确原因（web 刻意不带
     devtools 数据面，`build.ts` 的 `__FJS_DEVTOOLS__: String(devtoolsBundling
     && !web)`）。App 端 dump_tree 正例由协议同源的 stub server 用例覆盖
     （`DOM.getDocument` 真实返回形状）。✅
  5. `pnpm --filter @ufjs/cli run typecheck` / `run test` 通过。✅
  6. ZCode 注册：仓库根已执行 `ai init`（`.agents/mcp.json` + `.mcp.json` +
     `skills/`，未跟踪，去留待仓库主人决定）；ZCode 对 workspace 级 MCP
     自动连接，重开会话即出现 `ufjs` server 的 14 个工具——stdio 形状已由
     真进程冒烟用例钉住。✅

  spec 状态改 **done**。
