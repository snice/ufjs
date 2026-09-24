# Plan: fjs run ohos 自动复用本机鸿蒙调试签名

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 只改 CLI 的鸿蒙构建前置步骤，不涉及标签、样式或事件；Flutter / Web 渲染都不动 |
| II 边界即契约 | 否 | 不改 op 协议（`ops.ts`/`ui_ops.dart`）、natives 表（`natives.cpp`/`native-global.d.ts`）或事件类型 |
| III 同步单线程零序列化 | 否 | 与运行时无关 |
| IV 外观照 WeUI | 否 | 无 UI |
| V 静默失效是 bug | **是** | 这个 spec 的核心：①没有签名时在 flutter 之前就明确报错，不再等 hvigor 跑 20 秒；②存档失效时说明原因（证书文件缺失、bundle 不符、已过期），不悄悄写回坏配置；③写回和存档各打印一行；④ohos 宿主不存在或不是 fork 生成的时候**跳过**，不报错（android/ios 的流程不变） |
| VI 注释记录权衡 | 是 | 新模块顶部注释写清楚：为什么不引入 json5 解析器而是按文本定位 `signingConfigs` 数组；为什么以宿主为准覆盖存档；为什么存档按机器、按 bundleName 存（密码用 `~/.ohos/config/material` 加密，只能在本机解开） |
| VII JS 能包就不要下 Dart | 否 | 纯 Node CLI，不碰 Dart |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`「鸿蒙（OpenHarmony fork）」一节（约 842 行）加「调试签名」小节；`examples/fjs-go/README.md` 加一句：fjs-go 是仓库内提交的宿主，不走 `.fjs`，不受这个自动流程管 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/project/ohos-signing.ts`（新增） | 签名模块：读宿主配置、存档、写回、校验、构建前检查的入口 `ensureOhosSigning(flutterDir, { interactive })` |
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | debug 路径：`ensureFlutterHost` 之后、`startDevServer` 之前调用；`--release/--profile` 路径：`stopStaleApp` 之前调用。两处都只在 `opts.platform === 'ohos'` 时调用 |
| CLI / 构建 | `packages/fjs/src/bundler/build.ts` | `releaseBuild` 里 `if (opts.hap)` 分支在 `flutter build hap` 之前调用 |
| CLI / 构建 | `packages/fjs/src/commands/host.ts` | 导出 `opener()`（现在是模块私有的），让签名模块复用「用 DevEco 打开」 |
| 测试 | `packages/fjs/test/ohos-signing.test.ts`（新增） | 单测，见 §5 |
| JS runtime / Web / C++ / Dart | — | 不动 |
| 文档 | `docs/toolchain.md`、`examples/fjs-go/README.md` | 见 VIII |

## 3. 方案

### 3.1 数据

- **宿主配置**：`<flutterDir>/ohos/build-profile.json5` 的 `app.signingConfigs`。
  DevEco 写入的结构是
  `[{ name, type, material: { certpath, keyAlias, keyPassword, profile, signAlg, storeFile, storePassword } }]`，
  其中三个路径是 `~/.ohos/config/` 下的绝对路径，两个密码是加密后的密文。
- **bundleName**：从 `<flutterDir>/ohos/AppScope/app.json5` 里用正则取 `"bundleName"`。
- **存档**：`~/.fjs/ohos-signing/<bundleName>.json5`，内容是 `signingConfigs` 数组的
  **原文**，外加一行注释说明来源宿主和保存时间。原样存取，不重新序列化，这样
  DevEco 写的格式和密文完全不变。目录权限 0700，文件 0600，因为里面有密文和证书路径。
- **p7b 校验**：p7b 是 PKCS#7 包着明文 JSON，在 latin1 解码后的文本里用正则取
  `"bundle-name":"…"`、`"not-after":<秒>`。取不到时视为无效（按首次处理，并说明原因）。

### 3.2 流程：`ensureOhosSigning(flutterDir, { interactive })`

