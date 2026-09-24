# 工具链：创建、运行、测试、编译

> 第四层。全部 `fjs` 命令。仓库自身的包管理规范在
> [monorepo.md](monorepo.md)。

`@ufjs/cli` 提供 `fjs` 命令。主路径是：

```bash
npx @ufjs/cli create my-app
cd my-app
npm install
npm run dev:web
npm run dev:pages
npm run run:android
npm run build:release
```

## 准备环境

**最低 Flutter 版本：3.38.0（Dart 3.10）**，纯 Web 构建不需要 Flutter。更低的
版本编译不过：`@ufjs/webgl` 用的 flutter_angle 0.4.x 会让 Dart 3.10 之前的 CFE
崩在 `Crash when compiling: Null check operator used on a null value`——一个私有
`@Native` 函数收 TypedData `.address`，编译器给克隆出来的目标起了个下划线开头的
名字，而私有名要求带 library。**Flutter 3.35（Dart 3.9）也在这条线里**，别只升
到 3.35。

分两种情况，除了依赖来源不同，之后所有 `fjs` 子命令完全一样。

### A. 用发布包做应用

装 CLI 就够了，**不需要 CMake、NDK 或克隆本仓库**：

```bash
npx @ufjs/cli create my-app && cd my-app && npm install
```

- `flutter_fjs` 由 `fjs run` 生成的 Flutter 宿主从 pub.dev 拉，里面带了预编译的
  `libfjs.so` 和 `fjs.xcframework`
- 字节码编译器 `fjsc` 是 `@ufjs/cli` 的可选依赖 `@ufjs/fjsc-<平台>`，按 `os`/`cpu`
  自动装匹配的那个。包里有两个二进制：`bin/fjsc`（primjs，默认）和
  `bin/fjsc-quickjs`（`--js-engine quickjs`），见下文「fjsc 的查找顺序」

装完发现 `--bytecode` 报「no primjs fjsc found」且没列出任何候选，多半是发布窗口期的 npm 缓存问题——
optional 依赖解析失败是静默的。`npm cache clean --force` 后重装。

### B. 在本仓库开发

```bash
pnpm install
```

workspace 会把 `demo`、`examples/*` 链到 `packages/fjs` 和 `packages/fjs-runtime`
的源码；Flutter 侧走 `packages/flutter_fjs` 的 path 依赖。

`fjsc` 自己编一次，它必须和 Flutter 插件内嵌的引擎来自同一份源码（默认 primjs；
quickjs flavor 的构建目录见下文「JS 引擎切换」）：

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON
cmake --build build-native -j
./build-native/fjs-test
```

Linux 上要加 `-DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++`：默认的
primjs flavor 只能用 clang 编（上游写死了 clang 专用参数），用 gcc 时 configure
阶段就会报错；quickjs flavor 不挑编译器。

### fjsc 的查找顺序

引擎静态链接在 `fjsc` 里，**一个 flavor 就是一个二进制**；编出的 bundle 头里带
引擎 id，App 加载时 id 不符会直接拒绝。所以 `fjs build --bytecode` / `--release`
不看路径、不看文件名，而是把每个候选不带参数跑一次，读它自报的
`engine: <id>`，只用 id 等于目标引擎（`--js-engine` / `FJS_JS_ENGINE`，默认
primjs）的那个（spec 114）。候选顺序：

1. 环境变量 `FJSC_PATH`——**引擎不符直接报错，不往下找**：显式设的值错了要让人知道
2. 仓库内 `packages/flutter_fjs/native/build-native/fjsc` 与
   `build-native-quickjs/fjsc`，两个都探测，目录名只决定先看哪个
3. npm 包 `@ufjs/fjsc-<平台>` 的 `bin/fjsc` 与 `bin/fjsc-quickjs`

都不符时报错并列出每个候选和它的引擎。编完后还会从 fjsc 的输出行
`(N bytes, engine <id>)` 再核对一次，不符就删掉产物。

**仓库自编排在 npm 包前面**是刻意的：`pnpm install` 也会把 npm 包拉进 workspace，
如果它赢了，改完 `native/` 的人就会继续用已发布的旧引擎编字节码。第 2 条路径从
`node_modules` 里匹配不到，所以装到用户项目里仍然走第 3 条。

**别靠文件名**：已发布的 `@ufjs/fjsc-*@0.1.4` 只有一个 `bin/fjsc`，实际是
quickjs-ng。新 CLI 用它编 quickjs 没问题，编 primjs（默认）会在构建阶段报错——
升级 `@ufjs/cli` 让它带上新版 fjsc 包，或者用 `FJSC_PATH` 指向一个 primjs 的 fjsc。

## 创建项目

```bash
npx @ufjs/cli create my-app        # A
pnpm exec fjs create my-app        # B，工作区已 link
```

默认模板是 `vue3-vite`。模板会生成标准 Vite 项目，并带上 fjs 需要的页面目录：

```text
my-app/
  index.html
  vite.config.ts
  package.json
  src/
    main.ts
    Shell.vue
    pages/
      index.vue
```

首页是 `src/pages/index.vue`，默认文本为 `hello-fjs`。`src/pages` 是必须目录，
路由表由它自动生成。

本仓库内置的 `demo` 已改成 `workspace:*` 依赖，适合验证当前 checkout 的 CLI 和
runtime：

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run build:release
```

常用创建参数：

| 参数 | 说明 |
|------|------|
| `--template <name>` | 指定模板，当前默认 `vue3-vite` |
| `--list-templates` | 查看可用模板 |
| `--name <name>` | 指定 package name |
| `--yes` | 使用默认值，跳过交互 |

当前模板：

| 模板 | 说明 |
|------|------|
| `vue3-vite` | 默认模板，Vue 3 + Vite + `src/pages` 路由 |
| `ts` | 纯 TypeScript + element API，单包 release，模板列表中放在最后 |

后续扩展 React 等模板时，只需要往 create 的模板注册表里增加新模板。

## 在已有项目里生成文件

`fjs create` 的第一个参数如果是 `page` / `component` / `module`，它生成的是文件
而不是项目。`fjs g` 是只做生成的别名。

```bash
fjs create page about --title 关于       # src/pages/about.vue        -> /about
fjs create page user/[id]               # src/pages/user/[id].vue    -> /user/:id
fjs g page settings --platform app      # 只在 App 端出现的页面
fjs create component FancyButton        # src/components/FancyButton.vue
fjs create module qrcode --flutter      # src/modules/qrcode：可发 npm 的模块
```

`module` 生成的是一个自带 package.json 的包：API 在 `index.ts`（`import { … }
from 'qrcode'`），组件在 `components/`（`<QrcodeView />` 直接用，不用 import），
`--flutter` 还会生成 Dart 侧并写好 autolink 清单。发到 npm 之后别人装上即用，
细节见[模块](modules.md)。

| 参数 | 说明 |
|------|------|
| `--title <text>` | 写进 `<route>` 块的标题 |
| `--tab <n>` | 写进 `<route>` 块的 tab 序号 |
| `--path <route>` | 覆盖由文件名推导的路由路径 |
| `--route-name <name>` | 覆盖由路径推导的路由名 |
| `--platform <app\|web>` | 限定平台，缺省两端都有 |
| `--dry-run` / `-n` | 只打印将写入的内容 |
| `--force` / `-f` | 覆盖已存在的文件 |

页面名可以嵌套（`comp/button`）也可以是动态段（`[id]` / `[...rest]`）；带动态段
时模板会顺手写好 `useRoute()` 和参数展示。生成器写完文件后，会用**构建期同一个
扫描器**重新解析一遍并打印实际路由，所以打印出来的就是 `fjs build` 看到的。

