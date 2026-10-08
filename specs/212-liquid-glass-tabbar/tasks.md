# Tasks: tabbar liquid glass 风格（@ufjs/liquidglass 模块 + 风格切换）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（本需求不动三张表，先立"零改动"基线）

- [x] T001 记录契约文件基线：确认 `ops.ts` / `ui_ops.dart` / `native-global.d.ts` / `natives.cpp` / `element.ts` / `fjs.h` 当前无未提交改动（`git status` 干净），验收时据此 diff
- [x] T002 新建包骨架 `packages/fjs-liquidglass/{package.json,index.ts,README.md,CHANGELOG.md}`：清单 `fjs.module/components/componentPrefix/widgets.glass-surface/flutter`，`files` 枚举 `flutter/lib` + `flutter/pubspec.yaml`；`pnpm-workspace.yaml` 加入该包；`examples/hello-fjs/package.json` 加 `@ufjs/liquidglass: workspace:*`；`pnpm install`

## Spike（最大风险先验证，不通过则回 plan，不自行降级）

- [x] T003 最小 Dart 实现：`packages/fjs-liquidglass/flutter/{pubspec.yaml,lib/fjs_liquidglass.dart}` 注册 `glass-surface`，只做 `GlassContainer(useOwnLayer:true)` + children；`unawaited(LiquidGlassWidgets.initialize(enablePerformanceMonitor:false))`
- [x] T004 spike 页面：hello-fjs 临时在 `TabBar.vue` 里用 `<glass-surface>` 包胶囊，iOS 模拟器（Impeller）确认玻璃**能取到后面的页面做模糊/折射**（plan 风险 1）；截图存档，结论写进 plan §4
- [x] T005 若 T004 背景为纯色/未捕获：改用 `GlassBackdropGroup` 等手工接线再验；仍不通则停下回报用户

## 实现

- [x] T010 `packages/fjs-liquidglass/flutter/lib/fjs_liquidglass.dart`：补全 props（`radius/blur/tint/refraction/dark/pressed`）解析、`LiquidRoundedSuperellipse`、质量档（refraction>0 → premium，否则 standard）、`pressed` 过渡；降级时 debug 日志一次；写权衡注释（不 wrap、不嵌套玻璃、radius 双写）
- [x] T011 `packages/fjs-liquidglass/index.ts`：`registerTabBarStyle` / `getTabBarStyle` / `tabBarStyleNames` / 类型 `TabBarStyleProps`；未知名 `warnOnce` + 回退默认；模块加载时自注册 `liquid-glass`
- [x] T012 `packages/fjs-liquidglass/components/GlassTabBar.vue`：胶囊（`<glass-surface>`）+ 图标/文案 + 选中滑块（半透明高亮，不套第二层玻璃，JS 侧位置计算 + 过渡）+ `router.replace` 切换 + 自带主题变量（读 `useTheme` 同源，不依赖页面变量链）+ safe-area 处理同 210
- [x] T013 `examples/hello-fjs/src/components/ClassicTabBar.vue`：把现有 `TabBar.vue` 模板/样式原样搬入（外观零变化）
- [x] T014 `examples/hello-fjs/src/tabBarStyle.ts`：`useTabBarStyle()`（`ref` 默认 `liquid-glass`；Web 端 `localStorage` try/catch 读写，App 端内存态）
- [x] T015 `examples/hello-fjs/src/components/TabBar.vue` 改为风格分发器（`<component :is="getTabBarStyle(style)">`，透传 `tabs/active`）；`main.ts` 注册 `classic` 风格，`tabBar: { component: TabBar }` 不变
- [x] T016 `examples/hello-fjs/src/pages/about.vue`：新增「Tabbar 风格」Panel，两项分段（classic / liquid glass），点击即时切换
- [x] T017 移除 T004 的临时 spike 代码，确认 `git diff` 里 `TabBar.vue` 只剩分发器形态

## 两端对齐（宪法 I）

- [x] T020 `packages/fjs-liquidglass/components/GlassSurfaceWeb.vue`：`glass-surface` Web 替身，同 props；`backdrop-filter: blur() saturate()` + 高光描边 + 按下态；`dark/tint` 取值与 Dart 一致
- [x] T021 同文件：Chromium 上叠 SVG `feDisplacementMap` 折射（位移图按 radius 运行时生成并缓存）；其它引擎降级为毛玻璃并 `console.warn` 一次（宪法 V）
- [x] T022 清单 `widgets.glass-surface.web` 指向替身、`props` 类型声明；`fjs dev --web` 下 `<glass-surface>` 有类型提示
- [x] T023 两端对拍：同一页面 Web / iOS 模拟器 / Android（有则）各截深、浅色图，核对 blur/tint/radius 视觉一致、折射"有无"符合降级矩阵；差异写入 docs
- [x] T024 mp：`pnpm --filter hello-fjs run build:mp` 产物无本模块残留、不报错；若 `<glass-surface>` 引起报错，补 `fjs.mp.excludeComponents` 或清单处理

