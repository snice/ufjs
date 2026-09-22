# Tasks: 文档站同步 specs 087–097 的用户可见变化

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 事实核对（动笔前）

- [x] T001 对照 `packages/fjs/src/cli.ts` help 与 `commands/{debug,lint,types}.ts`，
      确认 `fjs debug` / `fjs lint` / `fjs types` 的全部 flag 与退出码语义

## CLI 参考与调试指南（specs 087/088/090/092/093/094）

- [x] T002 `website/reference/cli.md`：新增 `fjs debug`、`fjs lint`、`fjs types`
      三节（flag 表 + 一句话用途）；build 表补 `--devtools`、`--js-engine`；
      run 表补 `--js-engine`；环境变量表补 `FJS_JS_ENGINE`
- [x] T003 `website/guide/debugging.md`：断点调试节改 source map 原文可达（094）；
      Elements 行补树按需展开与 Styles 三层（092/093）；「几件需要知道的事」
      补 Console 两侧日志、启动顺序无关、flavor 与 `--devtools` 限制（088/090/091）
- [x] T004 `website/guide/debugging.md`：快捷键表补 `?`；常见症状表
      「某条 CSS 不生效」补 `fjs lint` 入口

## 热更新两档（spec 095）

- [x] T005 `website/guide/debugging.md` 热更新表删「多页共享模块热替换」行，
      改为页面级 / 整包两档
- [x] T006 `website/guide/platforms.md` dev 热更新差异行、
      `website/advanced/overview.md` 产物表更新行改两档措辞
- [x] T007 `docs/web.md`「dev 热更新」已知差异条目改两档（095 T005 遗留）

## 引擎措辞去硬编码（specs 088/091）

- [x] T008 `website/guide/introduction.md`：架构行改「PrimJS（默认）+ 可切
      quickjs-ng」；两处「QuickJS 字节码」改「引擎字节码」
- [x] T009 `website/index.md` 两张 feature 卡、`website/guide/getting-started.md`、
      `website/guide/platforms.md` 产物行的「QuickJS」措辞
- [x] T010 `website/guide/build-and-release.md`：两处字节码措辞 + 「QuickJS
      版本对不上」改 engine id 校验句
- [x] T011 `website/advanced/bundling.md`：4 处字节码措辞、engine id 校验句、
      默认 flavor 注记
- [x] T012 `website/advanced/overview.md`（除 T006 的更新行外 3 处）、
      `website/advanced/threading.md`（5 处）、`website/advanced/native-bridge.md`
      （2 处）、`website/advanced/web-and-mp.md`（1 处）、
      `website/guide/events-and-data.md` Worker 行（1 处）：「QuickJS runtime /
      实例」改「JS 引擎」；逐处人工判断不误伤
- [x] T013 `website/reference/runtime-api.md`：`engineInfo` 行补 `engineId`

## lint 出口（spec 087）

- [x] T014 `website/guide/styling.md` 支持矩阵段补 `fjs lint`

## 源码导读与贡献页（specs 088–091）

- [x] T015 `website/source/index.md`：`packages/fjs` 目录树补 `debug/`、
      `commands/` 举例补 debug/lint/types；native 树改双 flavor + `abi/`；
      成对契约表补调试器一行（链 `docs/debugger.md`）
- [x] T016 `website/source/contributing.md`：双 flavor build 命令；产物入库
      口径改 `abi/`；调试手段表补 `fjs debug`

## 两端对齐

- [x] T017 纯文档无运行时对拍；确认改动没有引入任何只描述一端的用户能力
      （fjs debug 仅 App 的限制已写明，等于如实登记差异）

## 验收

- [x] T018 `pnpm docs:build` 通过（死链检查）
- [x] T019 spec 第 6 节 grep 断言逐条跑，真实输出贴进汇报
- [x] T020 逐条核对 spec 第 3 节页面清单：每个列出的页面都被改到
