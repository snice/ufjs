# Spec: vapor 数字插入锚点按"追加"解析

- **ID**: 169-vapor-logical-anchor
- **状态**: done
- **日期**: 2026-10-01

## 1. 要解决什么

自研 vapor 运行时 `packages/fjs-runtime/src/vapor/host.ts` 的
`setInsertionState(parent, anchor)` 在 `anchor` 是数字（compiler-vapor 的
`appendIndex` 形式）时，立即按**原始宿主子节点下标**解析成
`be().childAt(p, anchor)`。而编译器给的是**逻辑下标**（模板里的 `<!>` 占位、
前面的动态块各算一个单元），前面同父的 v-if 已经插入了自己的锚点和分支节点后，
原始下标就偏前，后面的块被插到错误位置：

```vue
<view><text>T</text><text>{{ s }}</text><text v-if="show">H</text><text v-else>E</text>
<text>S{{ s }}</text><text>N</text><view v-for="(r, i) in rows" :key="i"><text>{{ r }}</text></view></view>
```

textContent 是 `T0HabS0N`，期望 `T0HS0Nab`。`examples/vapor-app` 上 web 和 iOS
都可见（v-for 行跑到 "store …" 那行上面）。

## 2. 不做什么（Non-goals）

- 不做 hydration（Vue 里数字下标只用于 hydration 定位起点，fjs 没有 SSR）。
- 不改 compiler-vapor 输出、不改 op 协议。

## 3. 用户可见的行为

Vue 3.6 runtime-vapor（rc.9 `insertionState.ts`）的语义：数字 = **追加**，
数值只是 hydration 起始单元下标。compiler-vapor 的 `processDynamicChildren`
只在动态块位于父节点**最后一个模板节点之后**时才发数字（否则把它换成 `<!>`
占位、发节点锚点），所以客户端渲染时数字锚点一律等价于 `null`（append）。
动态块按源码顺序创建，逐个追加即落在正确位置。

改后上例两端都渲染 `T0HS0Nab`，v-if 切换、v-for 增删后顺序不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 数字锚点 → append | 数字锚点 → append |
| 已知差异 | 无 | 无 |

修复在 host.ts（后端无关层），两端共享；`VaporBackend.childAt` 不再被用到，删掉。

## 5. 契约变更（宪法 II）

- [x] 都不涉及（只删掉 vapor 后端接缝里的 `childAt`，不属于 op/natives/事件契约）

## 6. 验收标准

1. 新增 web（happy-dom）与 Flutter 两组用例：v-if / v-for / 组件 在中间（`<!>` 占位）
   和在末尾（数字锚点）各种顺序下，挂载与更新后的文本顺序正确；Flutter 侧同时与
   VDOM 渲染器快照一致。
2. `pnpm --filter @ufjs/runtime test` 通过。
3. `pnpm --filter fjs-bench run vapor` 挂载耗时不回退（改动只会少一次 childAt）。

## 7. 待澄清

无
