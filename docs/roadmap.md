# Roadmap

## v1 已交付

- QuickJS-ng 0.9.0 源码嵌入（Android CMake / iOS & macOS CocoaPods）
- JSI 式直调：宿主函数收发原生 JSValue，无序列化
- 源码 + QuickJS 字节码双模式（fjsc 编译器 + engine id 校验）
- element API（h/create/…）+ 每微任务批量 UI 帧协议
- Vue 3 SFC 支持（script setup + template 编译、响应式、v-for/v-if）
- fjs CLI：create / dev / run / build / --bytecode / --pages / --release
- fjsrun 离线运行器（不需要 Flutter 即可验证 bundle）
- Dart 宿主模块（invokeHost 同步调用）

## 第二期（已完成 2026-08）

- ✅ 组件扩展：switch/checkbox/slider/progress/divider/safe-area/
  refresh/swiper/modal + toast 全局函数
- ✅ Dart 组件注册表：engine.registerComponent（JS 零改动；platform-view 经此接入）
- ✅ Vue 标准 HTML 标签自动映射（div/span/h1-h6/img/button/input... +
  默认样式 + @click/@input 事件适配）
- ✅ Worker 真·后台线程（Dart isolate + 独立 QuickJS runtime，Web Worker 风格 API）
- ✅ 复杂 Vue3 能力（大列表 v-for + computed + 嵌套组件 + Worker 排序）与
  性能基准（examples/bench + docs/performance.md）
- ✅ `fjs create` 默认 Vue3+Vite 模板，`fjs run android|ios` 自动创建 Flutter 宿主
- ✅ `fjs build --pages --release` 生成 `.fjsbundle` 并同步到 Flutter assets，
  `--apk` 可继续打 Android APK

## v1.1（已完成 2026-08）

- ✅ `<style>` / `<style scoped>`：JS 侧 CSS 引擎（基础选择器集、级联、
  继承、:deep/:global），class/`:class` 全链路打通
- ✅ 样式对齐常用 web：flexGrow→Expanded、gap、min/max 尺寸、display:none、
  overflow:hidden、boxShadow、linear/radial-gradient、opacity、border/
  borderRadius 简写、rgb()/rgba()/hsl()/命名色、px 单位、完整文字样式族
  （fontStyle/lineHeight/letterSpacing/textDecoration/textTransform/
  textShadow/fontFamily/whiteSpace）

## v1.2（已完成 2026-08）

- ✅ **列表性能**：list-view 走 `ListView.builder`；行用稳定 key +
  `findChildIndexCallback`，滚动时复用已有 render box；JS 侧只物化可视窗口
  （`preloadExtent` 首屏批量、`prefetchExtent` 触底续接），按需绑定
- ✅ **按压态 `:active`**：CSS 引擎为命中 `:active` 的节点额外算一份按压样式，
  随 `activeStyle` 一起下发；Flutter 侧由节点自己的按下状态就地切换（不回 JS，
  滑动取消按压），web 侧直接是浏览器原生的 `:active`
- ✅ Web 适配层对齐：默认行高/默认色、内置组件默认外观、scroll-view 方向与
  鼠标拖拽、swiper 一次一页（见 docs/web.md「已知差异」）
- ✅ **navMount 不强制 first-paint layout**（specs/086）：页面 `onMounted`
  里的 `getBoundingClientRect` 不再把整页 `flushLayout` 叠在 JS 栈上冻转场
- ✅ **vant 页首开提速 + `<defer>`**（specs/118）：元素层削分配（Element 原型化、
  标签字节缓存、ASCII 直写、常量 props 预编码、事件类型按节点索引、惰性 HTML
  属性不过桥）、子树标脏去重；新内置标签 `<defer>` 把首屏以下的内容推到转场结束
  后挂。vant-form 首开同步段 204 → 38 ms、卸载 29 → 7 ms（离线基准，容器口径），
  见 [vant-mount-perf.md](vant-mount-perf.md)。离线基准 `pnpm --filter demo run bench:mount`

## 工具链分发（已完成 2026-08）

- ✅ **fjsc 预编译产物分发**：`@ufjs/fjsc-<平台>` 五个平台包作为 `@ufjs/cli` 的
  optionalDependencies 按 `os`/`cpu` 自动装，用户不需要 CMake / NDK。
  交叉编译走 `.github/workflows/fjsc-release.yml`，发布流程见
  [publishing.md](publishing.md)

## CLI v1.3（已完成 2026-08）

命令从 `create / dev / run / build` 扩到十二个，覆盖「建页面 → 看路由 → 查环境 →
看体积 → 管原生宿主 → 上设备调试」这条链：

- ✅ **生成器**：`fjs create page|component`（别名 `fjs g`），支持嵌套与动态段
  `user/[id]`、`<route>` 块参数、`--dry-run` / `--force`；生成后用构建期同一个
  扫描器回读并打印真实路由和 `router.push` 调用
- ✅ **路由类型**：构建 / dev / Vite 插件 / 生成器都会写 `src/fjs-routes.d.ts`，
  `push({ name })` 有补全和拼写检查（空注册表时退回 `string`，老项目零影响）
- ✅ `fjs routes`（路由表 + 重名重路径告警）、`fjs doctor`（11 项体检，慢探测
  异步化并带转圈）、`fjs devices`、`fjs clean`（只删自己生成的，且只在项目内）
- ✅ `fjs build --analyze`：每个产物的 js / gzip / 字节码尺寸 + 包占比
- ✅ `fjs build` / `fjs dev` 首帧节点数静态预警：页面超过 `fjs.performance.nodeBudget`
  时提示改用 `list-view`、窗口化或降低默认首屏节点数
- ✅ **宿主归属**：`package.json` 的 `fjs.flutterDir` 配置项，
  `fjs host status|create|open|eject|sync|id`。eject 后 fjs 不再改写
  `lib/main.dart` / `pubspec.yaml` / Gradle 补丁
- ✅ **宿主原生配置**：根目录 `app.config.ts` 可配置应用版本（写入生成宿主
  pubspec，flutter build 传导到 Android/iOS 版本号）、屏幕方向锁定
  （`orientation`，含 iPad 的 `UIRequiresFullScreen` 自动补齐）、Android/iOS
  包名、Android permissions 和 iOS `Info.plist` 键值，managed 宿主每次同步时应用
- ✅ `fjs icon`：一张方图重生成两端图标，缩放外调 sips / ImageMagick，零图像依赖
- ✅ **dev server 快捷键**：`r` 重建并推 reload、`l` 就地开关日志流、`d` 看连接
  数、`c` 重出地址与二维码、`--web` 下 `o` 开浏览器、`?` 列表、`q` 退出；只在
  交互式终端启用（被 `fjs run` 拉起时自动关闭）
- ✅ `fjs log` / `fjs eval`：经 dev server 转发到设备 VM，返回值走日志通道，
  不需要"能返回值的 eval"原生接口；App 与浏览器构建行为一致
- ✅ 路由修正：动态页的 name/chunk 由文件路径推导（`user/[id]` → `user-id`，
  `[...all]` → `all`），web 端 catch-all 翻译成 vue-router 语法后两端
  `params.pathMatch` 同为字符串

## 表单组件（已完成 2026-09）

对着 hello uni-app「内置组件 → 表单组件」这一组补齐，spec 在
`specs/007-form-components/`：

- ✅ `radio` / `radio-group` / `checkbox-group`：组只管互斥与收集，
  载荷两端逐字节相同（选中项的 `name` / `name` 的 JSON 数组串）
- ✅ `label`：`for` 或子树第一个控件，切换或聚焦
- ✅ `form`：`@submit` 收集子树里带 `name` 的控件当前态（未改动的也带默认值），
  `@reset` 只发事件；配 `<button form-type="submit|reset">`
- ✅ `button` 的 `type` / `size` / `plain` / `loading` / 显式 `disabled`
- ✅ `input` 的 `@focus` / `@blur` / `maxlength`，以及补上 Flutter 侧缺的
  `keyboard` → `keyboardType`
- ✅ 四个新事件号（20 focus / 21 blur / 22 formSubmit / 23 formReset）三处同步
- ✅ `picker` / `picker-view` / `picker-view-column`：滚轮下到 Flutter
  `ListWheelScrollView` 与 web `scroll-snap`，弹层和 selector / multiSelector /
  time / date 四种 mode 留在同一份 JS 组件里；spec 在 `specs/008-picker/`

## 视图容器属性补齐（已完成 2026-09）

`specs/009-scroll-swiper-props/`，对着小程序的属性表把两个容器补完：

- ✅ `scroll-view`：`scroll-x` / `scroll-y`、`scroll-top` / `scroll-left`
  （受控但不粘手）、`scroll-into-view`、`scroll-with-animation`、
  `upper-threshold` / `lower-threshold`，以及 `@scroll` /
  `@scrolltoupper` / `@scrolltolower`
- ✅ `swiper`：`current`、`circular`、`autoplay` + `interval`、`duration`、
  `vertical`、`indicator-dots`，`swiper-item` 自己撑满一页
- ✅ 两个新事件号（24 scrolltoupper / 25 scrolltolower）三处同步；滚动语义
  （载荷字段序、到边只在进入阈值区时派一次、circular 的索引取模）写在
  `fjs-runtime/src/scroll/metrics.ts`，Dart 侧 `render/scroll_metrics.dart`
  逐条镜像
