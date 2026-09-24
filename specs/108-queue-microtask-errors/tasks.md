# Tasks: queueMicrotask 兜底不再吞异常

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表零变更，不改 native

## 实现

- [x] T010 `packages/fjs-runtime/src/microtask.ts`：`installQueueMicrotask(target)`；同步类型校验；回调 try/catch；按 vm.cpp 格式经 `console.error` 上报

## 两端对齐

- [x] T020 Web 侧：浏览器原生 `queueMicrotask`，兜底不安装，确认 `packages/fjs-runtime/src/web/` 零改动
- [x] T021 两个引擎 flavor 对齐：日志前缀与 `packages/flutter_fjs/native/src/vm.cpp` 逐字一致

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/microtask.test.ts`（spec §6.1 六条）

## 文档

- [x] T040 `docs/toolchain.md`「引擎全局差异由 runtime 兜底」补充错误上报
- [x] T041 `docs/roadmap.md` 登记 specs/108

## 验收

- [x] T050 `pnpm run typecheck`（demo / hello-fjs 既有 TS2339 除外）——6 个包 Done
- [x] T051 `pnpm test`——runtime 685（原 678 + 新增 7）、cli 351、webview 36、webgl 30 全过
- [x] T052 spec.md 第 6 节逐条核对；真机项标为需用户验证
