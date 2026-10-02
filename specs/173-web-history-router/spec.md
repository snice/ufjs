# Spec: web enableVapor 用薄 history 路由替掉 vue-router

- **ID**: 173-web-history-router
- **状态**: done
- **日期**: 2026-10-01

## 1. 要解决什么

enableVapor 的 web 包里 vue-router 占 25.1 KB（vapor-app `fjs build --web --analyze`：
共享 chunk 34.9 KB 中的 72%），但 vapor 壳（`app/web-vapor.ts`）只用了它的
一小部分：

- 没装到任何 Vue app 上，`<router-view>` / `<router-link>` / 导航守卫都不用；
- 匹配已经有自己的 `router/match.ts`（Flutter 端同一份）；
- 真正用到的只有：history/hash 两种模式的地址读写与 `popstate` 监听、
  `currentRoute` 这个响应式源、懒加载页面组件、首次导航、窗口滚动复位。

为了这几件事还要绕一些弯：手动复刻 `install()` 里的首次 push、跳过
`START_LOCATION`、把 vue-router 的 route 对象抄成 fjs 的 `RouteLocation`。

## 2. 不做什么（Non-goals）

- **VDOM web（不开 enableVapor）不动**：那里有 `<router-view>`、按历史条目的
  KeepAlive、页面转场，用户代码也可能直接用 vue-router 的 API，继续用 vue-router。
- 不做导航守卫、命名视图、嵌套路由、`<router-link>`、`scrollBehavior` 配置项
  ——enableVapor 的路由表本来就是扁平的生成表。
- 不改 Flutter 路由，不改 `fjs/router` 的公共 API（`Router` / `RouteLocation` 类型不变）。

## 3. 用户可见的行为

页面代码不变：

```ts
import { useRouter, useRoute, onPageSettled } from 'fjs/router';
const router = useRouter();
router.push({ path: '/about', query: { from: 'home' } });
const route = useRoute(); // 本页的响应式 RouteLocation
```

- `history: 'hash'`（默认）与 `'history'` + `base` 两种模式照旧；地址栏、
  浏览器前进/后退、直接打开深链接与现在一致。
- 未匹配的路径重定向到 `initial`（除非路由表有 `/*`）；`initial !== '/'` 且表里
  没有 `/` 时，`/` 重定向到 `initial`——与现在 vue-router 表的行为一致。
- `push` / `replace` 的 Promise 在页面组件加载完、`currentRoute` 切换后 resolve；
  推同一个 fullPath 什么也不做。
- 窗口滚动：新页面回到顶部，后退/前进回到离开时的位置（与现在的 `scrollBehavior` 一致）。
- 空闲预加载（specs/143）、`router.preload()`、`onPageSettled` 照旧。
- enableVapor 页面里 `import { useRoute } from 'vue-router'` 已经在构建时告警（specs/167），保持不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web (enableVapor) |
|---|---|---|
| 行为 | 原生 Navigator，不变 | 新的 history 驱动，行为对齐现在的 vue-router 版本 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无新增 | 无新增（VDOM web 仍是 vue-router） |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（CLI 的 web enableVapor alias：`fjs/router` 指向新模块）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增单测覆盖：hash / history 两种模式的
   push / replace / back（popstate）/ 深链接首开 / 未匹配重定向 / 懒加载 / query 解析。
2. `examples/vapor-app` `fjs build --web --analyze`：产物里没有 `vue-router`，总量
   比 176.1 KB 小 ~25 KB。
3. `examples/vapor-app` web（`pnpm dev:web` 或静态预览）：首页 → about → 返回、
   首页 → 表单页 → 浏览器后退/前进、直接打开 `#/about`，页面与标题正确，pinia 状态保留。
4. demo / hello-fjs 的 VDOM web 构建产物里仍有 vue-router 且行为不变（`pnpm test` 里
   既有的 web 路由测试通过）。

## 7. 待澄清

- [x] 范围只限 enableVapor web（用户确认）；VDOM web 继续用 vue-router。
