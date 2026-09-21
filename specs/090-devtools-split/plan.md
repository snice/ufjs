# Plan: DevTools 分层

对应 spec：`./spec.md`

## 1. 宪法自查

I 豁免（延续 088/089，开发者工具）；II 零协议增量（运行时内部槽位模块 +
原生侧仅移动导出位置）；III 不变；V 缺符号/缺数据平面时显式降级不静默崩溃；
VI 钩子表与 vendored 补丁都要注释"为什么拆"；VII 数据平面本就是 JS 侧；
VIII toolchain.md 更新。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `src/devtools-hooks.ts`（新） | 槽位：provider + recordProps/recordText/netRequest/netResponse/netBody |
| JS runtime | `src/devtools.ts` | 重构为"安装槽位"的 dev-only 模块（boot 显式、不再自注册） |
| JS runtime | `src/ui/element.ts` `src/vue/renderer.ts` `src/net/fetch.ts` | 改走槽位可选调用 |
| JS runtime | `src/index.ts` | `if (__FJS_DEVTOOLS__) devtoolsBoot()` |
| CLI | `src/bundler/build.ts` | VUE_DEFINES 加 `__FJS_DEVTOOLS__`；opts `--devtools`；`fjs dev` 置 true |
| vendored | `primjs/src/interpreter/quickjs/include/inspector_hooks.h`（新）、`source/inspector_hooks.cc`（新） | 6 个钩子的表 + 安装函数 + GC 写屏障锚点，编进引擎 |
| vendored | `primjs/src/interpreter/quickjs/source/quickjs.cc`（8）、`quickjs_gc.cc`（2） | 10 处调用点改走钩子表 |
| vendored | `primjs/src/interpreter/quickjs/include/quickjs-inner.h` | include 钩子表头文件 |
| vendored | `primjs/src/interpreter/quickjs/include/base_export.h` | `FJS_INSPECTOR_PLUGIN` 下 `QJS_HIDE` 放开为默认可见 |
| vendored | `primjs/CMakeLists.txt` | inspector 源码拆出 `quickjs_inspector` target |
| 原生 | `native/CMakeLists.txt` | libfjs 不含 inspector；libfjs_debugger = inspector + 传输 |
| 原生 | `native/src/debugger-plugin.cpp` | attach 时装钩子；去掉遗留 fprintf |
| 原生 | `native/tools/fjsrun.cpp` | 调试改 dlopen 插件 |
| Dart | `lib/src/ffi.dart` | 引擎与插件分开加载，attach/detach 只在插件句柄上查 |
| 原生 | `native/tools/debugger-module.h`（新） | 宿主侧 dlopen 加载器，fjsrun / fjs-test 共用 |
| 打包 | `tool/build-apple.sh` `ios/flutter_fjs.podspec` `macos/flutter_fjs.podspec` `*/Classes/FlutterFjsPlugin.m` | 第二个 xcframework；`#if DEBUG` keep-alive 表决定是否链入 |
| 打包 | `tool/build-android.sh` `android/build.gradle` | 产物内容变了，排除规则复核 |
| 打包 | `tool/build-ohos.sh` `ohos/build-profile.json5` | 第二个 .so 进 libs/；`buildModeBinder` 让 release/profile 的 HAR 不收它 |
| 文档 | `native/primjs/VENDORED.md` `docs/toolchain.md` | 本地补丁清单、构建产物矩阵 |

## 3. 方案

运行时拆两层：`devtools-hooks.ts`（恒在、纯槽位，调用点 `hooks.x?.()`）与
`devtools.ts`（dev-only 数据平面，由打包器按构建模式注入 + `__FJS_DEVTOOLS__`
define 门控 boot）。release 的 esbuild define=false → DCE 后产物无该模块。

原生按**内容**而不是按**产物 flavor** 切：一份引擎 + 一份可选 inspector
归档。引擎侧留一张 6 项的函数指针表（`qjs_inspector_hooks`），插件在
attach 时填、detach 时清。这样：

- Android：插件是独立 .so，release 由 gradle 从 jniLibs 里删掉；
- Apple：插件是独立静态归档，静态库按需拉 .o，只有
  `Classes/FlutterFjsPlugin.m` 里 `#if DEBUG` 的 keep-alive 表引用
  attach/detach——Release/Profile 没人引用，一个字节都不进二进制；
- ohos：插件是独立 .so，hvigor 打插件 HAR 时按 buildMode 过滤 —— Dart 侧
  本来就只在 `kDebugMode` 下加载模块，所以 release **和 profile** 一起剔；
- 桌面：`fjsrun` dlopen 插件。

三端都不需要"两份引擎"，因此不存在 duplicate symbol 和 pod 安装期选型。

被否备选：①发布两套完整引擎预编译（Apple 静态链接撞 duplicate symbol）；
②保持初版"inspector 惰性留在引擎"（release 只减 2%，见 spec §2.1 实测）；
③运行时 define 包裹原模块不拆槽位（静态导入仍会把模块带进 release 产物）。

## 4. 风险

- **vendored 补丁随 PrimJS 升级漂移**：钩子表的 6 个签名、23 个
  `QJS_HIDE` 符号都可能变。缓解：补丁集中在 4 个文件并记在 VENDORED.md；
  漏改会在插件链接期报 undefined symbol（Android `--no-undefined`、
  Apple 静态链接），不会静默。
- **符号预占（interposition）**：引擎侧不再定义那 6 个名字，插件里是唯一
  定义，取地址不会自指。若将来图省事在引擎里留同名转发函数，会变成
  插件调自己→转发→插件的无限递归，禁止这么做。
- define 漏加某个 esbuild 调用 → dev 构建丢面板：VUE_DEFINES 单点定义。
- units 热更的模块图混合（089 尾注教训）：验证时重启 `fjs run` 取干净构建。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
fjs build --out /tmp/chk && grep -c __fjsDevtools /tmp/chk/app/*.js   # 0
fjs build --devtools --out /tmp/chk2 && grep -c __fjsDevtools /tmp/chk2/app/shared.js  # ≥1

cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
nm -gU build-native/libfjs.dylib | grep -E 'QJSDebugger|DoInspectorCheck|HeapProfiler'  # 空
./build-native/fjs-test
# 桌面断点端到端：fjsrun --debug + fjs debug 前端
# 模拟器面板门禁重跑（dev 链路不回归）
```
