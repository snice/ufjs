# Tasks: 页面容器 page-container

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `tags.json` +`"page-container"`；`vue-global.d.ts` props 接口与
      GlobalComponents 注册；`element.ts` EventType +7（35-41）、
      `ffi.dart` FjsEvent +7、`fjs.h` +7（Dart 镜像表在 ffi.dart，不是
      ui_ops.dart）

## Flutter 端

- [x] T010 `widgets/page_container.dart`：route 级实现。实测发现
      CupertinoRouteTransitionMixin 的手势探测器是 SDK 私有类，其
      buildTransitions 还会叠加水平滑入的 CupertinoPageTransition——按
      其语义重写了 20px 边缘手势条（放 buildTransitions 层）+ 拖拽
      controller； Navigator 装载路由时会 offstage 跳钟产生一次假
      completed，afterEnter 以 !offstage 门控
- [x] T011 `node/node_adapters.dart` 注册 adapter
- [x] T012 `flutter test` 全绿（353 个，含新 page_container_test 六例；
      无 native dylib 依赖的 widget 测试，无需先编 native）

## web 端

- [x] T020 `web/components/page-container.ts`：Teleport + fixed + CSS
      transition + touch 拖拽；phase 状态机，transitionend + 定时器兜底
- [x] T021 `web/components/index.ts` fjsComponents 注册 + base-css 样式
- [x] T022 `web-page-container.test.ts` 五例（fake timers 驱动 rAF 与
      settle 兜底定时器）

## 小程序端（零代码，测试钉死）

- [x] T030 mp-compiler 测试：透传原样 wxml + `bindbeforeenter`/
      `bindclickoverlay`
- [x] T031 vue-plugin 测试：Flutter 路径原生元素、web 路径
      resolveComponent

## 示例

- [x] T040 hello-fjs `src/pages/comp/feedback/page-container.vue`：四向
      入口 + round/close-on-slide-down + 事件日志

## 文档

- [ ] T050 `docs/ui-api.md` 加 page-container 一节（含三端差异）
- [ ] T051 `docs/miniprogram.md` 标签映射表加"透传 wx 原生"一行

## 验收

- [x] T060 `pnpm run typecheck` + `pnpm test`（816）+ hello-fjs
      typecheck + `flutter test`（353）
- [x] T061 web 走查（spec §6.3 逐条：四向/遮罩/事件链/圆角/duration）
- [x] T062 iOS 模拟器走查（spec §6.4）。中途两笔返工记录：
      1. demo 页爆栈白屏——`@ufjs/cli` dist 内联了旧 tags.json，
         `page-container` 被编译成组件、页面自引用递归；重建 CLI 后恢复，
         坑记入 AGENTS.md §4.6
      2. 用户走查反馈「打开时有路由动画、页面层仍可滑动返回」——route
         混入的 `CupertinoRouteTransitionMixin` 让底下页面把容器当成
         Cupertino push（canTransitionTo 命中）且其手势语义漏到页面层；
         改为 bare `PageRoute`（canTransitionTo=false）+ 自写边缘手势条。
         另发现并修复 Flutter 端 top/bottom 面板未撑满屏宽（wx 语义：
         top/bottom 全宽、right 全高、center 随内容）
- [x] T063 `build:mp` 产物核对 + 微信开发者工具走查（skyline）。结论：
      page-container 在 skyline 可用，bottom 正常；**position=center 时
      容器宽度随内容，内容需显式宽度否则空白**（已记入 spec §4 与
      ui-api.md 差异表，demo 内容补 width:260px）
