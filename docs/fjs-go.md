# fjs go

`fjs go` 是 ufjs 的调试客户端，类似 Expo Go：手机或模拟器上装一次，以后
连接任意 `fjs dev` 项目，不需要每次改 JS/Vue 都重新编译原生 App。

## 推荐流程

1. 创建并启动一个 fjs 项目：

```bash
pnpm exec fjs create my-app
cd my-app
pnpm install
pnpm run dev:pages
```

2. 安装 fjs go。

**Android 直接从 Release 下 APK**，不用自己编：

| 下载 | 大小 | 用途 |
|------|------|------|
| [fjs-go-release-arm64.apk](https://github.com/snice/ufjs/releases/latest/download/fjs-go-release-arm64.apk) | ~8.7 MB | 日常调试用这个 |
| [fjs-go-debug-arm64.apk](https://github.com/snice/ufjs/releases/latest/download/fjs-go-debug-arm64.apk) | ~42 MB | 需要 Flutter DevTools 时用 |

上面两个链接始终指向最新版本；要装历史版本去
[Releases](https://github.com/snice/ufjs/releases) 页面挑。

- 手机浏览器直接打开链接下载，或者电脑下完 `adb install fjs-go-release-arm64.apk`
- 第一次装要在系统里允许「安装未知来源应用」
- 两个包都只打 `arm64-v8a`（覆盖近几年的机器），用同一个 fjs-go 测试证书签名，
  所以新版本可以直接覆盖安装，不用先卸载
- release 包够用：fjs go 是通过网络连 dev server 的，JS 侧的热重载在 release
  构建里照常工作，debug 包的额外价值只是 Dart 侧的 DevTools

**iOS 没有分发包**（没有签名证书），需要自己跑 `flutter run`。

也可以本地构建运行：

```bash
cd examples/fjs-go
flutter run
```

3. 在 fjs go 里连接 dev server。

- 真机：优先扫终端里的二维码，或点“附近的 dev 服务器”
- Android 模拟器：`10.0.2.2:38900`
- iOS 模拟器 / macOS：`127.0.0.1:38900`
- 真机手输：电脑和手机在同一局域网，填 `192.168.x.x:38900`

## GitHub Actions APK

仓库提供 workflow：

```text
.github/workflows/fjs-go-android-apk.yml
```

触发方式：

- 新建并发布 GitHub Release

构建内容：

- `flutter pub get`
- `flutter analyze`
- `flutter test`
- `flutter build apk --debug --target-platform android-arm64`
- `flutter build apk --release --target-platform android-arm64`
- 上传 `fjs-go-debug-arm64.apk` 到当前 GitHub Release
- 上传 `fjs-go-release-arm64.apk` 到当前 GitHub Release

这是测试包，适合内部安装和调试 `fjs dev`。

要出一版新的 APK，就在 GitHub 上新建并发布一个 Release，workflow 会自动跑并把
两个 APK 附上去。

## 连接方式

fjs go 支持三种入口：

- **扫一扫**：扫 `fjs dev` 输出的二维码
- **附近的 dev 服务器**：读取局域网 UDP 发现结果
- **手输地址**：直接输入 `host:port` 或完整 URL

地址栏也接受：

```text
http://192.168.1.20:38900/bundle.js
```

## 注意事项

- iOS 第一次连接局域网会弹“本地网络”权限；拒绝后需要到系统设置里重新打开
- 广播发现受网络环境影响，跨网段、访客网络、AP 隔离都可能发现不到
- 扫码应对准 `fjs dev` / `fjs dev --pages`（默认 38900），不是 `fjs dev --web`
- 工程如果依赖自定义 Dart host module，需要在 fjs go 里补对应注册逻辑
- fjs go 是纯 Flutter 项目，不走 `fjs run`。要换 JS 引擎（spec 091），
  构建前在 fjs go 目录下手动物化：`dart run flutter_fjs:engine quickjs`
  （或 `primjs` 切回），然后正常 `flutter run`；debug 构建里 define 与
  实际引擎不一致时 App 会打告警

## 相关

- [工具链](toolchain.md)
- [路由](routing.md)
- [分包与 release assets](code-splitting.md)
