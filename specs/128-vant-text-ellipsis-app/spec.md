# Spec: vant TextEllipsis 在 App 端截断

- **ID**: 128-vant-text-ellipsis-app
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

demo `vant-more` 页的 TextEllipsis（`rows` 默认 2、`expand-text="展开"`）：
web 截成两行并在末尾显示「…展开」；App 端整段全文显示，没有截断、没有「展开」。

**根因**：vant 靠浏览器 DOM 同步测量来算截断位置（`text-ellipsis/TextEllipsis.mjs`）：
1. `root.value.isConnected` —— fjs 元素没有这个属性，`cloneContainer` 第一行就返回，
   整个计算静默跳过；
2. `window.getComputedStyle(root)` 枚举全部样式拷到克隆 div 上 —— demo 的
   `dom-env.ts` shim 返回 `length: 0`，什么都拷不过去；数值一律加 `px`
   （`lineHeight: 1.6` → `"1.6px"`、`fontWeight: 400` → `"400px"`），`width` 取不到布局宽度；
3. `document.createElement('div')` + `document.body.appendChild` —— shim 没有；
4. 往克隆 div 写 `innerText` / `innerHTML` 后同步读 `offsetHeight`，二分查找能放下
   `rows + 0.5` 行的最长前缀 —— 需要"给定宽度与字体，多行排版后的高度"，App 端没有。

实现中又发现三处（都已纳入）：
5. 样式引擎按微任务批量计算，`onMounted` 时新节点还没有 computed style ——
   浏览器的 `getComputedStyle` 会先强制重算，shim 也要先 `flushPending()`；
6. 裸 `TextPainter` 不带 App 的 `DefaultTextStyle` / textScaler，测得比 `Text`
   窄约 2.5%，「展开」被挤到第三行；
7. 「展开」是段落里的 `<span @click>`，App 上段落片段是 `TextSpan` 不是 widget，
   点击没人接；且 vant 的文字是 span 的子片段，Flutter 只问最内层片段要识别器。

## 2. 不做什么

- 不在 fjs runtime 里伪造全局 `document` / `window`（specs/070 的决定）；vant 专用的
  DOM 表面继续放在 demo 的 `plugins/vant/dom-env.ts`（specs/073 的先例）。
- 不支持 `#action` 插槽的 HTML 测量（按其纯文本测）；不支持 `position="middle"` 以外的
  新能力，`start` / `middle` / `end` 走 vant 自己的算法即可。
- 不改 web。

## 3. 用户可见的行为

页面零改动：

```vue
<van-text-ellipsis :content="text" expand-text="展开" collapse-text="收起" />
```

App 端与 web 一致：截成 2 行、末尾「…展开」，点「展开」显示全文与「收起」。

## 4. 两端约定

| | Flutter | Web |
|---|---|---|
| 行为 | vant 算法 + shim 提供的测量 | 原生 DOM |
| 已知差异 | 截断点由 Flutter 排版决定，字体度量与浏览器不同时可能差一两个字 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及。新增 host 模块 `fjs.ui.measureText`（同步，走已有 `invokeHost`，
      与 `fjs.canvas.measureText` 同形），不动三张表。

## 6. 验收标准

1. `pnpm --filter @ufjs/runtime test`、`pnpm run typecheck`、`flutter test` 通过；新增：
   - runtime：`isConnected` 在挂入页面树后为 true、卸载后为 false；
   - Dart：`fjs.ui.measureText` 在窄宽度下行数/高度随文字增长；
   - Dart：段落里 `@click` 的片段（含其子片段）点击派发 tap。
2. iOS 模拟器 vant-more：TextEllipsis 两行 +「…展开」；点展开出全文 +「收起」。

## 7. 待澄清

无。
