# Spec: 引擎 flavor 由构建按配置直接选用，不再改写插件目录

- **ID**: 105-engine-flavor-no-plugin-writes
- **状态**: done（本机验证项 6–10 待用户执行）
- **日期**: 2026-09-24
- **来源**: 近 3 天代码 review 第二条（specs/091 的物化方案）。范围由用户定为「一次全平台改完」。

## 1. 要解决什么

specs/091 让 `bin/engine.dart`（`dart run flutter_fjs:engine <flavor>`）把选中的
flavor 从 `abi/` **复制进 flutter_fjs 包自己的目录**（`android/src/main/jniLibs`、
`ios|macos/fjs.xcframework`、`ios|macos/Classes/fjs_engine_flavor.h`、`ohos/libs`），
非 debug 构建还会删掉调试器产物。由此带来：

1. **改写全局共享目录**。`fjs create` 生成的宿主依赖 pub.dev 的
   `flutter_fjs: ^0.1.4`（`packages/fjs/src/commands/module.ts:353`），包在
   `~/.pub-cache` 里：
   - 两个项目选不同 flavor 会互相覆盖；
   - A 项目 `fjs build`（删调试器）时 B 项目的 debug 构建丢调试器；
   - 复制不是原子的，并发构建可能链接到半新半旧的文件；
   - `pub cache repair` 或只读 CI 缓存下直接失效。
2. **发布产物取决于本机磁盘状态**。平台目录不入库，`pub publish` 从磁盘收集，
   最后一次物化是什么 flavor、带不带调试器，发出去的就是什么。另外
   `android/.gitignore`（`jniLibs`）、`ios|macos/.gitignore`（`*.xcframework`）、
   `ohos/.gitignore`（`/libs`）在发布时仍然生效（根 `.pubignore` 只替代同目录的
   `.gitignore`），发布包很可能根本不含平台二进制。
3. **CLI 静默跳过失败**。`packages/fjs/src/project/engine.ts` 在没有 `dart`、
   或默认 flavor 物化失败时直接 return，注释写的是「committed state is primjs」，
   但 bba1c17 之后平台目录已不入库——全新 clone 会带着空 jniLibs 继续构建。
4. **文档与代码不符**。`bin/engine.dart`、`build.ts` 的注释和 `docs/toolchain.md`
   说 gradle / podspec / hvigor 有「按 `--dart-define=FJS_JS_ENGINE` 在构建时复制」
   的钩子，实际三个文件里都没有；纯 Flutter 宿主传 dart-define 只会得到运行期告警
   （`lib/src/engine.dart:107`），引擎并不会切换。

## 2. 不做什么（Non-goals）

- 不做同进程双引擎、不改引擎本身、不改字节码与 engine id 机制（沿用 091）。
- 不改 `fjs_*` C ABI、op 协议、natives 表、事件类型。
- 不改调试器在 release 里「物理不存在」的保证，只换实现方式（见 §3）。
- 不改 JS runtime 与 web 端任何行为。
- **鸿蒙的非默认 flavor 不做「零复制」**：HAR 只从模块的 `libs/` 打包 .so，
  本环境也无 DevEco 可验证其它配置；鸿蒙 quickjs 仍复制进 `ohos/libs`，但只允许
  path 依赖（monorepo），在 pub-cache 里明确报错（见 §3）。
- 不重新发布 pub 包（发布是用户的操作），只提供发布前校验。

## 3. 用户可见的行为

命令与 flag 不变：

```bash
fjs run android --js-engine quickjs
fjs build --js-engine quickjs --release --apk
FJS_JS_ENGINE=quickjs fjs run ios
flutter run --dart-define=FJS_JS_ENGINE=quickjs      # 纯 Flutter 宿主
```

改变的是背后的机制——**插件目录只读**：

| 平台 | flavor 从哪来（优先级从高到低） | 怎么选用 | 写插件目录？ |
|---|---|---|---|
| Android | gradle 属性 `fjs.jsEngine` → 环境变量 `FJS_JS_ENGINE` → Flutter 传给 gradle 的 `dart-defines` 里的 `FJS_JS_ENGINE` → `primjs` | `jniLibs.srcDirs` 直接指向 `abi/<flavor>/android`；release/profile 仍按现有规则排除 `libfjs_debugger.so` | 否 |
| iOS / macOS | 环境变量 `FJS_JS_ENGINE` → 宿主 `Generated.xcconfig` 的 `DART_DEFINES` → `primjs`（pod install 时求值） | 产物搬到 `ios|macos/abi/<flavor>/`，podspec 的 `vendored_frameworks` 按 flavor 选；flavor 宏改由 `pod_target_xcconfig` 注入，删掉生成的 `fjs_engine_flavor.h`；release 里调试器仍靠链接器不引用而为零字节 | 否 |
| 鸿蒙 | 同 CLI / runner 参数 | 默认 primjs 放在 `ohos/libs`（发布包自带）；非默认 flavor 由 runner 复制，**仅限 path 依赖**，否则报错说明原因 | 仅 path 依赖 + quickjs |

- flavor 变化时 iOS 需要重新 `pod install`：CLI / runner 在**宿主**记录上次的 flavor，
  变了就 touch 宿主 `ios|macos/Podfile` 并清宿主 build 下的 Xcode xcframework 缓存
  （只写宿主，不写插件）。纯 Flutter 宿主改 dart-define 后需自己 `pod install`，
  运行期 engine id 不一致告警保留作兜底。
