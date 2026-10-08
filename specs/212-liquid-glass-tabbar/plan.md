# Plan: tabbar liquid glass 风格（@ufjs/liquidglass 模块 + 风格切换）

对应 spec：`./spec.md`

## 0. 调研结论（spec §7 遗留项已关）

读 `liquid_glass_widgets` 1.11.0 源码与 hello-fjs 现状得到的事实，plan 以此为准：

| 事实 | 出处 | 对方案的影响 |
|---|---|---|
| 要求 `flutter >=3.41.0`、`sdk >=3.5.0` | 其 `pubspec.yaml` | 本机 Flutter 3.41.10（ohos 分支）满足；`flutter_fjs` 下限 3.38 不变，**模块自己**写 `flutter: ">=3.41.0"`，不抬核心下限 |
| `wrap()` 对 `GlassBackdropScope` **不再必需**，仅 `theme:` / `adaptiveQuality:` 才需要 | `liquid_glass_setup.dart` wrap 文档 | **不需要包 App 根**，不碰宿主 `main.dart`。spec §7 里"wrap 侵入宿主"的担心解除 |
| `initialize()` 只做异步预热（`LightweightLiquidGlass.preWarm` 等），不预热也能渲染（"loading them on demand"） | 同上 | 在模块 `register(engine)` 里 `unawaited(LiquidGlassWidgets.initialize())`，与 iconmind 的 `unawaited(_load())` 同范式；`enablePerformanceMonitor:false` 免得 debug 起监视器 |
| `GlassContainer(useOwnLayer: true, shape, settings)` 是独立玻璃面，自带背景捕获（Impeller 用 `toImageSync` 或 BackdropFilterLayer；Skia/Web 走 lightweight 着色器） | `glass_container.dart`、`ATTRIBUTION.md` | `glass-surface` 直接落到它；tabbar 在 `FjsView` Stack 里是页面的**上层兄弟**，页面就是它的背景，无需 `GlassPage/GlassScaffold` |
| 「玻璃是托盘不是包装」：`GlassContainer` 子树 `avoidsRefraction=true`，内部再嵌玻璃会退化 | README Composition Rule | tabbar 的选中滑块**不再套第二层玻璃**：用 JS 侧半透明高亮胶囊（亮色/暗色各一个 rgba），不是 `GlassButton` |
| 包是 iOS plugin（`LiquidGlassWidgetsPlugin`），着色器是包内 asset | `pubspec.yaml` `flutter.plugin` / `shaders` | 宿主 `pod install` 会多一个 pod；着色器随依赖自动入宿主，无需手拷 |
| 自定义组件由 `renderer.dart:406` `registry.lookup(tag)` 构建，`children` 已是建好的 Widget，外层再由 `decorateNode(style, …)` 包 CSS 装饰（背景/圆角/阴影/padding） | `render/renderer.dart` | `glass-surface` 的几何由 CSS（width/height/flex/margin）+ `radius` prop 决定；CSS `border-radius` 的装饰与玻璃形状各画各的，**约定 `radius` 必须与 CSS border-radius 同值**（TabBar.vue 里同一个常量传两处） |
| 模块 Flutter 包会被写进宿主 pubspec 为 `path:` 依赖，其传递依赖（`liquid_glass_widgets`）由 pub 解析 | `project/modules.ts` `autolinkPubspecDeps` | 无需改 CLI |
| hello-fjs 没有任何持久化原语（`native-global.d.ts` 无 storage；仓库无 shared_preferences） | grep | **spec §3.2 的"持久化"在 App 端做不到**——见 §3 「持久化」与 §6 待确认 |

## 0.1 实现期修订（2026-10-08，T003 前）