## 测试

- [x] T030 vitest `packages/fjs-liquidglass/test/styles.test.ts`（含 vitest 配置/脚本接入 `pnpm test`）：注册/取默认/未知名回退并 warnOnce/名称列表
- [x] T031 vitest：`GlassTabBar` 的 `active → 滑块位置` 计算（抽成纯函数后测）
- [x] T032 flutter test `packages/fjs-liquidglass/flutter/test/glass_surface_test.dart`：子节点渲染、prop 变化重绘、`refraction=0` 走 standard 质量档（确认真跑，不是 `No tests ran`）
- [x] T033 契约零改动自检：`git diff --stat` 对 T001 的 6 个文件应为空

## 文档（宪法 VIII）

- [x] T040 `docs/modules.md`：补"带第三方 pub 依赖的 widget 模块"范例与 Flutter ≥3.41 提示
- [x] T041 `docs/css-compat.md`：玻璃（blur/折射）两端差异与降级矩阵（含 ohos 未验证）
- [x] T042 `docs/routing.md`：tabBar 章节补"风格化 + 注册表 + 应用层分发"，注明 App 端风格不持久化
- [x] T043 `docs/ui-api.md`：`<glass-surface>` 标签与 props、`radius` 与 CSS `border-radius` 同值约定
- [x] T044 `docs/miniprogram.md`：登记 tabBar 风格/玻璃在 mp 忽略
- [x] T045 `docs/roadmap.md`：无 tabbar/玻璃条目，无需改
- [x] T047 `docs/modules.md` / README：写明链接本模块的宿主需 iOS ≥15 的手动步骤，并登记 `minIos` 自动化为后续 spec
- [x] T046 `packages/fjs-liquidglass/README.md`：用法、风格注册、降级矩阵、Flutter 版本要求、iOS `pod install` 提示

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `cd packages/fjs-liquidglass/flutter && flutter test`
- [x] T053 `fjs modules`（hello-fjs）列出 `@ufjs/liquidglass`；`pnpm --filter hello-fjs run typecheck`
- [x] T054 Web 目测：关于页切换风格即时生效、滑块随 tab 滑动、深浅色截图、刷新后风格保持
- [x] T055 iOS 模拟器目测：App 端可见模糊（对比 classic 纯色）、切换不闪烁不丢当前 tab、App 重启回默认（已知差异）
- [x] T056 spec.md 第 6 节逐条核对并勾掉；spec 状态改 done

## 增补：首页彩色背景 + 玻璃上字色（用户目测后追加，2026-10-08）

目测发现素背景下玻璃只剩灰胶囊，验证（临时彩色块）证明玻璃本身正常、是背景太素；
并发现玻璃盖在彩色背景上时选中项蓝字难读。

- [x] T060 ~~首页加彩色渐变~~ 用户目测后决定拿掉，`index.vue` 恢复原样（验证已完成：彩色背景下玻璃正常）
- [x] T061 `packages/fjs-liquidglass/components/GlassTabBar.vue`：滑块改为更亮的玻璃胶囊（亮色 `rgba(255,255,255,0.72)` + 发丝边），选中项蓝字落在亮底上可读；暗色同步
- [x] T062 web + iOS 目测：首页彩色背景下玻璃质感、字色可读；deep/浅色各看一眼；`pnpm run typecheck` 与 `pnpm test`

## 增补二：选中滑块对齐系统 tab bar（用户拿 iOS 相册对照后追加）

- [x] T063 `GlassTabBar.vue`：静止态为浅灰实心药丸（撑满胶囊高度）
- [x] T064 同文件：切换时滑块放大（`scale(1.14, 1.18)`）并用过冲 cubic-bezier 回弹，`moving` 定时器收尾（App 端 inset 过渡不派发 transitionend）
- [x] T065 同文件：移动期间挂载带折射的玻璃透镜（`v-if`，不用 opacity——backdrop 层不受祖先 Opacity 影响），到位后换回灰药丸；iOS 模拟器中间帧 / 落点帧目测
- 未做（用户决定）：选中项图标改实心（第 4 项）；胶囊贴合内容宽度 + 独立搜索钮

