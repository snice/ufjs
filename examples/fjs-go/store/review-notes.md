# App 审核信息（App Review Information）

填到版本页底部「App 审核信息」。审核员读英文，**备注用英文**；中文对照供自查。

| 字段 | 填写 |
|------|------|
| 需要登录 | 否（取消勾选「需要登录」） |
| 联系人 / 电话 / 邮箱 | 填你自己的，审核员有问题会联系 |
| 附件 | 可选：一段 30 秒录屏（首页 → 在线演示 → 切 tab → 打开 3D 飞机大战），能明显降低沟通成本 |

## 备注（Notes）——直接粘贴

```
fjs go is a developer tool: the development client of the ufjs framework (https://github.com/snice/ufjs), comparable to Expo Go for React Native.

Developers write their app pages in Vue 3 / TypeScript on their own computer and run the "fjs dev" command. fjs go connects to that server (by scanning its QR code, by local network discovery, or by typing its address) and renders the developer's own project with native Flutter UI, reloading whenever they save a file. It does not offer, sell or distribute third-party apps.

HOW TO REVIEW WITHOUT A COMPUTER
1. Launch the app. The interface is in Simplified Chinese.
2. Tap "在线演示" (Online Demo), the white card directly below the orange "扫码连接" (Scan to connect) card.
3. The official sample project loads from https://fjs-showcase.zhuzhe.dev (an internet connection is required). It shows the framework's built-in components (tab "内置组件"), APIs (tab "接口") and examples such as charts, WebGL and small demo games (tab "示例").
4. The dark floating button with the lightning bolt opens the developer menu: reload, console log ("日志"), and exit ("退出演示").

PERMISSIONS
- Camera: only to scan the QR code printed by "fjs dev". Frames are decoded on the device and never stored or uploaded.
- Local Network: to discover and connect to "fjs dev" running on the developer's computer on the same Wi-Fi.

REGARDING GUIDELINE 2.5.2
The code fjs go runs is the developer's own project, served from their own computer during development, or the framework's official sample project for evaluation. It is not used to add features to fjs go itself, change its purpose, or distribute apps. Production apps built with ufjs bundle their code in their own binaries and never depend on fjs go.

No account, no in-app purchase, no advertising, no analytics, and no personal data collection.
```

## 中文对照（自查用，不必粘贴）

- fjs go 是 ufjs 框架的开发调试客户端，定位同 React Native 的 Expo Go。
- 开发者在自己电脑上用 Vue 3 / TS 写页面并运行 fjs dev；fjs go 扫码 / 局域网发现 / 手输地址连上后，用原生界面渲染开发者自己的工程，保存即刷新；不提供、不销售、不分发第三方 App。
- 无电脑审核路径：首页「在线演示」→ 加载官方示例工程（需联网）→ 三个 tab 分别是组件、接口、示例；闪电悬浮按钮是开发菜单。
- 权限：相机只用于扫 fjs dev 的二维码，本地解码不存不传；本地网络用于发现和连接同一 Wi-Fi 下的 fjs dev。
- 2.5.2：运行的代码是开发者自己的工程或官方示例，不用来给 fjs go 增加功能、改变用途或分发 App；正式 App 把代码打进自己的安装包，不依赖 fjs go。
- 无账号、无内购、无广告、无统计、不收集个人数据。

## 可能的追问与回复要点

- **「App 下载并执行代码」（2.5.2）**：强调开发者工具属性、执行的是开发者自己的代码；类比 Expo Go、Swift Playgrounds 等同类工具；正式 App 不依赖 fjs go。
- **「示例里有小游戏」（4.7 小程序 / 小游戏）**：这些是框架能力的技术样例（Canvas / WebGL 渲染演示），不是可分发的游戏内容，没有商店、没有账号、不能从第三方加载。若审核坚持，可在示例工程里隐藏「交互游戏」分组后重新部署演示站，无需重新提交 App。
- **「功能太少 / 仅为网页壳」（4.2）**：扫码、局域网发现、热重载、日志、开发菜单都是原生实现；演示工程由原生 Flutter 组件渲染，不是 WebView。