- ✅ 顺手修掉两处**只在 Flutter 上哑火**的事件名：模板写 `@scrolltolower`
  给出的是全小写 prop，而事件表里只有驼峰；`@change` 写在 swiper 上会被当成
  控件的值变化。element 层现在遇到不认识的 handler 会告警而不是静静丢掉（宪法 V）

> ⚠️ **破坏性变更：`@scroll` 的载荷**。以前是一个裸的偏移量字符串，现在是
> 六字段 JSON 串
> `{"scrollTop","scrollLeft","scrollHeight","scrollWidth","deltaX","deltaY"}`
> （字段序固定、数值一位小数）。页面里 `@scroll="(v) => (top = Number(v))"`
> 这种写法要改成 `@scroll="(v) => (top = JSON.parse(v).scrollTop)"`。
> 两端同时改，web 和 Flutter 给出的字符串逐字符相同。

同组里 **region picker / editor** 顺延：`region` 要内置并维护行政区划数据集，
`editor` 是独立富文本引擎，和 picker 的列机制不是同一体量。

## image mode 与加载事件（已完成 2026-09）

`specs/010-image-mode-events/`，把内置 `image` 从「只有 `src` 和 `fit`」补到
uni-app 那张表：

- ✅ `mode` 的 14 个值两端同源（`fjs-runtime/src/image/mode.ts` ↔
  `render/image_mode.dart`）：`scaleToFill` / `aspectFit` / `aspectFill` /
  `widthFix` / `heightFix` 加九个裁剪对齐位。默认 `scaleToFill`，未知值告警降级；
  显式 `mode` 压过旧的 `fit`，只写 `fit` 的老页面行为不变
- ✅ `lazy-load`：web 用 `IntersectionObserver`，Flutter 沿
  `RenderAbstractViewport` 比对 viewport（没有引入 `visibility_detector`）。
  两端共用预加载余量 `IMAGE_LAZY_PRELOAD_PX = 240`，所以同一页在两端是在同一个
  滚动位置开始加载；普通页面、`scroll-view`、`list-view` 里都可用，宿主给不出
  viewport 时告警并立即加载
- ✅ `@load` / `@error`（事件号 26 / 27，三处同步）。载荷
  `{"width":n,"height":n}` / `{"errMsg":"image load failed"}`，字段序固定、两端
  逐字符相同，同一轮加载互斥且只派一次，换 `src` 丢弃旧结果
- ✅ Flutter 网络图改用 `cached_network_image`（内存 + 磁盘缓存），asset 仍走
  `AssetImage`，空 `src` 不发请求
- ✅ iOS/macOS 网络图崩溃（`specs/117-pin-path-provider-foundation`，2026-09）：
  `flutter_fjs` 把间接依赖 `path_provider_foundation` 限制在 `<2.6.0`，实际解析到
  2.5.1（插件实现）。2.6.0 的 FFI 实现依赖 `objective_c` native assets，构建时偶尔
  漏打包，首张网络图报 `DOBJC_initializeApi` 崩溃。**放开条件**：Flutter stable 修好
  native assets 嵌入（flutter/flutter#178915、dart-lang/native#3281）
- ✅ 与微信小程序对齐（`specs/102-image-mode-wechat-parity`，2026-09）：
  九个位置类 mode 改成**不缩放**的 1:1 开窗（`object-fit: none` /
  `BoxFit.none`，原来按 `cover` + 对齐实现，与 `dist/mp` 实拍 MAD 47–71）；
  `heightFix` 改成宽优先——声明了 `width` 就按宽算高（微信此时等同
  `widthFix`），只声明 `height` 的写法不变
- ✅ 事件首参契约修复（`specs/103-event-payload-contract`，2026-09）：
  specs/070 给所有 `on*` 包的 DOM 事件对象让 Flutter 端每个载荷 handler
  （`JSON.parse(payload)`）静默抛错，图片页 mode / load-error 两个面板整块
  空白；现在 fjs 标签首参=裸载荷（与 web 组件 emit 同源）、非 fjs 标签
  仍=事件对象，demo vant 的 Field/Stepper 由项目内补丁兜底
- ✅ 事件首参按 web emits 判定（`specs/104-event-first-arg-by-emits`，2026-09）：
  103 只看标签，`<view @click.stop>` 在 Flutter 端抛错；现在按「该事件是否在
  web 组件 emits 中」决定裸载荷还是事件对象，`event-emits.ts` 由漂移单测锁住
- ✅ 引擎 flavor 不再改写插件目录（`specs/105-engine-flavor-no-plugin-writes`，2026-09）：
  091 把选中引擎复制进 flutter_fjs 自身目录（多数宿主下是共享 pub-cache）；
  现在 Android 的 gradle 与 iOS/macOS 的 podspec 按 `FJS_JS_ENGINE` 直接引用
  对应产物，鸿蒙仅 path 依赖可切；CLI 不再静默跳过 runner 失败；
  `tool/check-publish.mjs` 发布前校验。**待本机验证**：各平台真机构建与
  `dart pub publish --dry-run`
- ✅ flex 主轴百分比参照改为显式标记（`specs/106-flex-percent-basis-explicit`，2026-09）：
  101 从「max 无穷、min > 0」推断参照，把 CSS `min-height` / `min-width` 盒子里的
  `height/width: 100%` 也解析了（web 为 auto）；现在只有装饰层解封高度时打的
  `FjsUncappedHeightScope` 才让 min 生效。**待本机验证**：`flutter test` 与飞行盒真机
- ✅ 调试通道鉴权（`specs/107-debug-channel-auth`，2026-09）：`fjs debug` 的 VM 端口对
  非回环连接做 token 质询（经 CDP `Runtime.evaluate`，不改 native），未认证连接不占会话
  槽位；dev server 只接受本机工具，`eval` / `perf` / `debug-relay` 要求已登记工具，
  跨机器需 `fjs dev --remote-tools`。**待本机验证**：`flutter test` 与局域网真机附加
- ✅ PrimJS 的 `queueMicrotask` 兜底不再吞异常（`specs/108-queue-microtask-errors`，2026-09）：
  回调异常按 quickjs-ng 原生同款前缀与格式上报，非函数参数同步抛 `TypeError`
- ✅ 未处理的 Promise 拒绝打日志（`specs/111-promise-rejection-tracker`，2026-09）：两个引擎在 pump 排空后
  报 `[fjs] unhandled promise rejection`；顺带修掉 PrimJS 未处理拒绝列表只进不出的内存泄漏。
  **待办**：用 `tool/build-*.sh` 重新生成各平台预编译产物后才会进 App
- ✅ iOS/macOS 上 `--js-engine` 切换后仍运行旧引擎（`specs/112-engine-switch-stale-build`，2026-09）：runner
  递归清 Xcode 缓存（spec 105 的一层查找从未命中）；戳记升到 v2，已处于错误状态的宿主会重新失效一次。
  **待本机验证**：iOS / macOS 来回切换
- ✅ 鸿蒙调试签名跟着机器走（`specs/113-ohos-signing-reuse`，2026-09）：DevEco 首次签名后 `fjs run ohos` /
  `fjs build --hap` 把 `signingConfigs` 存进 `~/.fjs/ohos-signing/`，宿主重建后自动写回；没有可用签名时在
  flutter 之前报错并打开 DevEco，不再等 hvigor 跑 20 秒。鸿蒙模拟器上 `fjs run ohos` 与 `fjs build --hap` 均已实测；删掉 `.fjs/flutter/ohos`
  后宿主会自动补建
- ✅ fjsc 双引擎（`specs/114-fjsc-dual-engine`，2026-09）：每个 `@ufjs/fjsc-<平台>` 带 `bin/fjsc`（primjs）与
  `bin/fjsc-quickjs`；CLI 按二进制自报的引擎 id 挑 fjsc（`FJSC_PATH` 不符即报错），编完再核对，`fjs doctor`
  分引擎列出。修掉 0.1.4 把 quickjs-ng 当默认 `bin/fjsc` 发布、primjs 构建到运行时才失败的问题。
  已随 0.1.6 发布，`@ufjs/fjsc-*@0.1.4` 已 deprecate
- ✅ release / profile 不带调试器模块（`specs/115-android-release-drop-debugger`，2026-09）：Android 调试器
  挪到 `abi/primjs/android-debugger/` 只挂 `debug` 源集（`jniLibs.excludes` 被 AGP 忽略）；鸿蒙由宿主
  `entry/build-profile.json5` 过滤，CLI 托管宿主自动补丁；`tool/test/android_debugger_strip_check.mjs`
  实跑三变体断言。iOS Release 核实无需改动。已随 0.1.7 发布
- ✅ `libfjs.so` 收窄导出符号（`specs/116-libfjs-export-trim`，2026-09）：版本脚本在构建时从调试器目标文件
  生成，只导出 `fjs_*` + 调试器所需，配 `--gc-sections`；arm64 primjs 1.94 → 1.34 MB。`fjs_debugger` 以
  `--no-undefined` 链接兜底，`tool/test/libfjs_exports_check.mjs` 核对产物。已随 0.1.7 发布
- ✅ 清理入库的构建产物与死代码（`specs/109-no-committed-build-artifacts`，2026-09）：spec 093 e2e 的
  `bundle.js` / `relay.cjs` 改由 `e2e/build.mjs` 生成、不再入库（Linux 上重跑 11/11）；删除从未编译的
  `primjs/src/wasm/`；`fjsrun` 补 `<ctime>`，Linux 可编
