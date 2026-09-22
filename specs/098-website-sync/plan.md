# Plan: 文档站同步 specs 087–097 的用户可见变化

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 纯文档，不产生任何运行时行为。网站如实记载的两端差异（fjs debug 仅 App、quickjs flavor 无调试器）本来就登记在 `docs/web.md` 已知差异表。 |
| II 边界即契约 | 否 | 三张契约表（ops / natives / 事件类型）都不动，spec 第 5 节已勾「都不涉及」。 |
| III 同步单线程零序列化 | 否 | 不涉及。 |
| IV 外观照 WeUI | 否 | 不改任何组件样式。 |
| V 静默失效是 bug | 是 | 网站内容与实现不一致就是本文档的「静默失效」——本 spec 的存在即为该条款在文档域的落实：所有陈述以已合入的 specs 087–097 与对应源码/`--help` 为准，`pnpm docs:build` 死链检查兜底。 |
| VI 注释记录权衡 | 否 | Markdown 不适用；权衡记录在 specs 目录本身。 |
| VII JS 能包就不要下 Dart | 否 | 不新增能力。 |
| VIII 变更落到文档 | 是 | 本 spec 就是文档落地；反向不适用（没有代码变更需要回写 docs/）。`docs/web.md` 的 spec 095 遗留条目顺带修掉。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | 不动 | `reference/cli.md` 的内容以 `packages/fjs/src/cli.ts` 的 `--help` 文本与 `commands/{debug,lint,types}.ts` 的实际 flag 为准抄录，不改实现 |
| JS runtime | 不动 | — |
| Web 适配层 | 不动 | — |
| C++ 引擎 | 不动 | — |
| Dart 宿主 | 不动 | — |
| 文档（网站） | `website/index.md` | 两张 feature 卡的「QuickJS 引擎 / QuickJS 字节码」改不绑 flavor 的说法 |
| 文档（网站） | `website/guide/debugging.md` | 热更新表改两档（095）；断点调试节改 source map 原文（094）、补树按需展开与 Styles 命中规则与 Console 两侧日志与启动顺序与 flavor/`--devtools` 限制（088/090/092/093）；快捷键表补 `?`；症状表补 `fjs lint` |
| 文档（网站） | `website/reference/cli.md` | 新增 `fjs debug` / `fjs lint` / `fjs types` 三节；build 表补 `--devtools`、`--js-engine`；run 表补 `--js-engine`；环境变量表补 `FJS_JS_ENGINE`（087/088/090/091） |
| 文档（网站） | `website/reference/runtime-api.md` | `engineInfo` 行补 `engineId` 字段（091） |
| 文档（网站） | `website/guide/introduction.md` | 架构行改「PrimJS 默认 flavor + 可切 quickjs-ng」；两处「QuickJS 字节码」（088/091） |
| 文档（网站） | `website/guide/getting-started.md` | `build:release` 注释的「QuickJS 字节码」 |
| 文档（网站） | `website/guide/platforms.md` | 产物行「QuickJS 字节码」；dev 热更新差异行改两档（091/095） |
| 文档（网站） | `website/guide/build-and-release.md` | 两处字节码措辞 + engine id 校验句（088/091） |
| 文档（网站） | `website/guide/styling.md` | 支持矩阵段补 `fjs lint` 出口（087） |
| 文档（网站） | `website/guide/events-and-data.md` | Worker 行「独立的 QuickJS 实例」（088/091） |
| 文档（网站） | `website/advanced/overview.md` | 3 处引擎名（088/091） |
| 文档（网站） | `website/advanced/threading.md` | 5 处「QuickJS runtime / 实例」（088/091） |
| 文档（网站） | `website/advanced/bundling.md` | 4 处字节码措辞 + engine id 校验句 + 默认 flavor 注记（088/091） |
| 文档（网站） | `website/advanced/native-bridge.md` | 2 处「QuickJS 没有 socket / 引用计数规则」（088/091） |
| 文档（网站） | `website/advanced/web-and-mp.md` | Worker 行（088/091） |
| 文档（网站） | `website/source/index.md` | `packages/fjs` 目录树补 `debug/`、`commands/` 举例补 debug/lint/types；native 树改双 flavor + `abi/`；成对契约表补调试器一行（088–091） |
| 文档（网站） | `website/source/contributing.md` | 双 flavor build 目录与 `-DFJS_JS_ENGINE=quickjs`；产物入库口径改 `abi/`；调试手段表补 `fjs debug`（088–091） |
| 文档（仓库） | `docs/web.md` | 「dev 热更新」已知差异条目从 unit/page 两档改为 spec 095 的页面/整包两档（补 095 T005 遗留） |