`ComponentRegistry` builder 只收到 `(context, node, children, dispatch)`，CSS 的
`flex-direction` / gap / align 不在其内（`renderer.dart:406-414`：builder 产出
`content`，之后才由 `decorateNode` 包装饰；排版由 `viewNodeAdapter` 持有）。
因此 `glass-surface` **改为叶子"玻璃层"**：`position:absolute` 铺满容器，内容作为
兄弟节点画在其上。好处：不需要在 Dart 重实现 flex；也天然规避"玻璃不嵌玻璃"
（图标不在玻璃子树里）。`children` 被忽略。plan 下文中"容器/child 排版"的描述以此为准；
`GlassTabBar` 路由切换改为 `emit('select', path)`，由应用层分发器调
`router.replace`（避免模块与应用各持一份 router 单例）。

## 0.2 实现期发现：iOS 部署目标（2026-10-08，首次 `fjs run ios`）

`liquid_glass_widgets` 要求宿主 iOS 部署目标 ≥ 15.0，而 `flutter create` 生成的宿主
是 13.0（`.fjs/flutter/ios/Podfile` 的 `platform` 被注释、Runner 的
`IPHONEOS_DEPLOYMENT_TARGET = 13.0`），`pod install` 直接失败：
`The plugin "liquid_glass_widgets" requires a higher minimum iOS deployment version`。
这是**显式失败**（非静默），但与"装完即用"的 autolink 承诺有落差。处理：
- 本期：README / `docs/modules.md` 写明"链接本模块的宿主需 iOS ≥15（Podfile
  `platform :ios, '15.0'` + Runner 部署目标）"，hello-fjs 的 `.fjs/flutter/ios` 手改（目录
  gitignore，可再生）。
- 后续（不在本 spec，已作为跟进项）：清单加 `fjs.flutter.minIos`，`fjs host sync`
  取各模块最大值写入 Podfile/Runner，让 autolink 真正免配置。需改 `packages/fjs/src`
  与 `docs/modules.md` 清单表，单独成 spec。
- 风险：`.fjs/flutter` 在别的机器/CI 上被重新生成时会回到 13.0，需要重做上面的手改。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter：`packages/fjs-liquidglass/flutter/lib/fjs_liquidglass.dart`（`glass-surface` builder）。Web：`packages/fjs-liquidglass/components/GlassSurfaceWeb.vue`（同标签名替身）。`GlassTabBar.vue` 与风格注册表是纯 JS/Vue，两端同一份。折射两端不同源（着色器 vs SVG 位移图），**blur/tint/radius 取同一组参数**，差异登记 `docs/css-compat.md` |
| II 边界即契约 | 否 | 三张表一张都不动：`glass-surface` 是模块 widget，走既有 `ComponentRegistry` + setProps/children 通道；无新 op、native、事件类型。验收时 `git diff --stat` 确认 `ops.ts`/`ui_ops.dart`/`native-global.d.ts`/`natives.cpp`/`element.ts`/`fjs.h` 零改动 |
| III 同步单线程零序列化 | 否 | 着色器预热是 Dart 侧异步 asset I/O，不碰 JS↔Dart 调用；风格切换是 JS 状态 |
| IV 外观照 WeUI | 部分 | classic 风格原样保留（WeUI 取值不动）；liquid glass 是 iOS 26 风格扩展，不属"内置组件默认外观"，spec §4 已声明例外 |
| V 静默失效是 bug | 是 | ① 未知风格名 → `warnOnce` 并回退默认；② `refraction>0` 但平台/质量档不支持 → Dart 侧降级为纯毛玻璃时 `debugPrint` 一次（不静默）；③ web 在 Safari/Firefox 无 `feDisplacementMap` 折射 → 降级时 `console.warn` 一次；④ mp 构建遇到本模块 widget → 随 `excludeComponents` 移除，不产生空标签 |
| VI 注释记录权衡 | 是 | 要写权衡注释的点：为什么不套第二层玻璃（avoidsRefraction）、为什么不 `wrap()`、radius 双写约定、为什么风格切换换组件而非换 class、折射降级矩阵 |
| VII JS 能包就不要下 Dart | 是 | **`glass-surface` 必须下 Dart**：模糊 + 折射要 `BackdropFilter`/`FragmentProgram` 着色器，JS 侧给不了（`css-compat.md` 明确 `backdrop-filter` ❌）。其余（tabbar 布局、滑块动画、风格注册表、切换状态）**全部 JS/Vue 包**，不下 Dart。不用 `FLUTTER_COMPONENT_TAGS`：`glass-surface` 要被当元素送进引擎（模块 widget 的标准路径），不是 Vue 组件 |
| VIII 变更落到文档 | 是 | `docs/modules.md`（范例补一条：带第三方 pub 依赖的 widget 模块）、`docs/css-compat.md`（玻璃折射差异）、`docs/routing.md`（tabBar 章节：风格化）、`docs/miniprogram.md`（忽略登记）、`docs/ui-api.md`（`glass-surface` 标签与 props）、`docs/roadmap.md`（如有 tabbar/玻璃条目则打勾，无则不改）、模块 `README.md` |

