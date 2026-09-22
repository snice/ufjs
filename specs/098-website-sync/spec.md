# Spec: 文档站同步 specs 087–097 的用户可见变化

- **ID**: 098-website-sync
- **状态**: done（2026-09-22 `pnpm docs:build` 通过，第 6 节 grep 断言全绿）
- **日期**: 2026-09-22

## 1. 要解决什么

网站上一次事实同步是 f1a92fa（2026-09-20，覆盖到 specs 069–086）。之后合入的
specs 087–097 改了不少**用户可见**的行为，网站跟着过时了，具体现象：

- `guide/debugging.md` 的热更新表还是三档 —— 中间那档「多页共享模块在同一
  虚拟机里热替换」已随 spec 095 删除，现在只有「页面级 / 整包」两档。
- `guide/debugging.md` 断点调试节写着「Sources 里……看不到 Vue SFC 原文」——
  spec 094 之后能看到原文，断点可下在 `<script setup>` 行。这句话现在是反的。
- `reference/cli.md` 没有 `fjs debug`、`fjs lint`、`fjs types` 三条命令，
  build/run 表也没有 `--js-engine`、`--devtools`，环境变量表缺 `FJS_JS_ENGINE`
  （specs 087、088、090、091）。
- 全站十几处把引擎写死成「QuickJS / QuickJS-ng」——spec 088 起默认引擎是
  PrimJS 4.1.1（CDP 调试器只在它上面），quickjs-ng 0.9.0 是可切换 flavor；
  字节码校验的也是 engine id（`primjs-4.1.1`）而不是「QuickJS 版本」。
- Elements / Network / Console 面板的能力停在 spec 089/092 之前：没写树按需
  展开（093）、Styles 命中规则（092）、Console 收全两端日志（092）。
- `source/index.md` 仓库地图缺 `debug/`（CDP 中继）目录，native 树还写
  `quickjs/` 单份源码——现在是 `primjs/` + `quickjs/` 双 flavor 与 `abi/` 产物缓存。
- `source/contributing.md` 说「改了 native 要重新生成预编译产物**并提交**」——
  spec 091 起平台产物不入库，`abi/` 才是唯一入库产物源。
- `docs/web.md` 的「dev 热更新」已知差异条目仍写「unit / page 级热替换，
  spec 037」——这是 spec 095 T005「文档改为两档热更新」的遗留，顺带补上。

## 2. 不做什么（Non-goals）

- **不新开页面**：不为引擎切换、引擎性能对比（`docs/engine-perf.md`）、
  调试器内部实现（`docs/debugger.md`）建站内页 —— 这些留在仓库 docs/，
  网站相关位置链接过去即可。
- **不改主题、导航、侧边栏结构**：没有新增页面，`config.mts` 不动
  （除非死链检查暴露问题）。
- **不覆盖 specs 069–086 已同步的内容**（样式支持面、ui-libs、splash/preview/
  upgrade 等），只动本次差距清单里的条目。
- **不动 spec 096**：鹈鹕骑行是 hello-fjs 示例画廊内容，网站不逐例介绍。
- **不动 spec 097 相关表述**：`guide/events-and-data.md` 的 `touch-action`
  建议从未记载过「会吞掉 @tap」这个 bug，无需改。
- **不 commit / 不 push**：只改工作区，提交等用户明确要求（AGENTS.md §7）。
- 不改任何生产代码：本 spec 纯文档（`website/` + 一行 `docs/web.md`）。

## 3. 用户可见的行为

改完之后，网站读者看到的与当前实现一致。逐组列出关键变化（页面路径相对
`website/`）：

**热更新两档（spec 095）**

- `guide/debugging.md` 热更新表：删掉「多页共享模块热替换」行，剩
  「页面自己的代码 → 只重载这一页」「其它一切（shell、入口、共享组件与 ts、
  路由、配置）→ 整虚拟机重建、回首页」两行。
- `guide/platforms.md` 差异表 dev 行、`advanced/overview.md` 产物表更新行：
  「页面级 / 模块级热替换」→「页面级热更新 + 整包重建两档」。
- `docs/web.md` dev 热更新条目：`fjs dev --pages` 对 App 端只有页面级与
  整包两档（不再是 unit / page 级）。

**CLI 参考补齐（specs 087、088、090、091）**

`reference/cli.md` 新增/修改，示例输出与 `fjs --help`、各命令实现一致：

```
### `fjs debug`
建立 CDP 中继，Chrome DevTools 直连设备上正在跑的 JS。
| `--cdp-port <n>` | DevTools 侧端口，默认 38902 |
| `--vm-port <n>`  | App 虚拟机侧端口，默认 38903 |
（`--port` / `--host` 是 dev server 地址，见 `fjs dev`。）

### `fjs lint [paths...]`
静态检查 CSS：引擎不支持、写了也不生效的选择器/属性/单位/at-rule。
| `--strict` | warn 也算失败（CI / pre-commit 用） |
有 drop 退出码 1；只有 warn 退出码 0。

### `fjs types`
写出/刷新 src/fjs-routes/-assets/-modules/-components.d.ts（变了才写）。
| `--check` | 只读；有过期文件时退出码 1（CI 用） |
```