- [ ] fjs-go 内置的 `assets/shared.fjsbundle.gz` 是 quickjs-ng 字节码，默认引擎已是 PrimJS——
  按 PrimJS 重新部署 showcase 后执行 `examples/fjs-go/tool/refresh-seed.sh`
- ✅ 提交规范护栏（`specs/110-commit-hygiene`，2026-09）：`.githooks/commit-msg` 校验 conventional
  commits 与空洞摘要（`git config core.hooksPath .githooks` 启用）；`flutter_fjs` 库包锁文件不再入库；
  fjs-go 鸿蒙签名配置移出仓库（本机签名见其 README）

实机对拍时抓到三个只有跑起来才看得见的问题：Dart 的 mode 分支漏了 `center`
（静静降级成 `scaleToFill`）；web 的 `heightFix` 因为 column flex 的 stretch 被
拉满父宽，和 Flutter 的 `高 × 比例` 对不上；两端的 lazy 预加载余量原本一个 240
一个 0，同一页在不同滚动位置开始加载。三处都补了回归用例。

## src 路径补全与根目录 html/（已完成 2026-09）

`specs/018-src-hints-and-html-dir/`，真机验过 017 之后的三个收尾：

- ✅ `fjs` 把 `public/` 与 `html/` 扫成 `src/fjs-assets.d.ts`，`<image src>`
  补全图片、`<web-view src>` 补全 html，两个标签各查各的表
- ✅ 补全用 `keyof X | (string & {})`，所以不挡 http / import / 模板串 ——
  代价是**打错字不是类型错误**，查错另起一条构建期检查（只看字面量 src，
  给出最接近的候选，动态 `:src` 不碰）
- ✅ app 自己的 webview 页面有了合法位置：项目根 `html/`，页面写
  `/html/guide.html`，两端同源
- ✅ `@ufjs/webview` 不再往应用的 `public/fjs-modules/` 写第二份
  —— 那是钩子唯一一次写到 `outDir` 之外，017 之后变成了每个 release 包里的
  重复文件。现在 `.fjs/modules/<name>/` 是唯一一份，web 由 vite 插件（dev）
  与 web 构建（build）给它 URL，`/fjs-modules/<name>/<file>` 契约不变

实现中修的两处存量问题：vite 中间件对自己前缀下的未命中会 404，不再落进 SPA
兜底（在 `<web-view>` 里表现为「app 把自己渲染进了一个盒子」）；
`fjs-webview` 的 Flutter 测试文件少一个 import、一直编译不过，`flutter test`
把它报成一条失败的 "loading …"，等于从来没跑过。

## 本地图片（已完成 2026-09）

`specs/017-local-image-assets/`，让 vite/vue 的标准写法在两端都成立。之前
`import png from '@/assets/x.png'` 在 Flutter 侧**构建就失败**（app 那几条
esbuild 没配 `file` loader），而 `public/` 下的文件在 App 上**运行期静默失败**
（`public/` 从来没被同步进 Flutter host）。

- ✅ 本地文件统一成**根绝对路径**：import 的资源 → `/assets/x-<hash>.png`，
  `public/` 下的 → 原样。`asset://x` 作为旧写法等价于 `/x`
- ✅ 打包器五处 app 侧 esbuild 补 `file` loader，`outfile` 换成
  `outdir` + `entryNames`（否则 page chunk 会把图吐到 `dist/app/pages/assets/`）
- ✅ `public/` 与 `dist/app/assets/` 一起同步进 `assets/fjs/public/`，pubspec
  **递归**列出每一级目录（Flutter 的 asset glob 不递归，漏了不报错）
- ✅ Dart 侧一条规则解析根路径：连着 `fjs dev` 走 dev server，否则读 Flutter
  asset（`FjsAssetScope` 把 `devUri` 供给 widget 层）
- ✅ 三处静默失效补上告警：`fjs dev --web` 的 SPA 兜底不再对带扩展名的路径返回
  index.html；web 侧 `asset://` 剥前缀后是根路径而不是相对路径；Flutter 侧
  解析不出的 src（`.svg`、相对路径、越界路径）warn 后走 `@error`

模拟器上抓到的一个：dev 下改 `public/` 里的图，因为图片缓存按 URL 建键而 public
路径不变，页面还显示第一次拉到的那张。dev URL 现在带一个随完整 reload 自增的
`?fjs=<n>`。

## textarea（已完成 2026-09）

`specs/012-textarea/`，多行输入从「`<input multiline>` 凑合」补成对齐小程序的
`textarea`：

- ✅ `textarea` 是 **JS 组件**（`components/textarea.ts`），渲染成 `<input multiline>`，
  `tags.json` 不加条目。默认值、props 归一化、`@linechange` 的门都在组件里，两端共用
  一份；只有真正需要平台控件的四样落到共用的 `widgets/input.dart`：`auto-height` 关掉
  时的内部滚动、行数、焦点、键盘确认键
- ✅ `auto-height`：开时跟着内容长，关时到三行为止并在框里滚（Flutter `maxLines: 3` /
  web `rows="3"`，跟着字号走而不是一个像素数）；页面给了高度就填满那个盒子
- ✅ `focus` / `auto-focus` 受控焦点、`confirm-type` 的六个值、`placeholder-style`
  的四个键
- ✅ `@linechange`（事件号 28，三处同步），载荷 `{"height":n,"lineCount":n}`，
  只有行数变化才派，首帧不派。**不给 `heightRpx`**——fjs 没有 rpx 坐标系
- ✅ `@confirm` 复用事件号 4：它就是 `input` 的 `@submit` 在多行下的名字

> ⚠️ **破坏性变更：`<textarea>` 的 `maxlength` 默认值**。以前 `<textarea>` 只是
> `<input multiline>` 的 HTML 别名，不限长度；现在它是 textarea，默认 **140 字截断**
> （照小程序）。不想要上限的页面要显式写 `:maxlength="-1"`。截断是静默的，和 `input`
> 一样不给计数器 UI。

实现中发现「元素还是组件」的判定**有四处**，plan 只数到两处：构建
（`vue-plugin.ts`）、Web 构建（`vite.ts`）、运行时的 HTML 别名表（`renderer.ts`）、
Volar 插件（`volar.cjs`）。`form` 之所以从没暴露这个问题，是因为它同时还在
`tags.json` 里。组件标签现在单独一份 `component-tags.json`，四处共读，
`packages/fjs/test/vue-plugin-tags.test.ts` 盯着它——判错是静默的：页面照常渲染，
但渲出来的是原生 `<textarea>`，fjs 的 props 变成没人认识的 HTML 属性。

## web-view（已完成 2026-09）

`specs/013-web-view/`，嵌一张网页的能力，做成**模块** `@ufjs/webview`
（`packages/fjs-webview/`，形状照 `fjs-iconmind`）：

- ✅ `<web-view src @load @error @message />`：app 侧 `webview_flutter` 的
  `WebViewWidget`，web 侧 `<iframe>`；props 与三个事件载荷两端逐字符相同
- ✅ **不是内置标签**，`tags.json` 不加条目。`webview_flutter` 要 Dart SDK ^3.5，而
  `flutter_fjs` 声明 >=3.3——内置就得让所有应用跟着抬下限，做成模块只有装的人付。
  **核心的 `environment.sdk` 一个字没动**
- ✅ 事件号仍归核心发（宪法 II）：新增 `onMessage: 29`；26/27 从
  `FJS_EVENT_IMAGE_LOAD/_ERROR` 改名成 `FJS_EVENT_LOAD/_ERROR`，**值不变**，载荷形状
  由标签决定
- ✅ 它是**普通盒子**，不照小程序铺满整页；`@message` **立即派**，不照搬「攒批到后退
  时一次交付」。两条差异都写进了 `docs/ui-api.md`
- ✅ `asset://` 让模块自带的网页在 dev（dev server）/ release（Flutter asset）/ web
  （应用 `public/`）三处都能加载

实机才暴露的三个问题，都已修并补了用例：

1. **dev server 的 `/modules/` content-type 写死 application/json**，WebView 把 HTML
   当文本显示，而 `@load` 照常派——只看事件发现不了。现在按扩展名给
2. **release 下 `asset://demo.html?q=x` 无法传参**：Flutter asset 是 manifest 里的键，
   不是 URL。web-view 现在用无参数 key 查找文件，再在首次本地导航时恢复 query/fragment，
   页面与 dev/web 一样可以读取参数
3. **换 `src` 后旧 iframe 把它的 `load` 报成了新 URL 的**（web 侧，generation 挡不住，
   因为监听器是同一个闭包）

> 顺带记一条排查结论：iOS **模拟器**里网页的中文显示成豆腐块，不是编码问题（字节是
> 合法 UTF-8、响应带 charset、换 vite 服务一样），也不是没有中文字体（同一个 WebView
> 打开 m.baidu.com 正常），而是页面 font stack 以 `-apple-system` / `system-ui` 开头
> 时模拟器不再往 CJK 回退。真机不受影响。

## canvas（已完成 2026-09）

`specs/019-canvas/`，绘图能力。web 用浏览器原生 canvas，App 用 JS 实现的同名
2D 状态机 + Flutter `CustomPaint` 回放，页面一行不改跑两端：

