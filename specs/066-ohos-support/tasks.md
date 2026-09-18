# Tasks: 鸿蒙（ohos）平台适配

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## flutter_fjs 插件侧

- [x] T001 `lib/src/ffi.dart`：加载分支 +ohos（`Platform.operatingSystem == 'ohos'`），头注释补 ohos 分发说明
- [x] T002 `pubspec.yaml` platforms +`ohos: pluginClass: FlutterFjsPlugin`
- [x] T003 `ohos/` har 模块骨架（oh-package.json5 / index.ets /
      build-profile.json5 / hvigorfile.ts / module.json5）+ `FlutterFjsPlugin.ets`
      空壳垫片 —— 形状取自 fork 自带的 plugin 模板（不是想象的 src/main/libs：
      **.so 放模块根级 `libs/arm64-v8a/`**，fork 的 entry libapp.so 同款）
- [x] T004 `tool/build-ohos.sh`：DevEco llvm 交叉编译 fjs → strip →
      `ohos/libs/arm64-v8a/libfjs.so`；`build-native-artifacts.sh` 串上。
      关键 flag：`-static-libstdc++`（免带 libc++_shared.so，产物只依赖
      libc.so）+ `-Wl,-z,max-page-size=16384`（对齐 Android 侧的 16KB 页）
- [x] T005 实际跑出 `libfjs.so`（1.3M），`llvm-nm -D` 确认 `fjs_*` 全导出、
      NEEDED 只有 libc.so

## CLI（@ufjs/cli）

- [x] T010 `run.ts`：Platform union / parseRunArgs / devicesFor / 错误文案
- [x] T011 `run.ts`：deviceAddress ohos → LAN；ensureFlutterHost 的 fork
      检测（`which flutter` → realpath → SDK 根有
      `packages/flutter_tools/lib/src/ohos` 才加 ohos 平台）
- [x] T012 `devices.ts`（平台列表 + 各平台空列表提示）/ `doctor.ts` /
      `host.ts open ohos`（DevEco Studio）/ `build.ts --hap` / `cli.ts` 文案
- [x] T013 CLI dist 重建 + `pnpm run typecheck` + `pnpm test` 全绿
      （267 例，含新增 devicesFor ohos 前缀匹配 3 例）

## 实测（模拟器 127.0.0.1:5555，OpenHarmony-7.0.0.105 API 26）

- [x] T020 `fjs devices` 列出 ohos 设备（target `ohos-arm64`）。
      踩坑：fork 靠 `DEVECO_SDK_HOME` 找 hdc，不设这个变量设备列表是空的
- [x] T021 `fjs run ohos`（debug）画廊可渲染可交互：60 个页面 chunk 从
      dev server 预加载（走宿主 LAN 地址，模拟器 NAT 直达，fport 没用上）；
      点击导航、分组展开、路由 push/pop 全部正常
- [x] T022 `fjs run ohos --release` 跑通（chunk fetch 0ms，字节码来自
      rawfile/flutter_assets）；HAP 解包确认 `libs/arm64-v8a/libfjs.so`
      （1329832 B）；`fjs build --pages --release --hap` 出
      entry-default-signed.hap（46.6MB）
- [x] T023 风险落地：**两个 fallback 都没触发**——3.41 fork 的插件管线直接
      认了模板形状的 ohos 模块（registrant 自动生成、entry/oh_modules 下
      har 链接、libs 合入 HAP），LAN 地址模拟器可达

- [x] T024 WebGL 补洞：flutter_angle 无 ohos 原生端（`initOpenGL` 报
      MissingPluginException，画布空白）。fjs_webgl 自带 ohos 后端：
      `ohos/FjsWebglPlugin.ets` 只注册 Flutter 纹理并回传 OHNativeWindow*，
      `lib/src/ohos_surface.dart` 在 Dart 侧走 FFI 调系统 libEGL 建上下文与
      window surface，GL 调用复用 flutter_angle 的 LibOpenGLES(libGLESv3.so)
      + RenderingContext；`replay.dart` 抽出 `_GlSurface`，ANGLE 路径行为不变。
      Texture 在 ohos 上不做 Y 翻转（同 Android）。模拟器实测三角形、glTF 正常

## 文档

- [x] T030 `docs/toolchain.md`（鸿蒙前置条件小节、看设备、--hap、host open）、
      `README.md` 平台表 ohos → ✅ 已测试
