# Plan: 153-vdom-clone

## 改动的层

| 层 | 文件 | 改什么 |
|---|---|---|
| 编译（CLI） | `packages/fjs/src/template/clone-blocks.ts`（新） | nodeTransform：ROOT 退出时找最大合格子树，原地改写 VNodeCall，hoist `fjsTemplate(节点表)` |
| 编译（CLI） | `packages/fjs/src/bundler/vue-plugin.ts` | `templateCompilerOptions` 在非 web 时挂上该 transform |
| 运行时 | `packages/fjs-runtime/src/vue/template-block.ts`（新） | `fjsTemplate()`：Teleport 协议的 vnode 类型（克隆 / 逐节点兜底 / 更新 / 移动 / 卸载） |
| 运行时 | `packages/fjs-runtime/src/vue/vue-shim.ts` | 导出 `fjsTemplate` |
| 测试 | `packages/fjs/test/…`、`packages/fjs-runtime/test/…` | 改写产物；vnode 类型的挂载 / 更新 / 卸载 |
| 文档 | `docs/architecture.md`、`docs/performance.md` | 克隆一节补 VDOM |

## 编译改写细节

- 助手导入：`registerRuntimeHelpers({ [FJS_TEMPLATE]: 'fjsTemplate' })`（compiler-core 的全局表，产物
  `import { fjsTemplate as _fjsTemplate } from "vue"`）。需确认与 compiler-sfc 用的是同一份 compiler-core。
- 节点表：`[parent, tag, classes|null, text|null(动态)]` 的先序数组，JSON 字面量。
- 动态文字表达式直接取子节点 VNodeCall 的 `children`（插值 / 复合表达式，transformExpression 已加过前缀）。
- `key`：静态属性 → 字符串字面量；`:key` → 已处理的表达式。
- 助手：改成 `isComponent = true` 后要登记 `CREATE_VNODE` / `CREATE_BLOCK`。

## 运行时细节

- `process(n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds)`：
  - `n2.target` 存动态文字所在的 host 数组（Teleport 字段，cloneVNode 会带上）。
  - 兜底路径顺序同 mountElement：create → 文字 / 子元素 → setScopeId → class → insert。
- `remove(vnode, …, doRemove)`：`doRemove` 才删根。
- `move`：`nodeOps.insert(el, container, anchor)`。

## 顺序

1. 运行时类型 + 单测（手写 vnode 驱动）
2. 编译 transform + 单测
3. bench 构建、对拍、计时
4. demo / hello-fjs verify、bench:mount
5. 文档、spec §8
