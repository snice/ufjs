# Tasks: fjs run ohos 自动复用本机鸿蒙调试签名

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 不涉及契约层：本 spec 不改 op 协议、natives 表或事件类型（spec §5），这条确认后直接勾掉

## 实现

- [x] T010 写 `signingConfigs` 数组的文本定位器：跳过字符串、`//` 和 `/* */` 注释，按括号深度返回 `[start, end)`；再写按区间替换的函数。文件：`packages/fjs/src/project/ohos-signing.ts`
- [x] T011 实现读取：从 `ohos/AppScope/app.json5` 取 bundleName；从数组原文取出 `storeFile` / `profile` / `certpath` 三个路径；判断数组是否为空（去掉空白和注释后只剩 `[]`）。文件同上
- [x] T012 实现 p7b 校验：按 latin1 读文件，用正则取 `bundle-name` 和 `not-after`；返回「有效，附到期日」或「无效，附原因」，原因分三种：证书文件缺失、bundle 不符、已过期。文件同上
- [x] T013 实现存档读写：`~/.fjs/ohos-signing/<bundleName>.json5`，目录 0700、文件 0600，文件头一行注释写来源宿主和保存时间；存档根目录可以通过参数注入，方便测试。文件同上
- [x] T014 实现入口 `ensureOhosSigning(flutterDir, { interactive, store? })`，按 plan §3.2 的流程：宿主配置非空且与存档不同时存档；为空时校验通过就写回，否则打印首次提示，TTY 且 darwin 时打开 DevEco，然后抛错。模块顶部写权衡注释（宪法 VI）。文件同上
- [x] T015 导出 `opener()`，供签名模块打开 DevEco。文件：`packages/fjs/src/commands/host.ts`
- [x] T016 在 `fjs run` 里接入，只在 `opts.platform === 'ohos'` 时调用：debug 路径放在 `ensureFlutterHost` 之后、`startDevServer` 之前；release/profile 路径放在 `stopStaleApp` 之前。文件：`packages/fjs/src/commands/run.ts`
- [x] T017 在 `releaseBuild` 的 `if (opts.hap)` 分支里，在 `flutter build hap` 之前调用。文件：`packages/fjs/src/bundler/build.ts`

## 两端对齐

- [x] T020 不涉及 Web 侧：只改 CLI 的鸿蒙构建前置步骤，没有标签、样式或事件（plan §1 的 I），这条确认后直接勾掉
- [x] T021 核对 android / ios 的 `fjs run` 和 `fjs build --apk/--ipa` 行为不变：三个接入点都只在 ohos 分支里，`fjs run android` 不读 build-profile

## 测试

- [x] T030 为定位器写单测：带注释、带尾逗号的文件（用 flutter create 生成的那种和 fjs-go 带注释的那种）能取出区间；字符串里出现 `]`、注释里出现 `"signingConfigs"` 时都不误判。文件：`packages/fjs/test/ohos-signing.test.ts`
- [x] T031 为写回写单测：写回后区间外的字节不变；非空的宿主配置不被覆盖
- [x] T032 为 `ensureOhosSigning` 写单测，用临时目录造宿主、存档和假 p7b：①非空时存档，且以宿主为准覆盖旧存档；②为空且存档有效时写回；③三种失效（证书缺失、bundle 不符、过期）时抛错且不写回，报错里带原因；④没有 `ohos/build-profile.json5` 时直接返回；⑤`interactive: false` 时不调用 opener

## 文档

- [x] T040 在 `docs/toolchain.md` 的「鸿蒙（OpenHarmony fork）」一节加「调试签名」小节：第一次要在 DevEco 里点、存档位置和权限、写回规则、失效原因、`fjs build --hap` 也走这套检查
- [x] T041 在 `examples/fjs-go/README.md` 的签名段落补一句：fjs-go 是仓库里提交的宿主，不走 `.fjs`，不受这套自动流程管
- [x] T042 在 `docs/roadmap.md` 加一条 ✅ spec 113，写在 spec 112 那条后面，标注「**待本机验证**：鸿蒙模拟器」

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 逐条核对 spec.md 第 6 节：第 1、7 条由上面的任务覆盖；第 2–6 条在 `examples/hello-fjs` 上对着鸿蒙模拟器跑 plan §5 的实机步骤（先 `pnpm --filter @ufjs/cli run build`）
  - 2026-09-24 模拟器 127.0.0.1:5557 实测：第 2 条（无存档：在 flutter 之前退出，exit 1）、第 3 条（DevEco 签名后 `signing saved`，存档 0600）、第 4 条（清空后 `signing restored (expires 2027-09-24)`，写回结果与 DevEco 原文逐字节相同，App 装上并起来）、第 5 条（p12 路径改坏：报出原因，不写回）均通过
  - **未实测**：第 6 条 `fjs build --hap`（接入点与 run 相同，未跑完整 release 构建）；TTY 下自动打开 DevEco（验证时的 shell 不是 TTY，只覆盖了单测）
