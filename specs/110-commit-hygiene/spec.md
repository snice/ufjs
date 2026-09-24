# Spec: 「feat(pref): update」提交的善后与提交信息校验

- **ID**: 110-commit-hygiene
- **状态**: done（鸿蒙签名构建待用户在 DevEco 验证）
- **日期**: 2026-09-24
- **来源**: 近 3 天代码 review。

## 1. 要解决什么

### 16222fd「feat(pref): update」（2026-09-22）实际包含的东西

标题不说明任何事（`pref` 疑为 `perf` 的笔误，内容也与性能无关），25 个文件、+1152/−132 行混在一起：

| 内容 | 文件 | 判断 |
|---|---|---|
| fjs-go 鸿蒙：`bundleName` `dev.flutterjs.fjs_go` → `dev.flutterjs.fjsgo`，应用名同改；图标换小图 | `examples/fjs-go/ohos/AppScope/**`、`entry/src/**/string.json`、三处 `icon.png` | 上架相关的有意调整，保留 |
| fjs-go 鸿蒙：`compatibleSdkVersion` 5.1.0(18) → 5.0.5(17)，新增 `targetSdkVersion` 26.0.0 | `examples/fjs-go/ohos/build-profile.json5` | 有意调整（扩大可装机型），保留 |
| fjs-go 鸿蒙：签名配置的 `keyPassword` / `storePassword` 换成新密文 | 同上 | **问题**：见下 |
| fjs-go 鸿蒙测试模板、`oh-package.json5` 小改 | `ohos/entry/src/ohosTest/**` | DevEco 模板升级，保留 |
| fjs-go macOS：`applicationSupportsSecureRestorableState`、Podfile / pbxproj / scheme 迁移 | `examples/fjs-go/macos/**` | Flutter 工具自动迁移，保留 |
| 锁文件：fjs-go 的 `pubspec.lock` 更新；**首次加入** `packages/flutter_fjs/pubspec.lock` 与 `packages/flutter_fjs/example/pubspec.lock` | — | 库包的锁文件是**问题**：见下 |
| relay 日志措辞（`session #N`） | `packages/fjs/src/debug/cdp-server.ts` | 保留 |
| spec 088 的任务记录 | `specs/088-devtools-debugger/tasks.md` | 保留 |

### 需要处理的两处

1. **签名配置绑定个人机器**（9 月 19 日 7ed4fac 加入，本次又改）：
   `certpath` / `profile` / `storeFile` 写死 `/Users/zhe/.ohos/config/…`，密码是 DevEco 用本机密钥加密的密文。
   别人检出后签不了名；每个开发者在 DevEco 里自动签名都会改写这个受版本控制的文件，产生反复的无意义提交——
   16222fd 里的「新密文」正是这样来的。仓库里另外两个鸿蒙工程（`packages/flutter_fjs/ohos`、
   `packages/fjs-webgl/flutter/ohos`）都不带签名配置。
2. **库包提交了锁文件**：`packages/flutter_fjs` 是发布到 pub.dev 的库。Dart 的惯例是库不提交 `pubspec.lock`
   （使用方按自己的约束解析）；仓库 `.gitignore` 也已把模块包的 `pubspec.lock` 定为「构建状态，不是源码」；
   `.pubignore` 本来就不发布它。`example/` 是应用，保留其锁文件（与 fjs-go 一致）。

### 防止再发生

AGENTS.md 第 7 节要求 conventional commits，但没有任何检查；历史 60 条提交里有
`feat(pref): update`、`update doc`、`fjs go test` 这样的标题。

## 2. 不做什么（Non-goals）

- **不改写历史**：16222fd 已在 main 上，不 amend / rebase / force-push。本 spec 本身就是它的说明。
- 不改 fjs-go 的包名、SDK 版本、图标等有意调整。
- 钩子不强制安装、不加依赖（husky 等）：由开发者一条命令启用。
- 不校验 `Co-Authored-By` 尾注（只对 AI 协作提交有要求）。

## 3. 用户可见的行为

```bash
git config core.hooksPath .githooks   # 一次性启用
git commit -m "feat(pref): update"    # 被拒：摘要「update」不说明改了什么
git commit -m "update doc"            # 被拒：不是 type(scope): 摘要
git commit -m "fix(runtime): PrimJS 的 queueMicrotask 兜底不再吞异常"   # 通过
```

- 放行 git 自动生成的 `Merge …`、`Revert "…"`、`fixup! …` / `squash! …`。
- type 取 AGENTS.md 与历史里用到的：feat fix docs chore build refactor test perf style ci revert。
- 摘要拒绝空洞词：update / updates / fix / fixes / wip / tmp / misc / change / changes / 修改 / 更新 /
  调整 / 优化 / 修复（整句只有这个词时）。
- fjs-go 鸿蒙：仓库里的 `build-profile.json5` 不再带签名配置；README 说明在 DevEco 里自动签名，
  并用 `git update-index --skip-worktree` 让本地签名不进 `git status`。

## 4. 两端约定（宪法 I）

不涉及。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `node --test .githooks/check-commit-msg.test.mjs` 通过：覆盖合规 / 不合规标题、git 自动生成的标题、空洞摘要、注释行与空行处理；
   并用仓库全部历史标题回放，只拒绝已知不合规的那几条。
2. 根 `pnpm test` 包含这组测试且通过。
3. 在临时仓库里启用 `core.hooksPath` 实测：`feat(pref): update` 提交失败，合规提交成功。
4. `git ls-files packages/flutter_fjs/pubspec.lock` 为空，且被 `.gitignore` 忽略；example 的锁文件仍被跟踪。
5. `examples/fjs-go/ohos/build-profile.json5` 不含 `signingConfigs` 内容与任何 `/Users/` 路径，JSON5 结构合法；
   README 写明签名步骤。**鸿蒙真机签名构建需用户在 DevEco 验证。**
6. AGENTS.md 第 7 节写明启用钩子；`docs/roadmap.md` 登记。

## 7. 待澄清

- [x] 签名配置 → 用户选「移出仓库」（2026-09-24）。
- [x] 提交信息钩子 → 用户选「加，需手动启用」（2026-09-24）。

## 8. 验收记录（2026-09-24）

1. `node --test .githooks/check-commit-msg.test.mjs`：6/6。历史回放（60 条）只拒绝
   `feat(pref): update`、`update doc`、`fjs go test` 三条已知不合规标题，两条 `Merge branch …` 放行。
   （Node 22 的 `--test` 不接受目录参数，脚本直接指定测试文件。）
2. 根 `pnpm test` 末尾执行 `test:hooks`，通过。
3. 临时仓库实测：`feat(pref): update`、`update doc` 被拒并给出原因；合规标题提交成功；`--no-verify` 可绕过。
   本 spec 自己的提交在启用钩子的情况下完成。
4. `packages/flutter_fjs/pubspec.lock` 已停止跟踪并被忽略；`example/pubspec.lock` 仍被跟踪。
5. `examples/fjs-go/ohos/build-profile.json5`：`signingConfigs: []`、product 不再引用签名，无 `/Users/` 路径，
   结构可解析；README 写明 DevEco 自动签名 + `skip-worktree`。**DevEco 实际构建未在本环境验证。**
6. AGENTS.md §7、`docs/roadmap.md` 已更新。

注意：已提交过的密文与本机路径仍在 git 历史中（未改写历史）。密文只能用对应机器上的 DevEco 密钥解开，
且 `.p12` 证书本身从未入库；如仍介意，可在 DevEco 里重新生成调试签名使旧密文作废。
