# Tasks: 220-flutter-dynamic-route-overlay

## 契约层

- [x] T001 确认契约零变更（纯 JS 运行时）

## 实现

- [x] T010 `router/flutter.ts`：`pageKey`，`mount` / `replace` / `preloadPage` 按模式查页面
- [x] T011 `host-ops.ts`：提升元素的逻辑兄弟链（`nextSibling`、`insert` 锚点）

## 两端对齐

- [x] T020 Web 路径不变（`router/web.ts` 本来按模式；DOM 里 fixed 不提升），无需改动
- [x] T021 iOS 模拟器：`/app/:id` 详情页挂载、返回；`v-if` 卸载后宿主空、页面可点可滚

## 测试

- [x] T030 `router-dynamic-page.test.ts`（先失败后通过）
- [x] T031 `vue_overlay_level.test.ts`：单根层 / v-show 后 v-if / Fragment 首中尾 / v-if 锚点不误伤
- [x] T032 全量 runtime 测试无回归

## 文档

- [x] T040 `docs/routing.md`、`docs/overlay-host.md`
- [x] T041 更正 217 tasks.md 里被证伪 / 未证实的结论

## 示例

- [x] T050 详情页改回 `pages/app/[id].vue`，更正 CardExpand / index.vue 的注释

## 验收

- [x] T060 `pnpm run typecheck`、`pnpm test`
- [x] T061 spec §6 逐条核对（见下表）
- [x] T062 spec 状态改 `done`

## 实现期发现

### 验收结果

| # | 项 | 结果 |
|---|---|---|
| 1 | 新增单测 | `router-dynamic-page.test.ts` 2 个：实现前 2 失败 → 实现后通过；`vue_overlay_level.test.ts` 新增 7 个（单根 / v-show / Fragment 首中尾 / v-if 锚点），Fragment 的 3 个实现前失败 |
| 2 | 全量 | runtime 1026 全过；typecheck 全 workspace 无错 |
| 3 | 模拟器 | `/app/chatly` 由 `app-id` 分包挂载，日志无 `no page registered`，返回正常；`CardExpand` 用 `v-if` 卸载（最初复现的形状）后 `fjs eval` 读 `fjs-overlay-host` 子节点为 `[]`，卡片完整、页面可滚动可点 |
| 4 | 文档 | 已同步 |

### 发现

1. **217 的结论有两处是错的 / 未证实**：「卸载 fixed 子树不会从宿主移除」不成立——JS 测试早就覆盖了单根 fixed 层的 `v-if` 卸载，
   真正的条件是**组件根是 Fragment**（`CardExpand.vue` 模板开头那条 HTML 注释在 dev 构建下让根变成 Fragment）。
   「opacity + 玻璃会弄坏绘制」很可能是泄漏的 hero 盖在卡片上的错觉，修复泄漏后 `v-if` 版本里卡片内容完整；该结论未被独立证实。
2. **我最初的复现没复现**：做了个最小页（单根 fixed 层 `v-if` 卸载）在模拟器上滚动正常，说明条件没找对；
   在真实形状（Today 里的 `CardExpand`）上复现后，用 `fjs eval` 列宿主子节点（`fjs-overlay-host#247 -> [179]`）
   + 给 `nodeOps.remove` 临时加日志，才看到卸载时 `remove` 只被调用了 3 个锚点/注释节点、从没有叫到 179。
3. 模拟器工具的「首击丢失」让「滑动没反应」的证据很弱，不能单独当证据；这次以 `fjs eval` 的宿主快照为准。
4. 动态路由页面在 App 上白屏也是真的、且与 Fragment 问题互不相关；最小用例 `router-dynamic-page.test.ts` 不需要模拟器。

### 未做

- `host-ops.ts` 里提升元素与逻辑列表的双重记账没有重构（spec §2）；`hoistedBefore` 在多个提升元素、
  兄弟被换掉等极端顺序下的遍历顺序与真实 DOM 可能不同，但遍历覆盖全部节点，对移除够用。
