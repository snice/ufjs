# Tasks: 142-vant-safe-area-top

- [x] 1. `demo/vite/vant.ts`：Notify 补丁（default slot 包 `<safe-area edges="top">`）
- [x] 2. `demo/vite/vant.ts`：ImagePreview renderClose 补丁（top-right 时包 safe-area，点击挂 wrapper）
- [x] 3. `fjs run ios` 验收：showNotify 文案在状态栏下；close 图标可点、预览关闭
- [x] 4. `pnpm --filter demo run typecheck` 通过
- [x] 5. `pnpm test` 通过（6 pass / 0 fail）
- [x] 6. `pnpm --filter demo run build:web` 成功
- [x] 7. docs/overlay-host.md：§5 顶部锚定组件让位模式 + 已知差异表"状态栏横条点击不达"
- [x] 8. docs/fjs-go.md：调试单项目优先 `fjs run ios/android` 的指引
