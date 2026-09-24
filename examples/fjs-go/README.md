# fjs go

Expo Go 的对应物：**一个预编译好的客户端 app**，连到运行中的 `fjs dev`
服务器，跑它提供的任意 fjs 工程。改 JS/Vue 不需要重新编译原生层。

Android 测试包可以由 GitHub Actions 生成：新建并发布 GitHub Release 后，
`fjs-go Android APK` workflow 会自动把 `fjs-go-debug-arm64.apk` 和
`fjs-go-release-arm64.apk` 上传到该 Release 附件。两个包都只包含 `arm64-v8a`，
并使用同一个 fjs-go 测试证书签名。

```bash
# 1) 在工程目录起 dev 服务器（它会打印可用地址）
cd examples/hello-fjs
pnpm dev

# 2) 装一次 fjs go，之后一直用它调试
cd examples/fjs-go
flutter run          # iOS / Android / macOS 均可
```

鸿蒙（HarmonyOS）真机需要先签名。签名信息与个人证书绑定，仓库里的
`ohos/build-profile.json5` 刻意留空（spec 110）：

1. DevEco Studio 打开 `examples/fjs-go/ohos`，File → Project Structure →
   Signing Configs，勾选 Automatically generate signature；
2. 这会把**你本机**的证书路径和加密后的密码写进 `ohos/build-profile.json5`——
   别提交它，让 git 忽略你本地的这份改动：

   ```bash
   git update-index --skip-worktree examples/fjs-go/ohos/build-profile.json5
   # 以后要改这个文件里的其它配置时先撤销：
   git update-index --no-skip-worktree examples/fjs-go/ohos/build-profile.json5
   ```

连接页有三条路，真机优先用前两条：

- **扫一扫**（Android / iOS）：直接扫 `fjs dev` 在终端里画出来的二维码
- **附近的 dev 服务器**：`fjs dev` 每秒往局域网广播一次，听到谁就列谁，点一下就连
- **手输地址**：

  | 场景 | 地址 |
  |------|------|
  | iOS 模拟器 / macOS | `127.0.0.1:38900` |
  | Android 模拟器 | `10.0.2.2:38900` |
  | 真机（与电脑同一局域网） | `192.168.x.x:38900` |

地址栏也接受直接粘贴 `http://192.168.1.20:38900/bundle.js` 这类完整 URL。
连过的地址会记在"最近连接"里。

广播发现是尽力而为：跨网段、访客网络、开了 AP 隔离的路由器都收不到，个别
Android 机型为省电也会丢广播包。客户端现在会申请 Wi-Fi multicast lock，减少
真机听不到广播的情况。收不到就扫码或手输——三条路互不依赖。

扫码请对准 **`fjs dev` / `fjs dev --pages`** 终端里的码（默认端口 38900）。
`fjs dev --web` 是给浏览器的（端口 5173），fjs go 连上去会失败。

**iOS 第一次连接会弹"本地网络"权限**。点了不允许的话症状很误导：广播照收，
「附近的 dev 服务器」列表照出，但一点就连不上——iOS 14+ 把所有局域网连接都
挡在这个权限后面，报错和"网线没插"一模一样。到 设置 → fjs go → 本地网络
打开即可。

## 连接后

顶部 dev bar：

- **工程名 + 地址**：来自 `GET /manifest.json`
- **日志**：JS 的 console 输出 + 连接/重载状态；有 error 时图标变红。手机上
  没有终端可看，所有输出都汇到这里
- **重新加载**：手动重新拉取 bundle（文件变更本来就会自动推送重载）
- **断开**：销毁 VM 回到连接页——旧工程的定时器和 host 模块不会留下来

## 与嵌入式宿主的关系

fjs go 用的引擎、host 模块注册、widget 映射与 `fjs run` 生成的 Flutter 宿主
完全一致，唯一区别是程序来源：网络而非 assets。所以在 fjs go 里跑通的效果，
嵌进真实 app 后是同一套渲染路径。

两个已知边界：

- dev 服务器只提供**源码模式单包**（`--bytecode` / `--shared` 是生产构建
  路径），因此 fjs go 不需要注册 prelude，参见 docs/toolchain.md
- `engine.host.register` 的宿主模块由 fjs go 自己决定；目前只内置了
  `device`。工程若依赖自定义 Dart 模块，需要在 fjs go 里补上（或改用嵌入式宿主）

## 原生依赖

扫码 = 官方 `camera` 插件取帧 + `zxing2`（纯 Dart 的 ZXing 移植）解码，
解码那段在 `lib/src/qr_decode.dart`，不依赖相机、可单测。

没用 `mobile_scanner`：它在 iOS 上走 MLKit，会把部署目标顶到 15.5、还把
arm64 模拟器排除掉（Apple 芯片上的 iOS 模拟器直接构建不了），Android 上再多
打包一份条码模型。一个一辈子只点几次的入口不值这些。

- `Info.plist` 加了 `NSCameraUsageDescription` 和 `NSLocalNetworkUsageDescription`
- iOS 部署目标仍是 12.0，Android minSdk 不变
- Android 工具链抬到 AGP 8.4 + Gradle 8.7：AGP 8.1 在 JDK 21 下编不了带 Java
  源码的插件（`camera_android_camerax` 就是），会报 jlink/JdkImageTransform
- macOS 不显示扫码按钮（终端和 app 在同一块屏幕上），只加了
  `network.server` entitlement 给广播发现用
- 相机权限由 `camera` 插件自己声明和申请；发现和手输都不碰相机
