# Tasks: iOS/macOS 引擎切换后仍运行旧引擎

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表与 C ABI 零变更

## 实现

- [x] T010 ~~Android 同步任务~~——用户确认 Android 无问题，已撤回（见 spec §1）
- [x] T011 `packages/flutter_fjs/bin/engine.dart`：递归清理 Xcode 缓存目录；戳记 v2

## 两端对齐

- [x] T020 不涉及页面能力；`packages/fjs-runtime/src/web/`、`packages/flutter_fjs/lib/src/` 零改动
- [x] T021 iOS 与 macOS 两种构建目录布局都覆盖

## 测试

- [x] T030 ~~Gradle 同步切换用例~~——随 T010 撤回；原有 7 项 flavor 解析用例仍通过
- [x] T031 `tool/test/xcode_cache_paths_check.mjs`：模拟 Flutter iOS / macOS 构建目录验证清理规则

## 文档

- [x] T040 `docs/toolchain.md` JS 引擎切换一节
- [x] T041 `docs/roadmap.md` 登记 specs/112

## 验收

- [x] T050 `pnpm run typecheck`（demo / hello-fjs 既有 TS2339 除外）——6 个包 Done
- [x] T051 `pnpm test`——cli 351、runtime 685、webview 36、webgl 30、hooks 6 全过
- [x] T052 spec.md 第 6 节逐条核对；真机项标为需用户验证
