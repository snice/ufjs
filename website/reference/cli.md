# CLI 命令

`@ufjs/cli` 提供 `fjs` 命令。项目内用 `npx fjs <命令>` 或 package.json 脚本调用。`fjs --help` 打印完整帮助。

## 创建

### `fjs create [dir]`

创建新项目。

| 参数 | 说明 |
|---|---|
| `--template <name>` | 模板，默认 `vue3-vite`；另有 `ts`（纯 TypeScript + element API） |
| `--list-templates` | 列出可用模板 |
| `--name <name>` | package name |
| `--yes` | 使用默认值，跳过交互 |

### `fjs create page <name>`（别名 `fjs g page`）

生成 `src/pages/<name>.vue`。名字可以嵌套（`comp/button`）和带动态段（`user/[id]`）。

| 参数 | 说明 |
|---|---|
| `--title <text>` | 写进 `<route>` 的标题 |
| `--tab <n>` | 写进 `<route>` 的 tab 序号 |
| `--path <route>` | 覆盖推导出的路由路径 |
| `--route-name <name>` | 覆盖推导出的路由名 |
| `--platform <app\|web>` | 限定平台 |
| `--dry-run` / `--force` | 只打印 / 覆盖 |

### `fjs create component <Name>`

生成 `src/components/<Name>.vue`。支持 `--dry-run` / `--force`。

### `fjs create module <name>`

生成 `src/modules/<name>`：可以直接 `npm publish` 的模块。见[创建模块](/guide/modules)。

| 参数 | 说明 |
|---|---|
| `--component <Name>` | 生成的组件名 |
| `--no-component` | 纯 API 模块 |
| `--prefix <P>` | 全局组件前缀 |
| `--flutter` | 生成 Dart 侧（宿主函数 + Widget + Web 替身）并写好 autolink |
| `--widget <tag>` | Widget 标签名（隐含 `--flutter`） |
| `--no-widget` | 只要宿主函数 |
| `--dry-run` / `--force` | 只打印 / 覆盖 |

### `fjs add <package>...`

安装 JS 库并接进项目。见[添加插件](/guide/plugins)。

| 参数 | 说明 |
|---|---|
| `--list` | 列出支持的库 |
| `--dry-run` | 只打印改动 |
| `--force` | 覆盖已存在的 `src/plugins/<name>.ts` |
| `--no-install` | 只改 package.json，不执行安装 |
| `--entry <file>` | 要修改的入口文件，默认 `src/main.ts` |

## 开发

### `fjs dev [entry]`

启动 dev server。

| 参数 | 说明 |
|---|---|
| `--pages` | App 端分包 dev server（fjs go / `fjs run` 用这个） |
| `--web` | 以浏览器静态站点方式提供 |
| `--mp` | 小程序：监听源码增量重建 `dist/mp` |
| `--port <n>` | 端口，默认 38900（`--web` 为 5173）；被占用时自动递增 |
| `--host <addr>` | 绑定地址，默认 `0.0.0.0` |
| `--no-qr` | 不打印二维码 |
| `--no-discovery` | 不在局域网广播（fjs go 的「附近的服务器」看不到） |

运行时的终端快捷键：`r` 完整重建 · `l` 开关日志 · `d` 连接数 · `c` 地址和二维码 · `o` 打开浏览器 · `p` 性能面板 · `?` 帮助 · `q` 退出。

### `fjs run <android|ios|ohos>`

创建 / 复用 Flutter 宿主，启动 dev server，执行 `flutter run`。`--` 后面的参数透传给 `flutter run`。

| 参数 | 说明 |
|---|---|
| `--release` | 构建 release 字节码，`flutter run --release` |
| `--profile` | 同上，但 profile 模式（量性能） |
| `--no-minify` | 配合 release / profile：不压缩 |
| `--gz` | 配合 release / profile：gzip 资源 |
| `--no-pages` | 配合 release / profile：单包构建 |
| `--device <id>` | 设备 id |
| `--port <n>` | dev server 端口 |
| `--flutter-dir <dir>` | 宿主目录 |
| `--js-engine <primjs\|quickjs>` | 运行时用哪个引擎 flavor，默认 `primjs`（`fjs debug` 只在它上面可用）；`quickjs` 是无调试器的回退 |

