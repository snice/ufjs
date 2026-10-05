# Plan: 全局 tabbar + Vue 自定义（TabGroup in-flow 停靠）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 同一份 `app/tabbar.ts`（surface + 状态）服务两端；布局形状一致（页面区之上、bar 之下），机制差异（真路由覆盖 vs display:none）登记 docs |
| II 边界即契约 | 否 | 无 op / natives / 事件表改动；`fjs-tab-bar-host` 保留根 + `__tabBar` prop 走既有 setProps 通道 |
| III 同步单线程零序列化 | 否 | tabbar 状态全是 JS 侧响应式计算 |
| IV 外观照 WeUI | 否 | tabbar 外观归应用层组件（hello-fjs 自选 App Store 胶囊风，非内置组件） |
| V 静默失效是 bug | 是 | display:none 塌缩、push 覆盖都有 widget 测试钉住；vapor 不支持显式 warn |
| VI 注释记录权衡 | 是 | 为何 TabGroup 而非 overlay（闪烁）、为何 Dock 不留白，写进代码注释与 spec |
| VII JS 能包就不要下 Dart | 是 | 核心通路纯 JS；Dart 只学一条布局规则（FjsView 停靠 `__tabBar` 根），无新 widget 文件、无 op 协议改动 |
| VIII 变更落到文档 | 是 | routing / ui-api / overlay-host / miniprogram 四处更新 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/app/tabbar.ts`（新） | surface（in-flow）+ tabs/active/visible 计算 |
| JS runtime | `packages/fjs-runtime/src/app/web.ts` | FjsRoot 渲染 `fjs-tabbar-host` 槽位（childless）；mount 时把第二个 Vue app 挂进去 |
| JS runtime | `packages/fjs-runtime/src/app/flutter.ts` | `createTabBarHost()` 建根、同一 surface 挂入 |
| JS runtime | `packages/fjs-runtime/src/app/web-vapor.ts`、`flutter-vapor.ts` | 不支持显式 warn |
| JS runtime | `packages/fjs-runtime/src/vue/host-ops.ts` | `createTabBarHost()`（镜像 ensureAppOverlayHost 的记账） |
| JS runtime | `packages/fjs-runtime/src/web/base-css.ts` | `#app` relative + `fjs-tabbar-host` absolute 底部悬浮 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_view.dart` | TabGroup：`__tabBar` 根从页面内容中排除、基视图 Stack 内 `Positioned(bottom)` 悬浮 |
| 应用 | `examples/hello-fjs/src/main.ts`、`Shell.vue`、`components/TabBar.vue`、`theme.ts` | 接线；Shell 摘除 TabBar、无 bar 页面照旧补 safe-area；TabBar 悬浮胶囊风（自带主题变量） |
| 文档 | `docs/routing.md`、`ui-api.md`、`overlay-host.md`、`miniprogram.md` | TabGroup 方案、meta.tabBar、mp 忽略 |

## 3. 方案

**TabGroup**：bar 不进任何页面树，作为全局唯一的一份悬浮在页面区底部、
不占布局高度——Flutter 上基页 FjsView 把 `__tabBar` 根作为
`Positioned(bottom)` 层放进 Stack（页面区 `Positioned.fill` 铺满）；web 上
FjsRoot 在 `fjs-page-host` 之后渲染一个 childless 的 `fjs-tabbar-host`，
bar 的第二个 Vue app 挂进去（base-css 把它 absolute 钉在 #app 底部）。

**被否掉的备选**：
- *app 级 overlay 宿主（游离根 fixed 提升，第一版实现）*：bar 随 op 批次在
  浮层里重绘、胶囊半透明透出页面切换，目测有闪烁；且要为它加返回豁免、
  modal 收口、命中穿透三套特判。用户目测后否掉。
- *shell 内渲染（每页一份）*：tabbar 随页面实例化，正是本 spec 要解决的问题。
- *in-flow 停靠（第二版实现）*：bar 占一行布局、页面区变矮，用户指出
  "fixed 底部的 bar 不该影响页面高度"——改为 Stack 内悬浮，bar 回归
  fixed 语义但仍不进 overlay 宿主。
- *shell 内渲染（每页一份）*：tabbar 随页面实例化，正是本 spec 要解决的问题。

**可见性**：`visible = 当前路由是 tab 页（meta.tab 数字）&& meta.tabBar !== false`。
push 二级页在 Flutter 上是真路由覆盖（TabGroup 整页被盖，零 JS 参与）；web 上
surface display:none。返回恢复。页面级模态天然盖住 bar（OverlayPortal /
z-index），无特判。

**页面高度**：bar 悬浮不占布局——内容从 bar 底下滚过，tab 页滚动内容末尾
自己留出胶囊高度的空档（hello-fjs Shell 的 tab-clearance，52 + 8）。

**组件契约**：props `{ tabs, active }`；`active` = 当前路由 meta.tab（非 tab
页为 null）；组件内部照旧 `router.replace(path)`（基页原地换 + park 保活）。
tabbar app 注入同一 router（web `use(vueRouter)`，Flutter provide 同一对
key），用户组件可照常用 `useRouter()`。

**主题**：tabbar 游离在页面 CSS 变量链外，hello-fjs 的 TabBar 在自己根节点
挂同一份 `useTheme()` 变量（模块级单例，切主题仍是一处状态）。

## 4. 风险

- **切换闪烁是否根除**：overlay 版的闪烁源（浮层随 op 批次重绘）在
  TabGroup 下不复存在——bar 与页面同一重建路径、带 GlobalKey；最终以
  iOS 模拟器目测为准。
- **FjsView 停靠的回归面**：所有宿主共用 FjsView——无 `__tabBar` 根时行为
  与改前完全一致（分支不触发），tab_keepalive 等既有测试钉住。
- **mp**：tabBar 选项下的组件在 mp 构建里不进任何页面模块图（main.ts 不在
  mp 产物里）；`build:mp` 后确认产物无残留。
- **web 第二 app 挂在 Vue 管理的 childless 元素里**：主 app 只 patch 属性
  不碰子节点，vitest 钉住「多次导航后 bar 仍在」。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test                                        # 含新增 runtime vitest
cd packages/flutter_fjs && flutter analyze --no-pub && flutter test
pnpm --filter hello-fjs run build:mp             # 确认 mp 产物无 tabbar 残留
pnpm --filter hello-fjs run build:web && 目测     # #app 布局、push 隐藏
cd examples/hello-fjs && fjs run ios             # 目测：切换不闪烁、深色模式
```
