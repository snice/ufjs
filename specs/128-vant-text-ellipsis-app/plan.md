# Plan: vant TextEllipsis 在 App 端截断

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 只 App 缺；web 原生 |
| II 边界即契约 | 否 | 新 host 模块走 `invokeHost`，三张表不变 |
| III 同步单线程零序列化 | 是 | 测量同步（同 `fjs.canvas.measureText` / `fjs.ui.rect`），参数一个 JSON 字符串（v1 ABI 只过标量） |
| IV | 否 | — |
| V 静默失效是 bug | 是 | 本 bug 就是 `isConnected` 缺失导致的静默跳过；补测试 |
| VI 注释记录权衡 | 是 | dom-env 写清每个 vant 读点 |
| VII JS 能包就不要下 Dart | 部分 | 截断算法、测量 div 全在 JS（vant + demo shim）；只有"排版后高度"必须 Dart |
| VIII 文档 | 是 | `docs/ui-api.md` element DOM 表面补 `isConnected` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/geometry.dart` | 注册 `fjs.ui.measureText(json, text) -> "[w,h,lines]"`，TextPainter 排版 |
| JS runtime | `packages/fjs-runtime/src/ui/geometry.ts` | `measureTextBlock(style, text)` 封装 |
| JS runtime | `packages/fjs-runtime/src/ui/element.ts` | `isConnected` getter + `setConnectedResolver` |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | 注入 resolver：沿 `parentOf` 走到 `pageRoots` |
| JS runtime | `packages/fjs-runtime/src/vue/index.ts` | 导出 `measureTextBlock`（dom-env 经 `__FJS_SHARED['fjs/vue']` 取） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/text.dart` + `node/node_adapters.dart` | 段落片段 `@tap/@click` → `TapGestureRecognizer`，子片段继承；`buildText` 接 `dispatch` |
| demo | `demo/src/main.ts` | 参照 hello-fjs 加 `app.config.errorHandler`（生命周期里抛的错不再被 Vue 静默吞掉） |
| demo | `demo/src/plugins/vant/dom-env.ts` | `getComputedStyle` 可枚举、单位正确、`width` 取布局；`document.createElement` 测量盒；`body.appendChild/removeChild` |
| 测试 | runtime + flutter_fjs | 见 spec §6 |
| 文档 | `docs/ui-api.md` | `isConnected` |

## 3. 方案

测量盒是纯 JS 对象（不进镜像树），`offsetHeight` = `measureTextBlock` 高度 + 上下 padding，
宽度取克隆来的 `width`（= 原元素布局宽度减左右 padding，浏览器 computed width 语义）。
`innerHTML` 写入按纯文本（去标签）处理——vant 追加的是 `expandText` 文字。

否掉：runtime 里做全局 DOM —— 违反 specs/070；把 TextEllipsis 换成 fjs 自己的组件 ——
页面零改动是目标。

测量合并 `DefaultTextStyle.of(ctx)` 与 `MediaQuery.textScalerOf(ctx)`（ctx 取任一已挂载的页面根），
与 `Text` 的渲染一致；`getComputedStyle` 先 `styleEngine.flushPending()`，枚举用 Proxy 的 `has` + `get`
（`Array.prototype.slice` 先问 HasProperty）。

## 4. 风险

- 挂载时页面尚未布局（路由切换中）则 `width` 为 0：此时让测量返回"放得下"，不截断，
  并在首次布局后派一次 window `resize`（vant 的 `windowWidth` 由它驱动）重算。
- Dart 排版与最终渲染用同一组 TextStyle 参数，否则截断点和显示不一致。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime test && pnpm run typecheck
cd packages/flutter_fjs && flutter test
# 模拟器 vant-more
```
