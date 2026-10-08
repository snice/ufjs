# Plan: 全局组件（globalComponents）+ hello-fjs 悬浮球

对应 spec：`./spec.md`（待澄清已全部拍板）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Web：`app/web.ts` 渲染 `fjs-global-host` + 第二个 Vue app；Flutter：`app/flutter.ts` `installGlobalComponents()` + `fjs_app.dart` 经 `widgets/app_overlay_host.dart` 画 `__global` 根。路由匹配是同一个纯函数 `app/global-components.ts` |
| II 边界即契约 | 否 | 无新标签/op/natives/事件。`__global` 根 prop 走既有 `setProps`（同 `__tabBar`/`__appOverlay`）；悬浮球拖拽用既有 `touchstart/move/end` |
| III 同步单线程 | 是，满足 | 纯 JS 组织 + 一条 Dart 布局规则，无新桥 |
| IV 外观照 WeUI | 否 | 内置组件外观无改；演示组件是应用层 |
| V 静默失效 | 是 | vapor 路径传 `globalComponents` → warn 后忽略；mp 构建忽略并登记文档 |
| VI 注释记录权衡 | 是 | 层序/穿透/模态让位的取舍写进代码注释 |
| VII JS 能包就不下 Dart | 是 | 绝大部分在 JS：surface 组件、路由匹配、模态让位判定。Dart 只做"把 `__global` 根画在 Navigator 之上"——复用 app overlay 宿主既有的"仅子节点绘制处命中、空白下穿"机制，必须落 Dart 因为 Navigator 之上的层只有 FjsApp 能放 |
| VIII 文档 | 是 | `docs/routing.md`（全局组件章节）、`docs/ui-api.md`（选项）、`docs/overlay-host.md`（全局层 ≠ overlay 宿主、不拦返回）、`docs/miniprogram.md`（忽略）、`docs/roadmap.md`（如有条目） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/app/global-components.ts`（新） | `matchRoute`/`globalVisible` 纯函数；`FjsGlobalSurface`（单 Vue app，逐项 `display:none` 切换，不卸载）；类型 `GlobalComponentOptions` |
| JS runtime | `packages/fjs-runtime/src/router/types.ts` | `RouterOptions.globalComponents` + 类型导出 |
| JS runtime | `packages/fjs-runtime/src/app/flutter.ts` | `installGlobalComponents()`：`createGlobalHost()` 建根 + 挂 surface；vapor warn |
| JS runtime | `packages/fjs-runtime/src/vue/host-ops.ts` | `createGlobalHost()`（`__global`）；`modalMaskCount` 响应式（模态让位） |
| JS runtime | `packages/fjs-runtime/src/app/web.ts` | FjsRoot 渲染 `fjs-global-host`；`mount()` 后挂 surface |
| Web 适配 | `packages/fjs-runtime/src/web/base-css.ts` | `fjs-global-host`：absolute 全屏、`pointer-events:none`、z-index 低于模态；子孙 `pointer-events:auto` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/app_overlay_host.dart` | 额外收集 `__global` 根，画在 Navigator 之上、`__appOverlay` 之下；不计入 `fjsAppOverlayHoldsBack`（不拦返回） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_view.dart` | `rootIsGlobal` 并从页面内容中排除（避免 navKey 0 兜底画成页面） |
| 测试 | `packages/fjs-runtime/test/global-components.test.ts`（新）、`packages/flutter_fjs/test/…`（新 widget 测试） | 见 spec §6 |
| 示例 | `examples/hello-fjs/src/components/FloatingBall.vue`（新）、`src/main.ts` | 悬浮球 + 扇形菜单；`exclude: ['/example/game/*']` |
| 构建 | `examples/hello-fjs` mp 配置 `excludeComponents` | 剔除 FloatingBall |
| 文档 | 见上 | |

## 3. 方案

- **一个 surface、一个 Vue app**：`globalComponents` 规范化成 `{component, include, exclude}[]`，surface 逐项渲染 wrapper `view`（absolute 全屏），不命中时 `display:none`。两端同一份组件。实例单例、状态保留。
- **穿透**：
  - web：`fjs-global-host` 与 wrapper `pointer-events:none`，其后代 `auto`；
  - Flutter：根进 `FjsAppOverlayHost` 的 Stack（`Positioned.fill`），该处现有行为就是"盒子绘制处吃触摸，其余下穿到 Navigator"（specs/136 注释）。wrapper 无背景故空白区不命中。
- **层序（Q1/Q2）**：Flutter 全局层在 Navigator 之上（盖住 push 页），因此天然也压在页面模态之上，违背 Q2。解决：`host-ops.ts` 已有 `modalMasks` 集合（页面级遮罩判定），加一个 `shallowRef` 计数；surface 在计数 > 0 时整体 `display:none`（让位）。web 上全局层 z-index 低于模态（1000），自然被遮罩盖住，不用让位逻辑，但 surface 同样读不到计数（web 无 host-ops），差异登记：web 靠 z-index、App 靠让位，**结果一致**（遮罩期间球不可见/不可点）。
- **返回**：全局根不是 `__appOverlay`，不进 `fjsAppOverlayHoldsBack`，不拦返回。

### 被否掉的备选

1. **直接复用 `__appOverlay` 根**：它的非隐藏子节点会触发 back guard，球一直在 → 永远无法返回退出。否。
2. **挂进 TabGroup（同 tabBar，Q1-B）**：二级页看不到球，用户已否。
3. **在 Navigator 的 Overlay 里插 OverlayEntry**：能精确摆在模态之下，但需要新 Dart 机制 + 每页 anchor 联动，成本远高于"模态让位"。否。
4. **新增 `pointer-events: auto` 子树重开支持**：Dart 命中规则大改，css-compat 已定不做。否。
5. **每个全局组件一个 Vue app / 一个根**：多根多记账，无收益。否。

## 4. 风险

- Flutter 空白区下穿 + 球上拖拽手势要实机确认（`touchmove` 在 overlay 层里能否持续收到）——先做出来在 iOS 模拟器验。
- 模态让位依赖 `modalMasks`：`overlay="app"` 的 teleport 弹层不在其中（它在全局层之上，本就盖住球），无需处理。
- 全局根的 `flutterRoot` 记账：必须 `childrenOf/parentOf` 初始化（同 `createTabBarHost`），否则 insert 静默失败。
- dev server 热更：改 runtime 要重启 dev（memory）。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
(cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j)
(cd packages/flutter_fjs && flutter test)
pnpm --filter @ufjs/cli run build          # 若动了内联清单（本次不动）
pnpm --filter hello-fjs run dev:web         # web 目测
cd examples/hello-fjs && fjs run ios        # iOS 模拟器目测
```