**破例**：新增 pub 依赖 `liquid_glass_widgets`（仓库规则"不新增依赖，除非 spec 写明理由"）——spec §7 已明示，理由：自写折射着色器成本远超收益；依赖限于模块 Flutter 包，`flutter_fjs` 核心 pubspec 不动。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 新包（npm） | `packages/fjs-liquidglass/package.json` | 清单：`fjs.module`、`components`、`componentPrefix: "Liquidglass"`、`widgets.glass-surface`（`web` 指替身、`props`）、`flutter`（package `fjs_liquidglass`、`register: "FjsLiquidglass.register(engine)"`）；`peerDependencies` 同 iconmind；`files` 枚举 `flutter/lib` + `flutter/pubspec.yaml`（避免打进 `.dart_tool`，见 modules.md） |
| 新包（JS API） | `packages/fjs-liquidglass/index.ts` | 导出 `registerTabBarStyle` / `getTabBarStyle` / `tabBarStyleNames`、类型 `TabBarStyleProps`；未知名 `warnOnce` + 回退 |
| 新包（组件） | `packages/fjs-liquidglass/components/GlassSurfaceWeb.vue` | `<glass-surface>` 的 Web 替身：`backdrop-filter: blur() saturate()` + 高光描边 + 按下态；`refraction>0` 且 Chromium 时叠 SVG `feDisplacementMap`（位移图运行时按 radius 生成并缓存），其它引擎降级并 warnOnce |
| 新包（组件） | `packages/fjs-liquidglass/components/GlassTabBar.vue` | 风格 `liquid-glass` 的 tabbar：props 即 210 的 `tabs`/`active` + `items`；`<glass-surface>` 胶囊 + 选中滑块（JS 侧 left 计算 + 过渡）；`router.replace` 切换；自带主题变量读入（不依赖页面 CSS 变量链，同 210 TabBar.vue 的理由） |
| 新包（Flutter） | `packages/fjs-liquidglass/flutter/pubspec.yaml` | 包 `fjs_liquidglass`；依赖 `flutter_fjs: ^0.1.4`、`liquid_glass_widgets: ^1.11.0`；`environment.flutter: ">=3.41.0"` |
| 新包（Flutter） | `packages/fjs-liquidglass/flutter/lib/fjs_liquidglass.dart` | `FjsLiquidglass.register(engine)`：注册 `glass-surface`，`unawaited(LiquidGlassWidgets.initialize(enablePerformanceMonitor:false))`；builder 读 `radius/blur/tint/refraction/dark/pressed` → `GlassContainer(useOwnLayer:true, shape: LiquidRoundedSuperellipse(borderRadius: radius), settings: LiquidGlassSettings(...), quality: refraction>0 ? premium : standard)`，`child` 为 `children` 的 Column/Stack（与 view 的 flex 行为一致，实现时对拍 `viewNodeAdapter`）；`pressed` 变化驱动设置过渡 |
| 新包（Flutter 测试） | `packages/fjs-liquidglass/flutter/test/glass_surface_test.dart` | widget 测试：子节点渲染、prop 变化重绘、`refraction=0` 走 standard 质量档 |
| 新包（文档） | `packages/fjs-liquidglass/README.md`、`CHANGELOG.md` | 用法、风格注册、降级矩阵 |
| 工作区 | `pnpm-workspace.yaml` | `packages` 加 `'packages/fjs-liquidglass'`（iconmind 同款） |
| 示例应用 | `examples/hello-fjs/package.json` | `dependencies` 加 `"@ufjs/liquidglass": "workspace:*"` |
| 示例应用 | `examples/hello-fjs/src/tabBarStyle.ts`（新） | 风格状态：`ref<'liquid-glass'|'classic'>('liquid-glass')` + `useTabBarStyle()`；Web 端读写 `globalThis.localStorage`（有则用，try/catch），App 端内存态 |
| 示例应用 | `examples/hello-fjs/src/components/TabBar.vue` | 改风格分发器：`<component :is="…">`；原模板整体搬进 `components/ClassicTabBar.vue`（原样，含 safe-area/web blur class，不改外观）；`main.ts` 的 `tabBar: { component: TabBar }` **不变** |
| 示例应用 | `examples/hello-fjs/src/pages/about.vue` | 加 Panel「Tabbar 风格」：两项分段（classic / liquid glass），点击写 `useTabBarStyle` |
| 示例应用 | `examples/hello-fjs/src/main.ts` | `registerTabBarStyle('classic', ClassicTabBar)`（`liquid-glass` 由模块自注册）。**不改 `createFjsApp` 调用形状** |
| JS runtime | `packages/fjs-runtime/src/**` | **不改**（宪法 VII：靠模块 + 现有 tabBar 机制）。如实现中发现必须改，回 spec |
| CLI | `packages/fjs/src/**` | **不改**（modules.ts 已支持 widgets + flutter 依赖 + 传递 pub 依赖）；`tags.json` 不动，故无需重 build `@ufjs/cli`（约束 6 不触发） |
| mp | `packages/fjs/src/mp/**` | 预期不改：本模块不声明 `widgets.*.mp`；实现阶段验证 `build:mp` 在 `tabBar` 选项被忽略、`TabBar` 被 `excludeComponents` 剔除时不会因 `<glass-surface>` 报错（若报错，补到 `fjs.mp.excludeComponents` 或在模块清单声明 mp 空实现） |
| 文档 | `docs/modules.md`、`docs/css-compat.md`、`docs/routing.md`、`docs/miniprogram.md`、`docs/ui-api.md` | 见宪法 VIII 一行 |
| 原生宿主产物 | iOS pod | 新依赖带 iOS plugin：新增后宿主需 `pod install`（见记忆 ios-pod-new-source）；不涉及改 `native/`，约束 8 不触发 |

