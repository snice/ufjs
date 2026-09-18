# Spec: 鸿蒙（ohos）平台适配

- **ID**: 066-ohos-support
- **状态**: done（2026-09-18，模拟器实测通过）
- **日期**: 2026-09-18

## 1. 要解决什么

README 里鸿蒙一直标"理论支持、未实测"。现在用户装好了 OpenHarmony
fork 的 Flutter SDK（`~/ohos/flutter_flutter`，基于 gitcode
CPF-Flutter/flutter_flutter）和 DevEco Studio，`hello-fjs` 的内嵌宿主
`.fjs/flutter` 已用 `flutter create --platforms ohos .` 补出了 `ohos/`
目录。缺口在三处：

1. **引擎加载**：fork 的 Dart runtime 上 `Platform.operatingSystem` 返回
   `'ohos'`（fork 自己的工具代码就这么判），而 `ffi.dart` 只对 Android 走
   `DynamicLibrary.open('libfjs.so')`，其余平台走 `process()` —— ohos 上
   必炸（符号找不到）。
2. **引擎分发**：flutter_fjs 没有 ohos 插件声明、没有 ArkTS 垫片、没有
   ohos 的 `libfjs.so` 预编译产物，HAP 里根本不会有这个库。
3. **CLI 平台枚举**：`fjs devices` / `fjs run` / `doctor` / `host` 全部
   硬编码 `android | ios`，ohos 设备（`flutter devices --machine` 报
   `targetPlatform: 'ohos-arm64'`）既列不出来也跑不了。

补齐目标：`fjs devices` 能列出 ohos 设备，`fjs run ohos` 能在模拟器
（127.0.0.1:5555）上跑通 hello-fjs 的 debug 与 release 两条链路。

## 2. 不做什么（Non-goals）

- **ohos 应用图标**（`fjs icon`）：DevEco 有自己的图标工作流，后续按需加。
- **x86_64 / armeabi-v7a 的 ohos ABI**：Apple Silicon 上的模拟器与真机都
  是 arm64，只出 `arm64-v8a`。
- **真机分发签名**：模拟器跑通为准，签名/上架走 DevEco 自己的流程。
- **`fjs doctor` 的 ohos 工具链检查**（DevEco/hvigor/ohpm 版本探测）：
  fork 的 `flutter doctor` 已含 ohos doctor 分支，不重复造。
- **mp / web 端**：零关联。

## 3. 用户可见的行为

```bash
fjs devices                # ohos 设备出现在列表里（模拟器置顶、* 标默认）
fjs run ohos               # debug：起 dev server，flutter run 到设备，FJS_DEV 走 LAN 地址
fjs run ohos --release     # release：字节码烤进 assets，flutter run --release
fjs build --pages --release --hap   # 出 HAP（flutter build hap）
fjs host open ohos         # 用 DevEco Studio 打开宿主 ohos/ 目录
```

非 fork 的标准 Flutter 上行为完全不变：`ensureFlutterHost` 检测到
SDK 无 ohos 支持时保持 `--platforms=android,ios`，`fjs run ohos` 给出
明确报错而不是把锅甩给 flutter。

## 4. 关键技术判断（实现时已验证的事实）

- fork 设备发现：`flutter devices --machine` 里 ohos 设备的
  `targetPlatform` 是 `ohos-arm64`（fork `hvigor.dart:756`），模拟器
  `emulatorId => id`（恒真）。hdc 由 fork 从 DevEco SDK 路径自定位
  （`ohos_sdk.dart`），不要求 hdc 在 PATH。
- fork 插件机制：pubspec 插件声明加 `ohos: pluginClass: XxxPlugin`，
  fork 的 `ohos_plugins_manager.dart` 会把每个插件的 `ohos/` 目录作为
  hvigor HAR 模块打疤并注入宿主 entry（oh-package 依赖 +
  build-profile modules），宿主侧零手改。`GeneratedPluginRegistrant.ets`
  由工具再生成。
- flutter_fjs 无任何 platform channel（Android 垫片是纯注册契约空壳），
  ohos 垫片同样是最小空壳，仅为满足插件注册契约 + 让 HAR 带着
  `libfjs.so` 进 HAP。
- ohos 模板 `module.json5` 自带 `ohos.permission.INTERNET`；dev server
  绑 `0.0.0.0`；模拟器 NAT 可达宿主 LAN IP —— debug 链路不需要 fport。
  若实测不通，fallback 是 `hdc fport tcp:<port> tcp:<port>` +
  `FJS_DEV=127.0.0.1:<port>`（记入 plan §风险）。

## 5. 验收标准

1. `fjs devices` 列出 127.0.0.1:5555（platform ohos，emulator）。
2. `fjs run ohos` 在模拟器上跑通 hello-fjs 画廊，JS 引擎可用
   （页面能渲染、能交互）。
3. `fjs run ohos --release` 跑通（字节码从 rawfile/flutter_assets 加载）。
4. HAP 解包可见 `libfjs.so`（arm64-v8a）。
5. 非 ohos 路径零回归：`pnpm run typecheck`、`pnpm test` 全绿，
   android/ios 的 run/devices 行为不变。
