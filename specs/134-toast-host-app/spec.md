# Spec: toast 宿主挂在 App 上，一个 App 一个

- **ID**: 134-toast-host-app
- **状态**: done
- **日期**: 2026-09-25

## 1. 要解决什么

JS `toast('msg')`（`fjs` 模块导出，natives 经 `engine.onToast` 回到 Dart）在 App 端
由 `FjsToastHost` 显示。它现在挂在 **`FjsView` 里**（`lib/src/fjs_view.dart`），而
`FjsApp` 给每个路由都建一个 `FjsView`——结果是**每个页面一个 toast 宿主**：

1. **归属错位**：toast 是全局函数，不属于任何页面（web 端挂在 `document.body`，
   `fjs-runtime/src/web/index.ts` 的 `showToast`；小程序走 `wx.showToast`），App 端却
   按页面一份。
2. **`onToast` 靠链表接力**：每个宿主 `initState` 抢占 `engine.onToast`、记住前一个，
   `dispose` 时还原。页面不按栈序销毁（替换下层路由、tab 页停放、`fjs dev` 整树重载时
   `KeyedSubtree` 按 generation 重建）时，会把 `onToast` 还原成**已销毁宿主**的回调，
   下一次 `toast()` 在已卸载的 `context` 上 `Overlay.of` → 异常或静默不显示。
3. **翻页即丢**：toast 显示期间当前页被 pop，宿主随页面 dispose，toast 立即被撤掉；
   web 上 toast 跨路由照常显示满 2 秒。
4. `fjs dev` 每次整树重载都会重建宿主，正在显示的 toast 被撤掉。

## 2. 不做什么（Non-goals）

- 不改 toast 外观、时长（2s）、替换语义（新 toast 顶掉旧的）。
- 不改 JS 侧 API、natives、op 协议。
- 不改 vant `showToast` 等走 `position: fixed` 的组件（那是 overlay 宿主，specs/133）。
- 不改小程序端。

## 3. 用户可见的行为

页面代码不变：`import { toast } from 'fjs'; toast('已保存')`。

改完之后（App 端）：

1. **用 `FjsApp` 时，全 App 只有一个 toast 宿主**，挂在 `FjsApp` 上（Navigator 之上），
   各页面的 `FjsView` 不再各挂一个。
2. **toast 跨页面**：toast 显示期间 push / pop 页面，toast 照常显示满 2 秒，和 web 一致。
3. **宿主直接嵌 `FjsView`（不用 `FjsApp`）照常有 toast**：`FjsView` 发现上方没有同一
   engine 的 toast 宿主时，自己挂一个（兜底，行为同现在）。
4. **多个独立 `FjsView` 按任意顺序销毁，`toast()` 都落在一个活着的宿主上**；全部销毁后
   `onToast` 还原成宿主 App 自己设的回调（`toast_host.dart` 顶部注释承诺的"宿主自己设
   `engine.onToast` 保留控制权"不变）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 宿主归属 | `FjsApp` 一个；无 `FjsApp` 时 `FjsView` 兜底 | `document.body` 一个（不改） |
| 跨路由 | 照常显示满 2 秒 | 同（不改） |
| 事件载荷 | 不涉及 | — |
| 已知差异 | 无新增 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（只改 Dart 侧 widget 挂载位置）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；`cd packages/flutter_fjs && flutter test`
   通过且**不是** `No tests ran`。
2. Dart 测试（`nav_router_test.dart`，真 engine + `FjsApp`）：
   - push 两页后树里只有一个 `FjsToastHost`，且 push / pop 前后 `engine.onToast` 不变；
   - `toast` 显示中 pop 当前页，toast 仍在；2 秒后消失；
   - `MaterialApp(home: FjsView(...))` 不用 `FjsApp`，`toast` 照常显示；
   - 两个独立宿主先销毁先挂的那个，再 `toast` 仍显示、不抛异常；全部销毁后
     `onToast` 还原成原来的回调。
3. iOS 模拟器 hello-fjs 按钮页（`comp/form/button`）：点「主要按钮」后立即侧滑返回，
   toast 继续显示到 2 秒。
4. 文档：`docs/ui-api.md` 的 `toast` 一句补上"App 端一个 App 一个宿主，跨页面显示"；
   `docs/overlay-host.md` 区分：`toast()` 不走 overlay 宿主。

## 7. 待澄清

无（用户已给方向：`FjsApp` 作为根时 toast 宿主挂在 App 上作全局，不每个 view 挂一个）。
