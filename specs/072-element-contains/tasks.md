# Tasks: host element 补 DOM `contains()`

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张契约表不动（`ui/ops.ts`、`native-global.d.ts`、`element.ts` EventType 无改动）

## 实现

- [x] T010 在 `packages/fjs-runtime/src/vue/renderer.ts` 新增共享函数 `hostContains`（沿 `parentOf` 上溯，非元素/已卸载返回 false），带权衡注释
- [x] T011 在 `renderer.ts` 的 `nodeOps.createElement` / `createText` / `createComment` 与 `ensureOverlayHost` 里挂上 `contains`

## 两端对齐

- [x] T020 Web 侧无需实现：确认 `packages/fjs-runtime/src/web/index.ts` 走 runtime-dom，元素为真 DOM
- [x] T021 两端对拍：vant-form 点「乙」「选项二」，iOS 模拟器（`cd demo && fjs run ios`）与 Web（`pnpm --dir demo exec vite --port 5175`）一致

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/vue_contains.test.ts`：自身/后代 true，祖先/兄弟/null/非元素/已卸载 false
- [x] T031 同文件：DOM 事件处理器里 `e.target.contains(...)` 不抛，vant Checker 式 toggle 生效

## 文档

- [x] T040 `docs/ui-api.md`：DOM 形事件对象段补 `contains()`；「与浏览器的差别」补 `label-disabled` 差异
- [x] T041 `docs/custom-renderer.md` §2：抽 `ui/tree.ts` 时 `contains` 随迁
- [x] T042 `docs/roadmap.md`：无对应条目，跳过

## 验收

- [x] T050 `pnpm run typecheck`（hello-fjs 在 worktree 缺 gitignore 的生成 d.ts 而失败，与本改动无关；主仓同提交通过，其余包全绿）
- [x] T051 `pnpm test`
- [x] T052 spec.md 第 6 节逐条核对
