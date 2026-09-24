# Spec: Android release/profile 构建剔除 libfjs_debugger.so

- **ID**: 115-android-release-drop-debugger
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

`flutter_fjs` 0.1.6（pub.dev）的 Android release APK 带着调试器模块：

```
$ unzip -l app-release.apk | grep libfjs      # fjs run android --release，pub.dev 的 flutter_fjs 0.1.6
  1936144  lib/arm64-v8a/libfjs.so
   494976  lib/arm64-v8a/libfjs_debugger.so     ← 不该有
```

三个 ABI 各带一份，一个通用 APK 大约多 1.3 MB（arm64 495 KB、armeabi-v7a 315 KB、
x86_64 509 KB）。Dart 侧只在 debug 构建里加载它（`lib/src/ffi.dart`），所以 release
下没有可连接的 CDP 入口，问题在于**包体**，以及文档承诺的「release 物理上没有调试器」
（`docs/toolchain.md`「产物分层」、`docs/debugger.md`）没有兑现。

**来龙去脉**：

- spec 091 四轮时，由 CLI 的 runner 在构建前把插件目录里的 `libfjs_debugger.so`
  直接删掉；`android/build.gradle` 的 `jniLibs.excludes` 只是兜底。
- spec 105 撤掉了「改写插件目录」（它会改写共享的 pub-cache），剔除完全交给构建层，
  Android 只剩 `android/build.gradle` 里这一条：

  ```groovy
  sourceSets { main {
      jniLibs.srcDirs = [fjsEngineLibs]
      if (fjsIsNonDebugBuild && !fjsKeepDebugger) {
          jniLibs.excludes += ['**/libfjs_debugger.so']
      }
  } }
  ```
- **实测（2026-09-24，AGP 8.11.1）**：在 hello-fjs 宿主（path 依赖本地 flutter_fjs）
  跑 `./gradlew :flutter_fjs:mergeReleaseJniLibFolders --rerun-tasks`，配置阶段
  `fjsIsNonDebugBuild` 为 `true`，但 `merged_jni_libs/release` 里三个 ABI 都有
  `libfjs_debugger.so`。也就是说，**AGP 忽略了 jniLibs 源集上的过滤规则**，这条
  兜底从来没真正起作用，只是之前被 runner 删文件掩盖了。

这是 0.1.6 的回归，构建阶段不报任何错（违反宪法 V）。

## 2. 不做什么（Non-goals）

- 不改 debug 构建：debug APK 仍然带 `libfjs_debugger.so`，`fjs debug` 照常可用。
- 不恢复「改写插件目录」的做法（spec 105 撤掉它的理由仍然成立）。
- 不改预编译产物本身（`abi/` 下的 .so 不动），也不缩减 `libfjs.so` 体积——那是
  另一个 spec（导出符号收窄）。
- 不改 Dart 侧加载逻辑（`lib/src/ffi.dart` 在 release 下本来就不加载它）。
- 不处理「纯 Flutter 宿主手动改 jniLibs」之类的自定义配置。

## 3. 用户可见的行为

| 构建 | `libfjs.so` | `libfjs_debugger.so` |
|---|---|---|
| `flutter run` / `fjs run android`（debug） | 有 | 有 |
| `flutter run --release`、`flutter build apk/appbundle`、`fjs run android --release`、`fjs build --apk/--aab` | 有 | **没有** |
| `--profile` | 有 | **没有** |
| 任一非 debug 构建 + `-PfjsKeepDebugger=true`（或宿主 `gradle.properties` 里 `fjsKeepDebugger=true`） | 有 | 有 |

判定依据是**构建变体**（debug / release / profile），而不是 gradle 命令行里的任务名；
同一次 gradle 调用里同时构建 debug 和 release 变体时，各自得到正确的结果。

## 4. 两端约定（宪法 I）

只涉及 Android 的打包配置，不涉及 Flutter 渲染与 Web 端。其它平台的对应机制本 spec
先核实；核实发现同类问题就并入本 spec 一起修（待澄清 2）：

| 平台 | 非 debug 剔除机制（现状） | 本 spec |
|---|---|---|
| Android | `jniLibs.excludes`（**不生效**） | 修 |
| iOS / macOS | 静态归档，只有 `#if DEBUG` 引用 debugger | 核实 Release 二进制里没有 debugger 符号 |
| ohos | `build-profile.json5` 的 `buildModeBinder` + `nativeLib.filter.excludes` | 核实 release HAP 里没有 `libfjs_debugger.so` |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. hello-fjs（path 依赖）：`flutter build apk --release` 的 APK 里三个 ABI 都**没有**
   `libfjs_debugger.so`，`libfjs.so` 都在（`unzip -l … | grep libfjs`）。
2. 同一宿主：`flutter build apk --debug` 的 APK 三个 ABI 都**有** `libfjs_debugger.so`。
3. `flutter build apk --profile` 没有；`flutter build apk --release -PfjsKeepDebugger=true`
   有。
4. `flutter build appbundle --release` 的 AAB 里没有。
5. 同一次 gradle 调用构建两个变体（`./gradlew assembleDebug assembleRelease`）：
   debug 产物有、release 产物没有。
6. release APK 装到模拟器上能正常启动并渲染（引擎加载不受影响）；debug 构建下
   `fjs debug` 仍能附加（调试器模块可加载）。
7. 构建层回归检查：新增一条可重复执行的检查（脚本或测试），在构建之后断言 release
   产物里没有 debugger、debug 产物里有，防止这条规则再次悄悄失效。
8. 核实：iOS Release（`flutter build ios --release --no-codesign`）的
   `flutter_fjs` 二进制里没有 debugger 符号；ohos release HAP 里没有
   `libfjs_debugger.so`。结果写进 tasks.md；不满足就在本 spec 里修到满足。
9. 文档：`docs/toolchain.md`「产物分层」表格的 Android 一行、`docs/debugger.md`、
   `android/build.gradle` 顶部注释与实际机制一致；`CHANGELOG.md` 记一条修复。

## 7. 待澄清

已拍板（2026-09-24）：

- [x] **1. 发布节奏**：不单独发版，和 spec 116（收窄导出符号）一起作为 0.1.7 发布。
- [x] **2. 其它平台**：如果验收 8 发现 iOS 或 ohos 也把 debugger 打进了 release，并入本 spec 一起修、一起验收。
