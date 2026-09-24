## 0.1.6

- **默认 JS 引擎换成 PrimJS 4.1.1（specs/088–091）**：带内置 Chrome DevTools
  协议调试器，`fjs debug` 可断点、看 Elements / Network。quickjs-ng 0.9.0 作为
  第二个 flavor 保留，两份预编译产物都在 `abi/{primjs,quickjs}/` 下随包发布。
  **字节码不跨引擎**：bundle 头带引擎 id，必须用同 flavor 的 `fjsc` 编（`@ufjs/cli`
  0.1.6 起按引擎自动挑选，spec 114）。旧版 CLI 编出的 quickjs 字节码在默认 PrimJS
  下会被拒绝加载。
- **引擎切换不再改写插件目录（spec 105/112）**：Android 的 gradle、iOS/macOS 的
  podspec 按 `FJS_JS_ENGINE`（环境变量或 `--dart-define`）直接选用对应产物；
  `dart run flutter_fjs:engine <flavor>` 负责鸿蒙 `ohos/libs` 与宿主 pods 失效。
  iOS/macOS 来回切换后仍链接旧引擎的问题已修（Xcode 缓存递归清理）。
- **调试器是可插拔模块（spec 090）**：非 debug 构建物理剔除 `libfjs_debugger`，
  release 包里没有 CDP 入口；调试通道对非本机连接做 token 质询（spec 107）。
- 未处理的 Promise 拒绝在两个引擎上都打 `[fjs] unhandled promise rejection`，
  顺带修掉 PrimJS 未处理拒绝列表的内存泄漏（spec 111）。
- `FjsEngine` 新增 `assetBundle`，正式构建的资源可改从网络读取。
- 布局与交互修复：flex 主轴百分比参照（spec 106）、fixed + transition 盒内
  `height: 100%`（spec 101）、`touch-action: none` 不再吞 `@tap`（spec 097）、
  image 位置类 mode 与 `heightFix`（spec 102）、vant 组件两端对拍（specs/068–077）。
- 性能：导航挂载窗口内跳过同步 `flushLayout`（spec 086）；热更新只留页面与整包
  两档（spec 095）。

## 0.1.5

- **修 Flutter 3.44 编译错误**：官方 3.44 把 `CupertinoPageTransitionsBuilder`
  从 material 挪进 cupertino（breaking change decouple-page-transition-builders），
  `fjs-slide` 的过渡声明在 3.44+ 上报 undefined。现在同时 import 两端，
  3.38（本包下限）到最新 stable 都能编过。本机若装的是 3.41 系 ohos fork
  （类还在 material），此前本地 `flutter analyze` 不会复现。
- **pub.dev 体检修复（specs/067）**：补 `example/`（`FjsEngine` + `FjsApp`
  的最小宿主）；`flutter_fjs` 库与 `CanvasChunkReader` 公开成员补 dartdoc；
  全包过 `dart format`；清理全部弃用 API（`withOpacity`/`withValues`、
  `onPop`/`onPopWithResult`、`activeColor`/`activeThumbColor`、颜色
  `.value/.opacity/.red` 等 getter 换新访问器）。静态分析、依赖下限、
  文档三项 pub 满分。

## 0.1.4

- **最低 Flutter 版本提到 3.38.0（Dart 3.10）。** 更低的版本编译不过：WebGL 模块
  依赖的 flutter_angle 0.4.x 用私有 `@Native` 函数接 TypedData `.address`，
  Dart 3.10 之前的 CFE 会崩在 `Crash when compiling: Null check operator used
  on a null value`。Flutter 3.35（Dart 3.9）同样受影响，升级要一步到 3.38+。
- `flutter_angle` 依赖从核心移到 `@ufjs/webgl` 模块（spec 022）。不用
  `getContext('webgl')` 的应用不再拉 ANGLE。
- `ffi` 提到 `^2.2.0`；`cached_network_image` 放宽成 `>=3.4.1 <5.0.0`，这样在
  Flutter ≥3.44 上会自动用 4.x，而不必在这里锁死一个更高的 SDK 下限。
- Android 侧固定 `ndkVersion`，避免宿主和插件解析到不同的 NDK。
- **鸿蒙（OpenHarmony/HarmonyOS NEXT）平台适配**：新增 `ohos/` 平台目录，
  `fjs devices` / `fjs run` 支持鸿蒙设备，`fjs build --hap` 打包（specs/066）。
  WebGL 画布补 ohos 后端，官方 Flutter 用户不受影响。
- **吸顶布局（specs 052/053/054）**：`<sticky-header>` / `<sticky-section>`
  吸顶组件；样式级 `position: sticky` 全端生效；`scroll-into-view` 置空可重触发，
  sticky 目标落在分组起点。
- `<page-container>` 页面容器组件，三端同源（spec 065）。
- **WebGL**：接 three.js / glTF（spec 023），iOS 真机黑屏修复（spec 026），
  模型双指缩放（spec 029）；canvas/webgl 指令字节去掉 fromList 包 sublist
  的双重拷贝。
- `<rich-text>` 富文本组件，嵌套 text 变行内片段（spec 034）；一个段落一个
  节点，长文节点 486 → 91（spec 035）。