- ✅ `<canvas>` 进 `tags.json`；`getContext` / `toDataURL` / 只读的
  `width`·`height` 挂在**元素**上（`ui/element.ts`），裸 element API 和以后的
  React 适配拿到同一套 API
- ✅ **op 协议加第 10 号**：canvas 显示列表（`ops.ts` / `ui_ops.dart` /
  `fjsrun.cpp` 三处同步，`uiOpsVersion` 2 → 3）。坐标 f32、字符串按 chunk 去重、
  属性只在变化时发——一帧图表几千条命令走 `setProps` 的 JSON 是不可接受的
- ✅ **保留语义**：JS 每帧只发新命令，宿主累积；覆盖整块画布的 `clearRect`
  截断旧命令（chunk 以 CLEAR_ALL 开头，宿主不用解析就能丢）。尺寸变化两端都清空
- ✅ `getContext` 是**注册表**：`'2d'` 之外的类型（webgl）两端都返回 `null` +
  告警一次，将来由模块注册进来，`canvas` 标签本身不用改
- ✅ `measureText` 是同步 host 调用（Flutter `TextPainter`）+ JS 侧 LRU；
  `loadImage` / `toDataURL` 走 fetch 范式（事件 30，载荷带 `t` 区分三种消息）
- ✅ 页面拿到的 context 类型是 `FjsCanvasContext2D` 而不是 DOM 的那个——
  兼容清单的类型化版本，写了 App 端做不到的方法直接编译报错
- ✅ **ECharts 跑通**：`examples/hello-fjs/src/pages/example/canvas/echarts.vue`，
  折线 + 柱状 + 阶段速度表（gauge-stage）+ 饼图 + `setOption` 更新，接法见
  `examples/hello-fjs/src/adapters/echarts/adapter.ts`
- ✅ **F2 跑通**：`examples/hello-fjs/src/pages/example/canvas/f2.vue`，折线 / 柱状 /
  饼图，适配层在 `examples/hello-fjs/src/adapters/f2/adapter.ts`（不用 `@antv/f-vue`）