- CLI：`--no-debugger` 不再删除任何文件（Android gradle 排除、Darwin 链接器、鸿蒙
  `buildModeBinder` 已在构建层保证 release 不含调试器），保留该参数以兼容。
- CLI：runner 找不到（无 `dart`）或失败时**不再静默**：默认 flavor 在 Android/Darwin
  上无需 runner，打一行告警继续；显式非默认 flavor 或鸿蒙需要复制时报错退出。
- 新增发布前校验：`node packages/flutter_fjs/tool/check-publish.mjs`，确认各平台
  两个 flavor 的产物齐全、`ohos/libs` 与 `abi/primjs/ohos` 一致（含调试器）、
  忽略规则不会把它们排除出发布包。

## 4. 两端约定（宪法 I）

不涉及。本 spec 只动 Flutter 宿主的构建链与 CLI，没有页面可见能力；web 端没有引擎概念。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

`FlutterFjsPlugin.m` 里的 flavor 判断从 `#include "fjs_engine_flavor.h"` 改为编译宏
`FJS_ENGINE_QUICKJS`（由 podspec 注入），声明的 ABI 集合不变。

## 6. 验收标准

本环境有 Node、Ruby、Gradle、Java，**没有 Flutter / Dart / Xcode / CocoaPods / DevEco**。
能在这里验证的：

1. `pnpm --filter @ufjs/cli test` 与 `pnpm --filter @ufjs/cli run typecheck` 通过；
   新增单测覆盖 CLI 不再静默跳过（无 `dart` + 显式 quickjs → 抛错；无 `dart` +
   默认 primjs → 告警一次、不抛）。
2. Android flavor 解析逻辑：用 Gradle 跑一个只含该逻辑的脚本，覆盖
   `-Pfjs.jsEngine`、环境变量、`dart-defines`（base64）、默认四种来源，以及非法值报错。
3. podspec：用 Ruby 加载两个 podspec（桩 `Pod::Spec`），覆盖环境变量、
   `Generated.xcconfig` 的 `DART_DEFINES`、默认三种来源，断言
   `vendored_frameworks` 路径存在于磁盘、quickjs 注入 `FJS_ENGINE_QUICKJS=1`。
4. `node packages/flutter_fjs/tool/check-publish.mjs --fix` 在仓库当前状态下通过
   （`ohos/libs` 不入库，`--fix` 从 `abi/primjs/ohos` 补齐）；各种发布事故下失败并指出原因。
5. `git grep` 确认插件目录内不再有写 `jniLibs` / `fjs.xcframework` / `fjs_engine_flavor.h`
   的代码，文档里不再描述不存在的构建钩子。

**需要用户本机验证**（本环境做不到，完成后在 spec 尾部记录结果）：

6. `bin/engine.dart` 能跑通（`dart run flutter_fjs:engine quickjs` 在 fjs-go 下）。
7. `fjs run android` 与 `fjs run android --js-engine quickjs` 都能启动，engine id 对应。
8. `fjs run ios` / macOS 同上，切换 flavor 后无需手动清缓存。
9. `fjs run ohos`（默认）能启动；path 依赖下 `--js-engine quickjs` 能启动。
10. `dart pub publish --dry-run` 清单含两 flavor 的 Android / Darwin 产物与 `ohos/libs`。

## 7. 待澄清

- [x] 修复范围 → 用户定为「一次全平台改完」（2026-09-24）。
- [x] 鸿蒙无法零复制 → 按 §2 处理（path 依赖可切、pub-cache 报错），不另问。

## 8. 验收记录（2026-09-24）

1. `pnpm --filter @ufjs/cli test`：343 通过（新增 `test/engine.test.ts` 4 项）；
   typecheck 通过。`pnpm test` 全绿。
2. `packages/flutter_fjs/tool/test/gradle_flavor_check.sh`（真实 Gradle 跑
   `build.gradle` 原文里的解析段）：7/7——默认、dart-defines、env、env 优先于
   dart-defines、`-Pfjs.jsEngine` 优先于 env、dart-defines 不含引擎、非法值报错。
3. `ruby packages/flutter_fjs/tool/test/podspec_check.rb`（桩 `Pod::Spec` 加载两个
   podspec）：12/12——ios/macos 各 6 项，含 vendored 路径真实存在、quickjs 宏注入。
4. `packages/flutter_fjs/tool/test/check_publish_test.sh`：9/9——完整通过；缺 quickjs
   xcframework、ohos libs 缺调试器、ohos libs 混入 quickjs、忽略规则排除 abi、
   091 时期的 `ios/.gitignore`、无 `.pubignore` 的 `ohos/.gitignore`、残留 jniLibs、
   quickjs 带调试器，均失败并指明原因。
5. `git grep` 无残留的 jniLibs / `fjs_engine_flavor.h` / `.materialized` 写入代码；
   文档已改为真实机制。

**待用户本机验证**：§6 的 6–10（本环境无 Flutter / Dart / Xcode / CocoaPods / DevEco）。
`bin/engine.dart` 未经编译运行，是本次风险最高的一处。
