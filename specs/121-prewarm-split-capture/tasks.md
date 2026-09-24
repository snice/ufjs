# Tasks: 分包构建的样式快照按分包产物抓取

- [x] T001 router `captureStyles({ routes, loadChunk })`、app 从 hook 传入
- [x] T002 `importSnapshot(input, label)` 告警带页面路径
- [x] T003 `captureStyleSnapshots(files, { routes, chunks })`
- [x] T004 `buildPages` 每页一个 VM 抓取，去掉临时单包
- [x] T010 单测：cli 多文件 + routes + chunk 加载；router 只抓指定路由并先加载 chunk；告警带路径
- [x] T011 离线回放 `build:pages` 产物（shared → index → 页面），快照全部被接受
- [x] T005 单包页面首次打开才执行：`definePageLoader` + 生成 `require()`（`project/pages.ts`、`router/flutter.ts`）
- [x] T006 分包 shared 入口先按 main.ts 的 import 顺序导入（`entryImportOrder`）
- [x] T012 单测：route table 生成、页面 loader 只跑一次、`entryImportOrder`；demo 单包/分包快照表顺序一致；hello-fjs / hello-js 两种构建冒烟
- [x] T020 文档：vant-mount-perf.md、toolchain.md
- [x] T030 `pnpm run typecheck`、`pnpm test`
- [ ] T040 真机复核（用户）
