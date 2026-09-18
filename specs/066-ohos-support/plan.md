# Plan: 鸿蒙（ohos）平台适配

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 纯平台适配，不新增面向用户的标签/样式/事件 |
| II 边界即契约 | 否 | op 协议、JSI 边界零改动 |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 非 fork 的 flutter 上 `fjs run ohos` 显式报错；`Platform.operatingSystem` 判断不到时保持原行为并留注释 |
| VI 注释记录权衡 | 是 | ffi.dart、ArkTS 垫片、build-ohos.sh 头注释记录"为什么"（fork runtime 判定、HAR 带 .so 的分发模式、交叉编译工具链来源） |
| VII JS 能包就不要下 Dart | 否 | 引擎本来就是 Dart/FFI 层的事 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`、README 平台表更新 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 插件 | `packages/flutter_fjs/lib/src/ffi.dart` | 加载分支 +`Platform.operatingSystem == 'ohos'` |
| Dart 插件 | `packages/flutter_fjs/pubspec.yaml` | platforms +`ohos: pluginClass: FlutterFjsPlugin` |
| Dart 插件 | `packages/flutter_fjs/ohos/**` | 新建 har 模块：oh-package.json5 / Index.ets / build-profile.json5 / hvigorfile.ts / src/main/ets/FlutterFjsPlugin.ets / src/main/libs/arm64-v8a/libfjs.so |
| native | `packages/flutter_fjs/tool/build-ohos.sh` | 新建：DevEco llvm 交叉编译 `fjs` SHARED → strip → ohos libs |
| native | `packages/flutter_fjs/tool/build-native-artifacts.sh` | 串上 ohos |
| CLI | `packages/fjs/src/commands/run.ts` | Platform union、devicesFor、deviceAddress、parseRunArgs、ensureFlutterHost 的 --platforms 检测 |
| CLI | `packages/fjs/src/commands/devices.ts` | 平台列表 + 文案 |
| CLI | `packages/fjs/src/commands/doctor.ts` | devicesCheck 收 ohos |
| CLI | `packages/fjs/src/commands/host.ts` | `host open ohos` → DevEco |
| CLI | `packages/fjs/src/bundler/build.ts` | `--hap` → `flutter build hap` |
| CLI | `packages/fjs/src/cli.ts` | usage 文案 |
| 文档 | `docs/toolchain.md`、`README.md` | 登记 ohos 支持与前置条件 |
| spec | `specs/066-ohos-support/**` | 本三件套 |

## 3. 方案

- **引擎加载**：`(Platform.isAndroid || Platform.operatingSystem == 'ohos') ? DynamicLibrary.open('libfjs.so') : process()`。fork 的 Dart runtime 上 `operatingSystem` 返回 `'ohos'`（fork 工具代码同款判定），不能只加 `isAndroid`。
- **.so 分发**：照 android jniLibs 的"预编译入库"模式，`ohos/src/main/libs/arm64-v8a/libfjs.so` 提交入库；fork 的插件管理器把插件 `ohos/` 目录当 HAR 模块打包，libs 随 HAR 合入宿主 HAP。**风险**：HAR 的 libs 打包路径未实测，若 HAP 里没有 .so，fallback 是 CLI 仿 `patchAndroidAbiFilters` 把 .so 拷进宿主 entry 的 `src/main/libs`（android 已有同款先例）。
- **fork 检测**：解析 `flutter` 可执行文件路径定位 SDK 根（`bin/flutter` 的上一级，处理 symlink），检查 `packages/flutter_tools/lib/src/ohos/` 目录存在。`ensureFlutterHost` 仅在需要 create 宿主且检测通过时才把 platforms 写成 `android,ios,ohos`；宿主已存在时不跑 create，不受影响。
- **dev 地址**：ohos 走 LAN 地址（dev server 绑 0.0.0.0，模拟器 NAT 可达宿主）。**风险**：模拟器 NAT 行为未实测，不通则 fallback `hdc fport` + 127.0.0.1（在 run 的 debug 分支里做，只对 ohos）。
- **release**：现有链路（buildBundle → 烤 assets → `flutter run -d <id> --<mode>`）平台无关，fork 的 `flutter run` 自行构建/安装 HAP；`fjs build --hap` 加 `flutter build hap` 分支（产物在 `ohos/entry/build/default/outputs/default/`）。
- **ArkTS 垫片**：`FlutterFjsPlugin` 实现 FlutterPlugin 空方法，与 Android .java 同构，注释说明"无 channel，纯 FFI，此类只满足注册契约并让 HAR 进 HAP"。

## 4. 风险

- **HAR libs 打包**（见上）——用 HAP 解包验收（spec §5.4）。
- **模拟器网络**（见上）——用 debug run 验收；不通就 fport。
- **CMake 交叉编译**：CMakeLists 只有 WIN32 特判，预期 `-DCMAKE_SYSTEM_NAME=OHOS` + llvm 包装器即可；若 `m`/`dl`/线程库判定有出入，补 OHOS 守卫而不是动公用路径。
- **fork 对 `flutter create --platforms=android,ios,ohos` 的要求**：ohos 平台必须由 fork create；非 fork 环境检测兜底（spec §3 最后一段）。
