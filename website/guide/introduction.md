# ufjs 是什么

ufjs 让你**用 Vue 3 / TypeScript 写界面，用 Flutter 负责原生渲染**。同一份源码还能编译成浏览器静态站点和微信小程序。

它由三样东西组成：

| 组成 | 发布位置 | 作用 |
|---|---|---|
| `@ufjs/cli` | npm | 命令行 `fjs`：创建项目、dev server、打包、生成 Flutter 宿主、编译小程序 |
| `@ufjs/runtime` | npm | 打进你 bundle 的运行时：内置标签、路由、Vue 渲染器、CSS 引擎 |
| `flutter_fjs` | pub.dev | Flutter 插件：内嵌 QuickJS 引擎，把 JS 发来的节点操作画成 Flutter Widget |

你平时只和前两个打交道，第三个由 `fjs run` 自动放进生成的 Flutter 工程里。

## 一张图看懂

```text
Vue 3 / TypeScript / Vite                你写的代码
        │
        ▼
fjs CLI：create / dev / run / build
        │
        ├─ fjs build        → Flutter 应用（QuickJS 字节码，Android / iOS / 鸿蒙 / 桌面）
        ├─ fjs build --web  → 浏览器静态站点 dist/web
        └─ fjs build --mp   → 微信小程序 dist/mp（Skyline + glass-easel）
        │
        ▼
@ufjs/runtime：内置标签 + 路由 + Vue 渲染器 + CSS 引擎
        │
        ▼
flutter_fjs：QuickJS-ng + Dart FFI + Flutter Widget
```

## 和其它方案有什么不同

| | WebView 套壳 | React Native | **ufjs** |
|---|---|---|---|
| 渲染 | 浏览器排版 | 原生控件 | **Flutter Widget** |
| JS 与原生通信 | 字符串桥，异步 | JSI / 旧版异步桥 | **C 函数直调，同步** |
| 写法 | HTML / CSS | React | **Vue 3 SFC** |
| 小程序 | 另写一份 | 不支持 | **同一份源码编译** |
| 包体增量 | 系统 WebView | Hermes 等 | **约 1 MB 的 `libfjs`** |

代价也要说清楚：Flutter 端**没有 DOM、没有浏览器排版引擎**，ufjs 自己实现了一个 CSS 子集（flex 布局为主），能用和不能用的边界是明确列出来的，见[样式](./styling)。

## 支持的平台

| 平台 | 状态 | 怎么跑 |
|------|------|------|
| Web（浏览器） | ✅ 已支持 | `fjs build --web` 或 `vite build` |
| 微信小程序 | ✅ 已支持 | `fjs build --mp`，用微信开发者工具打开 |
| Android | ✅ 已测试 | `fjs run android` |
| iOS | ✅ 已测试 | `fjs run ios` |
| macOS | ✅ 已测试 | Flutter 桌面 |
| 鸿蒙（HarmonyOS） | ✅ 已测试 | 需 OpenHarmony fork 的 Flutter SDK，`fjs run ohos` |
| Windows / Linux | 理论支持 | Flutter 桌面可编译，未实测 |

## 你需要会什么

- **必须**：Vue 3 组合式 API、TypeScript 基础、npm。
- **做 App 时需要**：装好 Flutter（≥ 3.38）。不需要会写 Dart —— 除非你要写原生模块。
- **不需要**：CMake、NDK、Xcode 工程配置（引擎是预编译好随 `flutter_fjs` 发布的）。

## 这份文档怎么读

文档按由浅入深组织：

1. **开始**：[快速开始](./getting-started) → [读懂项目结构](./project-structure) → [写第一个页面](./first-page)。半小时内在浏览器和手机上都跑起来。
2. **基础**：路由、组件、样式、事件、资源、多端差异。写业务需要的全部知识。
3. **扩展**：[添加插件](./plugins)、[三方 UI 组件库](./ui-libs)、[创建模块](./modules)、[配置 Flutter 宿主](./flutter-host)。需要三方库或原生能力时读。
4. **调试与发布**：打包 APK、字节码、小程序上线。
5. **[原理](/advanced/overview)**：ufjs 为什么这样设计，一次点击从手指到屏幕经过了什么。
6. **[源码导读](/source/)**：想读 ufjs 自身的源码、给它提 PR 时看。
