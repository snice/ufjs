# Tasks: JS 引擎双份缓存与切换入口

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 引擎边界（先做，后面都依赖它）

- [x] T001 从 e6fb442~1 恢复 `native/quickjs/`（quickjs-ng 0.9.0，21 文件）
- [x] T002 新增 `native/src/engine.h`：facade 类型 + PrimJS 后端（直通），
      core 四文件改走 facade，primjs 行为不变（fjs-test 对比）
- [x] T003 facade 增 quickjs-ng 后端（签名规范化：`EvalFunction` 元数、
      `SetMaxStackSize` 收 runtime、`lepus_free`/`js_free`、flag 常量
      由 facade 拥有）
- [x] T004 `fjs_engine_id()` 按 flavor 返回 `primjs-4.1.1` /
      `quickjs-ng-0.9.0`

## 构建层

- [x] T010 `native/CMakeLists.txt`：`FJS_JS_ENGINE` 选项、quickjs-ng
      target、flavor 宏、quickjs flavor 下调试器 target 关闭
- [x] T011 `tool/build-android.sh` 双 flavor → `abi/<engine>/android/`，
      primjs 默认物化到 jniLibs
- [x] T012 `tool/build-apple.sh` 双 flavor → `abi/<engine>/{ios,macos}/`，
      primjs 默认物化到 pod 根
- [x] T013 `tool/build-ohos.sh` 双 flavor → `abi/<engine>/ohos/`，
      primjs 默认物化到 ohos/libs
- [x] T014 gradle：不改逻辑（物化即文件变化，gradle 天然感知），只补
      spec 091 注释；release 剔除 debugger 的原逻辑兜底
- [x] T015 podspec（ios/macos）：vendored 位置不变；debugger framework
      改为 `File.exist?` 守卫（quickjs 物化后不存在）

## CLI

- [x] T020 `fjs run` 增加 `--js-engine`（env `FJS_JS_ENGINE` 同效），
      spawn flutter 前调用 `materializeJsEngine()`（`project/engine.ts`）
- [x] T021 `fjs build` 增加 `--js-engine`，字节码走对应 flavor 的 fjsc
      （`findFjsc(engine)` 认 `build-native-quickjs/`，quickjs 请求不回落
      primjs npm 二进制），releaseBuild 物化
- [x] T022 `fjs debug`：`FJS_JS_ENGINE=quickjs` 时启动即提示无 CDP 调试器

## 测试

- [x] T030 双 flavor `fjs-test` 全绿（primjs 46 项、quickjs 39 项，
      调试器段按设计跳过）
- [x] T031 双 flavor `fjsc` 出包 + `fjsrun` 运行；跨 flavor bundle 报
      mismatch（id 均写入 bundle 头）
- [x] T032 `pnpm run typecheck` + `pnpm test`（1008 项）全绿
- [x] T033 Android 双 flavor 产物构建（NDK 28.2）
- [ ] T034 模拟器端到端：`fjs run --js-engine quickjs` 起得来、
      debug attach 有可见降级提示（有 Xcode/模拟器时）

## 文档

- [x] T040 `docs/toolchain.md`：引擎切换一节（flag、env、abi 缓存布局、
      物化机制、调试器差异、fjsc/FJSC_PATH）
- [x] T041 `specs/091` 状态收口；roadmap 变更记录

## 二轮：Dart runner 统一物化（纯 Flutter 宿主可用，fjs-go 需求）

构建期钩子方案（gradle 解码 dart-defines / podspec script_phase）做过一
轮后被否：Xcode 对 xcframework 抽取缓存与增量 Ld 的指纹判定让"构建期换
归档"反复出现静默滞后，试了声明 I/O、清抽取缓存、touch 源文件都无法闭
合。最终收敛到用户建议的形态——物化发生在 flutter 构建开始**之前**，
且只有一条实现：

- [x] T050 `flutter_fjs/bin/engine.dart`：Dart runner（pubspec
      `executables`），copy abi 缓存 → jniLibs / xcframework / ohos libs，
      改写 `Classes/fjs_engine_flavor.h`（shim 据此条件化声明 ABI），
      清宿主 Xcode 抽取缓存与 framework 产物强制重链，touch 宿主
      ios/Podfile 强制 pod install 重评估 vendored 列表
- [x] T051 quickjs flavor 不再有任何 debugger 产物（build-apple.sh 空归
      案方案废弃移除）；primjs 之外物化即删除 debugger framework/.so
- [x] T052 shim（ios/macos 同步）：debugger 段 `#if DEBUG &&
      !defined(FJS_ENGINE_QUICKJS)` —— quickjs 构建不声明不存在的 ABI
- [x] T053 CLI：`materializeJsEngine` 改为 spawn Dart runner（逻辑只有一
      份）；`--js-engine`/`FJS_JS_ENGINE` 仍以 `--dart-define` 转发给
      flutter 供 App 内自检
- [x] T054 App 内失配告警（engine.dart）：debug 下 define 与真实
      engineId 不一致打一次告警 + 给出 runner 命令（纯 Flutter 宿主的
      "提示"入口）
- [x] T055 验证：runner 双向翻转 + 纯 `flutter build ios`（无 define）
      均正确重链（quickjs: 2 处 id、0 attach 符号；primjs: attach 回归）；
      Android APK 字节级验证同前
- [x] T056 `docs/toolchain.md`（runner 形态 + 纯 Flutter 宿主路径）、
      `docs/fjs-go.md` 注记、roadmap 收口

## 三轮：PrimJS 缺 `queueMicrotask` 全局（fjs-go 实机踩雷）

默认 primjs flavor 下导航 settled 回调直接
`ReferenceError: queueMicrotask is not defined`（markSettled →
dispatchEvent 抛穿到 Dart）：quickjs-ng 内置该全局，PrimJS 没有，而
router 的 settle 链（`settled.ts` / `flutter.ts`）裸调它——`host.ts`
自己有 `typeof` 守卫，新代码没跟上这个先例。

- [x] T057 `fjs-runtime/src/microtask.ts`：缺位时以 `Promise.resolve().then`
      兜底装一个——引擎在每个 eval/宿主回调后都会清 promise 微任务队列
      （Vue 本身就跑在上面），语义无损；从 `host.ts` 顶部引入，它是所有
      native 面向入口的公共依赖，一处引入全覆盖。不选在 PrimJS C 层注册：
      vendored 源码零侵入、免去双 flavor × 全平台引擎产物重编重发（约束
      8），且与 `raf.ts` 既有"runtime 兼容引擎环境"的模式一致
- [x] T058 验证：单测（缺位安装且异步执行 / 原生实现不被覆盖）；双 flavor
      `fjsrun` 冒烟——primjs 裸跑 `typeof queueMicrotask` 为 undefined
      （前提坐实），带 runtime 的 bundle 后为 function 且微任务回调真实
      执行；quickjs 侧守卫空操作。`pnpm test`（1010 项）+ 
      `pnpm run typecheck` 全绿；`docs/toolchain.md` 引擎差异小节补第三条

