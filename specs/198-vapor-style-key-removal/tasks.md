# Tasks: 198-vapor-style-key-removal

## 契约层
- [x] 1. 确认不涉及三张表

## 实现
- [x] 2. `packages/fjs-runtime/src/vapor/host.ts`：`setStyle` 摘掉上次绑定写过、本次没有的键，补注释

## 两端对齐
- [x] 3. 确认 web / Flutter 共用 `host.ts`，`be().patchStyle` 两端都收 prev/next

## 测试
- [x] 4. `vapor-helpers-web.test.ts`：`:style` 变 `{}` 后键被摘；fallthrough / 静态键保留
- [x] 5. `vapor-helpers-flutter.test.ts`：同上（Flutter 后端）

## 文档
- [x] 6. docs/vapor-contract.md 无 style 语义段落，无需改

## 验收
- [x] 7. 回归用例去掉修复必挂
- [x] 8. `pnpm run typecheck`、`pnpm test`
- [x] 9. iOS 模拟器拖拽排序复测（格子 + 竖列表）
- [x] 10. spec 第 6 节逐条核对，状态改 done
