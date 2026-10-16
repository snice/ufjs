# Spec: Flutter 动态段页面解析 + overlay 宿主卸载 Fragment 里的 fixed 层

- **ID**: 220-flutter-dynamic-route-overlay
- **状态**: done
- **日期**: 2026-10-16
- **来源**: specs/217-app-store-clone 的 iOS 模拟器验收（tasks.md「iOS 模拟器验收」6 个问题里的第 2、4 条）。
  **实现顺序说明**：这次是先在模拟器上查根因、再补的 spec（需求来自 217 的发现，而不是一句话需求），
  所以本文档是调查结论的记录，不是调查前的假设。

## 1. 要解决什么

两个 Flutter 端（App）才有的缺陷，Web 都正常：

1. **动态段页面白屏**。`src/pages/user/[id].vue` 在 App 上 push `/user/7` 后白屏，日志
   `[fjs-router] no page registered for /user/7 (chunk "user-id" evaluated without calling definePage …)`。
   docs/routing.md 写了支持动态段。
2. **组件卸载后 fixed 层留在 overlay 宿主里**。全屏的 fixed 层（故事页、半屏弹层）被 `v-if` 卸载后，
   画面上还留着它，并且摸不到下面的页面（点击、滑动、返回手势全被吞）。

## 2. 不做什么（Non-goals）

- 不动 Dart 侧、不动 op 协议 / natives / 事件表：两个问题的根因都在 JS 运行时。
- 不重构 `host-ops.ts` 的 `childrenOf` / `parentOf` 双列表模型（把提升元素留在逻辑列表里是更干净的做法，
  但改动面太大）；只让「Vue 看到的兄弟链」感知提升元素。
- 217 里对「卡片 opacity + 玻璃」的猜测**不在本 spec 验证范围**：见 §4 的更正。

## 3. 用户可见的行为

### 3.1 动态段页面

```
src/pages/user/[id].vue   →   router.push('/user/7')   →   页面挂载，route.params.id === '7'
```

`/user/7` 与 `/user/8` 是同一份页面代码、同一个分包，只加载一次。

### 3.2 卸载 fixed 层

```vue
<Sheet v-if="open" />    <!-- Sheet 的根是 position: fixed 的层，或根是 Fragment 且含 fixed 子节点 -->
```

`open` 置 false 后，层从宿主里移除，页面立刻可点、可滚、可返回。含「模板开头有注释」的组件
（dev 构建里根是 Fragment）和多根组件。

## 4. 调查结论（根因）

1. **动态段页面**：页面 chunk 末尾调 `definePage('/user/:id', comp)`，登记在**模式**下；
   `router/flutter.ts` 的 `mount()` / `replace()` / `preloadPage()` 用 `location.path`（**具体路径**
   `/user/7`）查 `pageComponent`，永远找不到。Web 路由用 vue-router 按模式匹配，所以没事。
2. **卸载泄漏**：不是「卸载 fixed 子树不会从宿主移除」（我在 217 里的结论，**错了**）。真正的条件是
   组件根是 **Fragment**。Vue 移除 Fragment 的做法是从起始锚点沿 `nextSibling` 走到结束锚点，
   对途经节点逐个 `remove`；被提升的 fixed 元素已不在父节点的子列表里，**走不到**，永远不会被
   `remove`。217 的 `CardExpand.vue` 模板开头有一条 HTML 注释，dev 构建下根就是 Fragment。
   单根 fixed 元素 / 元素内部含 fixed 后代的卸载一直是对的（已有测试覆盖）。
3. **217 的更正**：217 记录的 3 个结论里，「卸载不移除」被本 spec 重新归因（见上）；
   「对含玻璃子树做 opacity 过渡会弄坏绘制」很可能是同一个泄漏层盖在卡片上造成的错觉（泄漏的
   hero 恰好盖住卡片，看起来像卡片只剩渐变）——修好泄漏后，`v-if` 版本里卡片内容完整。该结论
   **没有被独立证实**，已在 217 的文档里降级为「未验证」。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及。

文档（宪法 VIII）：`docs/routing.md`（动态段两端一致）、`docs/overlay-host.md`（Fragment 卸载）。

## 6. 验收标准

1. 新增单测先失败后通过：
   - `test/router-dynamic-page.test.ts`：模式下登记的页面能为具体路径挂载；单 bundle 的 loader 同理；
     `/x/9` 与 `/x/10` 只加载一次；
   - `test/vue_overlay_level.test.ts`：根是 Fragment、fixed 层在首 / 中 / 尾，卸载后层被 `remove`；
     `v-show` 先隐藏再 `v-if` 卸载；`v-if` 锚点相邻的 fixed 元素**不被误伤**。
2. `pnpm --filter @ufjs/runtime test`、`pnpm run typecheck`、`pnpm test` 全过，既有 overlay / 路由用例无回归。
3. iOS 模拟器：
   - 示例里把详情页改回 `pages/app/[id].vue`（`/app/:id`），点列表行进入详情、返回正常；
   - `CardExpand` 用 `v-if` 卸载（最初复现的形状）后宿主里无残留（`fjs eval` 读宿主子节点为空），
     页面可点、可滚。
4. 文档同步。

## 7. 待澄清

无。
