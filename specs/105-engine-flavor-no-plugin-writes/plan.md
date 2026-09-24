# Plan: 引擎 flavor 由构建按配置直接选用，不再改写插件目录

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 纯宿主构建链。web 无引擎概念，JS runtime 与 `fjs-runtime/src/web/` 零改动。 |
| II 边界即契约 | 否 | 三张表不动。`FlutterFjsPlugin.m`（ios/macos 各一份）只把 flavor 来源从生成头文件换成编译宏 `FJS_ENGINE_QUICKJS`，声明的 `fjs_*` 集合不变，`native/include/fjs.h` 不动。 |
| III 同步单线程零序列化 | 否 | 不涉及运行时。 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 本 spec 核心之一：CLI 不再静默跳过 runner 失败；鸿蒙在 pub-cache 下请求非默认 flavor 明确报错；发布前校验脚本把「发出去缺二进制 / flavor 不对」变成失败。 |
| VI 注释记录权衡 | 是 | gradle / podspec / runner / check-publish 顶部写清：为何不复制（共享目录）、为何 Darwin 产物必须在 pod 根内（CocoaPods 文件模式不越出 pod 根）、为何鸿蒙仍复制（HAR 只打包 `libs/`）、flavor 优先级。 |
| VII JS 能包就不要下 Dart | 部分 | 不新增能力。`bin/engine.dart` 是既有 Dart runner（纯 Flutter 宿主要用，不能只放 CLI），职责收窄为「鸿蒙复制 + 宿主侧 pod 失效」。 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`「JS 引擎切换」一节重写；`docs/publishing.md` 发布步骤加校验；`docs/roadmap.md` 登记；`packages/flutter_fjs/NOTICE` 的产物路径。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI | `packages/fjs/src/project/engine.ts` | `materializeJsEngine`：先设 `process.env.FJS_JS_ENGINE`（后续 flutter 子进程 → pod install 读得到）；runner 缺失/失败时：默认 primjs 告警一次继续，显式非默认 flavor 抛错；删掉「committed state is primjs」的过时说法；`debugger` 选项保留但只透传 |
| CLI | `packages/fjs/src/cli.ts:208`、`packages/fjs/src/bundler/build.ts:181` | 帮助文本与 `engineDefineArgs` 注释改成真实机制 |
| CLI 测试 | `packages/fjs/test/engine.test.ts`（新增） | 注入 spawn 桩：无 dart+显式 quickjs 抛错、无 dart+默认告警不抛、runner 非零+显式抛错、env 被设置 |
| Dart runner | `packages/flutter_fjs/bin/engine.dart` | 不再写 android/ios/macos 任何文件；鸿蒙：`ohos/libs` 与目标 flavor 不一致时，path 依赖才复制，pub-cache 内报错退出；宿主侧：`<host>/.dart_tool/flutter_fjs/engine_flavor` 记录 flavor，变化时 touch 宿主 `ios|macos/Podfile` 并清宿主 build 下 `XCFrameworkIntermediates/flutter_fjs`；`--no-debugger` 接受但无操作 |
| Android | `packages/flutter_fjs/android/build.gradle` | flavor 解析（`fjs.jsEngine` 属性 → env → `dart-defines` base64 → primjs，非法值 `GradleException`）；`jniLibs.srcDirs = ["$projectDir/../abi/$flavor/android"]`；release 排除调试器规则保留 |
| Android | `packages/flutter_fjs/android/.gitignore` | 删（jniLibs 不再存在） |
| iOS/macOS | `git mv abi/<f>/ios → ios/abi/<f>`、`abi/<f>/macos → macos/abi/<f>` | Darwin 产物进 pod 根 |
| iOS/macOS | `packages/flutter_fjs/{ios,macos}/flutter_fjs.podspec` | flavor 解析（env → 宿主 `Generated.xcconfig` 的 `DART_DEFINES` → primjs，非法值 raise）；`vendored_frameworks = ["abi/<f>/fjs.xcframework"] + (primjs ? ["abi/primjs/fjs_debugger.xcframework"] : [])`；quickjs 注入 `GCC_PREPROCESSOR_DEFINITIONS FJS_ENGINE_QUICKJS=1` |
| iOS/macOS | `packages/flutter_fjs/{ios,macos}/Classes/FlutterFjsPlugin.m` | 删 `#include "fjs_engine_flavor.h"`，注释改为宏来源 |
| iOS/macOS | `packages/flutter_fjs/{ios,macos}/.gitignore` | 删（不再有生成物） |
| 鸿蒙 | `packages/flutter_fjs/ohos/.pubignore`（新增） | 复制 `.gitignore` 规则但**不含** `/libs`，让发布包带上默认 primjs 的 `ohos/libs` |
| 构建脚本 | `packages/flutter_fjs/tool/build-apple.sh` | 输出改到 `ios|macos/abi/<f>/`，删默认物化步骤，符号链接检查改扫新目录 |
| 构建脚本 | `packages/flutter_fjs/tool/build-android.sh` | 删 jniLibs 默认物化 |
| 构建脚本 | `packages/flutter_fjs/tool/build-ohos.sh` | 保留默认 primjs 复制到 `ohos/libs`（鸿蒙仍消费该目录），注释更新 |
| 发布校验 | `packages/flutter_fjs/tool/check-publish.mjs`（新增） | 检查两 flavor × Android/iOS/macOS 产物齐全、`ohos/libs` 与 `abi/primjs/ohos` 逐字节一致（含调试器）、`abi/quickjs/ohos` 存在、各忽略文件不排除这些路径 |
| 包配置 | `packages/flutter_fjs/.gitignore`、`pubspec.yaml` 注释、`NOTICE` | 去掉 `.materialized`；runner 描述；产物路径 |
| 文档 | `docs/toolchain.md`、`docs/publishing.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

**原则**：插件目录在 Android / iOS / macOS 上只读；flavor 是构建输入，由构建系统按配置直接引用 `abi/` 里对应的那份。

- **Android**：Gradle 不限制源目录位置，`jniLibs.srcDirs` 直接指到 `../abi/<flavor>/android`。Flutter 把 `--dart-define` 以 `-Pdart-defines=<逗号分隔 base64>` 传给 gradle，插件子项目可直接读，所以纯 `flutter run --dart-define=FJS_JS_ENGINE=quickjs` 也生效——兑现 091 原本的承诺。
- **iOS/macOS**：CocoaPods 的文件模式只在 pod 根（`ios/`、`macos/`）内匹配，`../abi` 匹配不到任何东西，因此产物搬进 pod 根（`abi/<flavor>/ios` 与 `/macos` 本就各一份，搬家不增体积）。podspec 在 pod install 时求值：先读 env（CLI 设置），再读宿主 `Flutter/Generated.xcconfig`（iOS）或 `Flutter/ephemeral/Flutter-Generated.xcconfig`（macOS）的 `DART_DEFINES`。不同 flavor 路径不同，Xcode 的 xcframework 抽取缓存按路径失效；runner 仍在 flavor 变化时清一次宿主缓存兜底。
- **调试器**：Android 的 release 排除规则、Darwin 的「`#if DEBUG` 才引用 → release 零字节」、鸿蒙的 `buildModeBinder` 早已在构建层保证 release 不含调试器，runner 删文件是多余的一层，去掉。
- **鸿蒙**：HAR 只打包模块 `libs/`，没有可验证的换目录配置，保留复制；但复制只在 path 依赖下做，并先比对内容（一致即 no-op），pub-cache 下请求非默认 flavor 直接报错并说明改用 path 依赖。

