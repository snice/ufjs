# 契约对照表：overlay 宿主（spec 069 弹层第二步）

日期：2026-09-18。结论先行：**不新增 op、不动三张契约表**（宪法 II），
采用「预留标签」方案。

## 方案

预留 fjs 标签 **`fjs-overlay-host`**：

| 侧 | 内容 | 文件 |
|----|------|------|
| JS | 运行时创建该标签的元素，用普通 `Create`/`Insert`/`SetStyle` op 挂到页面根下；弹层 hoist 的目标从「页面内 host 盒」（第一步）换成该元素 | `packages/fjs-runtime/src/vue/renderer.ts` |
| Dart | 新增标签适配器：`fjs-overlay-host` 的子树经 `OverlayPortal`（或等价 Overlay 机制）渲染进 MaterialApp 根 Overlay——悬浮于页面内容与宿主 chrome 之上，不随页面滚动 | `packages/flutter_fjs/lib/src/render/renderer.dart`（标签分派处） |
| 文档 | `docs/ui-api.md` 标签表登记；标注「运行时保留，页面不要手写」 | `docs/ui-api.md` |

## 为什么不是新 op

- 树形态信息（父子关系）已经由既有 `Create`/`Insert` op 完整表达；overlay
  宿主需要的只是 Dart 侧对**某个标签**换一种呈现容器，属于渲染策略，不是
  新的树操作。为渲染策略开协议位会让三张表背上永久的兼容负担。
- 旧宿主的降级路径是天然的：不认识 `fjs-overlay-host` 的宿主按既有规则
  兜底成 `view`（`renderer.dart` 头注释），行为精确退回第一步
  （页面内 host 盒）——无需版本协商。

## 行为保证与边界

1. 宿主盒本身 `position: absolute; inset: 0`，全屏、不随页面滚动。
2. 子树内的弹层/遮罩沿用普通元素语义：`display: none`（v-show）照常
   隐藏；点击命中走既有手势管道。
3. 多个弹层同时打开时，遮罩与弹层的上下关系由插入顺序决定（与 web DOM
   顺序一致）。
4. 页面销毁（keep-alive 卸载）时整棵子树随 `Remove` op 消失，overlay 条目
   随之释放——不引入跨页面生命周期的常驻条目。

## JS 侧保留位

`packages/fjs-runtime/src/tags.ts` 若有标签清单，登记 `fjs-overlay-host`
为运行时保留（页面手写该标签没有意义，但误写也只是得到一个空盒，不崩）。
