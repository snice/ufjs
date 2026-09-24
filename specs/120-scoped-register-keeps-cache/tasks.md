# Tasks: 注册新作用域的样式表不再清空样式缓存

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [ ] T001 确认不涉及 op 协议 / natives / 事件类型；抓改前 op 帧基线（bench eager bundle `--hex`）

## 实现

- [ ] T010 `seenScopes`：`addScope` 写入；`importSnapshot` 从链签名解析作用域写入：`packages/fjs-runtime/src/css/style.ts`
- [ ] T011 `register()` 快路径（四个条件），注释写明成立理由：`packages/fjs-runtime/src/css/style.ts`

## 两端对齐

- [ ] T020 Web：不涉及（浏览器 CSS），spec §4 已登记

## 测试

- [ ] T030 `packages/fjs-runtime/test/css-scoped-register.test.ts`：快路径保留缓存且结果与整体失效相同（含 `:deep`）；五种必须整体失效的情形
- [ ] T031 离线复现：注册新作用域表后 vant-form match miss 与不注册相同
- [ ] T032 对拍：不注册时 op 流与基线逐字节相同；注册时逐节点解析后样式相同

## 文档

- [ ] T040 `docs/vant-mount-perf.md`：分包 vs dev 的差异、实测
- [ ] T041 `docs/performance.md`：一句指向

## 验收

- [ ] T050 `pnpm run typecheck`
- [ ] T051 `pnpm test`
- [ ] T052 spec.md 第 6 节逐条核对
