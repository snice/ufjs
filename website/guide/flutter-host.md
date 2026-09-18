# Flutter 宿主与原生配置

你的 JS 代码最终跑在一个 Flutter App 里，这个 App 叫**宿主**（host）。默认情况下它完全由 `fjs` 生成和管理，你不需要打开它；当你需要配置包名、权限、签名或者写原生代码时，才需要了解它。

## 宿主在哪

```bash
npx fjs host
```

默认宿主在 `.fjs/flutter`：

- 第一次 `fjs run` / `fjs build --release` 时通过 `flutter create` 生成
- **被 gitignore**，随时可以删掉重建（`fjs clean --all`）
- `pubspec.yaml` 每次运行都会重新生成（带上 `flutter_fjs` 和模块的 autolink 依赖）

生成的 `lib/` 里有三个文件，归属不同：

| 文件 | 归谁 | 每次 `fjs run` |
|---|---|---|
| `lib/main.dart` | 你 | **只在缺失时生成**，手改不会被覆盖 |
| `lib/fjs_autolink.dart` | fjs | 重写：模块的 import 和 `register()` 都在这里 |
| `lib/fjs_attach.dart` | 项目 | 用你的 `src/main.dart` 覆盖 |

## 用 `app.config.ts` 配置原生应用

绝大多数原生配置不需要碰宿主，写在项目根目录的 `app.config.ts` 里：

```ts
import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
  version: '1.2.0+3',            // → pubspec version → Android versionName/Code、iOS 版本号
  orientation: 'landscape',      // 锁定屏幕方向：'portrait' | 'landscape'
  android: {
    applicationId: 'com.acme.demo',
    permissions: [
      'android.permission.INTERNET',
      'android.permission.CAMERA',
    ],
  },
  ios: {
    bundleIdentifier: 'com.acme.demo',
    infoPlist: {
      NSCameraUsageDescription: '用于扫描二维码',
      NSLocalNetworkUsageDescription: '用于连接开发服务器',
    },
  },
  wxmp: {
    appid: 'wx1234567890abcdef',
    renderer: 'skyline',           // 'webview'（默认）| 'skyline'
    setting: { minified: true },   // 合并进 project.config.json 的 setting
  },
});
```

`fjs run` / `fjs host create` 会把它同步到 `AndroidManifest.xml`、`Info.plist`、`pubspec.yaml` 和 Xcode 工程里。只覆盖 fjs 写入的标记区块，重复运行不会重复添加。

- Android 权限写完整名字（`android.permission.CAMERA`）
- iOS 的 `infoPlist` 键就是 Apple 的 Info.plist key
- `NSLocalNetworkUsageDescription` 即使不写，dev 模式也会自动注入（iOS 14+ 没有它会静默拒绝所有局域网连接，连不上 dev server）

## 项目级 Dart 代码：`src/main.dart`

要在宿主里注册宿主函数、初始化 Firebase 等 SDK，又不想 eject 时，在 `src/main.ts` 旁边放一个 `main.dart`：

```dart
// src/main.dart
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> fjsAttachHost(FjsEngine engine) async {
  engine.host.register('app.channel', (args) => 'official');
  engine.host.registerAsync('app.slowThing', (args) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return {'ok': true};
  });
}
```

它每次运行都会被复制为宿主的 `lib/fjs_attach.dart`，在注册完模块之后、`runApp` 之前调用。`examples/hello-fjs/src/main.dart` 是一个完整例子。

需要**新的 pub 依赖**时，不要写在这里（宿主 pubspec 会被重新生成），而是放进一个[模块](./modules)，或者 eject 宿主。

## eject：把宿主变成你自己的

需要以下任何一件事时，eject：

- 配置 Android 签名 / iOS 证书
- 直接改 Gradle、Xcode 工程、原生 Kotlin / Swift 代码
- 自由地 `flutter pub add` 任意插件

```bash
npx fjs host eject          # 默认移到 flutter/
npx fjs host eject native   # 或者指定目录
```

它会：

1. 把 `.fjs/flutter` 移到 `flutter/`（pubspec 里的相对路径会自动重算）
2. 在 `package.json` 写入 `fjs.flutterDir`，之后所有命令都认这个目录
3. 从此**不再改写**它的 `lib/main.dart`、`pubspec.yaml` 和 Gradle 配置

eject 之后，autolink 仍然工作（`lib/fjs_autolink.dart` 和 `lib/fjs_attach.dart` 照常更新），但新模块的 **pub 依赖**需要你自己加进 pubspec —— `fjs run` 会把需要手动补的内容打印出来，`fjs modules` 也随时可查。

```bash
npx fjs host sync --force   # 后悔了：把生成版的宿主文件重新盖回去
```

## 其它宿主命令

```bash
npx fjs host create             # 只创建/更新宿主，不运行
npx fjs host open android       # 用 Android Studio 打开
npx fjs host open ios           # 用 Xcode 打开
npx fjs host id com.acme.app    # 一次性修改包名（长期请写 app.config.ts）
npx fjs icon icon.png           # 生成 Android / iOS 应用图标
```

## 生成的 main.dart 做了什么

打开 `.fjs/flutter/lib/main.dart` 可以看到宿主启动的全过程，大致是：

```dart
final engine = FjsEngine();
engine.onLog = (level, message) => debugPrint('[js:...] $message');
fjsRegisterModules(engine);        // fjs_autolink.dart：模块注册
await fjsAttachHost(engine);       // fjs_attach.dart：你的 src/main.dart

const dev = String.fromEnvironment('FJS_DEV');
if (dev.isEmpty) {
  await engine.loadReleaseAssets();          // release：从 assets/fjs 加载字节码
  runApp(App(engine));
} else {
  runApp(App(engine));                       // dev：先把界面画出来
  engine.connectDevString(dev).ignore();     // 再连 dev server（失败会自动退避重试）
}
// App 里是 MaterialApp → Scaffold → FjsApp(engine: engine)
```

dev 模式「先画界面再连接」是刻意的：iOS 首次联网会弹系统权限窗，必须有界面在前台才能弹出来；连接失败时屏幕上会显示正在连哪个地址，而不是黑屏。

`FjsApp` 是一个由 JS 路由驱动的 `Navigator`，每个 JS 路由是一个原生页面。原理见[渲染管线](/advanced/rendering)。

## Android 工具链

生成的宿主每次运行时会把 Android 工具链补到基线（只升不降）：Gradle 8.14、AGP 8.11.1、Kotlin 2.2.20、Java 17。release 构建出问题时，先确认 Flutter 用的是 JDK 17：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 17)
```

## 鸿蒙

需要 OpenHarmony fork 的 Flutter SDK 和 DevEco Studio，设置好 `DEVECO_SDK_HOME`，并在 `.fjs/flutter` 里执行一次 `flutter create --platforms ohos .`。之后：

```bash
npx fjs devices             # 能看到 ohos 设备
npx fjs run ohos
npx fjs build --pages --release --hap
```
