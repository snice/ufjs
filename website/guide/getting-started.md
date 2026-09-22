# 快速开始

这一篇带你从零创建一个项目，依次在**浏览器**、**手机（fjs go）**、**真机 / 模拟器**和**微信小程序**上跑起来。

## 准备环境

| 工具 | 版本 | 什么时候需要 |
|---|---|---|
| Node.js | ≥ 18 | 总是需要 |
| Flutter | **≥ 3.38.0**（Dart 3.10） | 要跑 App 时。纯 Web / 小程序不需要 |
| Android Studio / Xcode | — | 要装到 Android / iOS 设备时 |
| 微信开发者工具 | — | 要预览小程序时 |

::: warning Flutter 版本
3.35 及以下版本编译不过（`@ufjs/webgl` 依赖的 flutter_angle 会让旧版编译器崩溃）。只升到 3.35 也不够，至少 3.38。
:::

不需要 CMake、NDK，也不需要克隆 ufjs 仓库：JS 引擎已经预编译进 pub.dev 上的 `flutter_fjs`，字节码编译器 `fjsc` 会随 `@ufjs/cli` 按平台自动安装。

装完可以随时体检一下：

```bash
npx fjs doctor
```

它会依次检查 Node、依赖版本、fjsc、Flutter、adb / xcodebuild、可用设备。

## 1. 创建项目

```bash
npx @ufjs/cli create my-app
cd my-app
npm install
```

默认模板是 **Vue 3 + Vite**。还有一个不用框架的纯 TypeScript 模板：

```bash
npx @ufjs/cli create my-app --template ts   # 直接调 element API
npx @ufjs/cli create --list-templates        # 查看所有模板
```

生成的 `package.json` 里已经写好了常用脚本：

| 脚本 | 等价命令 | 作用 |
|---|---|---|
| `dev:web` | `vite --host 0.0.0.0` | 浏览器开发 |
| `dev:pages` | `fjs dev --pages` | App 端 dev server（给 fjs go / 真机连） |
| `run:android` / `run:ios` | `fjs run android\|ios` | 生成 Flutter 宿主并装到设备 |
| `build:web` | `vite build` | Web 静态站点 → `dist/web` |
| `build:release` | `fjs build --pages --release` | App 发布构建（字节码） |
| `build:apk` | `fjs build --pages --release --apk` | 直接出 Android APK |
| `typecheck` | `vue-tsc --noEmit` | 类型检查 |

## 2. 在浏览器里跑

```bash
npm run dev:web
```

打开终端里打印的地址，能看到屏幕中间写着项目名。这是一个普通的 Vite dev server，改代码即刻热更新，适合快速调样式和业务逻辑。

## 3. 用 fjs go 在手机上跑

**fjs go** 是 ufjs 的调试客户端（类似 Expo Go）：手机上装一次，之后可以连任意 `fjs dev` 项目，改 JS / Vue 不需要重新打原生包。

**安装**：Android 直接从 [Releases](https://github.com/snice/ufjs/releases/latest) 下载 APK。

| 下载 | 大小 | 用途 |
|------|------|------|
| [fjs-go-release-arm64.apk](https://github.com/snice/ufjs/releases/latest/download/fjs-go-release-arm64.apk) | ~8.7 MB | 日常调试用这个 |
| [fjs-go-debug-arm64.apk](https://github.com/snice/ufjs/releases/latest/download/fjs-go-debug-arm64.apk) | ~42 MB | 需要 Flutter DevTools 时 |

iOS 暂时没有分发包，需要克隆仓库后在 `examples/fjs-go` 下自己 `flutter run`。

**启动 dev server**：

```bash
npm run dev:pages
```

终端会打印局域网地址和二维码（默认端口 `38900`）。

**连接**：

- 真机：在 fjs go 里**扫二维码**，或点「附近的 dev 服务器」（局域网 UDP 自动发现）
- Android 模拟器：手输 `10.0.2.2:38900`
- iOS 模拟器 / macOS：手输 `127.0.0.1:38900`

::: tip
手机和电脑要在同一个局域网。访客网络、AP 隔离会让发现和连接都失败。iOS 第一次连接会弹「本地网络」权限，一定要允许。
:::

现在改一下 `src/pages/index.vue` 里的文字，保存，手机上立刻更新。

## 4. 直接装到真机 / 模拟器

不想用 fjs go，或者项目里有自定义原生代码时，直接生成完整 App：

```bash
npm run run:android
npm run run:ios
```

`fjs run` 会自动：

1. 在项目里创建（或复用）Flutter 宿主工程 `.fjs/flutter`
2. 启动 `fjs dev --pages`
3. 执行 `flutter run`，并通过 `--dart-define=FJS_DEV=<地址>` 把 dev server 地址注入 App

所以装上去的 App 同样连着 dev server，改代码照样热更新。

```bash
npx fjs devices                          # 看有哪些设备可用
npx fjs run ios --device <device-id>     # 指定设备
npx fjs run android --release            # 用字节码 release 模式跑
```

## 5. 编译成微信小程序

```bash
npx fjs build --mp     # 产物在 dist/mp/
npx fjs dev --mp       # 监听 src/，增量重建 dist/mp
```

用**微信开发者工具**打开 `dist/mp/` 目录即可预览。dev 模式下开发者工具自己监听 `dist/mp` 的变化热编译，`fjs dev --mp` 只负责重建。

appid 默认是 `touristappid`（游客模式），正式 appid 写在 `app.config.ts`：

```ts
export default defineConfig({
  wxmp: { appid: 'wx1234567890abcdef' },
});
```

## 6. 发布构建

```bash
npm run build:release   # JS → 引擎字节码，复制进 Flutter 宿主 assets
npm run build:apk       # 再执行 flutter build apk
npm run build:web       # 浏览器静态站点
```

APK 输出在 `.fjs/flutter/build/app/outputs/flutter-apk/`。详见[构建与发布](./build-and-release)。

## 下一步

- [读懂项目结构](./project-structure)：刚才生成的每个文件是干什么的
- [写第一个页面](./first-page)：做一个能跳转、有交互的小应用
