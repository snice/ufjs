# Tasks: overlay 宿主专题——跟随页面转场、模态拦截返回、使用范围收口

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及三张契约表；在 `packages/flutter_fjs/lib/src/node/overlay_host_adapter.dart` 顶部注释登记宿主节点的新属性 `modal`（JS 经 `setProps` 写，Dart 只读）

## 实现

- [x] T010 新增 `isModalMask(style)`，并在样式回调里维护宿主内元素的模态集合——`packages/fjs-runtime/src/vue/renderer.ts`
- [x] T011 新增 `syncHostModal(pageRoot)`：结论变了才对宿主节点 `setProps({ modal })`；在 hoist / unhoist / `dropElement` / `releaseRoot` / Teleport 落入宿主时调用——`packages/fjs-runtime/src/vue/renderer.ts`
- [x] T012 `OverlayHostNodeAdapter` 外包 `PopScope(canPop: !modal)`，被拦时 debug 下打一次日志——`packages/flutter_fjs/lib/src/node/overlay_host_adapter.dart`
- [x] T013 portal 内容外包 `_FollowRoute`（plan §3.6：跟随 `FjsRouteAnchor` 的 LayerLink，非 Cupertino 路由加淡出）；`fjs_app.dart` 每页包锚点——`packages/flutter_fjs/lib/src/node/overlay_host_adapter.dart`、`packages/flutter_fjs/lib/src/widgets/route_anchor.dart`
- [x] T014 `NavigatorPopHandler.onPopWithResult` 从 `pop()` 改为 `maybePop()`——`packages/flutter_fjs/lib/src/fjs_app.dart`

## 两端对齐

- [x] T020 Web 侧不改代码：确认 `vant-feedback` / `vant-float` 在 web 的 fixed 随页面走、浏览器后退直接离开（已知差异，spec §7-3）
- [x] T021 两端对拍（iOS + web + Android）：iOS 模拟器与 web 的 `vant-float` 吸顶→返回；`vant-feedback` 开 Popup→返回，记录差异是否只剩"web 后退不拦截"

## 测试

- [x] T030 runtime 测试：`.van-overlay` 形状→`modal: true`；`display:none`→false；Toast / Sticky 吸顶 / fixed NavBar→false；遮罩卸载→false——并入 `packages/fjs-runtime/test/vue_overlay_pseudo.test.ts`（复用其 op 解码器）
- [x] T031 Dart 测试：push 第二页后第一页宿主内容不可见不可点；pop 转场中宿主内容与页面同步移动；转场后不在树里；层外空白处点击穿透到页面（iOS）——`packages/flutter_fjs/test/overlay_host_test.dart`
- [x] T032 Dart 测试：`modal: true` 时 `maybePop()` 后页面仍在、`handlePopRoute()` 不 pop；无 `modal` 时正常 pop——`packages/flutter_fjs/test/overlay_host_test.dart`
- [x] T033 编 native 后跑 `flutter test`，确认输出不是 `No tests ran`

## 文档

- [x] T040 新增 `docs/overlay-host.md`：谁会进宿主（三类来源表）、转场跟随、模态判定规则、返回拦截、页面级 fixed 的写法建议、已知差异（web 后退、forbidClick Toast、透明度只整体淡出、自建路由需包锚点）
- [x] T041 `docs/ui-api.md` 的 `fjs-overlay-host` 行、`docs/css-compat.md` 的 `position: fixed` 行改为摘要 + 链接
- [x] T042 `docs/web.md` 已知差异加"模态弹层时浏览器后退不拦截"
- [x] T043 `docs/README.md` 与 `AGENTS.md` §6 文档地图挂上 overlay-host.md
- [x] T044 `demo/src/pages/vant-float.vue` 页顶说明补"吸顶元素随页面转场（specs/133）"
- [x] T045 `docs/roadmap.md` 有对应条目则打勾，没有就不加（无对应条目，未加）

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `flutter test`（native 已编）
- [x] T053 iOS 模拟器：spec §6 第 5、6、7 条
- [x] T054 Android 模拟器：spec §6 第 4 条（用户自测通过）
- [x] T055 Web：spec §6 第 8 条
- [x] T056 spec.md 第 6 节逐条核对，状态改 done