事实来源（每处措辞先核对再落笔）：

- CLI flag / 输出格式：`packages/fjs/src/cli.ts` 的 help 文本、
  `commands/{debug,lint,types}.ts`、`docs/toolchain.md` 对应章节。
- 热更新两档：`specs/095-drop-dev-units/spec.md` §3、`docs/code-splitting.md`「热更新」。
- 面板能力：`docs/toolchain.md`「断点调试：`fjs debug`」（088–094 的权威汇总）。
- 引擎 flavor：`docs/toolchain.md`「字节码格式」「JS 引擎切换（spec 091）」、
  `specs/091-js-engine-switch/spec.md` §3。
- native/abi 布局：`packages/flutter_fjs/tool/build-*.sh` 头注释、
  `docs/publishing.md`（spec 091 后的入库口径）。

## 3. 方案

按「事实源 → 网站页面」单向同步，一组主题一个任务，顺序：先 CLI/调试
（读者最可能照着敲的），再热更新（有反直觉的行为变化），再引擎措辞（面最广、
机械替换多），最后源码导读/贡献页，`docs/web.md` 一行归入热更新组。

被否掉的备选：

- **为 `fjs debug` 单开 guide 页**：调试已有 `guide/debugging.md`，单开会造成
  两处维护同一内容；CLI 参考只放 flag 表与一句话，细节链到 guide。
- **把 `docs/debugger.md` / `docs/engine-perf.md` 搬进网站**：面向用户的网站与
  面向框架开发者的 docs/ 分工已定（`website/README.md`、导航「更多 → 技术
  文档」），搬运会分叉；在调试页/引擎处给 GitHub 链接即可。
- **引擎措辞全部改成「PrimJS」**：写死 PrimJS 与写死 QuickJS 是同一个错误的
  两面——flavor 可切（091），且字节码锁 engine id。面向用户除非讲 flavor
  差异，否则用「JS 引擎 / 引擎字节码」，在 introduction 与 bundling 各点一次
  「默认 PrimJS、`--js-engine quickjs` 可切」。
- **改 `config.mts` 侧边栏**：无新增页面，不动。

## 4. 风险

- **措辞与实现漂移**：CLI flag 抄错会让读者敲出 `unknown option`。缓解：
  每条 flag 对照 `cli.ts` help 文本原文；验收跑 `fjs debug --help` 类命令
  人工核对（`--cdp-port`/`--vm-port` 已从 `commands/debug.ts` 源码确认）。
- **死链**：改标题可能破坏页内锚点（`docs:build` 不查锚点）。本次不改任何
  标题结构、不删小节，只改小节内文字与表格行，锚点面不变。
- **Vue 模板吞噬**：正文里不加反引号的 `<tag>` 会被当组件吞掉（`website/README.md`
  已知坑）。新写的 `<script setup>`、`--js-engine` 等一律包反引号或入代码块。
- **过度改写**：机械替换「QuickJS → JS 引擎」可能改坏本来就正确的句子
  （如「QuickJS 没有 socket」说的是引擎能力，两 flavor 都没有 socket）。
  逐处人工判断，只改绑死 flavor 的陈述。

## 5. 验证路径

```bash
# 构建 + 死链检查（验收主命令）
pnpm docs:build

# spec 第 6 节的 grep 断言
grep -rn "模块级热替换\|unit / page 级\|reload units" website docs/web.md \
  --include='*.md'          # 期望：无输出
grep -rn "QuickJS 字节码" website --include='*.md'   # 期望：无输出
grep -rn "看不到 Vue SFC" website --include='*.md'   # 期望：无输出
grep -c "fjs debug" website/reference/cli.md         # ≥ 1
grep -c "fjs lint"  website/reference/cli.md         # ≥ 1
grep -c "fjs types" website/reference/cli.md         # ≥ 1
grep -c "FJS_JS_ENGINE" website/reference/cli.md     # ≥ 1
grep -n "engineId" website/reference/runtime-api.md  # 有命中
```
