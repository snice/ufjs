# Spec: fjs run ohos 自动复用本机鸿蒙调试签名

- **ID**: 113-ohos-signing-reuse
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

`fjs run ohos` 反复失败在 hvigor 的签名检查上：

```
Running Hvigor task assembleHap...
Error: 请通过DevEco Studio打开ohos工程后配置调试签名(File -> Project Structure -> Signing
Configs 勾选Automatically generate signature)
```

现状：

- 宿主 `.fjs/flutter/ohos/build-profile.json5` 由 `flutter create` 生成，
  `"signingConfigs": []`。fjs 从不读写这个文件。
- DevEco 的「Automatically generate signature」做两件事：
  1. 登录华为账号，向 AGC 申请调试证书和 profile，写进 `~/.ohos/config/`
     （`default_ohos_<hash>.{p12,cer,csr,p7b}`；p7b 绑定 bundle-name 与设备
     UDID，有效期一年）；
  2. 把证书路径和用 `~/.ohos/config/material` 加密后的密码写进宿主的
     `build-profile.json5`。
- `.fjs/flutter` 是可重建的目录（换 worktree、删 `.fjs/flutter/ohos` 绕 SDK 问题、
  重新 create），重建后第 2 步的结果就没了，但第 1 步的证书还在。
  实测：本机 `~/.ohos/config/` 里有 `com.example.hello_fjs` 今天刚签发的证书，
  但没有任何 `build-profile.json5` 引用它——开发者签过，仍然被要求再签。
- 失败发生在 flutter 工具链和 hvigor 已经跑了约 20 秒之后，报错只说
  「去 DevEco 里点」，不告诉你该打开哪个目录。

## 2. 不做什么（Non-goals）

- **不替代首次签名**。向 AGC 申请证书需要华为账号登录，没有公开的 CLI 接口，
  第一次仍然由开发者在 DevEco 里点。
- 不生成 OpenHarmony 自签证书（SDK 自带的 `OpenHarmony.p12`）——
  `runtimeOS: HarmonyOS` 的设备和模拟器不认。
- 不处理 release / 上架签名（spec 066 已划出去）。
- 不改 bundleName 的来源（仍然是 `flutter create` 的 `com.example.<name>`）。
- 不跨机器同步签名：加密后的密码只能在本机解开，存档天然是按机器存的。
- 不校验 profile 里的设备 UDID 是否包含当前设备（取 UDID 需要 hdc，
  失败时仍交给 hvigor/安装步骤报错）。
- 仓库里提交的 `examples/fjs-go/ohos` 的 skip-worktree 流程（spec 110）不变。

## 3. 用户可见的行为

**首次（本机从没为这个 bundleName 签过）**

```
$ fjs run ohos
fjs: ohos signing — .fjs/flutter/ohos has no signing config for com.example.hello_fjs
     and no saved one on this machine. One-time step:
       DevEco Studio → File → Project Structure → Signing Configs →
       tick "Automatically generate signature" → OK
     opening .fjs/flutter/ohos in DevEco Studio… re-run "fjs run ohos" when done.
```

在调用 `flutter run` **之前**退出（非 0），不再等 hvigor 跑 20 秒后报错。

**签过一次之后**

`fjs run ohos` 检测到 `build-profile.json5` 里有有效的 signingConfigs，
把它存到宿主之外的 `~/.fjs/ohos-signing/`，打印一行：

```
fjs: ohos signing saved for com.example.hello_fjs (~/.fjs/ohos-signing/com.example.hello_fjs.json5)
```

**宿主重建 / signingConfigs 被清空之后**

```
$ rm -rf .fjs/flutter/ohos && fjs run ohos
fjs: ohos signing restored for com.example.hello_fjs (expires 2027-09-22)
...正常构建、安装...
```

**存档失效**时（p12/p7b 文件没了、p7b 的 bundle-name 与宿主不符、已过期），
不写回，按「首次」处理，并在提示里说明原因（例如 `saved profile expired 2026-09-01`）。

同样的检查也用于 `fjs build --release --hap`。

## 4. 两端约定（宪法 I）

纯 CLI 行为，只影响鸿蒙宿主，不涉及 Flutter / Web 渲染两端。

| | ohos | android / ios |
|---|---|---|
| 行为 | 构建前检查 / 存档 / 写回签名 | 不变 |
| 已知差异 | 首次签名仍需 DevEco 手动操作（AGC 需要登录） | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

改动只在 `packages/fjs`（`commands/run.ts` 的 ohos 分支、`bundler/build.ts` 的
`--hap` 分支，加一个小的签名模块）和 `docs/toolchain.md` 的「鸿蒙」一节（宪法 VIII）。

## 6. 验收标准

1. `pnpm --filter @ufjs/cli run typecheck`、`pnpm test` 通过；新增单测覆盖：
   从带注释的 `build-profile.json5` 读出 signingConfigs、存档、写回到空配置、
   保留文件里其它字段不变、存档失效（文件缺失 / bundle 不符 / 过期）时不写回。
2. `examples/hello-fjs`：删掉 `.fjs/flutter/ohos` 的签名（signingConfigs 置空）
   且本机没有存档 → `fjs run ohos` 在调用 flutter 之前退出，打印上面的首次提示
   并打开 DevEco。
3. 在 DevEco 里勾选自动签名后 → `fjs run ohos` 在鸿蒙模拟器上起得来，
   打印 `signing saved`，存档文件存在。
4. 再把 signingConfigs 置空（或 `rm -rf .fjs/flutter/ohos` 重建）→ `fjs run ohos`
   打印 `signing restored`，不打开 DevEco，直接在模拟器上起来。
5. 手动把存档里的 p12 路径改成不存在的文件 → 按首次处理，提示里写明原因，
   不写回坏配置。
6. `fjs build --pages --release --hap` 在同样条件下行为与 2/4 一致。
7. `docs/toolchain.md`「鸿蒙」一节写明签名流程和存档位置。

## 7. 待澄清

已拍板（2026-09-24）：

- [x] **存档位置**：`~/.fjs/ohos-signing/<bundleName>.json5`，按机器、按 bundleName 存。
- [x] **没有签名时**：在终端（TTY）里运行时自动 `fjs host open ohos` 并退出；非 TTY（CI）只打印提示，同样退出。
- [x] **已 eject 的宿主**：也处理。signingConfigs 为空时写回存档，有值时存档；不覆盖已有的非空配置。
- [x] **存档更新**：宿主里的签名跟存档不一致时，以宿主为准，覆盖存档。
