# Plan: 136-overlay-level

两层改动：JS 侧路由（fjs-runtime）+ Dart 侧 persistent 渲染（flutter_fjs）。
web 端零改动（原生 fixed 跟页面 DOM，`overlay` 属性 inert，登记差异）。

1. `packages/fjs-runtime/src/vue/renderer.ts`
   - `appOverlayRoot` 单例 + `ensureAppOverlayHost()`：`createRoot('fjs-app-overlay-host')`
     （照 flutterRoot 的簿记：childrenOf/parentOf/devtools 计数），`setProps(root,
     { __appOverlay: true })` 标记；**不进** pageRoots（不参与 pageRootOf/转场）。
   - `overlay` 属性读取：patchProp 里 `prop === 'overlay'` 记入 renderer 局部
     `overlayLevel` map（仅 'app' 记账，缺省即 page）；卸载清理同 hadActiveStyle。
   - `hoistIfNeeded`：fixed 解析后按 `overlayLevel` 分流——`app` → ensureAppOverlayHost()，
     否则现状 ensureOverlayHost(pageRootOf)。
   - 迁移：patchProp 检测 `overlay` 值变化且已 hoist → 搬移到另一级宿主
     （trackDetach/insert/trackInsert + styleEngine.recomputeSubtree，同 hoist 原语）。
   - Teleport：`querySelector('body'|'html')` 改返回 ensureAppOverlayHost()；
     更新 specs/129/133 相关注释。
2. `packages/flutter_fjs/lib/src`
   - `widgets/app_overlay_host.dart`（新）：`FjsAppOverlayHost`——ListenableBuilder(engine)
     扫 `tree.rootChildren` 里带 `__appOverlay` 的根，`FjsNodeRenderer` 渲染，
     `SizedBox.expand` + Stack；无 PopScope、无 RouteAnchor（不随转场、不拦返回）。
   - `node/overlay_host_adapter.dart`：新增 `fjs-app-overlay-host` tag 的 adapter
     （复用 positionedChild + `_paintOrder` 的 z 序 + FjsOverflowHitScope 透传；
     无 OverlayPortal——persistent 层已经在 Navigator 之上）。
   - `fjs_app.dart`：`FjsToastHost(child: FjsAppOverlayHost(child: NavigatorPopHandler…))`
     ——app 宿主在 Navigator 之上、toast 之下。
   - `fjs_view.dart`：根扫描跳过 `__appOverlay` 根（否则 base 页 navKey 0 重复渲染）。
3. 测试
   - JS：`packages/fjs-runtime/test/`（renderer 现有测试旁）新增 overlay-level
     用例：默认 page 不回归 / overlay=app 进 app 根 / 变更迁移 / teleport body
     指 app 根 / 卸载清理。
   - Dart：`test/app_overlay_host_test.dart`（照 nav_router_test 的驱动方式）：
     push 不盖住、pop 随卸载消失、base 页不重复渲染。
4. demo `vant-watermark.vue`：加「跨页水印（overlay=app）」开关块（push /about
   验证仍显示；页面级对照被盖住）。
5. docs/overlay-host.md：§「宿主级别」——page/app 两级、Teleport 语义更新、
   web 差异登记（`overlay` inert）。

验证顺序：JS 单测 → Dart 单测 → pnpm test / flutter test 全绿 → demo 两端对拍
→ 文档 → 提交（分支 136-overlay-level）。
