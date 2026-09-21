# Plan: JS 引擎双份缓存与切换入口

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 引擎底座，web 端无对应物 |
| II 边界即契约 | 是（恢复） | `fjs_engine_id` 双值 + .fjsbundle 锁步机制不变 |
| III 同步单线程零序列化 | 否 | 不碰执行模型 |
| IV 外观照 WeUI | 否 | |
| V 静默失效是 bug | 是 | 引擎 id mismatch 必须显式报错（现状机制）；quickjs flavor 起来时 dev server 的 `debug on` 必须有可见的"不支持"反馈 |
| VI 注释记录权衡 | 是 | facade 头、CMakeLists、脚本里的选择逻辑都写"为什么" |
| VII JS 能包就不要下 Dart | 否 | |
| VIII 变更要落到文档 | 是 | toolchain.md 引擎章节、roadmap |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| C++ 引擎 | `native/quickjs/` | 从 e6fb442~1 恢复 21 个文件（quickjs-ng 0.9.0） |
| C++ 引擎 | `native/src/engine.h` | **新增**：引擎 facade（~45 个原语 + Value 类型），`FJS_ENGINE_PRIMJS` / `FJS_ENGINE_QUICKJS` 二选一 |
| C++ 引擎 | `native/src/{vm,natives,value,fjs_internal.h}` | LEPUS_* 调用点改走 facade；`fjs_engine_id` 按 flavor 取值 |
| C++ 引擎 | `native/CMakeLists.txt` | `FJS_JS_ENGINE` 选项；quickjs-ng 静态库 target；flavor 宏下发；quickjs flavor 关调试器 target |
| 构建脚本 | `native/../tool/build-{apple,android,ohos}.sh` | 双 flavor 循环，产物落 **`abi/<engine>/<platform>/`** 缓存；primjs 份再物化到常规位置（jniLibs、pod 根、ohos/libs） |
| 插件配置 | `ios|macos/flutter_fjs.podspec`、`android/build.gradle` | 基本不动：podspec 仅加 `File.exist?` 守卫（quickjs 物化后无 debugger framework）；gradle 只补注释 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ffi.dart` | 不改；缺调试器模块时已有优雅降级 |
| CLI | `packages/fjs/src/project/engine.ts`（**新增**）、`commands/run.ts`、`bundler/build.ts`、`commands/debug.ts`、`cli.ts` | `--js-engine` / `FJS_JS_ENGINE` → **物化**（把选中 flavor 从 abi 缓存 copy 到常规位置）；字节码走对应 flavor 的 fjsc；debug 启动时对 quickjs 给出提示 |
| 文档 | `docs/toolchain.md`、`docs/roadmap.md` | 切换方法、abi 缓存布局、调试器差异 |

## 3. 方案

**引擎边界**：core 只写 facade（`fjsengine::Value`、`eval/call/prop/
to_cstring/read-write object/jobs/gc…`）。PrimJS 后端是 LEPUS 直通；
quickjs-ng 后端做少量规范化（`JS_ToInt32`↔`LEPUS_ToInt`、qjs-ng 的
`JS_WriteObject` 返回 malloc 指针 vs PrimJS 填 buf——facade 统一成
`std::vector<uint8_t>`）。宏改名 shim 被否：`LEPUSValue` 是指针、
`JSValue` 是值结构体，类型系统层面不可桥接。

**flavor 判定**：一个 CMake 变量 `FJS_JS_ENGINE`（primjs|quickjs，默认
primjs）→ 编译宏 `FJS_ENGINE_PRIMJS` / `FJS_ENGINE_QUICKJS` → facade 头
选 include 与实现。两个 flavor 用**不同 build 目录**（build-native 与
build-native-quickjs），互不污染。

**产物布局 = abi 缓存 + 物化**（采纳"一个目录存平台 so/a、运行时自动
copy 不同引擎"的思路）：

```
packages/flutter_fjs/abi/                     # 两个引擎的平台产物缓存（提交）
  primjs/android/<abi>/libfjs.so + libfjs_debugger.so
  primjs/{ios,macos}/fjs.xcframework + fjs_debugger.xcframework
  primjs/ohos/arm64-v8a/...
  quickjs/...                                  # 同布局，无 debugger