同时它会把路由表写成 `src/fjs-routes.d.ts`（`fjs build` / `fjs dev` / Vite 插件
也会写），`router.push({ name })` 因此有补全和拼写检查，详见
[路由](routing.md#路由名的类型提示)。

## 添加三方库

```bash
fjs add pinia               # 装包 + 写插件文件 + 接进入口
fjs add dayjs mitt          # 只动 package.json
fjs add --list              # 支持哪些
fjs add pinia --dry-run     # 只打印要改什么
```

registry 里每个条目分两类，这是这个命令存在的全部理由：

| kind | 改什么 | 例子 |
|------|--------|------|
| `dep` | 只有 `package.json` | dayjs、mitt、valibot、immer、es-toolkit |
| `plugin` | `package.json` + `src/plugins/<name>.ts` + 入口（仅第一次） | pinia、vue-i18n |

`plugin` 类需要 `app.use()`。它写出的文件默认导出 `(app) => void`，`fjs build` /
`fjs dev` / Vite 插件会把 `src/plugins/*.ts` 收集成生成模块 `fjs/plugins`——和
`fjs/pages` 收集路由表是同一套机制。入口只在**第一次**装 `plugin` 类库时被改一行：

```ts
import { plugins } from 'fjs/plugins';

createFjsApp({ routes, plugins, shell: Shell }).mount();
```

之后再 `fjs add`，命令看到这个 import 就不再动入口。新建项目的模板自带这一行，
所以对新项目来说入口永远不用改。

插件文件支持 `.app.ts` / `.web.ts` 后缀限定平台，加载顺序按文件名字典序，需要抢先
的用 `10-` 这样的前缀。

### 一个要记住的坑

Flutter 端**每个页面是独立的 Vue app**，所以插件函数每页跑一次。必须跨页共享的
东西（Pinia 实例、i18n 实例）要写在插件文件的**模块作用域**，不能建在导出的函数
里，否则每页各拿一套 store：

```ts
const pinia = createPinia();          // 模块作用域：全 app 一个
export default (app: App) => app.use(pinia);
```

`fjs add pinia` 生成的文件已经是这个形状。`fjs build --pages` 下 `fjs/plugins` 走
共享 chunk，页面 chunk 通过 `__FJS_SHARED` 引用同一个 store 模块。

### UI 组件库适配：vite 插件的 `fjs.app` 钩子

App 端打包（`fjs dev` / `fjs build`）走 esbuild，不跑 Vite。但组件库的适配仍然写在
项目的 `vite.config` 里：一处声明，两端生效。一个 Vite 插件只要带上 `fjs.app`
钩子，App 端打包就会加载 `vite.config`，并对匹配的文件执行这个钩子：

```ts
import { fjs } from '@ufjs/cli/vite';
import { vant } from './vite/vant';   // 项目本地的插件文件

export default defineConfig({ plugins: [fjs(), vant(), vue()] });
```

```ts
// 插件作者：钩子的形状（类型见 @ufjs/cli/vite 的 FjsAppHook）
{ name: 'my-ui', fjs: { app: {
    filter: /\/my-ui\/dist\/.*\.mjs$/,   // 绝对路径、`/` 分隔、Go 正则（esbuild onLoad）
    transform(code, id) { return patched },  // 返回 null 表示不改
} } }
```

- 只有声明了 `fjs.app` 的插件会在 App 端执行；plugin-vue、`fjs()` 等仍只作用于 web。
- 多个钩子命中同一文件时，按 config 里的顺序串联；`.vue` / `.css` 仍由 fjs 自己编译。
- `vite.config` 每个进程只加载一次，改了之后要重启 `fjs dev`。
- 组件库特有的处理（源码补丁这类）一律放进这种插件，**不进** `@ufjs/cli` 和
  `@ufjs/runtime`；runtime 只提供通用的 DOM/CSS 兼容，也不模拟 `window` /
  `document`——库里没做浏览器判断就直接用它们的地方，同样在插件里打补丁。
- 这类插件放在项目本地（和 `vite.config` 放在一起，如 `vite/vant.ts`），不单独发
  npm 包。参考 demo 的 [`demo/vite/vant.ts`](../demo/vite/vant.ts)。

demo 的 `vite/vant.ts` 是目前最完整的范例，十几条补丁分三类：

- **`window` / `document` 守卫**：vant 里没做浏览器判断就摸 `window` /
  `document` 的路径（`isWindow`、`useLockScroll`、`getScrollParent`、
  `isHidden`、Field autosize），App 端会直接 ReferenceError 并把组件更新中途
  打断——补上 `typeof window === "undefined"` 早退或让调用方走已有回退
- **`touch-action` 声明**：Slider / Rate 在 scroll-view 里的拖动。web 上靠非
  passive `touchmove` 里 `preventDefault()` 赢下手势，App 端监听晚手势竞技场
  一帧、指针已判给滚动容器——`touch-action` 是两端都认的抢手势声明
- **测量重试**：Tabs 下划线在挂载帧读 `offsetLeft / offsetWidth` 还是 0（首帧
  布局还没发生），按 rAF 重试至多 10 帧

补丁是**字面量锚点替换**：库升级后锚点对不上就跳过该补丁、构建告警一次并
写明哪个功能在 App 端失效——宁要显式降级，不要坏 bundle。demo 另带
[`src/plugins/vant/dom-env.ts`](../demo/src/plugins/vant/dom-env.ts)：在 vant
求值前装一个只含它所需表面的最小 `window` / `document` 侧影（rAF、读 fjs
样式引擎的 `getComputedStyle`、document 级 pointer-down、首次可见的
IntersectionObserver）——这是项目对单个库的 opt-in，runtime 仍然不装全局
假象，上面的守卫补丁继续覆盖 window 缺失时的路径。注册与样式按需引入
的配套写法见 `demo/src/plugins/vant.ts`（通用机制在
[vue3.md 的第三方组件库一节](vue3.md#第三方组件库兼容vant)），对拍页面是 demo
的 `vant: *` 五页——basic / form / feedback / more / nav（specs/068–073）。

### 共享 chunk：`fjs.shared`

`fjs build --pages` 会把 vue / fjs 运行时放进 `shared.js`，页面 chunk 通过
`__FJS_SHARED` 引用，不各带一份。第三方库默认**不在**这个名单里——页面 chunk 里
直接 `import { storeToRefs } from 'pinia'` 就会被 esbuild 复制一份进那个 chunk。

这不只是体积问题：两份 pinia 就是两个 `activePinia` 模块变量，页面 chunk 里读到的
会是另一个 store。所以带模块级状态的库要登记到 package.json：

```json
{
  "fjs": {
    "shared": ["pinia"]
  }
}
```

`fjs add` 对 registry 里声明了 `shared` 的条目会自动写这一项。手动加时判断标准是：
**页面 chunk 会直接 import 它，并且它有模块级状态**（pinia、vue-i18n）。纯函数库
（dayjs、es-toolkit）不需要，多一份副本只是多几 KB。

demo 里实测：about 页加一行 `storeToRefs` 后，`dist/app/pages/about.js` 从 1738 B 涨到
4707 B；登记 `fjs.shared` 后回到 1848 B，`shared.js` 只多 1.6 KB。

### 和 `fjs native add` 的分界

`fjs add` 只动 JS 侧。要动 Flutter 宿主（pubspec 插件、Dart 注册、权限清单）的原生
能力归 `fjs native add <capability>`（见 [roadmap](roadmap.md)），它们生命周期不同：
原生能力要能 list/remove/sync 对着可 eject 的宿主收敛。JS 库用 registry 里的
`requires` 声明依赖哪个 capability，缺了就提示先装它，而不是等到运行时报错。

## 字体（`@font-face`）

App 构建（`fjs build` / `fjs dev` 的 Flutter 路径）会处理样式里的 `@font-face`
（specs/071）：`src` 中的 WOFF2 / WOFF——无论是 `data:` 内联还是相对 CSS 文件的
本地文件——统一解码成 TrueType 并内联为 `data:font/ttf`，因为 Flutter 只保证
TTF/OTF。WOFF2 解码用 `wawoff2`（wasm，首次用到时才加载），WOFF 由 CLI 自带的
解码器处理；远程 `http(s)` 源原样保留（App 运行时跳过）。

构建日志里会出现两类提示：字体文件找不到 / 解码失败（该 src 保持原样，运行时
会再告警一次），以及内联字体超过 1 MB 的体积提醒——字体进的是 JS 包，大的正文
字体（中日韩全字库）会明显拖慢加载。Web 构建不做任何改写，浏览器直接读 WOFF2。

## 查看路由表

```bash
fjs routes                  # PATH / NAME / CHUNK / TARGET / FILE / META
fjs routes --platform web   # 只看 web 端会包含的页面
fjs routes --json
```

同一路径被两个文件命中时会给出告警——文件路由最常见的坑就是这个。

## 静态检查 CSS：`fjs lint`

fjs 的 CSS 引擎不是浏览器，页面写了不支持的东西（`#id` 选择器、
`word-break`、`vw` 单位、`@import`……）运行期才 `warnOnce`，Web 端浏览器
更是直接静默丢弃。`fjs lint` 把这件事提前到命令行：扫
`src/**/*.vue` 的 `<style>` 块与静态 `style="…"` 属性、`src/**/*.css`，
对照支持矩阵（[`css-compat.md`](css-compat.md) 的机器可读镜像
`fjs-runtime/src/css/support.ts`）逐条报告。

```bash
fjs lint                    # 扫整个 src/
fjs lint src/pages/demo.vue # 只扫指定文件/目录
fjs lint --strict           # warn 也算失败——CI / pre-commit 用
```

发现分两级：

- **`[drop]`**（退出码 1）：整条/整块不会生效——不支持的选择器、属性、
  单位、at-rule。`#id` 尤其要留神：裸 `#id` 是死规则，`#id .x` 会**静默
  放宽成 `.x`**，比不生效更糟。
- **`[warn]`**（退出码 0）：部分生效或两端分叉——`transition` 过渡了
  App 端不会动画的属性、位图背景、`@keyframes` 里的非 transform/opacity
  帧、`@font-face` 的远程源等。`--strict` 把它们也算失败。

`:style="{ filter: x }"` 这类对象字面量**不在扫描范围**：值是任意表达
式，静态判别必然误报（同 asset 检查只看字面量 `src` 的理由）。新增 CSS
支持后要同步支持表，见 [css-compat.md](css-compat.md) 最后一节的流程。

## 生成类型文件：`fjs types`

`src/fjs-routes.d.ts` / `fjs-assets.d.ts` / `fjs-modules.d.ts` /
`fjs-components.d.ts` 四个生成文件平时由 dev server、构建和 Vite 插件
顺带写入；`fjs types` 把同一份生成暴露成命令，刚 checkout 的项目不用先
跑 dev 就有补全：

```bash
fjs types                   # 写出/刷新，变了才写（与 dev/build 同一条写入规则）
fjs types --check           # 只读；有过期文件时列出并退出码 1——CI 用
```

项目没有本地模块/资产时照旧不生成（输出 `skipped`）；核心标签的组件类型
由 `@ufjs/runtime` 自带的 `vue-global.d.ts` 提供（跟着包走），这条命令只
负责项目级的四个文件。

## Flutter 宿主

默认宿主在 `.fjs/flutter`：被 gitignore，每次 `fjs run` 都会重新生成
`lib/main.dart` 和 `pubspec.yaml`。这个默认适合「界面全用 JS 写」的阶段。

### 原生应用配置

在项目根目录创建 `app.config.ts`（与 `package.json` 同级），为自动生成的
`.fjs/flutter` 配置 Android/iOS 包名和权限：

```ts
import { defineConfig } from '@ufjs/cli/config';

export default defineConfig({
  version: '1.2.0+3',
  orientation: 'landscape',
  android: {
    applicationId: 'com.acme.demo',
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
  },
  ios: {
    bundleIdentifier: 'com.acme.demo',
    infoPlist: {
      NSCameraUsageDescription: '用于扫描二维码',
      NSLocalNetworkUsageDescription: '用于连接开发服务器',
    },
  },
});
```

从 `@ufjs/cli/config` 导入 `defineConfig` 后，编辑器会提示 `version`、
`orientation`、`applicationId`、`permissions`、`bundleIdentifier` 和
`infoPlist` 的类型。也可以只导入 `AppConfig`，用 `satisfies AppConfig` 做
类型检查。

`fjs host create` 和 `fjs run` 会把这些配置同步到 managed Flutter 宿主：

- `version` 写入生成宿主 `pubspec.yaml` 的 `version:` 行（不配置时保持默认
  `1.0.0+1`）。`flutter build` 会从这里推导 Android 的
  `versionName`/`versionCode` 和 iOS 的 `CFBundleShortVersionString`，所以
  APK/IPA 的版本号只改这一处即可；eject 之后 pubspec 归你维护，fjs 不再碰；
- `orientation` 锁定屏幕方向，横屏游戏（如 racing）配 `landscape`：Android
  映射为 MainActivity 的 `android:screenOrientation="sensorLandscape"`
  （正反两个横屏方向都允许），iOS 改写 `Info.plist` 的两组
  `UISupportedInterfaceOrientations` 数组并自动写入 `UIRequiresFullScreen`——
  iPad 多任务开启时没有这个键方向锁会静默失效。`portrait` 同理。不配置时
  原生文件不动；想恢复全方向，删掉配置后用 `fjs clean` 重新生成宿主；
- Android 的 `applicationId` 和 `android/app/src/main/AndroidManifest.xml` 权限；
- iOS 的 `PRODUCT_BUNDLE_IDENTIFIER` 和 `ios/Runner/Info.plist` 键值。

配置只覆盖 FJS 写入的标记区块，重复运行不会重复添加。没有配置的字段保持
Flutter 默认值。Android 权限写完整的 permission name；iOS 的 `infoPlist` 键名
就是 Apple 的 Info.plist key，例如 `NSCameraUsageDescription`。

### 首次装机会弹两张系统授权（iOS）

全新安装的 app 第一次连 dev server，iOS 会问两件事，**它们是两张不同的弹窗，
触发方式也不同**（spec 030 真机实测）：

| 弹窗 | 谁触发 | 没答之前 |
|------|--------|---------|
| 「查找并连接到你本地网络上的设备」 | 访问局域网地址（dev server 本身） | 局域网不通 |
| 「允许…使用无线数据」 | **只有访问公网主机才触发** | **全部网络都不通，含局域网** |

第二张是坑：局域网请求**不会**把它勾出来，但它没被回答之前连 dev server 也
连不上 —— 症状是 `SocketException: No route to host (errno = 65)`，看起来像
IP 写错或者防火墙。所以 dev 引导启动时会**并行打一发**
`http://captive.apple.com/hotspot-detect.html`（iOS 自己做 captive portal
检测用的端点）把它勾出来；仅 iOS、仅 dev、成败都不影响引导，不带任何用户数据。

引导拉取（manifest / prelude / bundle）本身会**退避重试** 1→2→3→5→8 秒、
之后固定 8 秒、不设上限：授权弹窗是异步的，弹出来的那一刻第一次请求早就失败
了，不重试就永远等不到那个「允许」。答完之后**不需要重启 app**，几秒内自己
接上。页面自己的 `fetch()` 和路由 chunk **不重试**（失败该让页面看见）。

连不上时屏幕上会显示「连接 dev server <host:port> 中…／连不上会自动重试，
无需重启」，不再是黑屏。点了「不允许」也是这个界面 —— 去「设置 → 隐私与
安全性 → 本地网络 / 无线数据」里改回来即可。

**注意**：这些行为在 CLI 生成的宿主 `lib/main.dart` 里。**`fjs host eject`
过的宿主保留自己的 main.dart**，run 时只会幂等补齐
`fjsRegisterModules` / `fjsAttachHost` 两处调用，不会重写其余内容——照
`packages/fjs/src/commands/run.ts` 的模板核对（关键是 `runApp` 要在
`connectDevString` **之前**，否则引导一失败整个 app 打不开）。

**iOS 有一个键是 CLI 自动注入的**：`NSLocalNetworkUsageDescription`。
iOS 14+ 对**没有**这个键的 app 直接拒绝一切局域网连接，而且**不弹权限窗** ——
dev server 的每次请求都报成 `SocketException: No route to host (errno = 65)`，
看起来像 IP 写错或者防火墙，实际是权限被静默否掉了。dev 模式连 dev server 是
工具链自身的传输命脉，不是项目的业务选择，所以 `fjs run ios` 默认写进去，
文案是一句英文说明。要换文案（或改成中文），在 `app.config.ts` 里配同名键即可
覆盖 —— 上面的例子就是这么写的（spec 028）。

`fjs host id <id>` 仍可用于一次性修改已有宿主；要让 managed 宿主在重新生成后
保持包名，应把 `applicationId` / `bundleIdentifier` 写入 `app.config.ts`。

```bash
fjs host                     # 在哪、归谁管、application id、flutter_fjs 从哪来
fjs host create              # 只创建/更新宿主，不跑应用
fjs host open android|ios    # 用 Android Studio / Xcode 打开
fjs host open ohos           # 用 DevEco Studio 打开（需要 OpenHarmony fork 生成的宿主）
fjs host id                  # 打印当前 application id
fjs host id com.acme.app     # 改 applicationId 和 bundle identifier
fjs host eject [dir]         # 移进仓库（默认 flutter/），从此归你管
fjs host sync --force        # 把生成版宿主文件重新盖回去
```

### eject 之后

一旦要加权限、加原生插件、配签名、换图标，就 `fjs host eject`。它做三件事：

1. 把 `.fjs/flutter` 移到 `flutter/`（或你指定的目录）
2. 往 `package.json` 写 `fjs.flutterDir`，之后所有命令都认这个目录
3. 从此**不再改写**它的 `lib/main.dart`、`pubspec.yaml` 和 Gradle 补丁

移动目录时 pubspec 里的相对 `path:` 依赖（`../../../packages/...` 指向仓库内
的 Flutter 包）会按新旧位置**自动重算**，`flutter pub get` 不会因为层级变浅
而找不到依赖（spec 042）。

`fjs run` 仍然会保证 `assets/fjs` 目录存在并执行 `pub get`，其余交给你。
`fjs clean --all` 会拒绝删除 eject 过的宿主——那已经是你的源码，不是构建产物。
想拿回生成版本用 `fjs host sync --force`。

#### 宿主 lib/ 的三个文件，谁的手

无论宿主是否 eject，`lib/` 都按所有权分三份（spec 042）：

| 文件 | 归谁 | 每次 run |
|---|---|---|
| `lib/main.dart` | 你（标记外的部分） | **缺失才生成**，手改永远不会被覆盖；`fjs host sync --force` 可强制重写 |
| `lib/fjs_autolink.dart` | fjs | 重写——模块的 import 与 `register()` 调用都在 `fjsRegisterModules(engine)` 里，增删模块只动这个文件 |
| `lib/fjs_attach.dart` | 项目 | 用 `src/main.dart` 覆盖——项目级宿主代码的唯一事实来源 |

因为 main.dart 的内容不再随模块增减变化，它才可以"缺失才写"：你在里面加的
`engine.host.register`、Flutter 插件初始化，`fjs run` 之后都还在。

#### 项目级 `src/main.dart`

与 `src/main.ts` 同级放一个 `main.dart`（完整的 Dart 模块），它会在每次
run 时原样复制为宿主 `lib/fjs_attach.dart`，生成的 main() 在注册模块之后、
`runApp` 之前调用它：

```dart
// src/main.dart
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> fjsAttachHost(FjsEngine engine) async {
  engine.host.registerAsync('demo.asyncStore', (args) async { /* ... */ });
  // 初始化 Firebase / 推送 / 任何 Flutter 插件……
}
```

没有这个文件时宿主拿到一个空实现，页面代码无需关心。老宿主（eject 过或
旧版本生成的）缺这两处调用时，`fjs run` 会幂等补上 import 与调用行，并
顺手移除旧模板内联的模块 register（避免双重注册）。

### application id

```bash
fjs host id com.acme.app
```

只改 Android 的 `applicationId` 和 iOS 的 `PRODUCT_BUNDLE_IDENTIFIER`（含
`RunnerTests` 那几个）。Gradle 的 `namespace` **不动**：它是生成的 R / BuildConfig
类的包名，改了就得连 `MainActivity.kt` 一起搬。`--dry-run` 可以先看会改哪些文件。

## 应用图标

```bash
fjs icon icon.png              # 覆盖 Android mipmap + iOS appiconset
fjs icon icon.png --dry-run    # 只列出会写哪些文件、各是多大
fjs icon icon.png --platform ios
```

源图给一张方形 PNG，1024x1024 最稳（iOS 最大就要这个尺寸）。命令**就地覆盖**
`flutter create` 留下的那些文件，所以不用注册任何东西：Android 五档 mipmap
（48/72/96/144/192）按目录写回，iOS 的尺寸直接从 `AppIcon.appiconset` 里已有的文件
名反推（`Icon-App-83.5x83.5@2x.png` → 167），`Contents.json` 原样不动。

缩放本身调用系统已有的工具，不引入图像依赖：macOS 用自带的 `sips`，其他平台找
`magick` / `convert`，都没有会报错说明装哪个。

写之前会读 PNG 的 IHDR 做三件事：确认真的是 PNG（否则十几个文件都会写坏才发现）、
非方形给警告（会被拉伸而不是裁剪）、带 alpha 通道时提醒——iOS 图标必须不透明，
App Store Connect 会因为透明度打回。

## 看日志 / 在设备上求值

```bash
fjs log                          # 应用的 console 输出，实时
fjs eval '1 + 1'                 # 在正在跑的 VM 里求值
fjs eval 'Object.keys(globalThis).length' --timeout 10000
fjs log --port 38913             # dev server 不在默认端口时
```

日志按 JS console 的级别分档并显示名字（`debug` / `info` / `warn` / `error`），
取值和引擎原生的 `FJS_LOG_*` 一一对应：`console.debug` → debug，`console.log` 和
`console.info` → info，依此类推。生成的 Flutter 宿主也打名字而不是数字：

```dart
engine.onLog = (level, message) =>
    debugPrint('[js:${FjsLogLevel.of(level).name}] $message');
```

两条命令都**不直接连设备**，而是接到 `fjs dev` 上：dev server 本来就握着每个应用
的 socket，工具只要自报身份（`{"fjs":"tool"}`）由它转发即可。手机上不用开任何新
端口，模拟器、局域网真机、浏览器构建三种情况用法完全一样。

服务端按身份区分两类客户端：应用和工具。工具永远收不到 `reload`（否则 `fjs log`
会被当成一个"客户端"计数），应用也永远收不到别的工具的流量。

**工具只能来自本机**（spec 107）。dev server 绑 `0.0.0.0`（手机要连），而工具能
让所有已连接的应用执行任意 JS（`fjs eval`）、能把它们指向任意调试端口
（`fjs debug`），所以默认只接受回环地址的工具连接，`eval` / `perf` /
`debug-relay` 也只认已登记的工具——局域网里别人连上 dev server 最多和一个应用
拿到的一样多。确实要从另一台机器用 `fjs log --host <IP>` 时，启动
`fjs dev --remote-tools`（会打印一行风险提示）；被拒的工具会收到原因并停止重连。

### eval 的返回值怎么回来的

`fjs eval` 把表达式包一层再下发，包装里用 `console.log` 把结果按 JSON 打印出来，
前缀是一个带 NUL 的标记加一次性 id。也就是说**返回值走的是日志通道**，不需要新增
消息类型，更不需要一个"能返回值的 eval"原生接口。`fjs log` 会把带这个标记的行过
滤掉，所以看日志的人不会看见别人的求值结果。

id 单独放在 `eval <id> <source>` 的外层而不是只藏在包装里：语法错误在包装的
try/catch 之前就抛了，这时得由宿主用这个 id 把错误答回去，否则调用方只能等超时。

```
$ fjs eval 'oops('
fjs: Unexpected token ';'
$ fjs eval 'nope.deep'
fjs: nope is not defined
```

## 断点调试：`fjs debug`

> 这一节是用法。内部实现（引擎原生 CDP、可插拔的 `libfjs_debugger`、中继的
> 域桥接、运行时数据平面）见 [debugger.md](debugger.md)。

Chrome DevTools 直连正在跑的 app：断点（含条件断点）、单步、调用栈、局部
变量、`evaluateOnCallFrame`、Console 全部可用；**Elements 与 Network 面板也
在工作**（spec 089）：

- **Elements**：每页的元素树（tag / class / style / 业务 props / 文本），
  选中节点后 Styles 侧栏有 `element.style`（inline）、**命中规则**（选择器
  原文 + 声明，按特异性排序，spec 092 第三轮），Computed 侧栏是样式
  引擎算出的最终生效样式。树的更新是**推送 + 自愈**（spec 092）：整包
  reload（VM 重建）即推 `DOM.documentUpdated` 让 DevTools 重拉；点了已
  换血的旧节点（id 已不存在）也会触发同样的刷新——普通树变更不推送
  （频繁变更的 app 会被整树重拉打断样式查询，实测一轮），断点暂停期间
  树照样可查（走的是调试通道，不依赖被冻结的 Dart 事件循环）。
- **Network**：app 里 `fetch()` 的请求行（方法 / URL / 状态 / 响应头）与
  Response 体预览（≤512KB，超出只记长度）。行有 ≤500ms 轮询延迟；响应体
  在**应用读取它时**才被记录（`text()/json()/arrayBuffer()`）——app 没读过
  的响应在面板里看不到体。
- **Console 收全两端日志**（spec 092）：JS 的 `console.*` 走引擎；终端里
  `[dev]` / `[nav]` / `[fjs/debug]` 这些 **Dart 侧进度日志**走 dev socket，
  由 `fjs debug` 合成 `Runtime.consoleAPICalled`（上下文名 "fjs host"）送进
  同一个 Console——终端看到的流，DevTools 里也有。`fjs eval` 的应答行
  不算 console 输出，已过滤。

```bash
fjs debug                        # 另开一个终端；fjs dev 跑着的时候

# 连 DevTools：直接开前端，别绕 chrome://inspect
open -a "Google Chrome" \
  "devtools://devtools/bundled/inspector.html?ws=127.0.0.1:38902/cdp"
# → Sources 面板选脚本，点行号下断点
```

`fjs debug` 的横幅会把上面这条命令按当前端口打印出来，复制即可。

**为什么不用 `chrome://inspect`**：那条路要靠 Chrome 自己去发现目标，实测
经常一片空白且不给任何报错，排查成本远高于收益。已知至少两个坑：

- 配置里填 `localhost:38902` 必然失败——这个名字在 macOS 上先解析到 `::1`，
  而中继只监听 IPv4 回环（CDP 能求值任意代码，不该绑更宽的地址）。要填也得
  填 `127.0.0.1:38902`。
- 填对了也未必出现。Chrome 的发现逻辑对目标端点有一些没文档化的期待，
  失败时不提示。

直连方式绕开整个发现环节，直接把前端接到中继的 WebSocket 上，是当前唯一
可靠的入口。注意 `devtools://` **粘进地址栏会被 Chrome 拦掉**（安全策略），
只能像上面那样从命令行 `open`，或从一个 HTML 链接点进去。

`fjs debug` 起一个 CDP 中继：DevTools 侧 WebSocket 只绑 `127.0.0.1`（CDP 能
求值任意代码，不像 dev server 那样绑 `0.0.0.0`），app 侧是 VM 自己拨出来的
TCP 通道（默认 `:38903`，与 dev WebSocket 同方向，手机不开任何端口）。app 的
拨号地址两个候选依次尝试：`127.0.0.1`（当机器上有 adb 时，`fjs debug` 自动
用 `adb reverse` 把通道发布到每台 Android 设备——从 PATH 和默认 SDK 位置解析，
**没有配置 adb 也能正常工作**，只是没有这条零延迟隧道）→ dev server 的
host（模拟器 `10.0.2.2`、真机走 LAN）。attach 失败会带原因重试，"re-attach
failed:" 后面不再是空串。引擎（PrimJS，spec 088）原生实现 CDP，中继只搬运字节：

| 端口 | 用途 | 绑定 |
|---|---|---|
| 38902 | DevTools 发现（`/json/list`）+ CDP WebSocket | 127.0.0.1 |
| 38903 | app VM 的调试通道 | 0.0.0.0（局域网内手机可达） |

`--cdp-port` / `--vm-port` 可覆盖（`--port` / `--host` 是 dev server 的地址）。

**鉴权**（spec 107）。38903 对局域网开放，而持有调试会话的一方能收到你在
DevTools 里执行的一切、也能伪造任何调试事件，所以：

- `fjs debug` 每次启动生成一个 128 位随机 token，随端口一起经 dev server
  下发（`debug on <端口> <token>`）；app 拨号前把它写进 VM 的
  `globalThis.__fjsDebugToken`。
- 中继对**非回环**地址拨进来的 VM 先发一次 `Runtime.evaluate` 取这个 token，
  常数时间比对通过才交出会话。没通过的连接不占用唯一的会话槽位（冒充者没法
  抢先占坑把真 app 挤掉），也听不到 DevTools 的任何消息；答错或 5 秒不答即断开，
  中继日志写明原因。
- **回环连接不质询**：本机进程、经 `adb reverse` 的 Android 设备、
  `fjsrun --debug-connect 127.0.0.1:…`。本机进程本来就能直连只绑回环的
  38902，豁免它们不扩大暴露面。
- 比 spec 107 旧的 flutter_fjs 不认 token：走局域网拨号会被拒（日志提示
  `fjs upgrade`），Android 模拟器 / USB 照常。

token 经 dev server 下发，所以它保护到的边界就是「能连上 dev server 的人」——
dev server 本来就在向局域网提供源码与 bundle。

行为与限制：

- **启动顺序无所谓**。`fjs debug` 把中继注册在 dev server 上，dev server
  记着它，app 每次连上（首次、热重启、`fjs run ios` 编译完才起来）都会收到
  `debug on <端口> <token>`；dev server 自己重启了，`fjs debug` 也会重连并重新注册。
- **attach 即重载**。app 挂上调试通道后整包重载一遍，让所有脚本
  进入调试器的脚本表；之后 DevTools 任何时候连上来，`Debugger.enable` 都会
  补发全部 `scriptParsed`，连接先后顺序无所谓。DevTools 断开时中继会向 app
  补发 `Debugger.disable`：会话复位（重连可重放脚本），若 app 当时停在断点
  上也会解冻——调试器没了，冻结没有意义。
- **断点期间 UI 冻结**。暂停的是 JS 所在的 UI isolate，这是"暂停"的本义；
  resume 后恢复，期间到达的热更新推送会在 resume 后处理。
- **Sources 面板能打开 Vue SFC 原文**（spec 094）。编译产物的脚本名是
  `bundle.js`、`pages/<chunk>.js`、`shared.js`（不是源路径）。dev
  构建另写 `.js.map`，中继把它内联进 `scriptParsed`，所以断点可以下在
  `<script setup>` 上，Call Stack 显示原文行号。`fjs build` 不带 map。
- **Console 输出走调试通道**。调试器附加期间，`console.log` 由引擎合成为
  `Runtime.consoleAPICalled` 送进 DevTools（带调用栈），app 侧的 `fjs log`
  通路可能不再收到这些行。
- **只调 dev 源码模式、主 VM**。release 字节码、Worker、小程序端不在范围
  内；web 端用浏览器自带 DevTools。
- **产物分层**（spec 090）：**调试器不在引擎里**。引擎只保留一张空的
  inspector 钩子表，CDP 语义层（断点、作用域、heap/cpu profiler）和 socket
  传输一起待在独立模块里，release 不带这个模块 = 物理上没有调试器。
  剔除由**构建层**完成（spec 105）：不管经不经 CLI，release/profile 构建
  都不含调试模块，也不需要任何人去删文件（spec 091 四轮让 runner 删插件
  目录里的文件，那会改写共享的 pub-cache，已撤掉）。

  | 平台 | 引擎 | 调试模块 | 非 debug 怎么剔除 |
  |------|------|----------|-------------------|
  | Android | `libfjs.so`（arm64 1.28 MB） | `libfjs_debugger.so`（482 KB） | 调试器在单独的 `abi/primjs/android-debugger/`，`android/build.gradle` 只把它挂到 **`debug` 源集**，release / profile / 自定义构建类型都合并不到它；`-PfjsKeepDebugger=true` 改挂 `main`（spec 115：之前用的 `jniLibs.excludes` 被 AGP 忽略，0.1.6 的 release APK 带着它） |
  | iOS / macOS | `fjs.xcframework` | `fjs_debugger.xcframework` | 静态归档按需拉取——只有 `FlutterFjsPlugin.m` 的 `#if DEBUG` 引用它，Release/Profile 一个字节都不链 |
  | ohos | `libfjs.so`（arm64 1.21 MB） | `libfjs_debugger.so`（422 KB） | **宿主的** `ohos/entry/build-profile.json5` 用 `buildModeBinder` 把 release/profile 绑到排除 `**/libfjs_debugger.so` 的 `fjs_no_debugger`；CLI 托管的宿主自动补上。fork 把插件当 `file:` 源码依赖，插件自己的 binder 不起作用（spec 115） |
  | 桌面 | `libfjs.dylib`（1.08 MB） | `libfjs_debugger.dylib`（474 KB） | `fjsrun` dlopen，文件不在就报"本构建无调试器" |

  纯 Flutter 宿主（例如 fjs-go）和已 eject 的宿主要自己在 `ohos/entry/build-profile.json5`
  的 `"targets"` 前加上（profile 那条只在工程定义了 profile 构建模式时加）：

  ```json5
  "buildOptionSet": [
    { "name": "fjs_no_debugger", "nativeLib": { "filter": { "excludes": ["**/libfjs_debugger.so"] } } }
  ],
  "buildModeBinder": [
    { "buildModeName": "release", "mappings": [{ "targetName": "default", "buildOptionName": "fjs_no_debugger" }] },
    { "buildModeName": "profile", "mappings": [{ "targetName": "default", "buildOptionName": "fjs_no_debugger" }] }
  ],
  ```

  **导出符号（spec 116）**：Android / 鸿蒙的 `libfjs.so` 只导出 `fjs_*`，primjs 版再加上
  调试器模块实际引用的约 190 个引擎符号。清单在构建时从调试器的目标文件生成
  （`native/cmake/libfjs-exports.cmake`，修饰名随 ABI 变化，所以不提交固定清单），配合
  `--gc-sections`：primjs arm64 1.85 → 1.28 MB、armeabi-v7a 1.16 → 0.77 MB，quickjs arm64
  1.35 → 1.13 MB（MiB，与上表同一口径）。调试器多用一个引擎符号时会自动导出；万一生成出错，`fjs_debugger` 以
  `--no-undefined` 链接，构建期直接报缺哪个符号。重建产物后
  `node packages/flutter_fjs/tool/test/libfjs_exports_check.mjs` 核对（构建脚本末尾会自动跑）。

  `node packages/flutter_fjs/tool/test/android_debugger_strip_check.mjs <宿主>/android`
  会跑一遍 debug / profile / release 三个变体的 jniLibs 合并并断言结果，改动这套配置
  后跑它（spec 115）。

  对比拆分前：Android arm64 的 release `libfjs.so` 从 2.21 MB 降到 1.85 MB（spec 116
  收窄导出符号后再降到 1.28 MB，见下），
  桌面从 1.44 MB 降到 1.08 MB（−26%）。

  运行时数据平面（元素树/fetch 记录）仍由 `__FJS_DEVTOOLS__` 门控，仅在
  `fjs dev` 或 `fjs build --devtools` 时打包；release DCE 掉全部。
- 桌面复用同一套链路，不需要设备：
  `fjsrun --debug-connect 127.0.0.1:38903 <bundle.js> --pump 60000`。
- `debug off`（Ctrl-C 退出 `fjs debug` 时自动下发）解除附加。

## 性能面板

`fjs dev` 跑着的时候按 **`p`**，连着的 app 右上角会浮出一个小面板；再按一次收起。
它可以拖，因为它一定会挡住点东西。

```
fps                3
ui        4.3/60.9 ms
gpu        1.3/2.7 ms
heap   4.6MB·14806
nodes            100
```

| 行 | 是什么 |
|---|---|
| `fps` | 最近一秒 Flutter 真正出了多少帧。**闲着的时候低是正常的**——没人要求画，所以它不标红 |
| `ui` | UI 线程那一半（build + layout + paint）：最近一秒的均值 / 面板打开以来的最坏值。**JS 也在这里**：引擎跑在 Flutter 的 UI isolate 上，一次慢重排落在这个数字里，不像 RN 那样单独有个 "JS fps" |
| `gpu` | 光栅线程那一半，同样两个数。这里大而 `ui` 小，要修的是画了什么，不是建了什么 |
| `heap` | JS 引擎的 malloc 大小和活对象数，**不触发回收**读出来的。对象数是预测回收代价的那个——QuickJS 标记整个堆 |
| `nodes` | 镜像树节点数，也就是 JS 建出来的东西在 Dart 侧有多少个 |

超过 16.7ms 的 `ui` / `gpu` 标红。**最坏值不随一秒的窗口滚掉**：值得看的那一帧
通常是刚点的那一下造成的，等人看到面板时滚动窗口早就忘了它；收起再打开就是重置。

面板每 500ms 采一次，不是每帧——每帧重画的监视器会让 app 一直在动，把它自己报的
fps 抬上去。

实现上它是 Dart 侧的一层浮层（`FjsPerfOverlay`，`FjsApp` 自动装），**不是 fjs 节点**
——否则它会把自己加进被测的那棵树里，切主题时还跟着一起重排。手写宿主（自己摆
`FjsView` 的）把它包一层就有：

```dart
FjsPerfOverlay(engine: engine, child: FjsView(engine: engine))
```

堆那一行需要引擎导出 `fjs_vm_heap`（`gc()` 也报同样两个数，但它得跑一次全堆标记
清扫才能拿到——对每秒采样的面板是错的工具）。这个符号是 ABI v1 之后加的，宿主按
**可选**处理：老的引擎二进制上这一行显示 `n/a`，面板其余部分照常。

## 看设备

```bash
fjs devices          # fjs run 能用的 android/ios/ohos 设备，带 * 的是默认选择
fjs devices --json
```

`flutter devices` 会把桌面端和 web 一起列出来，这条只留 fjs 真正能跑的平台，并且
把 `-d` 要填的 id 单独成列。排序和 `fjs run` 的挑选规则一致：模拟器优先，因为它
用主机本地地址就能连上 dev server，真机则依赖局域网可达。ohos 设备只有装了
OpenHarmony fork 的 Flutter SDK 才会出现（标准 flutter 的设备发现看不见它们；
fork 还要求 `flutter config --enable-ohos`，见下文「鸿蒙」一节）。

## 清理

```bash
fjs clean                # dist/、Flutter assets 里的 release 产物、生成的路由类型
fjs clean --dry-run      # 只打印
fjs clean --all          # 连 .fjs/flutter 一起删（下次 fjs run 会重建）
```

只删这个 CLI 自己写出来的东西，且只删项目目录内的路径——`--out` / `--flutter-dir`
指到项目外会直接报错而不是照删。

## 体检

```bash
fjs doctor
```

依次检查 Node 版本、是不是 fjs 项目、入口与 `src/pages`、`@ufjs/cli` 与
`@ufjs/runtime` 是否同一 minor、两个引擎的 fjsc 各从哪来（`FJSC_PATH` / npm /
本地构建；当前引擎的缺失算 problem，另一个只算 warning）、
`flutter`、`adb`、`xcodebuild`、可用的 android/ios 设备，以及 `.fjs/flutter`
宿主的 `flutter_fjs` 是 path 依赖还是 pub.dev。只影响部分目标的问题算 warning，
真正会挡住构建的算 problem 并让退出码为 1。

## 开发运行

### 浏览器

```bash
pnpm run dev:web
```

模板里的 `dev:web` 走 Vite，适合快速开发 UI 和业务逻辑。

### 微信小程序

```bash
npx fjs build --mp     # 产物 dist/mp/
npx fjs dev --mp       # watch src/，增量重建 dist/mp
```

用微信开发者工具打开 `dist/mp/` 预览；dev 模式没有 HTTP 服务，开发者工具自己
监听 `dist/mp` 热编译。appid 配置、标签映射和已知差异见
[miniprogram.md](miniprogram.md)。

### Android / iOS

推荐先用 [fjs go](fjs-go.md)：装一次调试客户端后，项目侧只需要启动
`pnpm run dev:pages`，然后在 fjs go 里扫码、选择附近服务器或手输地址。Android
的 APK 可以从
[Release 页](https://github.com/snice/ufjs/releases/latest) 直接下，不用
自己编。

```bash
pnpm run run:android
pnpm run run:ios
```

等价于：

```bash
fjs run android
fjs run ios
fjs run android --release --gz
```

### 鸿蒙（OpenHarmony fork）

`fjs run ohos` / `fjs devices` 的 ohos 列需要 **OpenHarmony fork 的 Flutter
SDK**（如 [flutter_flutter](https://gitcode.com/CPF-Flutter/flutter_flutter)）
和 DevEco Studio，标准 flutter 不认识 ohos 平台。前置条件：

- `PATH` 上是 fork 的 `flutter`（`fjs` 探测 fork 的方式：SDK 源码里有
  `packages/flutter_tools/lib/src/ohos`；探测不到时一切保持 android/ios 原样）；
- **`flutter config --enable-ohos`**：fork 的设备发现被这个 feature 开关
  门控（`ohos_workflow.dart` 里 `canListDevices = isOhosEnabled && SDK 就绪`），
  **默认 false**。新装 fork 后的典型症状是 `hdc list targets` 看得到模拟器、
  `flutter devices` 却没有它，`flutter doctor` 也不显示 HarmonyOS toolchain
  一节。开一次即可，配置落在 `~/.config/flutter/settings`，换 shell 不用重设；
- SDK 目录的定位顺序（`ohos_sdk.dart` 的 `localOhosSdk`）：`flutter config` 的
  `ohos-sdk` → 环境变量 `OHOS_HOME` / `OHOS_SDK_HOME` → 沿 `PATH` 找 `hdc`
  反推。把 DevEco 自带的 `…/sdk/default/openharmony/toolchains` 加进 `PATH`
  就够了，不必设 `DEVECO_SDK_HOME`——fork 只在 HarmonyOS NEXT 侧的
  `localHmosSdk` 里读它，OpenHarmony 设备发现走不到；
- ohos 宿主目录只能由 fork 生成：`flutter create --platforms ohos .`（在
  `.fjs/flutter` 里）。`fjs run ohos` 不负责补建它，缺失时直接报错。

debug 模式下模拟器/真机没有 Android 的 `10.0.2.2` 那种主机别名，`FJS_DEV`
直接走宿主局域网地址（dev server 绑 `0.0.0.0`，模拟器 NAT 可达）；局域网不通
时手动 `hdc fport tcp:<port> tcp:<port>` 再 `fjs run ohos --host 127.0.0.1`。
release 模式与 Android 同一条链路（字节码烤进 assets），`fjs build --hap`
出 `flutter build hap` 的包。

#### 调试签名（spec 113）

HarmonyOS 设备和模拟器只装 AGC 签发的调试证书，申请要登录华为账号，没有
公开 CLI，所以**每台机器、每个 bundleName 第一次**仍要在 DevEco 里点：
File → Project Structure → Signing Configs → 勾选 Automatically generate
signature → OK。DevEco 把证书放进 `~/.ohos/config/`，把证书路径和用本机
`~/.ohos/config/material` 加密的密码写进宿主的 `ohos/build-profile.json5`。

`.fjs/flutter` 随时可能重建，后一半会丢，所以 `fjs run ohos`（debug 与
`--release/--profile`）和 `fjs build --hap` 在调用 flutter **之前**先检查签名：

| 宿主的 `signingConfigs` | 本机存档 | 行为 |
|---|---|---|
| 非空 | 没有或不同 | 原样存到 `~/.fjs/ohos-signing/<bundleName>.json5`（0600），打印 `signing saved`；宿主为准 |
| 非空 | 相同 | 不动 |
| 空 | 有效 | 写回宿主，打印 `signing restored … (expires …)` |
| 空 | 没有或失效 | 报错退出并写明原因；终端里运行时（macOS）顺手用 DevEco 打开 `ohos/` |

「有效」指存档里 p12 / cer / p7b 三个文件都在、p7b 的 bundle-name 与宿主
`AppScope/app.json5` 一致且未过期；设备 UDID 不查，没登记的设备仍由安装步骤报错。
读写都只动 `signingConfigs` 数组那一段原文，文件其它部分（注释、尾逗号、已
eject 宿主里用户的改动）逐字节不变，非空的宿主配置永远不会被覆盖。存档里的
密码只能在本机解开，换机器要重新点一次。仓库里提交的 `examples/fjs-go/ohos`
不经过 `.fjs`，不受这套流程管，见其 README。

想让鸿蒙这一侧从头来过，直接 `rm -rf .fjs/flutter/ohos`：下一次 `fjs run ohos` /
`fjs build --hap` 发现托管宿主缺了平台目录，会用 `flutter create --platforms=ohos`
补回来（已有文件不动），签名随后按上表从存档写回。

引擎侧的 `libfjs.so`（arm64-v8a）是预编译入库的，重编 native 后跑
`packages/flutter_fjs/tool/build-ohos.sh`（用 DevEco 自带的 llvm 交叉编译）。

`fjs run` 会创建或复用 `.fjs/flutter`。这个 Flutter 宿主由 CLI 生成，包含：

- `flutter_fjs` 依赖
- `FjsEngine` 初始化
- dev 模式连接 `FJS_DEV`
- release 模式加载 `assets/fjs/*.fjsbundle`

运行时流程：

1. 确认 `.fjs/flutter` 存在，不存在就执行 `flutter create`
2. 写入生成版 `pubspec.yaml` 和 `lib/main.dart`
3. 把 Android 工具链补到基线（见下），执行 `flutter pub get`
4. 启动 `fjs dev --pages`
5. 执行 `flutter run -d android|ios --dart-define=FJS_DEV=<host:port>`

如果请求端口已被别的项目或其他进程占用，`fjs run` 会从该端口开始自动向后查找可用
端口，并把最终端口写进 `FJS_DEV`。如果端口上已经是同一个项目的 fjs dev server，则
直接复用它。

常用参数：

```bash
fjs run ios --device <device-id>
fjs run android --port 38913
fjs run android --profile
fjs run android --release --gz
fjs run android -- --dart-define=FOO=bar
```

**生成宿主的 Android 工具链**：宿主是 `flutter create` 一次性生成的，之后不会
自己跟着 Flutter 升级，所以每次 `fjs run` 都会把它补到基线上——只升不降，宿主上
已有的更高版本不会被拽回来：

| | 基线 |
|---|---|
| Gradle | 8.14 |
| Android Gradle Plugin | 8.11.1 |
| Kotlin Gradle Plugin | 2.2.20 |
| Java / jvmTarget | 17 |

同一步还会往宿主的 `android {}` 里写一段按 `--target-platform` 裁剪 ABI 的配置
（`packaging.jniLibs.excludes`），否则插件 AAR 带进来的 `.so`（`libfjs.so`、
`libdartjni.so`）会三个 ABI 全打进 APK。注意这里不能用
`defaultConfig.ndk.abiFilters`：它只管本模块自己编出来的 native 产物，管不到
依赖带来的预编译 `.so`。Groovy 和 Kotlin DSL 两种宿主都支持（`flutter create`
从 3.38 起生成 `.kts`）。

**Android 运行注意事项**：Flutter 和直接 gradle 使用的 JDK 可能不同。Android
release 构建建议显式指定 JDK 17：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 17)
```

配置后重新运行 `fjs run android`。如果之前启动过 Gradle，可先停止 Gradle daemon：

```bash
cd .fjs/flutter/android
./gradlew --stop
```

三种构建模式：

| 命令 | Flutter 模式 | JS 从哪来 |
|------|------|------|
| `fjs run android` | debug | dev server，改了就热更 |
| `fjs run android --profile` | profile | 打好的 `.fjsbundle` assets |
| `fjs run android --release` | release | 打好的 `.fjsbundle` assets |

`--profile` 和 `--release` 都会先同步 release assets 再 `flutter run --<模式>`，
不启动 dev server。profile 之所以跟 release 一样走 assets：这个模式是用来量性能
的，而 AOT 的宿主配上 dev server 喂过来的源码包，量到的是开发路径而不是发布路径。

要「AOT 宿主 + 仍然热更的 JS」（比如排查只在 profile 下复现的问题），用透传即可
——透传参数不会触发 assets 构建：

```bash
fjs run android -- --profile
```

`--release` / `--profile` 默认使用 pages split；纯 TS 单包项目可加 `--no-pages`。
JS 默认压缩，`--no-minify` 可以关掉；`--gz` 只压缩同步到 Flutter assets 的
`.fjsbundle`。

`--` 后面的参数会原样传给 `flutter run`。

## 测试

### A：在你的项目里

```bash
npm run typecheck
npm run build
npm run build:web
```

生成 Flutter 宿主后：

```bash
cd .fjs/flutter
flutter analyze
```

### B：在本仓库

```bash
pnpm run typecheck                  # 全 workspace
pnpm test                           # 单测：@ufjs/runtime + @ufjs/cli（vitest）
pnpm run build

cd packages/flutter_fjs && flutter test
cd examples/fjs-go && flutter test
```

`packages/flutter_fjs/test/nav_router_test.dart` 和 fjs-go 的集成测试要用
`native/build-native/libfjs.dylib` 起真实 VM，**找不到就整个文件静默跳过**
（输出是 `No tests ran`，不是失败）。先 `cmake --build build-native` 再跑。

完整验证 demo：

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run build:web
pnpm --filter demo run build:release
pnpm --filter demo run build:apk -- --debug
```

## 编译模式

| 命令 | 产物 | 用途 |
|------|------|------|
| `fjs build` | `dist/app/bundle.js` | 单包源码构建 |
| `fjs build --bytecode` | `dist/app/bundle.js` + `dist/app/bundle.fjsbundle` | 单包字节码 |
| `fjs build --pages` | `dist/app/shared.js`、`dist/app/bundle.js`、`dist/app/pages/*.js` | App 分页加载 |
| `fjs build --web` | `dist/web` | CLI 内置 Web 静态构建 |
| `fjs build --mp` | `dist/mp/`（微信小程序四件套） | Skyline + glass-easel，见 [miniprogram.md](miniprogram.md) |
| `fjs build --release` | 单包 `.fjsbundle` + Flutter assets | 纯 TS 发布构建 |
| `fjs build --pages --release` | split `.fjsbundle` + Flutter assets | Vue pages 发布构建 |
| `fjs build --release --apk` | release assets + APK | 纯 TS Android 打包 |
| `fjs build --profile --apk` | release assets + profile APK | 量性能用的包 |
| `fjs build --pages --release --apk` | release assets + APK | Vue pages Android 打包 |
| `fjs build --pages --release --hap` | release assets + HAP | Vue pages 鸿蒙打包，需要 OpenHarmony fork |

`--web` 和 `--pages` 互斥。`--mp` 必须单独使用（不能与 `--web` / `--pages` /
`--release` 同给）。

Web 端有两条路，都从 `src/pages` 走同一张路由表和同一套平台门控：默认
Vue3+Vite 模板的 `pnpm run build:web` 是标准的 `vite build`，上表里的
`fjs build --web` 是 CLI 内置的 esbuild Web 构建。产物按目标分目录
（specs/047-dist-output-layout）：App 构建落在 `dist/app/`，web 构建落在
`dist/web/`，互不覆盖。模板的 `vite.config.ts` 里写了
`build.outDir: 'dist/web'`，让 `vite build` 与 `fjs build --web` 同目录，
谁清空目录都波及不到 `dist/app/`。

Node 内置模块（`util` / `punycode` / `node:fs` 这类）在 fjs 目标上没有对应物：
App 构建是 esbuild + `platform: 'neutral'`，web esbuild 构建是 `platform: 'browser'`，
两条路都不会解析它们——npm 依赖图里哪怕只有一处 `require('util')`（比如
`@pixi/utils` → `url` → `qs` → `object-inspect`）也会让整个构建失败。CLI 因此
把所有 node 内置模块指到一份调用即抛的桩模块上：只 import（特性探测、废弃
转发、把 `util.inspect` 存着不调用）能过，真正调用时大声报错。要的是真功能
就在 `src/adapters/<lib>/` 里写平台垫片（参考 hello-fjs 的 `src/adapters/three/native-polyfills.ts`、
`src/adapters/pixi/native-shims.ts`），不要指望内置模块存在。

`src/workers/<rel>.ts|js` 是 worker 文件（specs/049）：每条构建都把它们各自打成自包含脚本，写到产物根下的
`workers/<rel>.js`——`dist/app/workers/`（release 时同步进 `assets/fjs/public/workers/`）、`dist/web/workers/`、
`vite build` 的输出目录、小程序的 `miniprogram/workers/`（并在 app.json 声明 `"workers"`）。`fjs dev` 与 vite dev
按请求现编译 `/workers/*.js`。页面用 `new Worker('/workers/<rel>.js')` 启动。

## 体积分析

```bash
fjs build --pages --bytecode --analyze
fjs build --web --analyze
```

按产物打印 js / gzip / 字节码三个尺寸，再列出每个产物里占比最大的几个包：

```text
shared.js  402.3 KB  gz 90.9 KB  bytecode 1.1 MB
  @vue/runtime-core                       254.5 KB   63.3%
  @vue/reactivity                          56.1 KB   14.0%
  @vue/shared                              25.8 KB    6.4%
  other                                    49.9 KB   12.4%
```

数字来自 esbuild 的 metafile（只有加了 `--analyze` 才会生成），是每个模块**进到这
个产物里**的字节数，不是它在磁盘上的大小；低于 2% 的模块和打包器自己的外壳一起并
进 `other`，所以百分比列永远加得起来。`--web` 的分片产物也会逐个列出。

字节码那一列是最该盯的：它决定冷启动要读多少，而且通常是 JS 的两三倍。

## 首帧节点数预警

`fjs build` / `fjs dev` 会对 `src/pages/**/*.vue` 做一次保守的静态估算：如果页面
首帧会一次性创建太多 fjs 节点，就输出 `[fjs perf]` warning。默认预算是 500 个节点，
可以在 `package.json` 里调整：

```json
{
  "fjs": {
    "performance": {
      "nodeBudget": 800
    }
  }
}
```

这不是耗时预测，也不会执行页面代码；它只识别字面量数组、`ref(200)`、
`computed(() => Array.from({ length: rows.value }))` 这类无副作用表达式，并沿本地
`.vue` 子组件递归估算。遇到预警时，优先考虑把大列表改成 `list-view`/窗口化、降低默认
行数，或把非首屏内容延后渲染。

## 构建期样式预热（`fjs.styleSnapshot`）

`fjs build`（含 `--pages` / `--bytecode` / `--release`）和 `fjs run --release` /
`--profile` 会多一步（specs/119）：

```
  style prewarm: 11 pages captured in 333ms (334 KB)
```

在 Node 里把 Flutter 目标的 bundle 跑一遍，逐个静态路由按真机路由同样的方式挂载
（同样的 Shell、同样等 `<defer>` 补挂），把 CSS 引擎的匹配 / 计算缓存导出成每页一份
JSON 快照，写在该页 chunk（单包则是 bundle）的**第一行**。路由挂载页面之前导入它，
第一次打开就和再次打开一样热。原理与实测见 [vant-mount-perf.md](vant-mount-perf.md)。
分包构建直接在分包产物上抓：每页一个全新 VM，按真机顺序执行 shared.js → bundle.js →
该页 chunk（specs/121），样式表注册顺序与真机一致。

- **结果不变**：快照只是提前填好的缓存。样式表集合、`@media` 结果或引擎开关与构建时
  不一致时整份放弃（日志里每页一行 `style snapshot for /路径 skipped: …`），照常现算。
- **不覆盖**：`fjs dev` / `fjs run`（debug）——每次保存都重建，抓取要挂一遍所有页面；
  带参数的路由（`/user/:id`）——构建期不知道参数。它们照常现算。要在模拟器上看预热
  效果，用 `fjs run ios --profile` 或 `fjs build`。
- **代价**：构建多约 0.5 s（demo 11 页）；包体积按页增加，vant 页每页 50–75 KB JSON
  （字节码里差不多），release 打开 `--gz` 后压缩率很高。
- 某页挂载时抛错（比如在 setup 里就要宿主能力）只跳过该页并告警，不让构建失败。

关闭：

```json
{ "fjs": { "styleSnapshot": false } }
```

## Release 构建

推荐发布命令：

```bash
fjs build --release          # 纯 TS / 单包项目
fjs build --pages --release  # Vue pages 项目
```

它会自动打开 `--bytecode`，并同步 release assets。JS 默认压缩，所以 bytecode
来自 minified JS；调试产物时可以用 `--no-minify` 关掉。gzip release assets 不是
默认行为，需要显式加 `--gz`：

```bash
fjs build --release --gz
fjs build --pages --release --gz
```

并同步到 Flutter 宿主：

```text
.fjs/flutter/assets/fjs/
  manifest.json
  bundle.fjsbundle
  shared.fjsbundle      # 仅 --pages
  pages/
    index.fjsbundle     # 仅 --pages
  public/               # 本地文件，见下
    images/x.png        # public/ 原样搬过来
    assets/x-<hash>.png # 页面 import 进来的资源
```

`manifest.json` 里的 `hashes` 记录每个程序文件的内容哈希（sha256 前 16 位），
键就是 manifest 里写的路径。嵌入式宿主不读它；从网络加载的宿主（fjs go 在线
演示）靠它判断本地副本能否直接用，哈希没变就不发请求。

要把这个目录直接放到网站上（例如 fjs go 的在线演示），加 `--root-path .`，
manifest 里的路径就相对 manifest 本身，不再带 `assets/fjs/` 前缀：

```bash
fjs build --pages --release --gz --root-path .
# 然后把 .fjs/flutter/assets/fjs/ 整个目录部署到站点根目录
```

这样产出的 manifest 只适合网络加载，嵌入式宿主仍用默认值。

### 本地文件（图片、字体…）

页面拿本地文件有两条路，两条都会进 App 包（specs/017-local-image-assets）：

| 写法 | 打包器怎么处理 | 落到哪 |
|------|----------------|--------|
| `import png from '@/assets/x.png'` | esbuild 的 `file` loader，产物是 `dist/app/assets/x-<hash>.png`，代码里拿到 `/assets/x-<hash>.png` | `assets/fjs/public/assets/` |
| `public/images/x.png`，页面写 `/images/x.png` | 不经过打包器，原样搬 | `assets/fjs/public/images/` |
| `html/guide.html`，页面写 `/html/guide.html` | 不经过打包器，原样搬 | `assets/fjs/public/html/` |

**`public/` 与 `html/` 的分工**：`public/` 是 vite 的约定，映射到站点根；
`html/` 是 `<web-view>` 能打开的页面的**唯一位置**，目录名留在 URL 里
（`/html/guide.html`）。两个目录因此不共用根命名空间，同名文件不会互相覆盖。

**生成物**：`fjs` 会把这两个目录扫成 `src/fjs-assets.d.ts`（和
`fjs-routes.d.ts`、`fjs-modules.d.ts` 一样是生成的，别手改、别提交时纠结它），
编辑器靠它补全 `<image src>` 与 `<web-view src>`。写死的本地 src 指向不存在的
文件时，`fjs build` 会 warn 并给出最接近的候选。

两条最终都是**根绝对路径**，所以同一份源码在浏览器和 App 上取到同一张图。
Flutter 侧连着 `fjs dev` 时向 dev server 要，release 时读 `assets/fjs/public/`
下的 Flutter asset（`lib/src/widgets/image.dart`）。

注意两件事：

- **`public/` 是整个目录搬过去的**，包括只给 web 用的文件（hello-fjs 的
  `public/fjs-modules/webview/demo.html` 就是）。想控包体就别往 `public/` 里
  放只有 web 需要的大文件。
- **pubspec 里每一级目录都要单独列**，`fjs run` 自动生成时已经这么做了 ——
  Flutter 的 asset glob 不递归，只写 `- assets/fjs/public/` 会漏掉子目录，而且
  不报错，只是 release 包里少几张图。

生成的 `.fjs/flutter/lib/main.dart` 启动时会先判断 `FJS_DEV`：

- 有 `FJS_DEV`：连接 dev server
- 没有 `FJS_DEV`：按 manifest 加载 `assets/fjs` 下的 release assets；如果是
  `.fjsbundle.gz` 会自动解压后执行

`dist/app/*.fjsbundle` 仍是未压缩 QuickJS bytecode，方便直接用 `fjsrun` 验证；gzip
只发生在 `--release --gz` 同步到 Flutter assets 的发布文件上。

## APK

```bash
fjs build --release --apk
fjs build --pages --release --apk
```

`--apk` 必须和 `--release` 一起使用。Flutter build 参数写在 `--` 后：

```bash
fjs build --release --apk -- --debug
fjs build --pages --release --apk -- --debug
fjs build --pages --release --apk -- --target-platform android-arm64
```

APK 输出目录：

```text
.fjs/flutter/build/app/outputs/flutter-apk/
```

## dev server

```bash
fjs dev --pages
```

dev server 默认端口 `38900`，会提供：

- `/manifest.json`
- `/shared.js`
- `/bundle.js`
- `/pages/<chunk>.js`
- `/ws` 热重载通道

### 热更新分两档

`fjs dev --pages` 的文件监听按下表决定推什么：

| 改动 | 推送 | 设备行为 |
| --- | --- | --- |
| 页面独占的代码（页面 .vue 及其私有子模块） | `reload pages:<chunk>` | 重 eval 该页 chunk，整页重挂；其余一切不动 |
| shell、入口、被多页或入口引用的组件和 ts、插件、路由表、`app.config.ts`、混合改动 | `reload` | 整个 VM 重建，回到首屏 |

共享模块打进 `shared.js`。页面重挂由 JS 路由完成。web（`--web`）
收到任何变更都是整页刷新，浏览器下这与热替换等价（见
[web.md](web.md) 已知差异）。

`fjs run` 会自动启动这个 server，并在端口被占用时尝试 `38901`、`38902` ……。
手动连接 Flutter 宿主时可以使用：

```dart
final engine = FjsEngine();
await engine.connectDev('192.168.x.x', 38900);
```

### 终端快捷键

server 跑起来后，终端本身就是个控制台（只在交互式终端里生效，被 `fjs run` 拉起
或输出被重定向时自动关闭）：

| 键 | 作用 |
| --- | --- |
| `r` | 重新构建并推一次完整 reload |
| `l` | 开关应用日志（和 `fjs log` 同一条流，不用再开一个终端） |
| `d` | 打印当前连着几个应用、几个工具 |
| `c` | 再打印一次地址和二维码 |
| `o` | `--web` 模式下用浏览器打开 |
| `?` | 列出全部快捷键 |
| `q` | 退出（Ctrl+C 也一样） |

`r` 和文件监听不同：它不做增量判断，一律整包重建再推 `reload`，正是热更新判断
出错时该用的那一下。

## 字节码格式

`.fjsbundle` 是带头部的引擎字节码：

```text
[0..4)   magic "FJSB"
[4..6)   u16 format version = 1
[6..8)   u16 engine id length
[8..]    engine id + engine bytecode
```

App 加载时会校验 magic、格式版本和 engine id（`primjs-4.1.1`，或 quickjs
flavor 的 `quickjs-ng-0.9.0`；spec 088 起默认引擎从 quickjs-ng 换为 PrimJS，
缘由与升级流程见 `packages/flutter_fjs/native/primjs/VENDORED.md`）；
engine id 或 `fjsc` 版本不一致时会直接报错，避免运行期出现难定位的崩溃。

## JS 引擎切换（spec 091）

引擎有两个 flavor，都预编译缓存在 `packages/flutter_fjs/abi/`：

| flavor | 引擎 | engine id | CDP 调试器 |
| --- | --- | --- | --- |
| `primjs`（默认） | PrimJS 4.1.1 | `primjs-4.1.1` | 有（`fjs debug` 只在此 flavor 可用） |
| `quickjs` | quickjs-ng 0.9.0 | `quickjs-ng-0.9.0` | 无（inspector 只存在于 PrimJS） |

```bash
fjs run ios --js-engine quickjs      # 运行时切换（debug 模式）
fjs build --js-engine quickjs --release --apk
FJS_JS_ENGINE=quickjs fjs run android  # 环境变量等价
fjs run ios                          # 默认即 primjs

# 纯 Flutter 宿主（不经过 fjs CLI，比如 fjs-go）
flutter run --dart-define=FJS_JS_ENGINE=quickjs   # Android 直接生效
dart run flutter_fjs:engine quickjs               # iOS/macOS 切换后、鸿蒙切换时需要
```

**插件目录只读**（spec 105）：flavor 是构建输入，由各平台的构建文件
按配置直接引用对应那份预编译产物，不再把文件复制进 flutter_fjs 自己的
目录——对 `fjs create` 出来的项目，那个目录就是全机共享的
`~/.pub-cache`，spec 091 的复制式物化会让两个项目互相覆盖、并发构建
读到半新半旧的文件、发布内容取决于最后一次物化。

| 平台 | 产物位置 | flavor 从哪来（先到先得） |
| --- | --- | --- |
| Android | `abi/<flavor>/android/<abi>/`，`android/build.gradle` 的 `jniLibs.srcDirs` 直接指过去 | gradle 属性 `fjs.jsEngine` → 环境变量 `FJS_JS_ENGINE` → Flutter 传给 gradle 的 `dart-defines` → `primjs` |
| iOS / macOS | `ios/abi/<flavor>/`、`macos/abi/<flavor>/`（必须在 pod 根内：CocoaPods 的文件模式不越出 pod 根），podspec 按 flavor 选 `vendored_frameworks`，quickjs 时注入 `FJS_ENGINE_QUICKJS` 宏 | 环境变量 → 宿主 `Generated.xcconfig` 的 `DART_DEFINES` → `primjs`，在 **pod install** 时求值 |
| 鸿蒙 | 默认 primjs 在 `ohos/libs/`（HAR 只打包模块的 `libs/`，随包发布）；另一份在 `abi/<flavor>/ohos/` | runner 参数 |

CLI（`fjs run/build/dev`）会把 flavor 写进自身环境变量（之后启动的
`flutter` 子进程继承，podspec 读得到）、传 `--dart-define`，并调用
`bin/engine.dart`（`dart run flutter_fjs:engine <flavor>`）。runner 只做
构建文件做不到的两件事：

- **宿主的 pod install**：在宿主 `.dart_tool/flutter_fjs/engine_flavor.v2`
  记录上次的 flavor（没有记录时按「未知」处理，失效一次），变了就 touch 宿主
  `ios|macos/Podfile`（Flutter 见 Podfile 比 Podfile.lock 新会重跑 pod install），
  并递归删掉宿主 `build/` 下的 `XCFrameworkIntermediates/flutter_fjs` 与
  `flutter_fjs/flutter_fjs.framework`，让下一次构建重拷切片、重链。只写宿主文件。

**为什么 iOS/macOS 切换要主动让缓存失效**（spec 112）：两个 flavor 的 `libfjs.a`
同名、只是目录不同，而 CocoaPods 的 xcframework 复制阶段按「输入是否比输出新」决定
重拷——git 检出的另一份时间戳可能更旧，会被判定为最新而继续链接旧引擎。所以由
runner 在切换时删掉派生的缓存目录。Android（Gradle 按内容判断）不受影响。
- **鸿蒙 libs**：按内容比对 `ohos/libs` 与目标 flavor，一致就什么都不做；
  需要换时，只有 flutter_fjs 是 **path 依赖**才复制，在 pub-cache 里会
  报错退出——鸿蒙要用非默认引擎，请用 path 依赖。宿主没有 `ohos/`
  目录时整段跳过。

runner 找不到（没装 Dart）或失败时 CLI 不再静默：显式请求的 flavor 直接
报错；默认 primjs 打一行告警继续（Android/iOS/macOS 不依赖 runner）。
`--no-debugger` 仍被接受但不再有动作，见上文"产物分层"。App 运行时
（debug 构建）会对比 `--dart-define=FJS_JS_ENGINE` 与二进制里真实的
engine id，不一致打一次告警——典型场景是纯 Flutter 宿主改了
dart-define 却没重新 pod install。

三件事要配对：

- **字节码跟引擎走**。`fjs build --js-engine quickjs` 只接受自报
  `quickjs-ng-0.9.0` 的 `fjsc`：仓库内 `native/build-native-quickjs/fjsc`，
  或 npm 包的 `bin/fjsc-quickjs`；默认 primjs 同理（仓库 `build-native/fjsc`、
  npm `bin/fjsc`）。引擎不符的候选会被跳过，不会产出引擎 id 错误的 bundle，
  见上文「fjsc 的查找顺序」。纯 Flutter 宿主没有 CLI 字节码步骤，`fjs build`
  照常产出对应引擎的 bundle 即可。
- **重编引擎**（改了 `native/` 之后）每个 flavor 一个 build 目录，互不
  污染：

  ```bash
  cd packages/flutter_fjs/native
  cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
  cmake -B build-native-quickjs -DFJS_JS_ENGINE=quickjs \
        -DFJS_BUILD_TESTS=ON -DFJS_DEBUGGER=OFF && \
  cmake --build build-native-quickjs -j
  cd .. && tool/build-apple.sh      # 或 tool/build-android.sh / build-ohos.sh
  ```
- **引擎全局差异由 runtime 兜底**。quickjs-ng 内置 `queueMicrotask`，PrimJS
  没有（specs/091 实机踩过）——`@ufjs/runtime` 在 `host.ts` 顶部引入的
  `microtask.ts` 里缺位补一个（Promise 微任务兜底）。以后发现某个 JS
  全局只有一个 flavor 有：优先在 runtime 兼容层补，不要改 vendored 引擎
  源码或 native 注册——那会让每个 flavor × 平台的引擎产物重编重发，
  而缺的这个全局几乎总能用已验证存在的机制（promise 微任务、定时器）
  包出来。包的时候要把**报错行为**一并对齐（specs/108）：原生 `queueMicrotask` 的
  回调就是任务本身，抛错会被 `vm.cpp` 以 `[fjs] unhandled rejection in a
  microtask job: …` 打出来；兜底版本的任务是 `.then` 回调，抛错只会让派生的
  Promise 变成 rejected，而原生侧没有注册 rejection tracker——早期兜底因此在默认
  引擎上把回调里的异常全部吞掉。现在兜底用 try/catch 包住回调，按同样的前缀和
  「消息 + 栈」格式经 `console.error` 上报，非函数参数同步抛 `TypeError`。
  普通 Promise 的未处理拒绝由 native 报告（specs/111）：每次 pump 排空微任务后，
  仍无处理器的拒绝以 `[fjs] unhandled promise rejection: …`（error 级，消息 + 栈）
  打出，同一轮里后来被 `.catch` 的不报。quickjs-ng 走 `JS_SetHostPromiseRejectionTracker`；
  PrimJS 从运行时自带的 `unhandled_rejections` 列表逐条取出——在此之前没人取，
  列表只进不出，每条未处理拒绝的 Error 都活到 VM 销毁。已知差异：PrimJS 会把
  非 Error 的 reason 包成 Error，显示为 `Error: <值>`。

同进程内不混用两个引擎：它们各占一套 VM 与符号，双引擎热切换意味着
每个 App 永久背两份引擎体积，对比实验用不上；要对比就按上面整 App
切 flavor。

`--release --gz` 的 assets 保存为 `.fjsbundle.gz`。Flutter 侧先 gunzip，再按
上面的 `.fjsbundle` 格式校验和执行；未压缩 assets 也可被加载。

## 常见问题

**`fjs: command not found`**

还没安装工作区依赖。先在仓库根执行 `pnpm install`。项目外要全局使用，可以在
`packages/fjs` 执行 `pnpm link --global`。

**`no primjs fjsc found` / `no quickjs fjsc found`**

报错会列出看过的每个候选和它自报的引擎。缺哪个 flavor 就构建哪个
（`native/build-native` 是 primjs，`native/build-native-quickjs` 是 quickjs，
命令见「JS 引擎切换」），或设置 `FJSC_PATH` 指向对应 flavor 的 fjsc。
只装了 npm 包、默认 primjs 却只看到 `quickjs-ng-0.9.0`：那是 0.1.4 的旧包，
升级 `@ufjs/cli`。

**Flutter SDK cache lockfile 权限错误**

这是 Flutter/FVM 安装目录权限问题，不是 fjs 构建问题。修复 SDK 目录权限后重跑
命令。

**Android 构建 Java 版本异常**

Flutter 和直接 gradle 使用的 JDK 可能不同。Android release 构建建议指定 JDK 17：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 17)
cd .fjs/flutter/android
./gradlew --stop
```

## 相关

- [分包与 release assets](code-splitting.md)
- [路由](routing.md)
- [Web 平台](web.md)
- [Vue 3 集成](vue3.md)
