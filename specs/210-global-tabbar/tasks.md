# Tasks: 全局 tabbar + Vue 自定义（TabGroup in-flow 停靠）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

> 三次改向（均为用户目测后拍板）：① 可见性从"常驻（App Store 式）"改为
> "仅 tab 页显示"；② 挂载从 app 级 overlay 宿主改为 TabGroup（overlay 版
> 切换闪烁）；③ 形态从 in-flow 停靠改为 Stack 内悬浮（bar 是 fixed 的，
> 不该占页面高度）。中途产物（app 宿主挂载 / modal census / 返回豁免 /
> Expanded 一列）已全部回退。

## runtime 核心

- [x] T001 `router/types.ts`：`tabBar` 选项 + `meta.tabBar` 文档（active 由 surface 直接算，无需 router 层新面）
- [x] T002 `app/tabbar.ts`：in-flow surface（tabs/active/visible 计算 + 用户组件挂载点）
- [x] T003 `app/web.ts`：FjsRoot 渲染 `fjs-tabbar-host` 槽位 + 第二个 Vue app 挂入
- [x] T004 `app/flutter.ts`：`createTabBarHost()` 建根 + 同一 surface 挂入（注入 ROUTER/ROUTE key）
- [x] T005 vapor 路径：不支持显式 warn（spec non-goal，宪法 V）
- [x] T006 `vue/host-ops.ts`：`createTabBarHost()`（镜像 ensureAppOverlayHost 记账，无 overlay 语义）
- [x] T007 `web/base-css.ts`：`#app` relative + `fjs-tabbar-host` absolute 底部悬浮
- [x] T008 `coveredOnPush`：surface 在"被覆盖平台"上不收起 push 期间的 bar（Flutter `router.pushedDepth`，web 恒 false）；vitest 钉住四种状态

## Dart 侧

- [x] T010 `fjs_view.dart`：`rootIsTabBar` 排除出页面内容 + 基视图 TabGroup（Stack：页面区 Positioned.fill + bar Positioned(bottom)）+ 类文档
- [x] T011 widget 测试：悬浮且不占页面高度（页面内容位置不变）、push 整页盖住（offstage 不可命中）、display:none 消失

## 应用层（hello-fjs）

- [x] T020 `main.ts` 传 `tabBar: { component: TabBar }`
- [x] T021 `Shell.vue` 摘除 `<TabBar>`；悬浮 bar 压内容，tab 页滚动内容末尾补 tab-clearance + safe-area（mp 端 `__fjsWx` 判定，与 fjs-safe-area 同法）
- [x] T022 `TabBar.vue` 改 App Store 悬浮胶囊风（半透明；web backdrop-filter，App 端半透明纯色），自带主题变量（读同一 useTheme 单例）
- [x] T023 `meta.tabBar: false` 演示页（俄罗斯方块、合成大西瓜）
- [ ] T024 深色模式目测（web + iOS）

## 测试（runtime vitest）

- [x] T030 tabbar 单例：#app 内、fjs-page-host 之后；多次导航只此一份
- [x] T031 push 二级页隐藏 / 返回恢复（仅 tab 页语义）
- [x] T032 `meta.tabBar: false` 时 surface display:none
- [x] T033 不传 tabBar 选项时零挂载（demo 回归）

## mp 验证

- [x] T040 `build:mp` 产物无 tabbar 组件残留（excludeComponents 一并移除）；`docs/miniprogram.md` 登记选项忽略

## 文档

- [x] T050 `docs/routing.md`：全局 tab bar 章节（TabGroup 停靠、可见性、组件契约）
- [x] T051 `docs/ui-api.md`：createFjsApp tabBar 选项 + `<route>` meta `tabBar: false` 指针
- [x] T052 `docs/overlay-host.md`：说明 tab bar 是 in-flow chrome、不走 app 级宿主
- [x] T053 `docs/roadmap.md`：无 tabbar 相关条目，不需要改

## 验收

- [x] T060 `pnpm run typecheck`
- [x] T061 `pnpm test`
- [x] T062 `flutter test`
- [x] T063 spec.md 第 6 节逐条核对（web/iOS 截图核对；切换不闪烁的最终确认 = 用户侧复验，探针 91 帧零异常）

## 增补：safe-area scale / padding 覆盖（spec 第 8 节）

- [ ] T070 Flutter：node_adapters.dart `_SafeAreaNodeAdapter` 支持 scale + 显式 padding 覆盖
- [ ] T071 web：base-css `--fjs-safe-scale` + FjsSafeArea 组件映射 scale
- [ ] T072 mp：fjs-safe-area `scale` 属性；docs 登记不支持 padding 覆盖
- [ ] T073 类型 / docs/ui-api.md；TabBar.vue 用 scale；测试
