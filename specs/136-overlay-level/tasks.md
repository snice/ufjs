# Tasks: 136-overlay-level

- [x] T1 JS：ensureAppOverlayHost + hoist/Teleport 路由 + overlay 变更迁移
- [x] T2 Dart：FjsAppOverlayHost persistent widget + app 宿主 adapter + FjsView 排除
- [x] T3 JS 单测（分流/迁移/teleport/清理）
- [x] T4 Dart 单测（push 不盖、pop 消失、base 页不重复渲染）
- [x] T5 `pnpm test` + `flutter test` 全绿
- [x] T6 demo 跨页水印示例 + 两端对拍
- [x] T7 docs/overlay-host.md 级别一节 + web 差异登记

## 实测记录（Android 模拟器）

- 物理返回在 app 级下失效，两个原因叠加：
  1. `FjsAppOverlayHost` 空态直接 `return child`，第一个 app 级元素出现时
     Navigator 子树被重新挂到 Stack 下，未加 key 的 `NavigatorPopHandler`
     被重建、`_canPop` 回到 true → 返回键越过内层路由。改为结构恒定的 Stack。
  2. vant 全页水印形状上就是遮罩（fixed、0/0、100%×100%），`isModalMask`
     没看 `pointer-events: none`，页面宿主被标 modal、返回被拦；
     `migrateHostLevel` 也不重新推导来源/目标页面宿主的 `modal`。两处都已修。
- 回归测试：`app_overlay_host_test.dart`「system back still pops…」、
  `vue_overlay_level.test.ts` 的 pointer-events / 迁移 modal 两条。
- 用户改定：app 级有可见元素即拦系统返回（`FjsAppOverlayBackGuard`，每页路由 +
  NavigatorPopHandler 外层各一个）；v-show 隐藏的 teleport 内容不算。导航栏箭头
  （`router.back()`）不拦，属预期。

