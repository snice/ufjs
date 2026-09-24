# Tasks: 注册新作用域的样式表不再清空样式缓存

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认不涉及 op 协议 / natives / 事件类型；抓改前 op 帧基线（bench eager bundle `--hex`）

## 实现

- [x] T010 `seenScopes`：`addScope` 写入；`importSnapshot` 从链签名解析作用域写入：`packages/fjs-runtime/src/css/style.ts`
- [x] T011 `register()` 快路径（四个条件），注释写明成立理由：`packages/fjs-runtime/src/css/style.ts`

## 两端对齐

- [x] T020 Web：不涉及（浏览器 CSS），spec §4 已登记

## 测试

- [x] T030 `packages/fjs-runtime/test/css-scoped-register.test.ts`：快路径保留缓存且结果与整体失效相同（含 `:deep`）；五种必须整体失效的情形
- [x] T031 离线复现：注册新作用域表后 vant-form match miss 与不注册相同
- [x] T032 对拍：不注册时 op 流与基线逐字节相同；注册时逐节点解析后样式相同

## 文档

- [x] T040 `docs/vant-mount-perf.md`：分包 vs dev 的差异、实测
- [x] T041 `docs/performance.md`：一句指向

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对

## 验收记录（2026-09-24，Linux 容器 · PrimJS Release · fjsrun）

| spec §6 | 结果 |
|---|---|
| 1 typecheck / test + 新单测 | ✅ typecheck exit 0；runtime 748 / cli 391 / webview 36 / webgl 30。`css-scoped-register.test.ts` 8 条（快路径与整体失效逐元素相同含 `:deep`；已用作用域、`:root`、`@keyframes`、首条 structural、首条 `@media`、全局表、快照里出现过的作用域 → 仍整体失效）。去掉 `seenScopes` 检查 2 条失败（测试有效） |
| 2 离线复现 | ✅ 注册新作用域表后 vant-form match miss 86（修复前 234），同步段 45–50 ms 对不注册 45–56 ms |
| 3 对拍 | ✅ 不注册时 op 流与基线逐字节相同（bad788ae…）；注册 / 不注册逐节点解析后样式相同 |
| 4 真机复核 | ⏳ 交用户（`fjs run ios --profile`；先 `pnpm --filter @ufjs/cli run build`，构建输出应有 `style prewarm` 行） |
