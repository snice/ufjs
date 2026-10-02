# Plan: 178-vapor-web-page-transition

1. `router/web-history.ts`：`CurrentPage` 加 `kind`（`initial | push | replace | pop`），由 navigate 写入。
2. `app/web-vapor.ts`：
   - 页面元素改用 `fjs-page-entry`（base-css 的转场与布局规则写在它上面），宿主仍是 `fjs-page-host`；
   - 切页时算 NavKind（replace 且两端都是 tab → `tab`），`resolveTransition(options.transition, nav)`；
     宿主写 `data-nav`（无动画时 `none`）；
   - 有动画：旧页 `createTransitionHooks({ name }).leave` 结束后 `display: none`，新页先显示再 `enter`；
     `beginPageTransition` / `markPageSettled`（enter 结束或无动画时立即）。
3. 单测改 `fjs-page` → `fjs-page-entry`；新增转场测试。
4. 浏览器 true / false 对比；iOS 两种模式 `transition: 'fjs-fade'`。
