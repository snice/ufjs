# Tasks: 199-vdom-mounted-after-attach

## 契约层
- [x] 1. 确认不涉及三张表；`VdomMountContext.afterMount` 为 JS 内部接口

## 实现
- [x] 2. `vapor/vdom-context.ts`：`createMountHold()` + `VdomMountContext.afterMount`
- [x] 3. `vapor/runtime.ts`：`createComponent` 的 interop 调用处提供 `afterMount`（伪实例进 `pendingMounted`，父已连接时不 hold）
- [x] 4. `vapor/backend-flutter-interop.ts`：首次渲染走 `rendererInternals.p` + hold，放行后 no-op render 冲刷
- [x] 5. 微任务兜底放行

## 两端对齐
- [x] 6. `vapor/web-interop.ts`：`createRenderer({ ...nodeOps, patchProp })` 的 `render` + `internals`，同样接 hold
- [x] 7. 两端行为对拍（同一组用例）

## 测试
- [x] 8. 已写的两条失败用例变绿（去掉修复必挂）
- [x] 9. 边界用例：父已连接不 hold、hold 期间卸载、放行后 `onUpdated`、async setup

## 文档
- [x] 10. `docs/vapor-contract.md`：VDOM 互操作 mounted 时机

## 验收
- [x] 11. `pnpm run typecheck`、`pnpm test`
- [x] 12. iOS 模拟器 vant: more TextEllipsis 复测（截断、展开、收起）
- [x] 13. spec §6 逐条核对，状态改 done
