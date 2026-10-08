# Tasks: 全局组件

对应 plan：`./plan.md`

## runtime
- [x] T001 `app/global-components.ts`：类型、`globalVisible`（include/exclude/通配/RegExp）、`FjsGlobalSurface`
- [x] T002 `router/types.ts`：`globalComponents` 选项
- [x] T003 `vue/host-ops.ts`：`createGlobalHost()` + 模态遮罩计数
- [x] T004 `app/flutter.ts`：`installGlobalComponents` + vapor warn
- [x] T005 `app/web.ts`：`fjs-global-host` + 挂载
- [x] T006 `web/base-css.ts`：全局层样式（穿透）
## Dart
- [x] T010 `fjs_view.dart`：`rootIsGlobal` 排除
- [x] T011 `app_overlay_host.dart`：画 `__global` 根；不拦返回
## 示例
- [x] T020 `FloatingBall.vue`（拖拽、停靠、扇形）
- [x] T021 `main.ts` 注册；mp excludeComponents
## 测试
- [x] T030 vitest：匹配函数 + web 单例/隐藏不卸载/零挂载
- [x] T031 flutter widget 测试：空白区下穿、不拦返回
## 文档
- [x] T040 routing / ui-api / overlay-host / miniprogram
## 验收
- [x] T050 typecheck + pnpm test + flutter test
- [x] T051 web 目测、iOS 模拟器目测