- ✅ **重活不再压在路由转场上**（spec 027 第二轮）：新事件
  `FJS_EVENT_NAV_SETTLED = 31`（路由 push 转场结束）+ 页面级
  [`onPageSettled`](ui-api.md#页面onpagesettled)（两端同源：Flutter 走
  `didPush()` 的 TickerFuture，web 走 `<Transition>` 的 afterEnter）；
  `<canvas>` 新增 `defer-resize` 开关（默认关），开了之后首次 `@resize` 两端都
  等转场结束再派。修掉了「每次 push 进 F2 页固定丢约 205ms 帧」——三张图首帧
  渲染约 210ms，原本整段压在转场上

- ✅ **WebGL 跑通**（spec 021；spec 022 抽成 [`@ufjs/webgl`](../packages/fjs-webgl) 模块，装才有、不装两端一致 null）：`getContext('webgl')` / `'webgl2'`，同一份 GL
  代码两端渲染（`examples/hello-fjs/src/pages/example/canvas/webgl.vue`）。GL 指令流走
  op 11，App 侧经 flutter_angle（ANGLE）执行，回放层隔离在
  `canvas/webgl_replay.dart`；flutter_angle 已升到 0.4.x（TypedData 直接进 GL，
  不再过 NativeArray 包装），这也把整个仓库的最低 Flutter 抬到 3.38 /
  Dart 3.10——更低的 CFE 编译 flutter_angle 会崩，见 toolchain。webgl 坐标是
  位图像素（页面自己处理 dpr），与 2d 的逻辑像素契约不同，见 canvas-compat。

- ✅ **three.js 跑通**（spec 023，`examples/hello-fjs/src/pages/example/canvas/three-gltf.vue`）：
  GLTFLoader 加载 Xbot.glb、单指拖拽旋转。为此补齐：WebGL2 的 VAO 与
  `texStorage2D` / `texSubImage2D(source)` 命令（App 侧 `UNPACK_FLIP_Y_WEBGL`
  随命令携带、Dart 按行翻转）；`getShaderPrecisionFormat`（App 侧按 WebGL2
  下限常量作答——flutter_angle 的实现是全零 stub，照抄会让 three 选 lowp）；
  native polyfill（TextDecoder / Blob / object URL / fetch 拦截 /
  createImageBitmap → data: URL → 宿主解码）；fetch 的根相对 URL 在 dev 下按
  dev server 解析（`FjsHttp` 拿到与 canvas 图片同一个 devUri 闭包）。
  未承诺：three 的后处理、WebXR、Draco/KTX2（依赖 `getExtension` 扩展，恒 null）。
- ✅ **webgl 呈现路径收口**（spec 028，修正 spec 026 的归因）：GL 命令的执行与
  呈现拆成两个时钟 —— 执行随 chunk 到达，呈现每 Flutter 帧至多一次且等
  `Texture` layer 就绪。修掉四条只在**按需渲染**页面上现形的缺陷：纹理创建
  未 await、一帧 swap 两次（`EGL_BUFFER_DESTROYED`）、一个页面帧跨两个缓冲、
  iOS 真机 swap 前没有真同步（`glFinish` 在 ANGLE 的 Apple 后端不等，改用
  1×1 `glReadPixels`）。026 记的「present 前显式 `glFinish`」是错的，
  已在 [canvas-compat.md](canvas-compat.md) 改正。
  另：`fjs run ios` 自动注入 `NSLocalNetworkUsageDescription`，否则 iOS 14+
  静默拒绝局域网、dev server 报 `No route to host`。
- ✅ **模型查看器双指捏合缩放**（spec 029）：两个 glTF 页支持双指捏合改变相机
  距离，上下限按初始距离取 `[0.4x, 2.5x]`。纯页面侧实现 —— 多指
  （`FjsTouchEvent.touches`）与 `touch-action` 都是既有能力，运行时一行没改。
  桌面浏览器只有一个指针捏不出来，页面另配 `−` / `+` 按钮补齐（fjs 无 wheel
  事件），因此不必登记两端差异。手势状态机抽在
  `examples/hello-fjs/src/gltf/pinch.ts`，不含任何 3D 概念。

- ✅ **dev 引导能熬过 iOS 的异步授权弹窗**（spec 030）：引导拉取退避重试
  1→2→3→5→8s 不设上限（只重「够不着」，服务器答了 4xx 立刻抛，老 server 的
  manifest 回落不受影响）；启动时并行探一发公网把「使用无线数据」弹窗勾出来
  （局域网请求不触发它，而它没答之前所有网络都不通）；`runApp` 提前到
  connect 之前，引导失败不再让 app 全黑，屏幕上有可见的重试说明。

- ✅ **WebGL 实例化绘制**（spec 033）：`drawArraysInstanced` /
  `drawElementsInstanced` 进了命令流（0x0606 / 0x0607），宿主经 flutter_angle
  执行；three 的 `InstancedMesh` 在 App 端可用。示例「画布演示 / WebGL 实例化」。

- ✅ **webgl 画布间 GL 状态隔离**（spec 036）：flutter_angle 各平台只有一个 GL
  context，此前一张画布的 enable / 绑定 / viewport 会漏进下一张（真机：先开
  「WebGL 三角形」再开「WebGL 实例化」，后者只剩清屏色）。宿主按画布记账、切换
  或查询前对 GL 当前值做 diff 补发，默认 VAO 由每画布一个隐藏 VAO 充当，
  plugin 自己改的 viewport / framebuffer 等标记为未知再补。单画布每帧只付一次
  identity 比较。实现在 `fjs-webgl/flutter/lib/src/gl_state.dart`。

支持范围与两端差异：[canvas-compat.md](canvas-compat.md)。未做且已登记：
WebGL 扩展（`getExtension`）、`readPixels`、GL 指令去重、
`getImageData` / `putImageData`、`filter`、`OffscreenCanvas`、离屏 canvas。

## rich-text（已完成 2026-09）

`specs/034-rich-text/`，对齐小程序 `rich-text`：后端下发的 HTML 字符串或节点数组原样展示。

- ✅ `rich-text` 是 **JS 组件**（`components/rich-text.ts`），`component-tags.json` 加一行，
  `tags.json` 不加。解析、白名单、默认样式、列表编号、表格退化、空白与实体、默认 margin
  折叠都在 `fjs-runtime/src/rich-text/`，**web 侧也不用 `DOMParser`**，残缺 HTML 两端建出
  同一棵树
- ✅ 白名单照小程序原样：非白名单标签连子树删除、每个标签名告警一次；`class` 能命中调用方
  页面的 `<style scoped>`（组件把页面 scope 挂到内部节点上）
- ✅ `space`（ensp / emsp / nbsp）；`img` 与文字同一行；表格退化成 flex 网格，
  `colspan` / `rowspan` 告警后忽略；`user-select` 与 Skyline `mode` 不支持并告警
- ✅ **下到宿主的只有一件事：嵌套 `text` 的行内排版**，而且对所有页面生效——Flutter
  `widgets/text.dart` 有子节点时走 `Text.rich`（片段 `TextSpan`、其它子节点
  `WidgetSpan`、上下标平移），web `base-css.ts` 的 `text text { display: inline }`。
  三张契约表都没动
- ✅ 实现中补的两处：`mirror_tree.dart` 的失效要沿 `text` 祖先链上溯（段落从片段的
  MirrorNode 直接取文字，深层片段改了而段落不重建，App 上会停在旧字），且
  insert / remove / removeChild 不经过 `_touch`，要四处都改；`monospace` 在 iOS 上解析
  不到任何字体，`style.dart` 映射成 `Menlo`

> ⚠️ **破坏性变更：`text` 里嵌 `text` 变成行内片段**。以前 web 上一段一行竖着堆，
> Flutter 上只显示第一段；现在两端都连成一段，各自带自己的样式。要保持竖排的页面把外层
> `text` 换成 `view`。片段上的 margin / padding / border / 宽高不再生效（两端一致）。
> 仓库里的 `examples/` 与 `demo/` 扫过一遍，没有这种写法。

与小程序的差异（`docs/ui-api.md`）：默认样式的 `em` 按 14px 折成像素，给 rich-text 设
字号时标题不缩放；页面 class 给的 margin 不参与折叠；`ruby` 只做退化。

- ✅ **节点数优化**（`specs/035-rich-text-node-reduction/`，iOS 老真机打开示例页卡 UI）：
  一个段落一个节点——行内片段拍平成 `text` 的内部 prop `richSpans`，Flutter
  `text.dart` 建 `TextSpan`、web `FjsText` 建 `<span>`；只含一段文字的块与段落合并、单字符串
  走元素文本、列表项去掉内容 view。模拟长文 486 → 91 个节点、帧 34.6 KB → 15.3 KB，
  外观两端逐段不变。带 `class` 的片段与含图片的段落仍走嵌套节点。实现中补的一处：
  `renderer.dart` 的 `isHidden` 会把「无文本、无子节点」的 `text` 当 Vue 空锚点藏掉，
  `richSpans` 段落恰好长这样，要排除

## dev 热更新

页面级热更新还在：只改某一个页面（及其私有模块）推 `reload pages:`，该页
重挂，VM 不动。shell、共享组件、共享 ts、插件、路由改动整包 `reload`。

spec 037 的模块级 units 在 spec 095 去掉了。它只在「两页共用、入口碰不到的
展示组件」上换得上新代码；改 Pinia store 时热替换发生了，新工厂却不会跑。
为这一档维护注册表和调试脚本名不值得。

web（`fjs dev --web`）收到任何变更仍是整页刷新。行为见
[toolchain.md](toolchain.md)、[code-splitting.md](code-splitting.md)。

## 二进制句柄跨越 JSI（已完成 2026-09）

`specs/038-structured-jsi-handles/`，roadmap 原文的「HostObject 句柄
（JS_GetOpaque 持 C++ 指针）」落成时改了形态：宿主模块执行体全在 Dart、
拿不到 C++ 指针，真正省序列化的是 **number 句柄 + VM 内字节表**——

- ✅ `FJS_ABI_VERSION 2`：`fjs_handle_put_bytes / fjs_handle_bytes /
  fjs_handle_release`（Dart↔C++）+ `__fjs.fns` 的 `handleBytes /
  readHandleBytes / releaseHandle`（JS↔C++）；id 单调递增永不复用，
  stale id 读取显式抛错
- ✅ fetch 双向换通道：响应体/请求体不再 base64-in-JSON，事件 14 载荷以
  `handle` 替代 `bodyBase64`；旧引擎自动退回 base64，新载荷遇旧 runtime
  显式报错；页面代码零改动，web 侧走浏览器原生不受影响
- ✅ 通道成本对照（Dart 侧，`test/handle_bench_test.dart`）：
  1MB 7053µs → 505µs（14×）、5MB 27748µs → 864µs（32×）
- ✅ 未消费句柄的驻留策略（VM 销毁清算）登记在
  [jsi-and-native-modules.md](jsi-and-native-modules.md)

通用对象的结构化传递（Worker 结构化克隆、dispatchEvent 结构化载荷）顺延。

## 异步宿主调用（已完成 2026-09）

`specs/039-async-host-invoke/`，近期计划第一条：Dart 宿主模块从「必须当场
应答」解放出来，`Future` 结尾的能力（插件读写、权限、三方 SDK）可以直接
做成宿主模块。

- ✅ `invokeHostAsync(name, ...args)`：从 `fjs` 导出；参数整体作为一个
  JSON 数组串过界，Dart handler 收到解码后的 `List<Object?>`，返回值
  `jsonEncode` 后 dispatchEvent 回来 settle Promise。无原生 host（web /
  fjsrun）reject，与 `invokeHost` 抛错同一条边界
- ✅ Dart 侧 `engine.host.registerAsync`：与同步 `register` 分表（同步
  契约是「trampoline 当场返回」，不混 `is Future`）；引擎内置
  `'fjs.async.invoke'` handler 只发起、永远经微任务分发，不重入正在执行
  的 JS 栈
- ✅ 新事件号 `FJS_EVENT_ASYNC_RESULT = 32` 三处同步（fjs.h / ffi.dart /
  host-async.ts 的 registerSystemHandler）；载荷字段序固定
  `{"ok":…}` 在前。op 协议、natives 表、`__fjs.fns` 一个没动——通道
  全部复用既有 invokeHost + dispatchEvent（fetch 范式通用化，宪法 II）
- ✅ 未注册名字 / handler 抛异常 / 返回值不可 JSON 编码都**立即**回错误
  载荷，Promise 不悬挂；唯一静默路径是 VM 重建后迟到的 dispatch 查无
  此 id 丢弃（fetch 同款）
- ✅ hello-fjs `/example/interaction/async-host`：宿主 `demo.asyncStore`（400ms 假
  KV 存储），两端同页可对拍——App 走真通道，web 看 reject 文案。
  实机才暴露的一课记两条：**managed 宿主的 `main.dart` 每次 `fjs run` 都会
  重新生成**，手写的宿主模块放不住——模块片段存在 spec 目录
  （`specs/039-async-host-invoke/demo-module.dart`），重新生成后贴回
  `.fjs/flutter/lib/main.dart` 即可，不贴页面也能跑（所有按钮走 reject
  路径，正好演示另一条边）；另 `fjs host eject` 搬目录后 pubspec 的相对
  path 依赖（`../../../../packages/...`）不跟着改层级，`flutter pub get`
  会明确失败，要手动少写一级 `../`（自动改写顺延）
- ✅ 文档：[jsi-and-native-modules.md](jsi-and-native-modules.md) 新章节
  （时序 + 载荷 + web 差异）、[modules.md](modules.md) 的「同步还是异步」

## 伪类补全（已完成 2026-09）

`specs/040-pseudo-classes-first-last-hover/`，`:active` 之后把剩下的伪类补齐，
支持范围见 [css-compat.md](css-compat.md#4-状态伪类-active--hover-与结构伪类)：

- ✅ `:first-child` / `:last-child`：CSS 引擎按元素树判定兄弟位置，随**普通
  样式**下发（零协议改动）；兄弟增删即时重算，位置位进匹配缓存键（仅当存在
  结构伪类规则，否则零成本）。裸文字不算兄弟（web 上是文本节点），显式
  `<text>` 照算——两种混排两端结论一致
- ✅ `:hover`：CSS 引擎多算一份悬停样式走**新 op 12**（`uiOpsVersion` 5 → 6；
  扩 op 8 会让旧 runtime 配新宿主错位解析，独立 op 两向兼容）；App 桌面端
  `MouseRegion` 就地切换（进出子树语义同浏览器），移动端不触发，web 原生。
  同时命中时按压覆盖悬停；触屏按压两端都不带出悬停样式
- ✅ hello-fjs「样式演示 → 伪类」：列表增删对拍 + 裸文字/显式 text 混排 +
  hover/active
- ✅ **实机对拍修出两处**（iOS 模拟器 vs web）：① demo 页初版用了
  `border-bottom`——单边边框引擎不支持（css-compat ❌ 是老登记），web 真 CSS
  有分隔线而 App 整条静默丢弃，改成「容器灰底 + 行间 1px 缝隙 + 首末行圆角」
  的两端同源写法；② **flex-wrap 的子节点在 App 上全部拉满行宽**：
  `Wrap` 给子节点的是有界松约束，普通 view 默认 stretch 列在有界约束下撑满
  可用宽度（普通 Flex row 主轴无界所以没事），web 上 flex item 主轴是
  shrink-to-fit——`buildFlex` 的 Wrap 分支现在按 CSS 语义放宽主轴约束，
  声明了主轴百分比的子节点仍以 run 宽度为参照（`_wrapChild`）
## 单边边框（已完成 2026-09）

`specs/041-single-side-borders/`，spec 040 对拍踩出来的能力缺口：页面写
`border-bottom: 1px solid #eee`（列表分隔线最常见的写法）web 正常、App 整条
静默丢弃——「单边边框 ❌」是老登记，真实原因是 Flutter 的非均匀 `Border`
不能配 `borderRadius`（assert 崩溃）：

- ✅ JS 侧**零改动**（键透传），全部工作在 Dart：`FjsStyle.boxBorders` 每边
  级联解析（单边长手 > 单边简写 > 全局长手 > 全局简写；`none`/0 宽关单边；
  仅声明 `-color`/`-style` 按 CSS 语义推出 1px）
- ✅ 三条绘制路径：uniform solid → `Border.all`；无圆角非均匀 → `Border`
  per-side（Flutter 原生）；圆角非均匀 / 含虚线 → `FjsSideBorderPainter`
  自绘按边描（dashed_border 的 painter 路线），角弧归相邻边各半
- ✅ `button` 默认 hairline 改为**逐边**补默认：`border-bottom: none` 后其余
  三边保留默认描边（对齐 CSS）
- ✅ 已知差异登记 css-compat：合并 map 不还原源顺序；圆角非一致边的角部
  衔接是自绘近似。op 协议 / natives / 事件三张表零改动
- ✅ **实机复验又修出一个老缺口**：`<view>裸文字</view>` 与 `{{ x }}` 走
  setElementText，文字挂在 view 节点自身——web 是文本节点正常渲染，Dart 的
  view 适配器从不读 `node.text`，整段静默丢弃。现在合成为一个 Text 子节点
  （取 view 自己的计算样式，继承级联与 web 一致），排在子节点最前（
  `kidNodes` 垫 null 保持逐子记账对齐）
- ✅ demo「单边边框」面板（分隔线 / `:last-child` 关掉 / 圆角配
  `border-top`），iOS 模拟器与 web 两端对拍一致
- ✅ **对拍又揪出一个 web 侧静默失效**：`padding: 10 12` 这类无单位长度对
  浏览器是非法 CSS 被整条丢弃（App 正常、web 盒子塌掉，看起来像「Dart 多了
  默认高度」）。`rewriteFjsCss` 按长度属性白名单补 px——dev（vite transform）
  与 build（injectStyle）共用一份；`line-height` 明确排除（数字两端都是
  倍数）。用例 `web-css-compat.test.ts`

## @media 响应式样式（已完成 2026-09）

`specs/043-media-queries/`，近期计划 CSS 扩展的第一项：

- ✅ `@media` 从「整块告警跳过」变为条件匹配：type `screen`/`all`（`only`
  容忍）、`min/max-width`·`min/max-height`·`width`·`height`（px 与无单位）、
  `orientation`（正方形算 portrait）、`and` 与逗号；`not` / `print` / 未知
  特性 / 嵌套 at-rule 整块丢弃并 `warnOnce` 一次（宪法 V）
- ✅ **尺寸通道是新能力**：JS 侧此前没有任何窗口尺寸来源。Dart 每次窗口
  变化推事件 33（`FJS_EVENT_VIEWPORT_CHANGED`，载荷 `{"width":n,"height":n}`
  一位小数），renderer 模块加载时经 `fjs.viewport.get`（Dart HostRegistry
  注册，natives 零改动）拉初始尺寸——「VM 启动后推一发」不可行，renderer
  随 app bundle 之后才 eval，拉取对加载顺序免疫，dev reload 重建 VM 后
  自动重新拉取
- ✅ 视口变化复用 `register()` 的全量失效路径（bump epoch + 清缓存 +
  重算），走既有 setProps，**op 协议零改动**；无 media 规则的页面
  `setViewport` 只是一次相等比较
- ✅ `fjsrun` / 老宿主没有通道，按回退值 390×844 求值（与 JS 侧
  `FALLBACK_VIEWPORT` 同一组数）
- ✅ **web 端零生产改动**：web 构建的 `<style>` 走真 CSS，StyleEngine 不接
  样式；实现中抓到并修掉一个存量正则缺陷——`rewriteFjsCss` 的
  `LENGTH_DECL` 会把 media 条件当声明匹配，其值捕获越过右括号吞到下一个
  `}`，把块内 `flex-grow: 1` 先改写成 `flex-grow: 1px` 导致 `flex` 改写
  失配。现在条件先由专用 pass 处理（顺带把无单位条件值补成合法 px），
  再掩码走三个改写 pass，最后还原
- ✅ hello-fjs「响应式布局」示例页（断点分栏 / orientation / 组合条件 /
  print 告警演示），iOS 模拟器与 web 对拍

## 百分比间距与偏移（已完成 2026-09）

`specs/044-percent-spacing-offsets/`，近期计划 CSS 扩展的第二项：`%`/`calc()`
从「只在尺寸属性上生效」扩到盒模型间距与定位偏移——此前 `padding: 0 4%`、
`position: absolute; top: 50%` 这类声明 web（真 CSS）生效、App 整条静默丢，
同一性质的缺口（041 的无单位 padding 对拍修出过一次）：

- ✅ `padding` / `margin`（简写与长手，长手覆盖简写）与
  `top` / `right` / `bottom` / `left` 全部走 `FjsLength`（px + %），
  布局期按入参约束解析；`calc()` 同通道。JS 侧与 web 侧**零改动**
  （字符串本来就透传 / 真 CSS）
- ✅ 参照轴按 CSS：padding/margin 四边参照父盒**宽**（上下边也是）、
  `top`/`bottom` 参照高、`left`/`right` 参照宽；参照无界退化为 0/auto。
  row flex 子项的主轴无界问题由 `_flexChild`/`_wrapChild` 把容器宽上界
  传下去解决（既有 `width: 50%` 同一机制，门扩展到相对间距与偏移）；
  `positionedChild` 的相对门也加进偏移
- ✅ 有相对边的节点才包 `LayoutBuilder`（decoration 已有两处同款门），
  绝对值路径零开销；`button` 默认 padding 等 fallback 语义不变
- ✅ **顺带修掉一个存量静默失效**：简写按裸空格切分，
  `padding: calc(50% - 8px) 16px` 会被切成三段整条丢弃——切分改成括号
  感知（绝对值路径一起修）
- ✅ 不生效的少数消费点（`input` 的 `contentPadding`、text 路径的
  margin/padding——布局前就要数）登记 css-compat；`gap` /
  `border-radius` / `font-size` 的 `%` 参照机制各不相同，按需另补
- ✅ hello-fjs「百分比间距与偏移」示例页；web（内嵌浏览器 390 窄屏）与
  iOS 模拟器逐项对拍一致，转屏即时生效
- ✅ **实机对拍修出一个卡死级 bug**：margin / relativeOffset 的
  LayoutBuilder builder 闭包捕获了 `w` 变量本身而非赋值时的值——builder
  布局期执行时 `w` 已指向 LayoutBuilder 自己，构成自引用无限递归
  （`RenderBox was not laid out` 风暴 + 冻结）。照既有分支的
  `final inner = w` 快照写法修复；这类 bug 只在 App 端暴露（web 无
  widget 组装层），31 条 Dart 测试（含 % 间距/偏移的 widget 用例）全过

## transition 过渡（已完成 2026-09）

`specs/045-transition-background/`，CSS 扩展收尾。探明现状是「一半已实现
没登记 + 一半真缺」：

- ✅ **登记既有**：`transform` / `opacity` 的 transition 在 App 端早有完整
  实现（001/002 时期的 `transitionNode`/`_TransitionNode`，简写与长手、
  duration/curve/delay 都在），但 css-compat/ui-api 一直登记 ❌——按文档
  不敢用。本次实测后改登记 ⚠️
- ✅ **补背景色与尺寸**：`background-color`（实色）与 `width` / `height`
  经 `TweenAnimationBuilder` 逐帧插值，语义同 CSS transition（目标变化时
  从当前值插值）；尺寸是布局属性、逐帧重排，成本与 web 一致，靠显式
  track 门控。`all` 命中；gradient 与 duration 0 跳变
- ✅ **实机对拍修出存量 bug**：`:active` / `:hover` 的 transform 从不渲染
  ——transform 的唯一应用点 `transitionNode` 吃基础样式，状态变体到不了
  它。修复后包装由状态样式驱动、按目标插值（`:active` + `transition`
  的配对语义）；iOS 模拟器按住缩小验证生效
- ✅ 已知差异登记：`transition-delay` 对 background-color 不生效
  （TweenAnimationBuilder 无延迟钩子）；文字 `color` / `border-color` /
  布局属性 App 端瞬时（顺延）；`@keyframes` / `animation` 独立引擎另立
  spec。JS 侧与 web 侧零改动（键透传 + 真 CSS）
- ✅ hello-fjs「过渡演示」页；web 采样渐变中途色（rgb(19,117,110) 介于
  绿蓝之间）与 iOS 模拟器两端一致

- ✅ `@font-face` 自定义字体 / iconfont（specs/071）：构建期 WOFF2/WOFF → TTF
  内联，运行时 `fjs.font.load` 注册进 Flutter；`font` 简写展开、`font-family`
  字体栈；vant 全部图标两端一致。远程字体源、`unicode-range` 顺延

- ✅ `@keyframes` / `animation` + 内联 `<svg>`（vant 两端兼容收尾）：引擎解析
  简写与 keyframes（`var()` 替换后展开），原生侧每动画节点一个 ticker 逐帧跑
  ——任意节点动 `transform` / `opacity`，svg 形状另加描边/填充族（vant
  loading 转圈两端一致）。同批落地：相邻兄弟 `+` 组合器（带缓存失效）、
  `color: currentColor` 消解。伪元素上的动画、其余属性的帧插值顺延

- ✅ **第三方组件库（vant 4）两端兼容**（specs/068–073）：demo 的 `vant: *`
  五页两端对拍。CSS 侧——`position: fixed` 弹层置顶 overlay 宿主、行内流收缩盒、
  装饰型 `::before` / `::after`、属性选择器 `[class*=…]`、`%` 圆角、HTML 标签
  `flex-shrink` 初始值、SVG 渐变（van-empty 插画）；DOM 模拟侧——元素上的
  `contains` / `offset*` / `value` / `addEventListener`，vue-shim 的
  `<Transition>` / `vShow` / `withKeys`，`hoistStatic: false`，项目级最小
  window/document 侧影（demo 的 dom-env）。剩余差异
  （命令式 Toast / Dialog、深层 target、`getComputedStyle`）登记在
  [vue3.md](vue3.md#第三方组件库兼容vant)

## CSS 收尾：transition 与百分比（已完成 2026-09）

`specs/078-css-transition-wrapup/` + `specs/079-css-percent-wrapup/`，近期计划的
CSS 收尾项（纯 Dart 侧与 JS 引擎侧，op 协议零改动）：

- ✅ **transition 补全**：文字 `color`（段落自身，`:active`/`:hover` 状态变体
  驱动同一路径）、分边与虚线的 `border-color`（自绘 painter 每边 ColorTween，
  几何取终态）、`margin` / `padding`（解析后的 EdgeInsets 插值，% 在
  LayoutBuilder 内解析）。差异登记：delay 不生效、嵌套片段自带 color 瞬时、
  不派 transitionend
- ✅ **百分比补全**：`gap` 的 `%`（flex LayoutBuilder 内按容器自身对应轴解析，
  无界退化 0）；`border-radius` 的 `%` 放开到相对尺寸盒（按解析后的盒尺寸，
  内容盒保持方角、painter 组合回退方形并告警）；`font-size` 的裸 `%` 由引擎
  按父计算字号改写成 px 下发（根按 16px），两端同值、Dart 零改动

## fjs splash / upgrade / preview / --ipa --aab（已完成 2026-09）

近期计划的四条 CLI 项（specs/080–083）：

- ✅ **`fjs splash`**：一张 PNG + `--color` 生成三套启动屏——Android
  launch_background layer-list + 分密度 launch_image、values-v31 系统 splash
  （图标被 OS 裁圆已提示）、iOS LaunchImage.imageset 三倍图 + storyboard
  背景色；缩放复用 `fjs icon` 的外调 sips/ImageMagick；iOS 模拟器冷启动对拍
- ✅ **`fjs upgrade`**：`@ufjs/cli` / `@ufjs/runtime` / 宿主 `flutter_fjs`
  三包同 minor 一起升（target = npm latest 的 cli，另两者取同 minor 最高版，
  flutter_fjs 走 pub.dev API）；`--check` 只打印计划；path 依赖与
  pnpm-workspace checkout 跳过；doctor 补第三项检查（托管 flutter_fjs ↔ cli
  不同 minor 告警，此前只查 cli↔runtime）
- ✅ **`fjs preview`**：只读静态服务 `dist/web`（默认 4173），SPA 兜底 / 诚实
  404 / 穿越防护与 `fjs dev --web` 共享 `dev/static.ts`，URL 语义不漂移
- ✅ **`fjs build --ipa` / `--aab`**：与 `--apk`/`--hap` 互斥（一次一种）、
  同样要求 `--release`/`--profile`；`--ipa` 仅 darwin，签名导出失败留
  `.xcarchive` 并提示 `-- --export-options-plist` 透传

## fjs lint / fjs types（已完成 2026-09）

中期计划里的两条 CLI 项提前清掉（`specs/087-fjs-lint-types/`）：

- ✅ **`fjs lint`**：静态扫 `.vue` 的 `<style>` 块与静态 `style` 属性、
  `.css` 文件，对照支持矩阵报「引擎不会生效」的 CSS——`[drop]` 级
  （`#id` 选择器（`#id .x` 会静默放宽成 `.x`）、`~` 组合器、`:nth-child`、
  `word-break`/`filter`、`vw`/`vh`、`display: grid`、`@import`/
  `@supports`、非 class 属性选择器）退出码 1；`[warn]` 级（App 端不动画
  的 transition/keyframes 属性、位图背景、`@font-face` 远程源、
  `:root` 里的实声明）退出码 0，`--strict` 才算失败。规则表是
  `css-compat.md` 的机器可读镜像（`fjs-runtime/src/css/support.ts`），
  引擎与 CLI 共读，一致性由 fjs-runtime 测试钉住。`:style` 对象字面量、
  小程序 wxss、挂进 build/dev 都明确不做（spec §2）
- ✅ **`fjs types`**：`fjs-routes/-assets/-modules/-components.d.ts`
  四个生成器的命令化（此前只在 dev/build/Vite 里顺带写），刚 checkout
  不用跑 dev 就有补全；`--check` 只读、有过期文件退出码 1 供 CI。
  顺带修掉一个真实漂移：`stack` 在 tags.json 里但 `vue-global.d.ts`
  没有它的 GlobalComponents 条目——新增防漂移测试把 tags.json 与
  组件类型钉在一起

## Chrome DevTools 调试器 + 引擎切换 PrimJS（已完成 2026-09）

远期条目「调试器协议」落地，顺带把引擎从 quickjs-ng 0.9.0 换成 Lynx 系的
PrimJS 4.1.1（`specs/088-devtools-debugger/`）：

- ✅ **`fjs debug`**：Chrome DevTools 直连跑着的 app——断点（含条件断点）、
  单步、调用栈、局部变量、`evaluateOnCallFrame`、Console。引擎（PrimJS）
  原生实现 CDP，CLI 侧是字节搬运中继 + `chrome://inspect` 发现端点，
  DevTools 侧只绑 127.0.0.1。见 [toolchain.md](toolchain.md)「断点调试」。
- ✅ **引擎切换**：vendored quickjs-ng 0.9.0 → PrimJS tag 4.1.1
  （Apache-2.0，`native/primjs/VENDORED.md`）。理由：quickjs-ng 没有任何
  debugger 基础（上游 #757 仅讨论），自研解释器 hook 是 1.5–2.5k 行
  永久自维护的 C；PrimJS 把断点/栈帧/作用域/帧内求值整个给齐且由字节跳动
  按 Lynx 节奏维护。spike 先行验证（构建/API 面/CDP 冒烟）后再迁移。
  engine id 锁版本值变为 `primjs-4.1.1`，`.fjsbundle` 需重编。
- 随附：esbuild target es2021 → es2019（PrimJS 的 ES 上限，web 构建不变）；
  `fjs.h` 新增 OPTIONAL 符号 `fjs_vm_debugger_attach/detach`；fjsrun 增
  `--debug-connect host:port`（桌面复用同一调试链路）。
- 明确不做：release 字节码调试、Worker VM、小程序端、DAP/VS Code 前端
  （CDP 标准协议，后续可接）。Vue SFC source map 已由 spec 094 补上。
  控制台上下文下拉里引擎那一项后来从 `fjs console` 改成 `fjs engine`
  （`specs/099-fjs-engine-context/`），与合成的 `fjs host` 区分开。

## 双引擎缓存与切换入口（已完成 2026-09）

spec 088 删掉 quickjs-ng 时留下了对比与退路缺口，补上
（`specs/091-js-engine-switch/`）：

- ✅ **quickjs-ng 0.9.0 回归**：从 git 历史恢复 vendored 源码，native core
  走新的引擎 facade（`native/src/engine.h`），一份核心对两个引擎编译
  （`FJS_JS_ENGINE=primjs|quickjs`）。facade 只有约 45 个原语；两引擎
  实际差异比预期小——`EvalFunction` 元数、`SetMaxStackSize` 收 runtime、
  flag 位值不同由 facade 拥有。
- ✅ **双 flavor 预编译缓存 + 运行时物化**：`packages/flutter_fjs/abi/`
  按引擎×平台缓存全部 so/a/xcframework。物化只有一条实现——插件自带的
  Dart runner（`dart run flutter_fjs:engine <flavor>`，bin/engine.dart）：
  `fjs run/build --js-engine` 内部调它，纯 Flutter 宿主（fjs-go）在
  `flutter run` 前手动跑一次即可。runner 把选中 flavor copy 到 jniLibs /
  xcframework / ohos libs、改写 shim 的 flavor 头文件、清 Xcode 抽取缓存
  并 touch Podfile 强制 pod install 重评估（quickjs flavor 无 debugger
  产物，podspec 按 File.exist? 列出）。App 内 define 与实际引擎不一致时
  debug 下告警。字节码由对应 flavor 的 `fjsc` 编出，跨引擎 bundle 加载
  明确报 mismatch。
- ✅ **fjs debug 联动**：quickjs flavor 无 CDP 调试器（inspector 是
  PrimJS 专属），`fjs debug` 在 quickjs 环境下启动即提示。
- 明确不做：同进程双引擎热切换（每个 App 永久背两份引擎体积）；
  npm 预编译 quickjs 版 fjsc（仓库自建 + `FJSC_PATH` 覆盖）。

## DevTools 实时化：Console 日志流 + Elements 活树（已完成 2026-09）

`fjs debug` 在真实项目（vant 业务 app）首轮使用的反馈清账
（`specs/092-devtools-live/`）：

- ✅ **Console 收全两端日志**：终端里 `[dev]` / `[nav]` 这些 Dart 侧进度日志
  从只进 flutter 终端改为同时走 dev socket，`fjs debug` 的 tool 链接收下后
  合成 `Runtime.consoleAPICalled`（"fjs host" 上下文）送进 DevTools Console。
  quickjs flavor 的 JS console 也经这条路径第一次进了 DevTools。
- ✅ **Elements 树活树化**：整包 reload（VM 重建）即推 `DOM.documentUpdated`
  让 DevTools 重拉；点了已换血的旧节点（id 已不存在）也自愈刷新——此前树
  是死快照，reload 后 id 全部换血，点旧节点样式面板静默全空（首轮反馈的
  主症状）。普通树变更不推送：真实前端收到该事件会重启一切未决样式请求，
  持续变更的 app 会被打成样式栏永转（第二轮用真实 Chrome 前端对拍后撤掉
  了第一版的变更轮询）。
- ✅ **应答形状按真实前端对拍**：`inlineStyle` 剥掉 `{style:…}` 包装（前端
  解析抛异常即永久转圈）、补 `getInlineStylesForNode`（element.style 段的
  数据源）、`emulateNetworkConditionsByRule` 带 `ruleIds`、
  `startScreencast` 明确拒绝（不留空白预览区）。其中两处是 089 埋下的。
- ✅ **命中规则（matchedCSSRules）进入范围**（第三轮，用户复测 element.style
  有、匹配规则仍空）：原 non-goal「热路径记规则身份」的前提不成立——
  `matchedRulesOf(id)` 按需对单个元素走与 match cache 同源的候选桶，
  点击节奏调用、不缓存，热路径零改动；selector 记了源文本，中继拼
  `matchedCSSRules` 挂在合成样式表 `fjs-main` 上。连带修掉一个竞态：
  合成样式表的 `CSS.styleSheetAdded` 从 WS 连接时改到 `CSS.enable`
  应答后推（前端 CSSModel 构造函数里先注册 dispatcher 再 enable，
  连接时推送会输给模型创建时机 → 时而注册时而丢）。真实前端 SDK
  断言连续两跑通过（spec 092 第三轮）。
- 明确不做 / 待做：**DevTools 左侧实时 UI 预览**（`Page.startScreencast`
  需要 Dart 侧 RepaintBoundary 截屏管线 + 给 Dart 开一条到中继的旁路通道，
  用户已确认"难度高先过"，记为后续 spec 方向）。

## DevTools 树按需展开 + 结构变化自动刷新（已完成 2026-09）

092 上线后用户复测的两条反馈清账（`specs/093-devtools-tree-lazy-and-live/`）：

- ✅ **Elements 树按需展开**：真实前端首拍 `DOM.getDocument` 带 `depth:1`，
  之后靠 `DOM.requestChildNodes` / `DOM.getFlattenedInnerHTML` /
  `DOM.querySelector` 拉深层——这三个方法此前在中继兜底分支一律空应答，
  面板拿到根 + `childNodeCount` 后要子树的请求全部空手而归，**永远停在第一
  层**（表现为「只显示根壳、展开为空」）。现在三者在中继真实现：按 `nodeId`
  找到节点、从当前文档重新序列化（children / 转义 HTML / 最小选择器匹配），
  未命中回明确的空形状（`{nodes:[]}` / `{result:''}` / `{nodeId:0}`）而非
  `{}`。选择器匹配在运行时侧，`:pseudo` 剥掉不求值（静态快照没有 hover/
  active 态，与 `matchedRulesOf` 同口径）。
- ✅ **结构变化自动刷新**：新增 `devtoolsStructuralVersion` 计数器，**只在**
  element `insert`/`remove` 与页根 `flutterRoot`/`releaseRoot`（路由增删）处
  递增——纯属性/文本/样式变化不参与。中继在 `DOM.getDocument` 应答后起 1.5s
  低频轮询 `Dom.structuralVersion`，跨阈值推一次 `DOM.documentUpdated`，
  首轮只记基线不推（DevTools 附加前的变化已在刚拉的文档里）。三条触发路径
  （世界重置 / 死节点自愈 / 结构变化）共用 1s 冷却，批量插入折叠成一次推送。
  **不恢复按帧轮询**：092 R14 已证明那会把 Styles 面板打成永转。
- 实现落点：`fjs-runtime/src/devtools.ts`（三个 cmd 分支 + 结构版本读取）、
  `fjs-runtime/src/ui/element.ts` 与 `vue/renderer.ts`（四个递增点）、
  `fjs/src/debug/cdp-server.ts`（三方法真实现 + 冷却 + 结构轮询）；
  测试覆盖三方法形状、选择器命中/未命中/伪态剥离、结构版本跨阈值推一次且
  冷却内不重推、纯属性不触发（`debug-cdp.test.ts` / `devtools.test.ts`）。

## DevTools 的 Vue SFC source map（已完成 2026-09）

`fjs debug` 此前只能在编译后的 bundle 上下断点（`specs/094-devtools-vue-sourcemap/`）：

- ✅ **dev 构建出 map**：`fjs dev` 让 esbuild 写 external `.js.map`。Vue 插件把
  script 与 template 的 map 拼回 `.vue`，`sourcesContent` 是 SFC 原文。
  共享模块回到 `shared.js` 之后，这份 prelude 也出 map，但只保留项目文件。
- ✅ **中继内联**：脚本注释是 `fjs-map:<路径>`，PrimJS 原样放进
  `sourceMapURL`。中继读 `.js.map` 改成 data URL 再给 Chrome——DevTools
  不会自己去拉，`Network.*` 又被桥接走了。不是 `.js.map` 的路径不读。
- ✅ **脚本 url 与源路径错开**：eval 文件名是 `bundle.js`、`pages/<chunk>.js`、
  `shared.js`，不跟 `src/...` 撞名。
- 明确不做：release / 字节码、小程序、web（Vite 自有 map）、`<style>` 断点。
  template 行有映射就停，不作为一一对应的承诺。

## 近期计划

- **App 侧真机对拍挂账**：078/079 的示例页（过渡演示新增面板、百分比间距与
  圆角）web 侧已对拍，`fjs run ios` 走一遍显示层确认仍是手工项（行为已被
  13 条 Dart widget 用例覆盖）
- **`--aab` 实跑**：签名环境无关但构建耗时长，产物路径以 releaseBuild 打印
  为准（specs/083 T021）
- 当前 CSS 支持范围见 [css-compat.md](css-compat.md)，加一条要改的 8 个地方
  也在那里（dashed / dotted 边框自绘已完成，见 `render/dashed_border.dart`）

## 中期

- **小程序编译（微信 Skyline + glass-easel）第一版已落地**：`fjs build
  --mp`，同一份 Vue SFC 编译为小程序四件套，模板编译为 WXML、不引入
  Vue 运行时（`@ufjs/runtime/wx` 薄壳承担响应式 → setData）。见
  [miniprogram.md](miniprogram.md) 与 `specs/046-vue-to-miniprogram/`。
  ✅ rich-text / picker-view / form / position 四个组件页开放（`specs/048-mp-rich-text-picker-view-form/`，
  rich-text 在小程序上改走同一条 JS 管线）。
  ✅ rich-text 按渲染器分流：webview 用原生、skyline 走 JS 管线且管线按需打成 `fjs/rich-text.js`，不再进 `runtime.ts`（`specs/050-mp-rich-text-by-renderer/`）。
  ✅ Worker：三端统一为 worker 文件路径 `new Worker('/workers/x.js')`，小程序走 `wx.createWorker`（`specs/049-mp-worker/`）。
  ✅ 分包：`fjs.mp.subpackages` 声明 subPackages，vendor / 本地模块 / public 目录按可达性归属，URL 构建期改写 + 跨包引用守卫（`specs/063-mp-subpackages/`）。
  ✅ 分包预下载：`fjs.mp.preloadRule` 按 fjs 路由声明，编译期翻译成 app.json 的页面路径 key（同 spec 063）。
  待续：canvas / web-view / refresh 组件页、dev 模式（HMR）、canvas 2d/echarts 等重型页适配、icon-mind 真实
  图标、作用域插槽
- **React 接入**：`fjs/react` 自定义 reconciler，协议与 Vue 渲染器共享。
  接入步骤和前置重构（把影子树簿记 + StyleEngine 提到共享模块）已经写在
  [custom-renderer.md](custom-renderer.md#接一个新框架以-react-为例)
- **字节码加密/签名**：防篡改与资产保护
- **启动耗时报告**：目前 [performance.md](performance.md) 只有运行期基准，
  冷启动（读字节码 → prelude eval → 首帧）还没有数字
- **`fjs native add|list|remove <capability>`**：`fjs native add camera` 往宿主
  pubspec 加插件、注册 `engine.registerComponent`、写好 d.ts。依赖三方原生模块
  包管理先成型。命名上和已经落地的 `fjs add <npm 包>` 分开：前者动宿主
  （pubspec、Dart、权限清单），需要 list/remove/sync 对着可 eject 的宿主收敛；
  后者只动 JS 侧。JS 库用 `requires` 声明它需要哪个 capability，两边由此咬合
  （`fjs lint` / `fjs types` 已完成，见上文）

## 远期

- Windows / Linux 桌面端（PrimJS 的 CMake 自带 MSVC 分支，比 quickjs-ng 时期
  更近了一步）
- ~~调试器协议：Chrome DevTools 接 QuickJS debugger~~ → 已完成（见上
  「Chrome DevTools 调试器 + 引擎切换 PrimJS」）
- 三方原生模块包管理（npm 包声明 native/ 目录，构建期合并）
- 引擎侧追平 quickjs-ng 的 ES 等级（PrimJS 目前 ES2019，靠 esbuild 降级），
  或评估其 compatible memory management（tracing GC）在 arm64 上带来的收益
