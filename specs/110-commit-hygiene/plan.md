# Plan: 提交善后与提交信息校验

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 不涉及运行时。 |
| II 边界即契约 | 否 | — |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 钩子拒绝时说明原因与合规示例；启用是显式的，文档写明。 |
| VI 注释记录权衡 | 是 | 钩子脚本写清放行规则的理由（git 自动标题、fixup）。 |
| VII JS 能包就不要下 Dart | 不适用 | — |
| VIII 变更落到文档 | 是 | AGENTS.md §7、`examples/fjs-go/README.md`、`docs/roadmap.md`。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 工程 | `.githooks/commit-msg`（新增） | shell 外壳，调用 node 校验脚本 |
| 工程 | `.githooks/check-commit-msg.mjs`（新增） | 导出 `checkCommitMessage(text)`；CLI 读文件校验 |
| 工程 | `.githooks/check-commit-msg.test.mjs`（新增） | `node:test`；含历史回放 |
| 工程 | `package.json` | 根 `test` 追加 `node --test .githooks/check-commit-msg.test.mjs` |
| 工程 | `.gitignore` + `git rm --cached packages/flutter_fjs/pubspec.lock` | 库包锁文件不入库 |
| fjs-go | `examples/fjs-go/ohos/build-profile.json5` | `signingConfigs: []`，product 去掉 `signingConfig` |
| fjs-go | `examples/fjs-go/README.md` | 鸿蒙签名步骤 + skip-worktree |
| 文档 | `AGENTS.md` §7、`docs/roadmap.md` | 启用钩子；登记 |

## 3. 方案

钩子放在仓库内、用 `core.hooksPath` 启用：不引入 husky 等依赖，也不在 `pnpm install` 时偷偷改开发者的 git 配置。
规则只拦「格式不对」和「整句空洞」两类，不做语义判断，避免误伤。校验逻辑是纯函数，测试里拿仓库历史回放校准。

**被否掉的备选**：
- husky / commitlint：新增依赖（AGENTS.md §5 要求有理由才加），为一条正则不值得。
- CI 里校验：本仓库没有针对 PR 标题/提交的 CI，且事后校验拦不住已推送的提交。
- 签名配置改为环境变量占位：DevEco 不支持在 `build-profile.json5` 里引用环境变量。

## 4. 风险

- 移除签名后，fjs-go 鸿蒙包在 DevEco 首次构建需要先自动签名一次；README 写明。本环境无 DevEco，未实测。
- 钩子是 opt-in，没启用的人仍可提交不合规信息；它是护栏，不是强制。

## 5. 验证路径

```bash
node --test .githooks/check-commit-msg.test.mjs
pnpm test
# 临时仓库：git config core.hooksPath <repo>/.githooks，分别提交合规/不合规信息
```
