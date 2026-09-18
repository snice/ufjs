# @ufjs/cli

## 0.1.4

- **鸿蒙（OpenHarmony/HarmonyOS NEXT）适配（specs/066）**：`fjs devices` /
  `fjs run` 支持鸿蒙设备，`fjs build --hap` 生成鸿蒙应用包。
- **微信小程序**：Vue SFC 编译为微信小程序，webview/skyline 双渲染器
  （spec 046）；canvas 2d / WebGL 桥接，npm 依赖打包进产物；支持分包与
  分包预下载（spec 063）；worker 三端统一为文件路径，支持 wx.createWorker
  （spec 049）。
- `app.config.ts` 新增 `version`（同步进生成宿主 pubspec）和 `orientation`
  （锁定宿主屏幕方向）。
- sticky-header / sticky-section、swiper-item 编译期校验、safe-area `edges`
  等组件接入编译管线（组件本体记录在 @ufjs/runtime 0.1.4）。
- 生成的 Flutter 宿主每次 `fjs run` 都会补到一条 Android 工具链基线上
  （Gradle 8.14 / AGP 8.11.1 / KGP 2.2.20 / Java 17），只升不降。宿主是
  `flutter create` 一次性生成的，不会自己跟着 Flutter 升级，之前会一路警告到
  Flutter 不再支持为止。
- `--target-platform` 的 ABI 裁剪修好了：原来写的是
  `defaultConfig.ndk.abiFilters`，它只管本模块编出来的 native 产物，管不到插件
  AAR 带进来的预编译 `.so`——`libfjs.so`、`libdartjni.so` 一直是三个 ABI 全打进
  APK。改用 `packaging.jniLibs.excludes`。
- 上面两段补丁同时支持 Groovy 和 Kotlin DSL 的宿主。`flutter create` 从 3.38 起
  生成 `.kts`，而补丁只认 `build.gradle`，在新机器上会静默跳过。已有宿主里的旧
  写法会被自动迁移。

## 0.1.3

- Local image assets. `public/` is served by `fjs dev` and copied into the
  bundle for release, so `<image src="/images/x.png">` resolves the same way in
  dev, in a web build, and on device. `import png from './x.png'` inside `src/`
  works too — the bundler emits the file and rewrites the specifier to its
  hashed path.
- `html/` at the project root is where an app's own `<web-view>` pages live,
  reachable at `/html/<file>.html`. Before this there was no legal way to write
  a local html page: `classifySrc` only knew http URLs and `asset://` (files a
  module ships). The directory name stays in the URL on purpose — `public/` and
  `html/` would otherwise share the root namespace, and a collision there is a
  silent overwrite rather than an error.
- `public/` and `html/` are scanned into `src/fjs-assets.d.ts`, so `<image src>`
  completes the project's images and `<web-view src>` its html files, each from
  its own table. The types are `keyof X | (string & {})`, which keeps http URLs,
  `import`ed paths and template strings accepting; a typo is therefore not a
  type error, so a separate build-time check looks at literal `src` values and
  names the closest candidate. Dynamic `:src` is left alone.
- New `@ufjs/cli/vite` plugin export: the same Vue/pages app runs as an ordinary
  browser app under Vite dev and build, with the fjs pages router, plugins,
  module aliases and CSS compat wired in.
- A module's files are no longer copied into the app's `public/fjs-modules/`.
  `.fjs/modules/<name>/` is the single copy; the vite plugin (dev) and the web
  build give it a URL, and the `/fjs-modules/<name>/<file>` contract is
  unchanged. The old copy was a `prepare` hook writing outside `outDir`, and
  once `public/` started going into the package wholesale it was a duplicate
  file in every release build that the app side never read.
- The vite middleware returns 404 for a miss under its own prefixes instead of
  falling through to the SPA index. `/html/nope.html` used to answer 200 with
  `index.html`, which inside a `<web-view>` looks like the app rendering itself
  into a box and says nothing about what went wrong.
- `<canvas>` is a known native tag in the Vue plugin, and the Flutter host
  resolution used by `fjs build` was tightened (`test/flutter-resolve.test.ts`).

## 0.1.2

- Flutter host configuration through `app.config.ts`.

## 0.1.1

- `fjs module`: one package carrying a JS API, Vue components, Flutter widgets
  and its autolink entry.
- Android builds honour `--target-platform`.

## 0.1.0

- First release.