```
没有 ohos/build-profile.json5            → 返回（不是 fork 生成的宿主，交给 flutter 报错）
读 bundleName；读 signingConfigs 的文本和各路径
宿主配置非空:
    和存档文本不同 → 写存档（以宿主为准），打印 "signing saved …"
    返回                                  （非空的宿主配置一律不改）
宿主配置为空:
    有存档且校验通过 → 把存档文本替换进 build-profile.json5，打印 "signing restored … (expires …)"
    否则            → 打印首次提示（附上失效原因）；
                      interactive 且是 darwin → opener(ohos 目录, 'ohos') 打开 DevEco；
                      抛错，退出码非 0
```

`interactive = process.stdout.isTTY === true`。

### 3.3 文本定位而不是 JSON5 解析

`build-profile.json5` 里会有注释（fjs-go 那份就有）和尾逗号（flutter create
生成的就有），`JSON.parse` 读不了；宪法里写了「不新增依赖，除非 spec 写明理由」。
所以写一个很小的扫描器：跳过字符串和 `//`、`/* */` 注释，找到 key
`"signingConfigs"` 后面的 `[`，按括号深度找到配对的 `]`，返回 `[start, end)`。
读和写回都只动这一段文本，文件其它部分逐字节不变。

### 3.4 被否掉的备选

| 备选 | 否掉的原因 |
|------|-----------|
| 引入 `json5` 包完整解析再序列化 | 新增依赖；而且重新序列化会丢掉注释、改动格式。ejected 宿主的文件归用户，不应被整篇重写 |
| 完全自动签名（脚本调用 AGC 接口） | 需要华为账号 OAuth，没有公开的 CLI 接口，spec 已列为不做 |
| 用 SDK 自带的 OpenHarmony 自签证书 | `runtimeOS: HarmonyOS` 的设备和模拟器不认 |
| 从 `~/.ohos/config/` 直接拼出 signingConfigs | 证书文件在，但 p12 的密码是 DevEco 随机生成、只以密文形式写在 build-profile 里的，只有证书文件拼不出能用的配置 |
| 存档放项目内、加进 gitignore | 用户已选「按机器存在 `~/.fjs`」；放项目内的话换 worktree 就丢 |
| 在 `ensureFlutterHost` 里做 | 那里的 managed/ejected 分支会让逻辑重复，而且 `fjs host create` 也会触发打开 DevEco，不合适。放在「马上要构建 ohos」的三个调用点才对 |
| 构建失败后再解析 hvigor 输出 | 那时 20 秒已经浪费掉了，而且依赖中文报错文案，很脆 |

## 4. 风险

- **DevEco 写的结构变了**：我们只依赖 `material.{storeFile,profile,certpath}` 三个路径
  取出来做校验；取不到时存档照存，写回前的校验按「无效」处理，并提示原因。不会静默失败。
- **设备 UDID 不在 profile 里**：spec 已列为不校验；这种情况安装时 hvigor/hdc 会报错，
  和现在一样。
- **多个 product / 多个 signingConfig**：存取的是整个数组原文，天然支持。
- **run.ts 的 debug 路径先起 dev server 再跑 flutter**：检查放在 `startDevServer` 之前，
  失败时不会留下孤儿 dev server 进程。
- **与 spec 112 / 引擎切换无关**：`materializeJsEngine` 会改 `ohos/libs`，不碰
  build-profile，没有冲突。

## 5. 验证路径

```bash
# 单测：扫描器（带注释/尾逗号）、存档、写回后其它字节不变、失效三种情况、非空不覆盖
pnpm --filter @ufjs/cli run typecheck
pnpm --filter @ufjs/cli test -- ohos-signing
pnpm test

# 实机（鸿蒙模拟器 127.0.0.1:5557），在 examples/hello-fjs 下
pnpm --filter @ufjs/cli run build
cd examples/hello-fjs
# 1) 宿主配置为空、本机没有存档 → 在 flutter 之前退出，打开 DevEco
fjs run ohos --js-engine quickjs
# 2) 在 DevEco 里勾选自动签名后 → 打印 "signing saved"，起得来
fjs run ohos --js-engine quickjs
ls -l ~/.fjs/ohos-signing/
# 3) 把 signingConfigs 置空后 → 打印 "signing restored"，不打开 DevEco，起得来
fjs run ohos --js-engine quickjs
# 4) --hap 走同一套检查
fjs build --pages --release --hap
```
