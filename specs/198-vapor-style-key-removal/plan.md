# Plan: Vapor `:style` 去键

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 改在两端共用的 `vapor/host.ts`；`vapor-helpers-web.test.ts` 与 `vapor-helpers-flutter.test.ts` 各一条用例 |
| II | 否 | 不碰三张表 |
| III–V | 否（V：本改动正是修一个静默失效） | — |
| VI 注释记录权衡 | 是 | `setStyle` 注释写明为什么按「本绑定上一次写过的键」摘，而不是 prev/next 全量替换 |
| VII | 否 | 纯 JS |
| VIII | 否 | 无对外契约变化；`docs/vapor-contract.md` 若有 style 语义段落则补一句 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/vapor/host.ts`（`setStyle`，约 721 行） | 每个 host 记「本绑定上一次写过的键」，下次写入时 prev 有而 value 没有的键从 merged 里删 |
| 测试 | `packages/fjs-runtime/test/vapor-helpers-web.test.ts`、`vapor-helpers-flutter.test.ts` | 回归用例 |

## 3. 方案

`styleRecords`（host → 已应用的合并结果）不动。新增 `boundStyleKeys`（host → 上次 `setStyle` 的键集合）：
`setStyle` 先删掉「上次有、这次没有」的键，再按原逻辑合并本次值。只摘自己写过的键，所以 fallthrough
/ 静态 style / `show` 写的键不受影响。

被否掉：
- **setStyle 改成整表替换（prev=current、next=value）**：会抹掉 fallthrough 与 `show` 的键，是 specs/170 合并语义要避免的。
- **编译器在 `{}` 时发 null 键**：编译器看不到运行期对象的键，做不到。
- **在 `itemStyle` 里手写 `transform: ''`**：页面绕过，框架 bug 还在。

## 4. 风险

- 记录的是键集合而非对象引用（用户可能就地改对象）；每次 `setStyle` 多一次 `Object.keys`。
- 同一个 host 若有两处直接 `setStyle`（目前编译器每元素只发一处），后者会摘前者的键；测试里把这点钉死。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime exec vitest run test/vapor-helpers-web.test.ts test/vapor-helpers-flutter.test.ts
pnpm run typecheck && pnpm test
# iOS 模拟器：demo → 交互演示 → 拖拽排序，拖 1 到 5 松手
```