以上路径均已确认：`packages/fjs-iconmind/{package.json,index.ts,components/,flutter/lib/,prepare.mjs}`、`examples/hello-fjs/src/{main.ts,theme.ts,components/TabBar.vue,pages/about.vue}`、`pnpm-workspace.yaml`、`packages/flutter_fjs/lib/src/registry/component.dart`、`render/renderer.dart:406`、`packages/fjs/src/project/modules.ts` 均真实存在；新建文件按 iconmind 同构。

## 3. 方案

### 3.1 模块边界：玻璃面（Dart/Web 双实现）+ tabbar（纯 Vue）

- `<glass-surface>` 只负责"一块玻璃"，不知道 tabbar。tabbar 的所有逻辑（滑块位置、图标、路由）在 Vue 里，两端同一份。这样未来的风格（比如 `ios-classic`、`material-you`）只需要再写一个 Vue 组件并 `registerTabBarStyle`，不必碰 Dart。
- 风格注册表是**纯 JS Map**，不是框架机制：`TabBar.vue`（应用层）用 `<component :is="getTabBarStyle(current)">` 分发。切换 = 换 `:is`，tabbar 根（`__tabBar` 全局 Vue app）不重挂、210 的挂载/可见性逻辑零改动。
- 为什么分发器放应用层而不是 `createFjsApp({ tabBar: { styles, active } })`：那要改 runtime 的 `tabBar` 选项契约，违反 spec Non-goal（"不改 210 契约"）；应用层分发已足够，且注册表仍由模块提供，未来想上移到框架层时是纯重构。

