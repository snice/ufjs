# Plan: 页面容器 page-container

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 三端同一份 props/事件契约；行为差异（web 不拦返回、Flutter z-index 走路由顺序）写进 spec §4 与代码头注释 |
| II 边界即契约 | 是 | +7 事件号三张表（`element.ts` / `ffi.dart` / `fjs.h`）同步改，一次性提交 |
| III 同步单线程零序列化 | 否 | 事件无载荷，不过对象 |
| IV 外观照 WeUI | 是 | `round` 圆角、遮罩色取 WeUI 半屏弹窗一组数值，web 常量与 Dart 常量同值（modal.dart 的做法） |
| V 静默失效是 bug | 是 | 未知 `position` 值：web/Flutter warnOnce 并回退 bottom；mp 端透传后由 wx 兜底 |
| VI 注释记录权衡 | 是 | 三个实现文件头注释记录：为什么下沉 Dart（fixed ❌ + 返回手势是路由能力）、为什么 web 不拦返回 |
| VII JS 能包就不要下 Dart | 破例，有据 | Flutter 端 CSS 无 `position: fixed`（css-compat.md），JS 视图无法从任意挂载点盖住整页、无法逃逸 scroll-view；返回手势关闭是路由能力。这正是 VII 判据里「需要 Flutter 渲染能力」的一类，且 `modal` 已立先例 |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`、`docs/miniprogram.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/tags.json` | +`"page-container"`（原生标签，volar 自动跟随） |
| JS runtime | `packages/fjs-runtime/src/ui/element.ts` | EventType +7（kebab→camel 拼写按 `onScrolltolower` 惯例补别名） |
| Web 适配层 | `packages/fjs-runtime/src/web/components/page-container.ts` | 新建适配器（Teleport + fixed + transition） |
| Web 适配层 | `packages/fjs-runtime/src/web/components/index.ts` | fjsComponents +1 行 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ffi.dart` | FjsEvent 镜像 +7 |
| Dart 宿主 | `packages/flutter_fjs/native/include/fjs.h` | 事件号镜像 +7 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/page_container.dart` | 新建 widget（route 级） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | 注册 adapter |
| CLI / 构建 | — | **不动**（mp 的 `resolveTag` 默认透传已覆盖） |
| 示例 | `examples/hello-fjs/src/pages/comp/feedback/page-container.vue` | 新建 demo 页 |
| 测试 | `packages/fjs-runtime/test/web-page-container.test.ts`、`packages/fjs/test/*.test.ts` | 新用例 |
| 文档 | `docs/ui-api.md`、`docs/miniprogram.md` | 登记 |

## 3. 方案

**原生标签（tags.json）+ 三端三实现**，`modal` 同款：

- **Flutter**：node 上 `show=true` 时 `Navigator.push(PageRouteBuilder(opaque:false, barrierColor: transparent))`，自画遮罩（点击派 `clickoverlay`，不自动关）；面板用 `ListenableBuilder(tree.listenableFor(node.id))` 挂活子树（modal.dart 已验证的模式——内容在打开期间保持可变）。`position` 映射 `SlideTransition`（center 用 Fade）；`duration` 映射 `transitionDuration/reverseTransitionDuration`；`round` 面板圆角；`close-on-slide-down` 面板拖拽过阈值 → `Navigator.pop`（走"原生发起"路径）。事件时机：`beforeenter` 在 push 前派，`enter` 在动画起点派，`afterenter` 在 `animation.status == completed` 派；离场链 `beforeleave/leave/afterleave` 无论谁发起（JS 改 show / 遮罩处理函数 / 返回手势 / 下滑）**恰好派一次**——用"关闭发起方"标记去重，pop 完成回调里收尾。`PopScope(canPop: true)`：返回手势 pop 的就是容器路由本身，语义天然正确。
- **web**：`Teleport to body` + fixed 遮罩（`rgba` 同 modal）+ fixed 面板（按 position 定位，transform 进出场）；`duration` 写进 `transition-duration`；`transitionstart/transitionend` 驱动生命周期事件（无 transition 时 setTimeout 兜底）；`close-on-slide-down` 用 touch 拖拽，位移过阈值 emit 离场并收起。样式常量与 Dart 侧同值，圆角查 WeUI 半屏弹窗。
- **mp**：零代码。`resolveTag` 默认分支透传 + 事件兜底命名（`@before-enter`→`bindbeforeenter`）已对上 wx 原生写法；`:show`/`duration`/`close-on-slide-down` 等属性原样透传。用测试把行为钉死。

**被否掉的备选**：
1. *纯 JS 组件（component-tags.json）*——Flutter 端 `position: fixed` ❌，无法从任意挂载点盖住整页；返回手势做不到。否。
2. *JS 组件 + mp 端 fjs-page-container 四件套*——要在 wxss 里手写一份假 page-container（无 vdom、动画只能 wx:if 驱动），拿不到原生返回手势，三份实现变四份。否。
3. *生命周期复用一个事件号 + payload 区分（canvas 先例）*——会撞 `handlerKey(el.id, EventType[key])` 的注册键，要给派发热路径开特例。否，模板级事件按 tap/change 先例各占一号。

## 4. 风险

- **事件号接龙**：三张表当前最大号要以实现时读到的为准（grep 到过 32 号），取其后连续 7 个；漏一张表的表现是事件永不触发（宪法 V），用 typecheck + 三表 diff 自查。
- **双路径重复派发**：JS 发起关闭时 `didUpdateWidget` 派离场链、pop 完成回调又派——必须发起方去重，否则 `@after-leave` 走两次、`show` 归位逻辑抖动。Flutter 单测/手动对拍覆盖。
- **skyline 兼容**：wx 文档称 page-container 支持 skyline 但要求较新工具/基础库；hello-fjs 全局 renderer=skyline。DevTools 实测，若不可用把结论记回 spec §4（兜底方案：该页文档标注需真机/webview，不动全局 renderer）。
- **透传子节点布局**：native page-container 的 slot 子节点默认布局与 fjs 的 flex 基线（`.fjs-box`）可能不一致，DevTools 走查 demo 页时核对，需要再进 `CONTAINER_TAGS`，默认不动。
- **`modal` 快照教训**：面板必须挂活子树（ListenableBuilder），否则开容器后 JS 改内容不生效——modal.dart 头注释已写明为什么。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test                 # 静态 + 单测
pnpm --filter hello-fjs run typecheck
pnpm --filter hello-fjs run dev:web             # web 走查
pnpm --filter hello-fjs run run:ios             # iOS 模拟器（返回手势实测）
pnpm --filter hello-fjs run build:mp            # 产物给微信开发者工具
```