android/src/main/jniLibs/<abi>/               # 物化位置（提交，默认 primjs）
ios|macos/fjs.xcframework (+ fjs_debugger)    # 物化位置（提交，默认 primjs）
ohos/libs/arm64-v8a/                          # 物化位置（提交，默认 primjs）
```

**选择点 = 插件侧构建钩子，输入是 dart-define**。`fjs run/build
--js-engine quickjs`（或 `FJS_JS_ENGINE`）把 `--dart-define=
FJS_JS_ENGINE=quickjs` 转发给 `flutter run/build`，由 flutter_fjs 自己的
平台构建件完成物化——**任何纯 Flutter 宿主（fjs-go）不需要 fjs CLI 就能
切**：

- Android：`android/build.gradle` 解码 flutter 传入的 base64
  `dart-defines` property（`FlutterPlugin.kt` 的既有机制），注册
  `fjsMaterializeEngine` task 挂在 `preBuild` 前，把
  `abi/<engine>/android/<abi>/` 覆盖到 jniLibs；task 的 input 里带
  engine 值，否则 primjs→quickjs→primjs 翻转会被误判 up-to-date。
- iOS/macOS：podspec 的 `script_phase`（`:execution_position =>
  :before_compile`）读 `DART_DEFINES` build setting，逐个 base64 解码找
  `FJS_JS_ENGINE`，把 abi 缓存对应切片的 `libfjs.a` /
  `libfjs_debugger.a` `cmp` 后换入 pod 根。为什么必须是构建期：flutter
  在插件集合未变时跳过 pod install，pod-install 期读 env 会滞后一次
  构建（静默失效，宪法 V）；构建期改归档内容是 Xcode 一定感知的输入。
  script 刻意不声明 input/output（I/O 声明看不到 DART_DEFINES 的变化），
  靠 `cmp -s` 避免无谓重链。
- ohos：hvigor 没有等价挂钩面，CLI 保持直接物化（engine.ts，戳记幂等）。

quickjs flavor 的 `libfjs_debugger.a` 是**空归档**（一个无符号 object，
libtool 打包），因此 podspec 无条件列出两个 framework、不必按 flavor 变
vendored 列表，pod-install 依赖归零；空归档对链接是零贡献，与 090 的
"release 不含 inspector"语义一致。

CLI 同时保留直接物化（ohos 需要；Apple/Android 上它与钩子写同一份
缓存字节，幂等无害），并在每次 spawn flutter 时转发 dart-define。

**fjsc（字节码）**：二进制内嵌引擎，flavor 即二进制。`findFjsc(engine)`
认 `build-native-quickjs/` 候选；quickjs 请求永不回落到 primjs 的 npm
二进制（会静默产错 id 的 bundle），直接报错并给出构建配方；`FJSC_PATH`
是既有逃生门。npm 分发 quickjs 版推迟（Non-goals）。

被否掉的备选：

1. 同进程双引擎（见 spec Non-goals）——体积与 ABI 成本。
2. 维护两份 core 源码树（e6fb442 前后各一份）——三份协议同步已经够苦，
   core 再开双人舞必然漂移；facade 一次性把差异钉进一个文件。
3. objcopy 符号前缀改名塞进同一个 .so——iOS 位码/strip 工具链脆弱，
   且同样背双份体积。
4. gradle/podspec 配置期读 `FJS_JS_ENGINE` 选目录——gradle 可行，但
   podspec 的 env 在 flutter 跳过 pod install 时不重读，切换会滞后一次
   构建（静默失效）；且两条机制并存（Android 读 env、Apple 靠 copy）
   比单条 copy 路径更难解释。

## 4. 风险

- **facade 重构悄悄改变 primjs 行为**——最大风险。缓解：重构前后
  `fjs-test` 46 项逐项对比；iOS/macOS 产物重编后跑模拟器冒烟。
- quickjs-ng 与 PrimJS 在 `Call`/`ExecutePendingJob`/`ComputeMemoryUsage`
  等签名细节上的差异可能不止名字——facade 里逐个对签名（实际发现两处：
  `EvalFunction` 元数、`SetMaxStackSize` 收 runtime；flag 位值不同由
  facade 拥有常量），编译器兜底；fjs-test 双 flavor 全绿。
- quickjs 物化后 `libfjs_debugger` 残留——engine.ts 物化 quickjs 时主动
  `rm` 旧模块；gradle 的 release 剔除逻辑原样保留兜底。
- 物化状态与 git 默认（primjs）漂移——切到 quickjs 后 jniLibs/xcframework
  在 `git status` 里可见地变化；文档写明提交前 `git restore` 或保持
  （明确要改默认时）。

## 5. 验证路径

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
./build-native/fjs-test                                   # primjs 全绿
cmake -B build-native-quickjs -DFJS_JS_ENGINE=quickjs \
      -DFJS_BUILD_TESTS=ON -DFJS_DEBUGGER=OFF && \
cmake --build build-native-quickjs -j
./build-native-quickjs/fjs-test                           # quickjs 全绿
./build-native/fjsrun <demo dist bundle>                  # 引擎自报 id + 渲染帧
./build-native-quickjs/fjsrun <demo dist bundle>          # 同上
./build-native-quickjs/fjsrun <primjs bundle>             # 预期 mismatch 报错
cd ../.. && pnpm run typecheck && pnpm test               # CLI/runtime 回归
# 有 NDK 时：
tool/build-android.sh          # abi/ 双 flavor + jniLibs 默认物化
# 有 Xcode 时（耗时）：
tool/build-apple.sh            # abi/ 双 flavor + pod 根默认物化
# 物化链路：fjs run --js-engine quickjs → abi/quickjs copy 到位 → 冒烟；
#           再跑默认 fjs run → 物化回 primjs
```