### 3.2 Flutter：只用 `GlassContainer(useOwnLayer:true)`，不 `wrap`

- 不包 App 根：避免动宿主 `main.dart`/`fjs_app.dart`，也避免全局 `GlassTheme` 副作用。主题（亮/暗）由 `dark` prop 显式传入，不依赖其 `brightnessResolver`。
- 质量档：`refraction>0` → `GlassQuality.premium`（Impeller 全折射；Skia/Web 该包自动退到 standard）；`refraction==0` → `standard`（lightweight 着色器，纯毛玻璃）。**降级由包内平台探测完成**，我们只在 debug 下打一次日志（宪法 V）。
- 形状：`LiquidRoundedSuperellipse(borderRadius: radius)`；胶囊高 52、圆角 26 时与 CSS `border-radius` 同值。

### 3.3 Web：SVG 位移图折射 + backdrop-filter 兜底

参考 gentpan/liquidglass 的思路（"对元素自身像素做 `feDisplacementMap`、经 CSS `filter` 应用，位移图运行时按形状生成"）。本模块**不引入其库**（零新 npm 依赖），只取技术：小段位移图生成代码（~80 行）放在 `GlassSurfaceWeb.vue`。Chromium 才有 `backdrop-filter: url()` 折射；其它引擎降级为 `backdrop-filter: blur() saturate()`（所有现代浏览器都支持）。

### 3.4 持久化（偏离 spec §3.2，需用户确认）

仓库内**没有**键值存储原语：Web 有 `localStorage`，App 端没有任何 native/host 函数。按宪法 II/III，不为这个小功能新开 C ABI，也不引新依赖。方案：
- 风格状态 `ref` + Web 端 `localStorage`（try/catch，降级内存态）。
- App 端**本期不持久化**（重启回默认 `liquid-glass`），登记 `docs/routing.md`/README。
- 真要 App 持久化应是独立 spec（通用 `storage` 模块，走 iconmind 同款 widget/host 模块范式）。
- spec 验收 #6 的"重启后风格保持"相应改为"Web 刷新后保持；App 重启回默认（已知差异）"。

### 3.5 被否掉的备选

| 备选 | 否掉原因 |
|---|---|
| 把风格分发做进 `createFjsApp({ tabBar: { styles, initial } })` | 改 runtime 契约，违反 spec Non-goal；应用层已够用 |
| `wrap()` App 根 + `GlassScaffold` + `GlassTabBar`（直接用包的整套导航） | 要接管页面脚手架与路由，与 fjs 的"每路由一棵 Vue 树 + Navigator"模型冲突；tabbar 内容（图标/文案）在 JS 侧，Dart 整条 bar 渲染违反宪法 VII |
| `glass-tab-bar` 整条 bar 落 Dart（items 作 JSON prop） | 同上：JS 能包的不下 Dart；风格扩展还得改 Dart。`glass-surface` 容器 + Vue 内容是最小 Dart 面 |
| 选中滑块也用 `GlassButton`/第二层玻璃 | 包明确"玻璃不嵌玻璃"（`avoidsRefraction` 退化 + 弹簧超调被 clip），改用 JS 半透明高亮 |
| Web 端引入 gentpan/liquidglass 的 `components.js` | 新 npm/CDN 依赖，且其 Web Components 与 Vue 组件模型割裂；只借技术自写 |
| Web 仅 `backdrop-filter` 无折射 | 可作降级，但 spec 要的是 liquid glass 观感；Chromium 上做折射，其它降级 |
| 自写 Flutter 折射着色器 | spec 已明确选依赖（用户拍板） |
| 为 App 持久化新增 native 键值 ABI | 违反宪法 II"不要为一个功能新开 C ABI"；超范围 |

