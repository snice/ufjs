# Plan: Flutter 动态段页面解析 + overlay 宿主卸载 Fragment 里的 fixed 层

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 修的就是「App 端不一致」；Web 路径不变（`router/web.ts` 按模式匹配、DOM 里 fixed 本来就在原处） |
| II 边界即契约 | 否 | 纯 JS 运行时，op 协议不动 |
| III 同步单线程零序列化 | 否 | 无桥 |
| IV / V | 否 / 是 | 不涉及外观；错误日志 `no page registered` 保留 |
| VI 注释记录权衡 | 是 | `pageKey`、提升元素的逻辑兄弟链都写了「为什么」 |
| VII JS 能包就不要下 Dart | 是 | 零 Dart |
| VIII 文档 | 是 | `docs/routing.md`、`docs/overlay-host.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime（路由） | `packages/fjs-runtime/src/router/flutter.ts` | 加 `pageKey(location)`（匹配到的 `record.path`，未命中回退 `location.path`）；`mount()`、`replace()` 基页分支、`preloadPage()` 用它查 `pageComponent` / `pageLoaded` |
| JS runtime（renderer） | `packages/fjs-runtime/src/vue/host-ops.ts` | 加 `hoistedBeforeNode` / `logicalNextOfHoisted` / `physicalAnchor`；`nextSibling` 对提升元素按逻辑位置回答、对其前驱补上「坐在它前面的提升元素」；`insert` 的锚点若是提升元素则换成它原先坐在前面的那个节点 |
| 测试 | `packages/fjs-runtime/test/router-dynamic-page.test.ts`（新）、`packages/fjs-runtime/test/vue_overlay_level.test.ts` | 见 spec §6 #1 |
| 文档 | `docs/routing.md`、`docs/overlay-host.md` | 说明 |
| 示例 | `examples/app-store-clone`：`pages/app/[id].vue`、`components/AppRow.vue`、`CardExpand.vue` / `pages/index.vue` 的注释 | 详情页改回动态段；更正 217 里的错误解释 |

## 3. 方案

**路由**：注册表按模式登记是既定契约（生成的页面入口就这么调 `definePage`），所以改查找、不改登记。
`this.matcher.record(path)?.path` 同时给了模式，复用现有 `Matcher`，无新结构。

**卸载**：让 Vue 看到的兄弟链是「逻辑的」。被提升的元素在 `hoistedBefore` 里记着它原先坐在谁前面，
`nextSibling(X)` 先取物理的下一个 `N`，若有提升元素当初坐在 `N` 前面，就先返回它；对提升元素自己
调 `nextSibling` 则从它的逻辑位置往后答。这样 Vue 的 `removeFragment` 范围遍历会经过提升元素，
照常 `hostRemove`（走现有 `dropElement` 路径，宿主列表、样式引擎状态、模态遮罩登记都一并清理）。

**被否的备选**：
- 在 `remove` 里「删除结束锚点时顺带删它前面的提升元素」：分不出 Fragment 的起止锚点（都是空 text），
  会误伤相邻的 v-if 锚点旁的 fixed 元素（测试里专门有这一条）。
- 提升元素留在逻辑列表里、只在发 op 时翻译索引：更干净，但要重写 `insert` / `remove` / 索引换算，风险大。
- 示例里改用 `v-show` 常驻（217 的绕法）：绕开了现象但不是修复，别的使用者仍会踩。

## 4. 风险

1. `nextSibling` 在 Vue 的所有遍历里都会被调（插入锚点、`getNextHostNode`、Fragment 移除），语义变了；
   用全量 runtime 测试（1026）+ overlay / vant 相关用例兜底，并在模拟器上跑 Today 展开 / 收起。
2. 提升元素的 `hoistedBefore` 可能过期（那个兄弟已被移除）：`logicalNextOfHoisted` 在兄弟不再属于该父节点时返回 null，
   不返回悬空句柄。
3. 多个提升元素坐在同一个节点前面：按提升顺序排，遍历都会经过。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime exec vitest run test/router-dynamic-page.test.ts test/vue_overlay_level.test.ts
pnpm --filter @ufjs/runtime test && pnpm run typecheck && pnpm test
cd examples/app-store-clone && fjs run ios      # /app/:id 详情；v-if 卸载后 fjs eval 读宿主
```
