# Plan: Android release/profile 构建剔除 libfjs_debugger.so

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 只改 Android 打包配置和产物目录布局；渲染、Web 都不动。iOS / ohos 只核实（有问题再并入修） |
| II 边界即契约 | 否 | op 协议、natives 表、事件类型都不动；`libfjs_debugger.so` 的文件名与 Dart 侧 `DynamicLibrary.open('libfjs_debugger.so')` 不变 |
| III 同步单线程零序列化 | 否 | 与运行时无关 |
| IV 外观照 WeUI | 否 | 无 UI |
| V 静默失效是 bug | **是** | 核心：①改成靠构建类型源集，不再依赖 AGP 会忽略的过滤规则；②新增构建后检查脚本，对 debug / profile / release 三个变体断言调试器有无，规则再失效会直接报错；③`check-publish.mjs` 同步新布局，文件放错目录发布前就拦下 |
| VI 注释记录权衡 | 是 | `android/build.gradle` 顶部注释写明：为什么不用 `jniLibs.excludes`（AGP 忽略源集过滤，spec 115 实测）、为什么不看任务名、为什么调试器单独一个目录 |
| VII JS 能包就不要下 Dart | 否 | 纯 gradle 与构建脚本 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`「产物分层」表 Android 一行、`docs/debugger.md`、`docs/publishing.md` 的 pub 产物表、`CHANGELOG.md`、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Android 打包 | `packages/flutter_fjs/android/build.gradle` | `main.jniLibs` 只指向引擎目录；调试器目录只加到 `debug` 源集（`fjsKeepDebugger=true` 时加到 `main`）；删掉 `fjsIsNonDebugBuild` 任务名判断和 `jniLibs.excludes` |
| 预编译产物 | `packages/flutter_fjs/abi/primjs/android/<abi>/libfjs_debugger.so` → `abi/primjs/android-debugger/<abi>/libfjs_debugger.so` | `git mv`，字节不变（3 个文件） |
| 构建脚本 | `packages/flutter_fjs/tool/build-android.sh` | 调试器输出到 `android-debugger/<abi>/`；清理与汇总输出同步 |
| 发布检查 | `packages/flutter_fjs/tool/check-publish.mjs` | primjs 要求 `android-debugger/<abi>/libfjs_debugger.so`、禁止旧位置；quickjs 两处都禁止 |
| 回归检查 | `packages/flutter_fjs/tool/test/android_debugger_strip_check.mjs`（新增） | 在指定宿主的 `android/` 下跑 `:flutter_fjs:merge{Debug,Profile,Release}JniLibFolders`，断言 debug 有、profile / release 没有，引擎三者都有 |
| Dart / C++ / JS | — | 不动 |
| 文档 | 见 VIII | |

## 3. 方案

### 3.1 源集按构建类型划分

```groovy
def fjsEngineLibs   = "../abi/${fjsJsEngine}/android"            // <abi>/libfjs.so
def fjsDebuggerLibs = "../abi/${fjsJsEngine}/android-debugger"   // <abi>/libfjs_debugger.so, primjs only

