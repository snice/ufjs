# Tasks: 未处理的 Promise 拒绝要打日志

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表与 C ABI 导出零变更；`engine.h` 门面新增内部接口（两个 flavor）

## 实现

- [x] T010 `packages/flutter_fjs/native/src/engine.h`：`RejectionState` / `track_rejections` / `take_unhandled_rejection` / `clear_rejections`
- [x] T011 `packages/flutter_fjs/native/src/fjs_internal.h`：`FJSVM::rejections`
- [x] T012 `packages/flutter_fjs/native/src/vm.cpp`：创建时注册、pump 后报告、销毁前清理

## 两端对齐

- [x] T020 Web 侧：浏览器原生报告，`packages/fjs-runtime/src/web/` 零改动
- [x] T021 两个引擎 flavor 前缀与报告时机一致

## 测试

- [x] T030 `packages/flutter_fjs/native/test/main.cpp`：spec §6.1 六条
- [x] T031 primjs、quickjs 两个 flavor 桌面构建 + `fjs-test` ALL PASS
- [x] T032 回退 `vm.cpp` 改动，确认「应报」用例失败

## 文档

- [x] T040 `docs/toolchain.md` 引擎差异一节
- [x] T041 `docs/roadmap.md` 勾掉 rejection tracker 待办、登记 111（注明预编译产物待重建）

## 验收

- [x] T050 `pnpm run typecheck`（demo / hello-fjs 既有 TS2339 除外）——6 个包 Done
- [x] T051 `pnpm test`——cli 351、runtime 685、webview 36、webgl 30、hooks 6 全过
- [x] T052 spec.md 第 6 节逐条核对；预编译产物重建与真机项标为需用户执行