## 4. 风险

1. **Impeller `toImageSync` 捕获 + fjs 页面树**：玻璃要对"兄弟 Stack 里的 fjs 页面"取背景。包在 Skia 上走 lightweight（不取背景，仅近似），在 Impeller 上取实时背景。需在**真机/模拟器**对拍：iOS 模拟器（Impeller）+ Android；任何一端玻璃后面看起来是纯色=背景没捕获到，要回退为 `GlassBackdropGroup` 手工接线。**最大风险点，先做最小 spike（T-spike）再展开**。
2. **性能**：`premium` 档在悬浮 bar 持续重绘的页面（滚动）下的 raster 耗时；`adaptiveQuality` 我们不开，故需实测并给 `refraction` 一个保守默认（0.6 → 若掉帧降为 0）。真机结论会推翻模拟器（记忆 ios-device-profile-workflow）。
3. **Flutter 版本下限**：模块要求 ≥3.41，而 flutter_fjs 下限 3.38。低版本宿主 `pub get` 会失败——这是**显式失败**（非静默），但 README 与 modules.md 必须写明；hello-fjs 当前 3.41.10 OK。ohos 平台：该包声明的平台里没有 ohos，着色器/Impeller 在 ohos 的表现未知，**登记为未验证**，不做承诺。
4. **iOS plugin 新 pod**：已有 `ios/Pods` 的宿主要 `pod install`，否则链接缺 `LiquidGlassWidgetsPlugin`（记忆 ios-pod-new-source）。
5. **radius 双写**：CSS `border-radius` 与 `radius` prop 不一致会出现玻璃与装饰错位——约定同值并在 README 加粗；TabBar 内用同一常量。
6. **深色模式**：`dark` prop 与 `useTheme` 同步；210 遗留的 T024（深色目测）与本需求相邻，本 spec 的验收含深浅色截图，覆盖之。
7. **mp**：本模块 widget 在 `build:mp` 不得残留（验收 #7）；若 `fjs.mp.excludeComponents` 只按文件剔除而 `TabBar.vue` 间接引用 `GlassTabBar`，需实测。
8. **tags.json / component-tags.json 内联**：本方案不新增内置标签，约束 6 不触发；但模块 widget 标签靠 `fjs/plugins` 的模块清单扫描，**改清单后需重启 `fjs dev`**（记忆 fjs-dev-reload-workflow）。

## 5. 验证路径

```bash
# 0) 依赖与类型
pnpm install
pnpm run typecheck
pnpm test

# 1) Dart 侧（模块自己的 flutter test）
cd packages/fjs-liquidglass/flutter && flutter pub get && flutter test
#   用例必须真跑（不是 "No tests ran"）

# 2) 契约零改动自检
git diff --stat -- packages/fjs-runtime/src/ui/ops.ts packages/flutter_fjs/lib/src/ui_ops.dart \
  packages/fjs-runtime/src/native-global.d.ts packages/flutter_fjs/native \
  packages/fjs-runtime/src/ui/element.ts       # 期望：空

# 3) autolink 生效
cd examples/hello-fjs && pnpm exec fjs modules   # 列出 @ufjs/liquidglass，含 flutter 条目
pnpm --filter hello-fjs run typecheck

# 4) Web 目测（深浅色各一张；关于页切换 classic ↔ liquid glass；刷新保持）
pnpm --filter hello-fjs run dev:web

# 5) iOS 模拟器（Impeller）+ 对拍；先 spike 再展开
#    worktree 里跑见记忆 worktree-ios-run；一项目一个 dev server
pnpm --filter hello-fjs exec fjs run ios

# 6) mp 产物无残留
pnpm --filter hello-fjs run build:mp
```