**被否掉的备选**：
- 物化进宿主 `build/`，插件经绝对路径引用：CocoaPods 不接受 pod 根外路径，Android 可行但两套机制不统一。
- podspec 里 `../abi/...`：匹配不到文件（见上）。
- 保留复制、只加文件锁：并发问题缓解了，但跨项目串味、pub-cache 被改写、发布依赖磁盘状态都还在（用户已否，选全平台修）。
- 同时链入两套引擎运行时切换：091 已否（包体翻倍、ABI 拆两套）。

## 4. 风险

- **本环境无法构建任何平台**：Android 只能验证 gradle 的 flavor 解析脚本逻辑，Darwin 只能用 Ruby 桩验证 podspec 求值，runner 无 Dart 无法运行。真机验证项列在 spec §6 的 6–10，需用户执行。
- Flutter 是否在 pod install 前写好 `Generated.xcconfig` 的 `DART_DEFINES`：不确定，所以 CLI 同时设 env；纯 Flutter 宿主改 flavor 后若未重新 pod install，运行期 engine id 告警会提示。
- pub 对子目录 `.gitignore` 的处理：plan 按「子目录 `.gitignore` 生效」处理（新增 `ohos/.pubignore`、删 ios/macos/android 的 `.gitignore`），最终以 `dart pub publish --dry-run` 为准（spec §6.10）。
- 已存在的旧物化文件（`android/src/main/jniLibs`、`ios/fjs.xcframework`、`Classes/fjs_engine_flavor.h`）留在开发者磁盘上：gradle 不再读 jniLibs，但 podspec 的 `Classes/**/*` 会把旧头文件编进去——无害（不再被 include），发布校验会提示清理。

## 5. 验证路径

```bash
pnpm --filter @ufjs/cli exec vitest run test/engine.test.ts
pnpm --filter @ufjs/cli test && pnpm --filter @ufjs/cli run typecheck
gradle -q -b <scratch>/flavor.gradle ...        # flavor 解析四种来源 + 非法值
ruby <scratch>/podspec_check.rb                  # 桩 Pod::Spec 加载两个 podspec
node packages/flutter_fjs/tool/check-publish.mjs # 当前通过；删一个产物后失败
git grep -n "jniLibs\|fjs_engine_flavor\|\.materialized" packages/flutter_fjs
# 用户本机：dart run flutter_fjs:engine quickjs；fjs run android|ios|macos|ohos（两种 flavor）；dart pub publish --dry-run
```
