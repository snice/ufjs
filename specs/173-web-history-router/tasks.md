# Tasks: 173-web-history-router

- [x] T1 `router/web-preload.ts`，`router/web.ts` 改引用
- [x] T2 `router/web-history.ts`
- [x] T3 `router/web-vapor.ts`
- [x] T4 `app/web-vapor.ts` 换路由
- [x] T5 CLI alias（vue-plugin webAliases + vite.ts）
- [x] T6 单测：web-history-router；web-vapor-shell 适配；CLI alias
- [x] T7 typecheck + `pnpm test`
- [x] T8 vapor-app web 构建体积；浏览器实测；demo VDOM web 仍含 vue-router
- [x] T9 文档（web.md / routing.md / vue3.md 相关段落）

## 结果
- vapor-app `fjs build --web --analyze`：176.1 KB → 152.1 KB（gz 65.4 → 56.4 KB），产物无 vue-router
- demo VDOM web 仍含 vue-router（25.1 KB）
- 浏览器（vite dev）：首页 → about → 后退 / 前进、表单页 → 壳返回按钮、深链接 `#/about` 刷新、手改未匹配 hash 重定向到 `#/`；无控制台错误
- 顺带：`<defer>` 的 web 实现改从 `router/settled.ts` 取 onPageSettled（当前页 path 由打进包的路由注入），否则 vapor 包会经它拖进 vue-router
