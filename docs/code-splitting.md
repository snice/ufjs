# 分包与 release assets

> 第三层第 3 篇。为什么 reset 后 prelude 会被自动重放，见
> [threading-model.md](threading-model.md#生命周期)。

Vue pages 项目的推荐发布路径是 pages 分包：

```bash
fjs build --pages --release
```

这条命令会把 Vue/fjs 运行时、应用入口和页面 chunk 拆开，编译成 QuickJS
`.fjsbundle`，并同步到生成的 Flutter 宿主 assets。

## pages 分包

`src/pages/**/*.vue` 会被转换成路由表。每个页面对应一个 chunk：

```text
src/pages/index.vue        -> /              -> pages/index.fjsbundle
src/pages/about.vue        -> /about         -> pages/about.fjsbundle
src/pages/user/[id].vue    -> /user/:id      -> pages/user-id.fjsbundle
```

构建产物：

| 产物 | 内容 |
|------|------|
| `dist/app/shared.js` / `shared.fjsbundle` | Vue、@ufjs/runtime、Shell、公共组件 |
| `dist/app/bundle.js` / `bundle.fjsbundle` | 应用入口 |
| `dist/app/pages/<chunk>.js` / `.fjsbundle` | 单个页面代码 |

哪些模块进入 `shared` 由 CLI 自动计算：入口可达模块、Shell、公共组件，以及被多个
页面共同引用的模块会进入 shared；页面文件自身始终作为独立 chunk。

**没有 `src/pages` 的项目不会分包。** shared prelude 的定义是「Vue + fjs + 应用
自己的模块」，所以一个不用 Vue 的纯 JS app（`examples/hello-js`）如果照样分包，
拿到的是一个 ~450 KB、里面装着整个 Vue 而它一次都不会调用的 chunk，每次启动都要
求值一遍。`fjs run` 总是以 `--pages` 启动 dev server，因此这个判断落在
`fjs dev` / `fjs build` 里：项目没有路由时 `--pages` 不生效，退回单包，并在
banner 上说明（`no src/pages — single bundle`）。

## Release assets

```bash
fjs build --pages --release
```

release 会自动启用 `--bytecode`，然后创建或复用 `.fjs/flutter`，并同步 release
assets。JS 默认压缩（和 `vite build` 一致，`fjs dev` 不压缩）；如果还要 gzip
release assets，需要显式加 `--gz`：

```bash
fjs build --pages --release --gz
```

同步后的文件：

```text
.fjs/flutter/assets/fjs/
  manifest.json
  shared.fjsbundle
  bundle.fjsbundle
  pages/
    index.fjsbundle
```

生成的 Flutter 宿主已经声明了这些 assets。启动时：

- 有 `FJS_DEV`：连接 `fjs dev --pages`
- 没有 `FJS_DEV`：加载 `assets/fjs/manifest.json` 和 `.fjsbundle`；如果 manifest
  指向 `.fjsbundle.gz`，会自动解压后执行 QuickJS bytecode

`dist` 目录里的 `.fjsbundle` 保持未压缩，便于直接用 `fjsrun` 调试；只有
`--release --gz` 同步到 Flutter assets 的 release 文件会 gzip 压缩。

所以开发和发布用同一份 Flutter 宿主。

## APK

```bash
fjs build --pages --release --apk
```

`--apk` 会在 assets 同步完成后执行 `flutter build apk`。Flutter 参数放在 `--`
后面：

```bash
fjs build --pages --release --apk -- --debug
fjs build --pages --release --apk -- --target-platform android-arm64
```

`--apk` 必须配合 `--release` 或 `--profile`；单独执行会报错
（`fjs build --profile --apk` 打的是量性能用的 profile 包）。

## dev 模式

```bash
fjs dev --pages
```

dev server 提供源码形式的 split bundle：

- `/manifest.json`
- `/shared.js`
- `/bundle.js`
- `/pages/<chunk>.js`
- `/ws`

`fjs run android` / `fjs run ios` 会自动启动 `fjs dev --pages`，并把地址通过
`FJS_DEV` 注入 `flutter run`。`connectDev()` 看到 split manifest 后会自动加载
shared 和页面 chunk。

### 热更新

dev 只有两档（spec 095，units 已去掉）：

- 只改某一个页面，以及只被这一页 import 的模块：`reload pages:<chunk>`，
  重 eval 该页并重挂，VM 和其它页面不动。
- 其它改动（shell、入口、被多页或入口引用的组件和 ts、插件、路由、配置）：
  整包 `reload`，VM 重建，回到首屏。

共享 app 模块打进 `shared.js`，页面 chunk 用 `__FJS_SHARED` 取同一份实例。
`release` 与字节码产物没有热更新。

## 排查清单

**页面 chunk 加载失败**

确认页面文件在 `src/pages/**/*.vue` 下，并且 `<route>` 的 `platforms` 没有排除
当前目标。

**`__FJS_SHARED is not defined`**

通常是 shared prelude 没有先于业务包执行。使用 `fjs build --pages --release`
生成的宿主会自动处理顺序；自定义宿主需要先加载 manifest 中的 `shared`，再加载
`bundle`。如果 release manifest 指向 `.fjsbundle.gz`，`FjsEngine.runBundle()`
会自动解压。

**改了 @ufjs/runtime 或升级了 vue，运行时行为异常**

shared、bundle 和 pages 之间是 JS API 级耦合，所有 `.fjsbundle` 必须一起重新
构建。

## 相关

- [工具链](toolchain.md)
- [路由](routing.md)
- [Vue 3 集成](vue3.md)
