# Spec: Vapor `:style` 对象去掉的键要从元素上摘掉

- **ID**: 198-vapor-style-key-removal
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

demo 开 `enableVapor: true` 后，`interaction/dnd`（拖拽排序）拖一块再松手：顺序文字正确
（`2 3 4 5 1 6 7 8 9`），但格子错位——被拖块停在抬起态（放大 + 阴影），其他块带着拖动期间的
`translate` 留在原地（iOS 模拟器 iPhone 17 Pro 复现，VDOM 模式正常）。

根因：`:style="grid.itemStyle(item, index)"` 在拖动结束时返回 `{}`，新对象里**没有**
`transform` / `boxShadow` / `opacity`。VDOM 的 `patchStyle(prev, next)` 会摘掉 prev 有、next
没有的键；Vapor 的 `host.ts` `setStyle` 只做「把 value 的键合并进元素已有记录」（为了让
fallthrough 等第二个写入者不被覆盖），**从不删键**，旧的 transform 就一直留着。
`setStyleHost` 的动态 props 路径（`helpers.ts` 的 `applyDynamicProps`）自己补了 `null`，
所以只有直接编译出来的 `:style` 绑定中招。

## 2. 不做什么（Non-goals）

- 不改 merge 语义：组件根的 `:style` 与 fallthrough 的 style 仍然互不覆盖。
- 不改 `setStyleHost`（动态 props 路径已自己清键）。
- 不动 Dart / op 协议。

## 3. 用户可见的行为

```vue
<view :style="on ? { transform: 'scale(2)', opacity: 0.5 } : {}" />
```

`on` 由真变假后，元素上的 `transform` / `opacity` 被摘掉，与 VDOM 一致。
静态 `style="color: red"` 与另一个写入者（fallthrough `:style`）写的键不受影响。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `setStyle` 在 `vapor/host.ts`，两端共用；摘键走 `be().patchStyle(host, current, merged)` | 同左 |
| 事件载荷 | 无 | 无 |
| 已知差异 | 无 | 无 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. 新增回归用例（web 与 Flutter 各一）：`:style` 从含 `transform` 的对象变成 `{}` 后，元素上
   `transform` 被摘掉；去掉修复必挂。
2. 同用例覆盖：fallthrough 写的 style 键、静态 style 键在绑定变化后保留。
3. `pnpm test`、`pnpm run typecheck` 通过。
4. iOS 模拟器 `demo`（`enableVapor: true`）拖拽排序：拖 1 到 5 的位置松手，格子全部回到网格位，
   顺序为 `2 3 4 5 1 6 7 8 9`；竖列表同样验证。

## 7. 待澄清

无