### `fjs devices`

列出 `fjs run` 能用的 Android / iOS / 鸿蒙设备，`*` 标出默认选择。`--json` 机器可读。

### `fjs log`

实时查看 App 的 console 输出。`--port <n>` / `--host <addr>` 指定 dev server。

### `fjs eval <expression>`

在运行中的 JS 虚拟机里求值。`--timeout <ms>` 默认 5000。

### `fjs debug`

起一个 CDP 中继，让 Chrome DevTools 直连正在跑的 App：断点、单步、调用栈、局部变量，以及 Elements / Network / Console 面板。`fjs dev` 或 `fjs run` 跑着的时候另开一个终端执行；用法与限制见[调试](/guide/debugging#断点调试)。

| 参数 | 说明 |
|---|---|
| `--cdp-port <n>` | DevTools 侧端口，默认 38902（只绑 `127.0.0.1`） |
| `--vm-port <n>` | App 虚拟机侧通道端口，默认 38903 |
| `--port <n>` / `--host <addr>` | dev server 的地址（中继注册在它上面） |

### `fjs lint [paths...]`

静态检查 CSS：把「引擎不支持、写了也不生效」的规则提前报到命令行，扫描 `src/**/*.vue` 的 `<style>` 块与静态 `style` 属性、`src/**/*.css`。支持矩阵与引擎行为一一对应，见[样式](/guide/styling)。

| 参数 | 说明 |
|---|---|
| `--strict` | warn 也算失败（CI / pre-commit 用） |

`[drop]`（整条不生效，如 `#id` 选择器、`@import`）退出码 1；只有 `[warn]`（两端分叉，如位图背景、`transition: filter`）退出码 0。

### `fjs types`

立即写出 / 刷新 `src/fjs-routes.d.ts`、`fjs-assets.d.ts`、`fjs-modules.d.ts`、`fjs-components.d.ts` 四个生成文件（与 dev / build 同一条写入规则，变了才写）。刚 checkout 的项目不用先跑 dev 就有补全。

| 参数 | 说明 |
|---|---|
| `--check` | 只读；有过期文件时列出并退出码 1（CI 用） |

## 构建

### `fjs build [entry]`

| 参数 | 说明 |
|---|---|
| `--pages` | 分包：`shared.js` + `bundle.js` + `pages/<id>.js` |
| `--bytecode` | 同时输出 `.fjsbundle` 字节码 |
| `--release` | 字节码 + 同步到 Flutter 宿主 assets |
| `--profile` | 同上，配合 `--apk` 出 profile 包 |
| `--apk` | 配合 release / profile：`flutter build apk` |
| `--hap` | 配合 release / profile：`flutter build hap`（鸿蒙） |
| `--ipa` | 配合 release / profile：`flutter build ipa`（仅 macOS + Xcode；签名导出失败会留下 `.xcarchive`，可用 `-- --export-options-plist <file>` 透传） |
| `--aab` | 配合 release / profile：`flutter build appbundle`（Play 上架的 `.aab`） |
| `--gz` | 配合 release：gzip 复制进宿主的字节码 |
| `--root-path <path>` | 配合 release：改写 `manifest.json` 里的路径前缀（默认 `assets/fjs/`）；传 `.` 可把产物目录直接部署到站点根（fjs go 在线演示的用法） |
| `--web` | 浏览器静态站点 → `dist/web` |
| `--mp` | 微信小程序 → `dist/mp` |
| `--analyze` | 体积报告 |
| `--devtools` | 非 dev 构建保留 Elements / Network 面板的数据平面（`fjs dev` 天然有；普通构建会剔掉，release 始终没有） |
| `--js-engine <primjs\|quickjs>` | 字节码 / release 构建用哪个引擎 flavor：`primjs`（默认，带 CDP 调试器）或 `quickjs`（quickjs-ng，无调试器），同时把该 flavor 物化进插件 |
| `--no-minify` | 不压缩 |
| `--out <dir>` | 输出根目录，默认 `dist` |
| `--flutter-dir <dir>` | 宿主目录 |

`--web` 与 `--pages` 互斥；`--mp` 必须单独使用；`--apk` / `--hap` / `--ipa` / `--aab` 一次只能选一种。`--` 后面的参数透传给 `flutter build`。

### `fjs preview`

只读静态服务 `dist/web`，验证 release web 产物（同 `vite preview` 的定位）：不重新构建、不注入热更新片段，SPA 兜底与诚实 404 和 `fjs dev --web` 共用同一套逻辑。

| 参数 | 说明 |
|---|---|
| `--out <dir>` | 构建输出根目录，默认 `dist`（服务 `<dir>/web`） |
| `--port <n>` | 端口，默认 4173 |
| `--host <addr>` | 绑定地址，默认 `127.0.0.1` |

## 项目信息

| 命令 | 说明 |
|---|---|
| `fjs routes [--platform app\|web] [--json]` | 打印路由表 |
| `fjs modules [--json]` | 解析到的模块、标签和 autolink |
| `fjs doctor` | 环境与项目体检（含 cli ↔ runtime ↔ flutter_fjs 的 minor 版本咬合检查） |

## 宿主

| 命令 | 说明 |
|---|---|
| `fjs host [status]` | 宿主在哪、归谁管、包名、`flutter_fjs` 来源 |
| `fjs host create` | 创建 / 更新宿主，不运行 |
| `fjs host open <android\|ios\|ohos>` | 用 Android Studio / Xcode / DevEco 打开 |
| `fjs host eject [dir]` | 移进仓库（默认 `flutter/`），此后不再重写 |
| `fjs host sync [--force]` | 重新应用生成版宿主文件 |
| `fjs host id [<app.id>]` | 查看 / 设置 applicationId 和 bundle identifier |
| `fjs icon <file.png> [--platform android\|ios] [--dry-run]` | 生成应用图标 |
| `fjs splash <file.png> [--color <#rrggbb>] [--size <px>] [--platform android\|ios] [--dry-run]` | 从一张 PNG 重新生成三套启动屏：Android `launch_background` layer-list + 分密度图 + values-v31 系统 splash，iOS LaunchImage 三倍图 + storyboard 背景色；`--size` 是 logo 逻辑尺寸（默认 192），`--color` 缺省沿用模板白 |

## 升级

### `fjs upgrade`

把 `@ufjs/cli`、`@ufjs/runtime` 和宿主 `pubspec.yaml` 里的 `flutter_fjs` 一起升到咬合的版本（三者必须同一个 minor，`fjs doctor` 会查、这条命令负责修）：target 是 npm 上最新的 cli，runtime 与 flutter_fjs 取同 minor 的最高版（flutter_fjs 走 pub.dev API）。

| 参数 | 说明 |
|---|---|
| `--check` | 只打印 from → to 计划，不改任何文件 |

eject 过的宿主、pnpm workspace 里的 path 依赖会自动跳过。

## 清理

### `fjs clean`

| 参数 | 说明 |
|---|---|
| `--all` | 连 Flutter 宿主一起删（eject 过的不删） |
| `--dry-run` | 只打印 |
| `--out <dir>` / `--flutter-dir <dir>` | 指定目录（必须在项目内） |

## 环境变量

| 变量 | 说明 |
|---|---|
| `FJSC_PATH` | 字节码编译器 fjsc 的路径 |
| `FJS_JS_ENGINE` | 引擎 flavor，等价于 `--js-engine`，默认 `primjs` |