build 表补 `--devtools`（非 dev 构建保留 Elements/Network 数据平面）与
`--js-engine <primjs|quickjs>`；run 表补 `--js-engine`；环境变量表补
`FJS_JS_ENGINE`。

**调试指南跟上面板与 source map（specs 089、092、093、094）**

`guide/debugging.md` 断点调试节：

- 「Sources 里是编译后的 JS……看不到 Vue SFC 原文」改为：dev 构建带 source
  map，Sources 里能打开 `.vue` 原文与项目 `.ts`，断点可下在 `<script setup>`
  行、Call Stack 显示原文行号；`shared.js` 里的 npm 依赖没有 map（094）。
- Elements 面板行补：树按需展开（点箭头拉子树，093）；Styles 侧栏有
  inline、命中规则、Computed 三层（092）。Network 行保持现状。
- 「几件需要知道的事」补三条：Console 收全 JS 与 Dart 两侧日志（092）；
  `fjs debug` 启动顺序无关、App 连上即整包重载一次进脚本表（4a5a828/088）；
  quickjs flavor 没有调试器、release 物理剔除非 debug 产物，非 dev 构建要看
  面板用 `fjs build --devtools`（090/091）。
- 常见症状表「某条 CSS 不生效」补 `fjs lint` 入口；快捷键表补 `?`。

**引擎表述去硬编码（specs 088、091）**

面向用户的措辞从「QuickJS 引擎 / QuickJS 字节码」改为不绑死 flavor 的说法，
默认 flavor 与可切换性在首次出现处点一句：

- `index.md`（首页两张 feature 卡）、`guide/introduction.md`（3 处）、
  `guide/getting-started.md`、`guide/platforms.md`、`guide/build-and-release.md`
  （2 处，「QuickJS 版本对不上」改「engine id 不一致」）：
  「QuickJS 字节码」→「引擎字节码（`.fjsbundle`，头部锁 engine id）」。
- `guide/introduction.md` 架构行：「QuickJS-ng + Dart FFI」→
  「PrimJS（默认 flavor）+ Dart FFI，可切 quickjs-ng」。
- `advanced/overview.md`（3 处）、`advanced/threading.md`（5 处）、
  `advanced/bundling.md`（4 处）、`advanced/native-bridge.md`（2 处）、
  `advanced/web-and-mp.md`（1 处）、`guide/events-and-data.md`（Worker 1 处）：
  「QuickJS runtime / 实例」→「JS 引擎 runtime / 实例」；`bundling.md` 的
  字节码校验句改为「fjsc 与 App 必须是同一 flavor 的引擎，engine id 不一致
  直接拒绝加载」，并注一句默认 PrimJS、`--js-engine quickjs` 可切。
- `reference/runtime-api.md` `engineInfo` 行补 `engineId` 字段
  （`primjs-4.1.1` / `quickjs-ng-0.9.0`，Web 端为 `none`）。

**源码导读与贡献页（specs 088–091）**

- `source/index.md`：`packages/fjs` 目录树补 `debug/`（CDP 中继与域桥）与
  dev/ 的现有文件群；`commands/` 举例补 debug、lint、types；flutter_fjs 的
  native 树改「`primjs/`（默认）+ `quickjs/`（可切）双 vendored 源码，
  `abi/` 预编译产物缓存（唯一入库产物源）」；成对契约表补一行调试器契约
  （指向 `docs/debugger.md` §3）。
- `source/contributing.md`：编译原生引擎一节补双 flavor 的两个 build 目录与
  `-DFJS_JS_ENGINE=quickjs`；「重新生成预编译产物并提交」改为「跑
  `tool/build-*.sh` 更新 `abi/`（入库）并物化平台目录（不入库）」；调试手段
  表补 `fjs debug`。

**lint 出口（spec 087）**

- `guide/styling.md` 支持矩阵段补一句：写完可跑 `fjs lint` 提前把
  「写了不生效」的规则报到命令行。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 不涉及——本 spec 纯文档 | 同 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 网站在「调试」「多端差异」页如实记载 fjs debug 仅 App 端、quickjs flavor 无调试器（docs/web.md 已有对应条目） | |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（纯文档改动）

## 6. 验收标准

1. `pnpm docs:build` 成功 —— VitePress 死链检查通过，无 broken dead links。
2. `grep -rn "模块级热替换\|unit / page 级\|reload units" website/ docs/web.md`
   无残留（`config.mts`、node_modules 除外）。
3. `grep -rn "QuickJS 字节码" website/` 无残留；`grep -rn "看不到 Vue SFC" website/`
   无残留。
4. `grep -c "fjs debug" website/reference/cli.md` ≥ 1，
   `grep -c "fjs lint" website/reference/cli.md` ≥ 1，
   `grep -c "fjs types" website/reference/cli.md` ≥ 1，
   `grep -c "FJS_JS_ENGINE" website/reference/cli.md` ≥ 1。
5. `grep -n "engineId" website/reference/runtime-api.md` 有命中。
6. 逐条目人工核对第 3 节的页面清单（每个列出的页面都被改到）。

## 7. 待澄清

- [ ] 无 —— 范围是「把网站刷到与已合入的 specs 一致」，没有需要拍板的分叉。
