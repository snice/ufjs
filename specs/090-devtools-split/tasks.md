# Tasks: DevTools 分层

对应 plan：`./plan.md`。

T010–T012、T020 是初版（运行时数据平面）已完成的部分，保留勾选；
T013 / T021 / T023 因 spec §2.1 修订被重新打开，原实现只拆了传输。

## 契约层

- [x] T001 spec/plan 本体；确认零协议增量
- [x] T002 修订 spec/plan：inspector 真拆出引擎（实测耦合宽度 6 符号 / 10 调用点）

## 实现 · JS 运行时（初版已完成）

- [x] T010 `fjs-runtime/src/devtools-hooks.ts` 槽位模块（新）
- [x] T011 `devtools.ts` 重构为 boot 安装式；三处调用点改槽位可选调用
- [x] T012 `index.ts` define 门控 boot（`bootIfEnabled`）；`build.ts` fjsDefines + `--devtools`
- [x] T013 `bootIfEnabled` 用 `typeof` 兜底：没有 define 的消费者（普通 vitest
      import `@ufjs/runtime`）不再在 import 期抛错，define=false 仍然 DCE

## 实现 · 原生真分离

- [x] T030 vendored：`inspector_hooks.h/.cc` 钩子表（6 项）+ GC 写屏障锚点
- [x] T031 vendored：`quickjs.cc`（8）/ `quickjs_gc.cc`（2）调用点改走钩子表
- [x] T032 vendored：`base_export.h` 在 `FJS_EXPORT_ENGINE_INTERNALS` 下放开 `QJS_HIDE`
- [x] T033 vendored：`primjs/CMakeLists.txt` inspector 拆出 `quickjs_inspector` OBJECT target
- [x] T034 `native/CMakeLists.txt` 产物重划：libfjs 无 inspector、
      libfjs_debugger = inspector + 传输、fjs_core 不再编进传输
- [x] T035 `debugger-plugin.cpp`：attach 装钩子 / detach / VM 销毁清钩子；清掉遗留 fprintf
- [x] T036 `tools/debugger-module.h` dlopen 加载器；`fjsrun` / `fjs-test` 改用
- [x] T037 `lib/src/ffi.dart`：引擎与模块分开加载，attach/detach 只在模块句柄上查

## 实现 · 打包

- [x] T040 `tool/build-apple.sh` 出 `fjs.xcframework` + `fjs_debugger.xcframework`
- [x] T041 两个 podspec vendored 两个 xcframework；`FlutterFjsPlugin.m` 的
      `#if DEBUG` keep-alive 表决定 Release 是否链入
- [x] T042 `tool/build-android.sh` / `android/build.gradle` 复核排除规则
- [x] T043 重新生成预编译产物（jniLibs 三 ABI + 两个 xcframework）
- [x] T044 ohos：`tool/build-ohos.sh` 出两个 .so；`ohos/build-profile.json5`
      用 `buildModeBinder` + `nativeLib.filter.excludes` 在 release/profile
      剔除模块；`ffi.dart` 的 ohos 分支与 android 合并（原来是 090 前的单产物写法）

## 测试 / 验收

- [x] T020 devtools 单测适配新装配（直调 hooks 函数）；全量 typecheck/test
- [x] T021 产物矩阵：plain 构建 `__fjsDevtools` 计数 0、`--devtools` 为 1；
      `nm libfjs` 无任何 inspector 符号；桌面 −26.5%、Android arm64 −16.4%
- [x] T022 桌面断点端到端（fjs-test 经 dlopen 模块跑通断点/resume/detach）；
      模块缺席时引擎照常运行且 fjsrun 明确报"本构建无调试器"
- [x] T023 文档：VENDORED.md 本地补丁清单；toolchain.md 产物矩阵；`native/include/fjs.h`
      注释改口径（引擎不再"带着惰性 inspector"）
- [x] T024 iOS 模拟器 dev 链路端到端：Debug 构建的 keep-alive 表把
      `fjs_debugger.xcframework` 链了进来，中继报 app attached；CDP 实测
      scriptParsed 5 个、`bundle.js:76` 断点命中、`evaluateOnCallFrame`
      读出 `probeCount`、resume 后 UI 照常；`__fjsDevtools` 数据平面在位
- [x] T025 ohos 产物门禁：实跑 `hvigorw assembleHar` 三种 buildMode，
      debug 的 HAR 两个 .so 都在、release / profile 只剩 `libfjs.so`；
      模块的未定义符号除 libc 外全部由 `libfjs.so` 导出