sourceSets {
    main  { jniLibs.srcDirs = [fjsEngineLibs] + (fjsKeepDebugger ? debuggerDirs : []) }
    debug { if (!fjsKeepDebugger) jniLibs.srcDirs += debuggerDirs }
}
```

`debuggerDirs` 只在目录存在时非空（quickjs 没有调试器）。app 的 debug 变体消费插件的
debug 变体，release / profile 消费各自同名的变体——Flutter 的 `PluginHandler` 会把宿主的
构建类型（包括 `profile`）补进插件项目，所以插件确实有 `profile` 构建类型，`debug`
源集不会被它吃到。`fjsKeepDebugger` 时只放 `main`、不再放 `debug`，避免 debug 变体里
出现两份同名文件。

### 3.2 为什么挪目录而不是复制

两个源集不能指向同一个 `<abi>/` 目录（引擎会被合并两次），必须有一个只含调试器的目录。
直接改 `abi/` 布局最简单：没有构建期复制任务，不往插件目录写任何东西（pub-cache 只读的
约束不变），gradle 配置是纯声明式的。代价是 `build-android.sh`、`check-publish.mjs`
跟着改路径；spec 116 本来也要重建全部产物。

### 3.3 被否掉的备选

| 备选 | 否掉的原因 |
|------|-----------|
| 修过滤规则写法（`jniLibs.exclude` / `filter.exclude`） | AGP 8 合并 jniLibs 时不看源集过滤，换写法同样无效（spec 115 实测） |
| 插件里配 `packagingOptions.jniLibs.excludes` | 库模块的 packaging 选项不作用于消费它的 App |
| `androidComponents.onVariants` 里改库变体的打包 | 同上，库变体的 packaging 只影响 AAR 测试 APK；且 API 随 AGP 版本漂移 |
| 构建期 Sync 任务把 .so 复制到 build 目录再按变体挂载 | 能行，但要处理任务依赖和增量，复杂度高于直接改布局 |
| 恢复 CLI 在构建前删插件目录里的文件 | spec 105 撤掉它的理由（改写共享 pub-cache、纯 Flutter 宿主不经 CLI）仍然成立 |
| 继续按 gradle 任务名判断 debug / release | 一次调用构建多个变体时判断不了；按构建类型划分源集天然正确 |

## 3.4 追加：ohos 也漏了（实现中发现，按待澄清 2 并入）

核实 T022 时发现 hello-fjs 的 release HAP 带着 `libfjs_debugger.so`（433 KB）。原因：
fork 的 flutter 工具把插件作为 **`file:` 源码依赖**交给 ohpm（`oh_modules/.ohpm/lock.json5`
里是 `"flutter_fjs": "file:…/flutter_fjs/ohos"`），不走 `assembleHar -p buildMode=…`，
所以插件自己 `ohos/build-profile.json5` 里的 `buildModeBinder` 不被采用——它的注释
「fork 用 buildMode 组装插件 HAR」在这条路径上不成立。

真正打包 HAP 的是**宿主的 `entry` 模块**，它的 `nativeLib.filter` 作用于所有合并进来的
.so。实测：在 `entry/build-profile.json5` 加 `buildOptionSet`（`fjs_no_debugger`，排除
`**/libfjs_debugger.so`）+ `buildModeBinder`（release → 它），release HAP 只剩
`libfjs.so`，debug HAP 仍带调试器。

落点：

| 文件 | 改什么 |
|---|---|
| `packages/fjs/src/commands/run.ts` | 新增 `patchOhosEntryDebuggerFilter(dir)`，在托管宿主的 `ensureFlutterHost` 里调用（与 `patchAndroidAbiFilters` 同一处）：`entry/build-profile.json5` 没有 `buildOptionSet` / `buildModeBinder` 时插入 release、profile 两条绑定；已有这两个键但没有 `fjs_no_debugger` 时不改文件、打印一次警告并给出片段（宪法 V）；已打过补丁则不动 |
| `packages/fjs/test/run.test.ts` | 补丁函数的单测：flutter create 生成的原样文件、已打补丁（幂等）、用户自带 buildModeBinder（只警告） |
| `examples/fjs-go/ohos/entry/build-profile.json5` | 提交的纯 Flutter 宿主，直接写上同样的配置 |
| `packages/flutter_fjs/ohos/build-profile.json5` | 保留插件侧的 binder（fork 走 HAR 组装时仍有效），注释改正：不能单靠它，宿主 entry 才是决定因素 |
| 文档 | `docs/toolchain.md` 表格 ohos 一行、`docs/debugger.md`：写明宿主 entry 的配置，纯 Flutter 宿主要自己加 |

被否掉：让 CLI 在构建前按模式增删插件目录里的文件（spec 105 否掉的做法）；只改插件
`build-profile.json5`（源码依赖路径下不生效，已实测）。

## 4. 风险

- **pub 用户升级到 0.1.7 后**：gradle 配置和 `abi/` 布局在同一个包里一起变，不存在新旧错配。
- **自定义构建类型的宿主**（例如 `staging`）：只有 `debug` 带调试器，其它构建类型都不带。这符合「非 debug 不带」的语义，文档写明；要带就用 `fjsKeepDebugger`。
- **iOS**：已核实 Release 二进制只含引擎侧的空钩子与接线（spec 090 设计），无 `fjs_vm_debugger_attach`、无 CDP 字符串。
- **ohos 已 eject 的宿主 / 纯 Flutter 宿主**：CLI 不改它们的 entry，文档给出配置片段；fjs-go 直接提交配置。

## 5. 验证路径

```bash
cd packages/flutter_fjs && node tool/check-publish.mjs
node tool/test/android_debugger_strip_check.mjs ../../examples/hello-fjs/.fjs/flutter/android
cd ../../examples/hello-fjs/.fjs/flutter
flutter build apk --debug   && unzip -l build/app/outputs/flutter-apk/app-debug.apk   | grep libfjs
flutter build apk --profile && unzip -l build/app/outputs/flutter-apk/app-profile.apk | grep libfjs
flutter build apk --release && unzip -l build/app/outputs/flutter-apk/app-release.apk | grep libfjs
flutter build apk --release -PfjsKeepDebugger=true …
flutter build appbundle --release && unzip -l build/app/outputs/bundle/release/app-release.aab | grep libfjs
cd android && ./gradlew assembleDebug assembleRelease   # 同一次调用两个变体
# 模拟器：release 包启动 + 截图；debug 下 fjs debug 附加
# iOS：flutter build ios --release --no-codesign，查 flutter_fjs 二进制符号
# ohos：release HAP 里查 libfjs_debugger.so
```
