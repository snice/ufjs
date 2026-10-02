# Spec: enableVapor 的 web 页面转场

- **ID**: 178-vapor-web-page-transition
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

`createFjsApp({ enableVapor: true, transition: 'fjs-fade' })` 在 web 上没有页面转场：vapor 壳
（`app/web-vapor.ts`，specs/166）切页就是把旧页 `display: none`、新页显示，`transition` 选项和
页面的 `meta.transition` 都被忽略。`onPageSettled` 也因此不等转场、立即触发。VDOM 壳
（`app/web.ts`）有完整的页面转场；Flutter 两种模式共用同一个路由，转场走原生 Navigator。

## 2. 不做什么（Non-goals）

- Flutter 不改（两种模式都已由原生 Navigator 播放；本 spec 只做对比确认）。
- 不做手势返回（web 本来就没有）。
- VDOM 壳不动。

## 3. 用户可见的行为

与 VDOM 壳相同（同一套 CSS、同一个 `resolveTransition`）：

- 默认 `fjs-page`；`transition: 'fjs-slide' | 'fjs-fade' | 'fjs-slide-up' | 'fjs-zoom' | 自定义名 | false | (nav) => …`；
  页面 `meta.transition` 覆盖；tab 切换与首页无动画。
- push：新页盖在旧页上进场；pop：同一族镜像播放（宿主 `data-nav="pop"`）。两页在转场期间重叠。
- 旧页 leave 播完才隐藏（仍留在页面缓存里，状态保留）。
- `onPageSettled`：新页的 enter 播完才触发；无动画时立即触发。
- 转场进行中再次导航：正在进行的一半被取消，不卡住。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 原生 Navigator（不变） | vapor 壳按 VDOM 壳的类名与 CSS 播放 |
| 已知差异 | 无新增 | 无新增 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测（happy-dom + 假时钟）：push / pop 的类名与 `data-nav`、
   leave 结束后旧页隐藏、`transition: false` 与 tab 切换无动画、`meta.transition` 覆盖、`onPageSettled` 等 enter 结束。
2. 浏览器：vapor-app 分别以 `enableVapor: true / false` 配 `transition: 'fjs-slide'` 跑，push / 返回的类名时序与
   `data-nav` 一致，旧页离场后才隐藏。
3. iOS 模拟器：两种模式配 `transition: 'fjs-fade'`，push 都是淡入（与默认的右滑不同）。

## 7. 待澄清

无。
