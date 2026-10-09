---
name: ufjs-build
description: ufjs 应用的构建、校验与发布产物：fjs build 各 profile（app/web/mp/pages/release）、字节码与引擎 flavor 匹配、体积分析、验收顺序。要出包、出网页版、出小程序、做 release 验收时读这篇。
---

# ufjs 构建与发布

## 验收顺序（每次改完代码）

```bash
pnpm typecheck        # 或 vue-tsc --noEmit
fjs lint --strict     # 静态查出引擎会丢的 CSS / 不认识的标签
fjs build             # 出包不报错
# 跑起来人工/MCP 验证（见 ufjs-debug）
```

`fjs doctor` 体检环境；`fjs routes --json` 核对页面表；MCP 的 `build` /
`routes` / `doctor` 工具可以直接代跑。

## fjs build 的 profile 矩阵

| 目标 | 命令 | 产物 |
|------|------|------|
| App 调试包 | `fjs build` | `dist/app/bundle.js` |
| 浏览器站点 | `fjs build --web` | `dist/web/`（index.html + 每页一个 chunk） |
| 微信小程序 | `fjs build --mp` | `dist/mp/`（微信开发者工具打开） |
| 分包 | `fjs build --pages` | `shared.js` + `bundle.js` + `pages/<id>.js` |
| 字节码 | `fjs build --bytecode` | `.fjsbundle`（经 fjsc 编译） |
| release | `fjs build --pages --release` | 字节码 + 资产拷进 `.fjs/flutter/assets/fjs` |
| release + APK | `fjs build --pages --release --apk` | 上者 + `flutter build apk` |

`--analyze` 出体积报告（js/gzip/字节码分项 + 包内构成）；页面超过
`fjs.performance.nodeBudget` 会警告。

## 字节码与引擎 flavor（release 的头号坑）

`.fjsbundle` 是**绑引擎**的字节码：编译它的 fjsc 必须和 App 内嵌引擎同 flavor
（`primjs` 默认 / `quickjs`），不匹配表现为运行时加载失败而不是构建报错。
`--js-engine <name>` 同时控制编译 flavor 和宿主构建 flavor；环境变量
`FJS_JS_ENGINE` 可覆盖，`FJSC_PATH` 显式指定 fjsc 二进制。本机改过 native 代码
时，自编的 fjsc 排在 npm 包前面——用旧引擎编出来的字节码不带任何告警。

## 发布

- 版本升级 `@ufjs/cli` / `@ufjs/runtime` 后：**重跑 `fjs ai init`** 刷新 AI
  技能与 MCP 注册（知识工具读的是构建时快照，升级不改它就会拿到旧事实）；
- `fjs build --release` 假设 Flutter 宿主在 `.fjs/flutter`（`fjs host create`
  创建或 eject 过的项目按 `fjs.flutterDir`）；宿主管理见 `fjs host --help`；
- `fjs preview` 本地起 dist/web 静态站点（4173）自测网页产物。
