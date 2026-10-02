# Plan: 173-web-history-router

## 1. 新模块

| 文件 | 内容 |
|---|---|
| `router/web-history.ts`（新） | `createHistoryRouter(options)`：`Router` 实现 + `current`（shallowRef：fjs `RouteLocation` + 已加载的页面组件）+ `start()`。hash / history 两种模式的地址读写、`popstate`、`history.state.position`（与 `historyEntryKey` 同一形状）、重定向（未匹配 → initial；`/` 缺失 → initial）、懒加载、并发导航（后发者胜）、窗口滚动按 position 存取 |
| `router/web-preload.ts`（新） | 从 `router/web.ts` 挪出 `preloadRecord` / `whenBrowserIdle`，两个 web 路由共用 |
| `router/web-vapor.ts`（新） | enableVapor web 的 `fjs/router`：`useRouter` / `useRoute` / `onPageSettled` / `definePage` / `ROUTER_KEY` / `ROUTE_KEY` / 类型；不 import vue-router |

`ROUTER_KEY` / `ROUTE_KEY` 是 `Symbol.for`，两个模块各自声明也是同一个值。

## 2. 改动

- `app/web-vapor.ts`：用 `createHistoryRouter`；`buildPage` 直接拿 `current` 里的组件与 location；
  shell 的 effect 跟踪 `router.current`；删掉复刻 `install()` 的首次 push 与 `START_LOCATION` 绕行，
  改为 `router.start()`。
- `router/web.ts`：preload 两个函数改从 `web-preload.ts` 引入，其余不动。
- CLI：`webAliases(enableVapor)` 与 `vite.ts` 的 `fjs/router` 在 enableVapor 下指向 `router/web-vapor.ts`。

## 3. 测试

- `test/web-history-router.test.ts`（happy-dom）：hash / history 模式的 push / replace / back（popstate）、
  深链接首开、未匹配重定向、`/` → initial、懒加载组件、query、同 fullPath 不重复导航、
  后发导航胜出、`historyEntryKey` 的 position。
- 既有 `web-vapor-shell` 测试改走新路由；VDOM web 路由测试不改。
- CLI：enableVapor web 的 alias 指向 `web-vapor.ts`。

## 4. 验证

vapor-app `fjs build --web --analyze` 无 vue-router；浏览器里跑首页 → about → 返回、表单页、
后退/前进、深链接；demo VDOM web 构建仍含 vue-router。
