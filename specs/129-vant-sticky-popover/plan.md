# Plan: 129-vant-sticky-popover

## 改动层

1. **runtime · ui/element.ts**
   - `setParentResolver`（同 `setOffsetParentResolver` 的注入方式）；`parentNode` /
     `parentElement` / `nodeType` / `tagName` 进共享描述符。
   - `__fjsDispatchEvent`：事件号 1 时沿父链调用祖先的 handler / DOM 监听；派发期间
     暴露 `currentDispatch()`（被点中的 id + `stopped` 标志）。
2. **runtime · vue/renderer.ts**
   - 注入 parent resolver（`parentOf`，页面根返回 `pageRoots` 里的根）。
   - `asDomEvent`：`target` 取派发起点、`stopPropagation()` 置标志。
   - `createText` / `createComment` 的节点 `nodeType` 覆盖为 3 / 8（Vue teleport 的
     `updateCssVars` 按 nodeType 1 调 setAttribute）。
3. **demo · plugins/vant/dom-env.ts**：`getComputedStyle(scroll-view).overflowY` → `scroll`。
4. **demo**：`pages/vant-float.vue`、`plugins/vant.ts` 注册、首页入口。
5. **docs/ui-api.md**。

## 顺序

runtime + 测试 → shim → 模拟器验证 Popover / Sticky（fixed 定位若有偏差再定位）→ 文档。

## 实现中追加

- renderer `querySelector('body' | 'html')` → 最近页面根的 overlay 宿主（Teleport to body）。
- element：`nodeName`、`setAttribute` / `removeAttribute`（注入 renderer 的 patchProp）、
  `scrollTop` / `scrollLeft`（记录 scroll 事件偏移，可写不滚）、`clientTop` / `clientLeft`。
- dom-env：全局 `Element` / `HTMLElement`（`Symbol.hasInstance` 认 fjs 元素），document 盒子补
  `nodeName` / `ownerDocument` / `getBoundingClientRect` / 空监听。
- Dart overlay_host_adapter：子节点按 z-index 稳定排序（复用 flex.dart 的 `zIndexOf`）。
- Dart decoration：overflow 裁剪时阴影画在 ClipRRect 外层；css parser：`overflow` 简写同时写长写。
- 箭头：parser `[name]` / `[name<op>v]`（只放行 class / data-* / aria-* / role / tabindex）；
  StyleEngine.setAttribute + attrNames（只有被选择器用到的属性名进 chain key、触发子树重算）；
  renderer 的 inert 属性同时报给引擎（仍不过桥）；resolveCurrentColor 用于元素自身；
  foldAbsoluteCalc 支持乘除一个数、对所有值执行，并修掉百分比项多乘 100 的旧 bug；
  Dart：border-box 尺寸下限（decoration + positionedChild）、单边颜色沿用 border-width。
- text/comment 节点的 nodeType 覆盖为 3/8 **未做**：Vue 只在 teleport + useCssVars 时按 nodeType
  调 setAttribute，元素现在有 setAttribute，不会抛错。
