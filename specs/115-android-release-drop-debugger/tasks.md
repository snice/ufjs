# Tasks: Android release/profile 构建剔除 libfjs_debugger.so

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 不涉及契约层：op 协议、natives 表、事件类型，以及 Dart 侧加载的文件名 `libfjs_debugger.so` 都不变（spec §5）。确认后直接勾掉

## 实现

- [x] T010 `git mv abi/primjs/android/<abi>/libfjs_debugger.so abi/primjs/android-debugger/<abi>/`，3 个 ABI，字节不变
- [x] T011 `android/build.gradle`：`main.jniLibs` 只指向引擎目录；调试器目录只加到 `debug` 源集，`fjsKeepDebugger=true` 时改加到 `main`；删掉 `fjsIsNonDebugBuild` 和 `jniLibs.excludes`；顶部注释写明权衡（宪法 VI）
- [x] T012 `tool/build-android.sh`：调试器输出到 `abi/<flavor>/android-debugger/<abi>/`，清理、strip、汇总输出同步
- [x] T013 `tool/check-publish.mjs`：primjs 要求新位置、禁止旧位置；quickjs 两处都禁止

## 两端对齐

- [x] T020 不涉及 Web 侧（plan §1 的 I），确认后直接勾掉
- [x] T021 核实 iOS：`flutter build ios --release --no-codesign` 后，`flutter_fjs` 二进制里没有 `fjs_vm_debugger_*` 等调试器符号；有问题就在本 spec 里修
  - 2026-09-24：hello-fjs Release 的 `flutter_fjs.framework`（1.07 MB）只有引擎侧的 `QJSSetInspectorHooks`、`fjs_debugger_set_transport` 等空钩子 / 接线（spec 090 设计上留在引擎里），没有 `fjs_vm_debugger_attach`，CDP 协议字符串 0 处。**通过，无需修改**
- [x] T022 核实 ohos：release HAP 里没有 `libfjs_debugger.so`；有问题就在本 spec 里修
  - 2026-09-24：**不通过**，hello-fjs release HAP 带 `libfjs_debugger.so`（433 KB）。插件以 `file:` 源码依赖接入，插件侧 `buildModeBinder` 不生效；改在宿主 entry 模块过滤（plan §3.4），实测 release 去掉、debug 保留
- [x] T023 `run.ts`：新增 `patchOhosEntryDebuggerFilter`，托管宿主在 `ensureFlutterHost` 里调用；已有自定义 binder 时只警告
- [x] T024 `examples/fjs-go/ohos/entry/build-profile.json5` 写上同样的配置；`packages/flutter_fjs/ohos/build-profile.json5` 注释改正

## 测试

- [x] T030 新增 `tool/test/android_debugger_strip_check.mjs <宿主 android 目录>`：跑 `:flutter_fjs:merge{Debug,Profile,Release}JniLibFolders`，断言三个变体都有 `libfjs.so`，只有 debug 有 `libfjs_debugger.so`；加 `--keep` 时断言三个都有
- [x] T033 `run.test.ts`：`patchOhosEntryDebuggerFilter` 单测（原样文件、幂等、自定义 binder 只警告）
- [x] T034 hello-fjs 实测 HAP：release、profile 没有；debug 有（宿主由新 CLI 重新打补丁）
- [x] T031 hello-fjs 实测 APK：debug 有；profile、release 没有；release + `-PfjsKeepDebugger=true` 有；release AAB 没有；`./gradlew assembleDebug assembleRelease` 一次调用两个变体结果各自正确
- [x] T032 模拟器：release APK 能正常启动并渲染；debug 构建下 `fjs debug` 能附加

## 文档

- [x] T040 `docs/toolchain.md`「产物分层」表 Android、ohos 两行，`docs/debugger.md`：Android 按构建类型源集剔除，ohos 由宿主 entry 过滤（附纯 Flutter 宿主的配置片段）
- [x] T041 `docs/publishing.md` 的 pub 产物表：写上 `abi/primjs/android-debugger/<abi>/`
- [x] T042 `packages/flutter_fjs/CHANGELOG.md` 新增 0.1.7 一节（未发布），记这条修复；`docs/roadmap.md` 加一条

## 验收

- [x] T050 `pnpm run typecheck`、`pnpm test`、`flutter analyze`、`flutter test`（先编好 native）
- [x] T051 `node tool/check-publish.mjs` 与 `dart pub publish --dry-run` 通过
- [x] T052 逐条核对 spec.md 第 6 节
  - 2026-09-24，hello-fjs 宿主（path 依赖），Pixel 9 Pro 模拟器（arm64）与鸿蒙模拟器：
    - 1–4：APK debug 三个 ABI 都带 `libfjs_debugger.so`；profile、release 都不带；release + `-PfjsKeepDebugger=true` 带；release AAB 不带；`libfjs.so` 各处都在
    - 5：`./gradlew assembleDebug assembleRelease` 一次调用，debug 带、release 不带
    - 6：release APK 在模拟器上正常启动渲染（截图为「内置组件」首页）；debug 构建 `fjs debug` 附加成功，经 CDP `Runtime.evaluate('6*7')` 在 App 的 VM 里得到 42
    - 7：`android_debugger_strip_check.mjs` 正常配置通过、`--keep` 通过；故意把调试器挂回 `main` 时失败并列出 profile / release 的多余文件
    - 8：iOS Release 通过（无需修改）；ohos 不通过 → 并入修复后，新 CLI 自动给宿主 entry 打补丁，release / profile HAP 不带、debug HAP 带
    - 9：文档与 CHANGELOG 已更新
  - 验收命令：`pnpm run typecheck` 通过；`pnpm test` 全部通过（cli 378，含新增 5 条）；`flutter analyze lib` 无问题；`flutter test` 482 通过；`check-publish` 通过；`pub publish --dry-run` 仅剩「有未提交改动」一条 warning
