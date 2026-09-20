# 常见问题

## 环境与安装

### `fjsc not found` / `fjsc compiler not found`

`fjsc` 是 `@ufjs/cli` 的可选依赖（`@ufjs/fjsc-<平台>`），可选依赖安装失败时 npm 不报错。清缓存重装：

```bash
npm cache clean --force
rm -rf node_modules package-lock.json && npm install
```

也可以用环境变量 `FJSC_PATH` 指定一个 fjsc 可执行文件。

### Flutter 编译报 `Null check operator used on a null value`

Flutter 版本太低，至少需要 **3.38.0**（Dart 3.10）。

### Android release 构建报 Java 版本错误

Flutter 和 Gradle 用的 JDK 不一致，指定 JDK 17：

```bash
flutter config --jdk-dir=$(/usr/libexec/java_home -v 17)
cd .fjs/flutter/android && ./gradlew --stop
```

### `@ufjs/cli` 和 `@ufjs/runtime` 版本要一致吗

minor 版本要一致（`fjs doctor` 会检查）。升级时两个一起升。

## 连接与调试

### 手机连不上 dev server

按顺序排查：

1. 手机和电脑在同一个局域网，不是访客网络、没有 AP 隔离
2. 扫的是 `fjs dev --pages`（端口 38900）的二维码，不是 `dev:web`
3. iOS：设置 → 隐私与安全性 → **本地网络** 和 **无线数据** 里允许了这个 App。第二个权限只有访问公网才会弹出，但没答之前连局域网也不通
4. 模拟器地址：Android `10.0.2.2:38900`，iOS `127.0.0.1:38900`

连接失败时 App 会自动退避重试，授权之后不用重启。

### fjs go 里某个功能不工作，`fjs run` 装的就正常

fjs go 是预编译好的 App，不包含你项目里的 Dart 代码（`src/main.dart`、模块的 Flutter 侧）。依赖这些的功能要用 `fjs run`。

### 改了代码 App 没更新

在 dev server 终端按 `r` 强制完整重建。

## 写法

### 为什么不能用 `v-model`

Vue 的 `v-model` 指令实现依赖 DOM API。用 `:value` + `@text-changed`（input）或 `@value-changed`（switch 等）替代。

### 能用 vue-router 吗

不能直接用，路由走 `fjs/router`（API 是 vue-router 的子集）。Web 构建内部用的就是 vue-router。

### 能用 Element Plus / Vant 这类 UI 库吗

**vant 4 可以**：demo 的五个 vant 页面在浏览器与 iOS / Android 两端对拍过，20+ 组件结构、位置、交互一致（小程序端未测试，走 `@vant/weapp`）。做法与剩余差异（命令式 Toast / Dialog 等）见[三方 UI 组件库](./ui-libs)。Element Plus 这类桌面库没有验证过，不确定的库先拿一个页面两端对拍再铺开。

### 能用哪些 npm 包

纯 JS 逻辑库基本都可以。已经验证过的有 dayjs、mitt、valibot、immer、es-toolkit、pinia、vue-i18n、@vueuse/motion、Anime.js，以及 ECharts、F2、PixiJS、three.js（需要少量平台垫片，见 hello-fjs 的 `src/adapters/`）。不能用的是依赖 Node 内置模块的库；重度依赖 DOM 的库现在也有兼容路径（runtime 的 DOM 形状元素 API + 项目本地 vite 插件补丁，见上一条）。

### 为什么 `view` 里的子元素是竖着排的

`view` 默认 `flex-direction: column`。见[样式](./styling)。

### 事件拿到的值为什么是字符串

为了各端一致，所有事件载荷都是字符串，结构化数据是 JSON 串。见[事件](./events-and-data)。

### 页面文件名是 `input.vue`，里面的 `<input>` 不正常

Vue 把和文件名同名的标签当成组件自引用。加 `defineOptions({ name: 'InputPage' })`。

## 性能

### 长列表卡

1. 用 `list-view` 而不是 `scroll-view` + `v-for`
2. 页面外不要再套滚动容器（`<route>{"scroll": false}</route>` 让外壳不包 `scroll-view`）
3. 列表放进单独的子组件，别和频繁变化的状态放在一个组件里

### 进页面时转场卡一下

JS 跑在 UI 线程上。页面 setup 里的重活（建图表、解析大 JSON）放进 `onPageSettled`：

```ts
import { onPageSettled } from 'fjs/router';
onPageSettled(() => initChart());
```

### 重计算卡界面

放进 [Worker](./events-and-data#worker)。

## 小程序

### 主包超过 2MB

配 `fjs.mp.subpackages` 把大库所在的页面挪进分包。见[构建与发布](./build-and-release#微信小程序)。

### 某个页面在小程序上跑不了

用 `fjs.mp.exclude` 把它排除：`{ "fjs": { "mp": { "exclude": ["example/webgl"] } } }`。