- **CSS（specs 040/041/043/044/045）**：`@media` 响应式样式，窗口尺寸通道
  两端打通；伪类补全与单边边框；百分比扩展到盒模型间距与定位偏移；
  transition 背景色/尺寸插值。
- **safe-area**：`edges` 属性三端同源，NavBar 自带顶部安全区；Android 系统
  栏透明可穿透，二级页内容可滚到指示条下。
- **JSI**：二进制句柄跨越 JSI，fetch 请求/响应体告别 base64-in-JSON
  （spec 038）；`invokeHostAsync` 异步宿主调用，fetch 范式通用化（spec 039）。
- **导航**：`onPageSettled` + `<canvas defer-resize>`，重活不再压在路由转场
  上（spec 027）；JS UI 帧上不再重建 Navigator.pages（spec 024）；
  fjs-slide 底页视差跟随（spec 025）。
- **dev**：模块级 HMR，共享模块热替换不再重建 VM（spec 037）；连接退避
  重试与公网探测授权弹窗（spec 030）。
- `<swiper>`：直接子节点必须是 swiper-item，三端编译期校验（spec 051）。

## 0.1.3

- `<canvas>`: a Canvas 2D host. JS sends a display list of drawing commands and
  Dart replays it into a `CustomPainter` — paths, fills and strokes, gradients
  and patterns, text, images, clipping, transforms, and per-frame state. The
  op protocol is at version 4; an older host simply never receives the newer
  commands.
- A partial `clearRect` is now correct: a chunk flagged `NEEDS_LAYER` is
  replayed into its own `saveLayer`, instead of erasing whatever sits under the
  canvas into a black band. A full-canvas `clearRect` remains the signal that
  discards the retained display list; going 240 frames without one warns once.
- `arcTo` is a corner fillet between two segments, which Flutter's SVG-style
  `arcToPoint` cannot express — a rounded rectangle came out as a barrel. The
  tangent points are computed in JS now, so the host only ever receives
  `lineTo` + `arc`. `PathCmd.arcTo` keeps its slot (the numbering is fixed in
  `canvas_ops.dart`, and `fjs dev` can attach any older bundle to any client):
  it warns once and draws the corner as a polyline.
- `height: 100%` resolves inside a column whose height is known. Flutter's
  `Flex` hands children unbounded main-axis constraints by design, so a
  percentage resolved against `infinity` and degraded to `auto` — and a child
  that degraded while containing its own flex (a `<canvas>` surface, a nested
  column) hit "RenderFlex children have non-zero flex but incoming height
  constraints are unbounded". `buildFlex` now passes its own content box down
  to children that declare a main-axis percentage; children without one keep
  the unbounded constraints, and an unbounded box (inside a scroller) still
  degrades to `auto`.
- Percentages resolve for absolutely positioned children too. `RenderStack`
  hands `BoxConstraints()` unless an opposite edge or an explicit size is set,
  so `position: absolute` with `width/height: 100%` collapsed a full-screen
  overlay to one line of text; sizes are now resolved in place against the
  space the positioned box was given.
- `Expanded` became `Flexible(fit: bounded ? tight : loose)`. A tight fit is
  only legal when there is free space to hand out, so it asserted inside a
  shrink-wrapping column; CSS has no such failure — `flex-grow` with no free
  space simply does nothing.
- Style lengths accept `%` and `calc()` on `width` / `height` / `min-*` /
  `max-*`. The expression reduces to a px term plus a percentage term and is
  resolved in a `LayoutBuilder`; an unbounded axis degrades to `auto`, as in
  CSS. Percentages on other properties are still unsupported.
- Local images: `<image src>` resolves project assets, from the `fjs dev`
  server in development and from the bundled asset in release.
- `MirrorNode` is exported from `package:flutter_fjs/flutter_fjs.dart`. Writing a
  `ComponentBuilder` — the Flutter widget behind a JS tag — means reading the
  node it is handed, so the type is now part of the public surface. This is what
  an fjs module's widget extension is built on.
- `FjsEngine.devUri` / `devFetch(path)` expose the connected `fjs dev` server,
  and `fetch(url)` / `fetchString(url)` make one-off requests over the same
  HttpClient that backs JS `fetch()`. A module that ships a build-time file (an
  icon set, a language pack) can now read it from the dev server in dev and from
  its asset in release without an `FJS_DEV` dart-define or an HttpClient of its
  own. One engine now means one `HttpClient`: the dev-server connection shares
  it too, instead of opening a second one to the same host.

## 0.1.1

- Android natives are now 16 KB page aligned, as required by Android 15+ devices
  with 16 KB memory pages. `tool/build-android.sh` refuses NDKs older than r28,
  which is where that alignment became the default.

## 0.1.0

- First release.
- QuickJS-ng embedded via Dart FFI, JSI-style direct JS↔C++ calls.
- Source bundles and precompiled QuickJS bytecode bundles.
- HTML-like JS tags rendered as Flutter widgets; Vue 3 custom renderer support
  through the `@ufjs/runtime` npm package.
- Ships prebuilt natives: `libfjs.so` for `armeabi-v7a`, `arm64-v8a`, `x86_64`,
  and `fjs.xcframework` for iOS device, iOS simulator, and macOS — no NDK,
  CMake, or native compile step in consumer builds.
