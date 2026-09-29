# Spec: 每节点 Widget 层数压缩

- **ID**: 157-node-widget-slim
- **状态**: done
- **日期**: 2026-09-29

## 1. 要解决什么

specs/156 之后真机 flat-4050 显示帧 UI 线程 87.7 ms：build 29 + GC 31 + 纯布局 20 + 绘制 7。build 与 GC 都和
Widget / Element 数量成正比。一格（view.cell + text，两个节点）现在展开成 13 个 Element、7 个 RenderObject：

```
FjsShrinkCross [RO] → _FjsNodeView → ListenableBuilder → Padding [RO](margin) → Container
  → DecoratedBox [RO] → Padding [RO](0) → FjsFlex [RO] → FjsAdaptiveShrinkCross [RO]
  → _FjsNodeView → ListenableBuilder → Text → RichText [RO]
```

其中每个节点都有的 `_FjsNodeView` + `ListenableBuilder` 两层可以合一；`Container` 只是转手，且带 decoration 时
总会再包一层 `Padding`（留边框宽度，宽度为 0 也包）。

## 2. 不做什么（Non-goals）

- 不改渲染结果、不改 JS / op 协议；web 不涉及。
- 不合并 margin / 背景 / padding 成自定义 RenderObject（纯布局那 20 ms，另议）。

## 3. 用户可见的行为

渲染结果不变。可观察的是真机上屏：4050 显示帧的 build + GC 下降。

## 4. 做法

- A：`_FjsNodeView` 改成自己监听节点信号的 StatefulWidget，去掉 `ListenableBuilder`（每节点 −1 Element）。
- B：`decorateNode` 的装饰盒不经 `Container`，按 Container 的组装顺序直接建：边框宽度的 `Padding` 只在非零时包，
  尺寸用 `ConstrainedBox`（每个带装饰的节点 −2 Element、−1 RenderObject）。
- C：纯文本节点若能等价，直接建 `RichText`（视 text 适配器的实现决定，记入 §8）。

## 5. 契约变更（宪法 II）

无。

## 6. 验收标准

1. `flutter test` 全过；新增用例：一格 view.cell + text 的 Element 数从 13 降下来（钉住数字）。
2. 真机 timeline：4050 显示帧的 build / GC / 上屏前后对比。
3. 真机抽查 hello-fjs 页面无变样。

## 7. 待澄清

无。

## 8. 结果（2026-09-29，iPhone，profile）

一格 view.cell + text：13 Element / 7 RenderObject → **9 / 6**（`node_widget_count_test.dart` 钉住）。

hello-fjs 4050 页 VDOM，`frame-timeline.mjs` 录的一次（ms）：

| | specs/156 之后 | 本 spec |
|---|---:|---:|
| 显示帧（UI 线程） | 87.7 | 80.5 |
| 　build（去 GC） | 29.3 | 25.7 |
| 　GC | 31.1 | 28.2 |
| 　纯布局 | 20.4 | 20.0 |
| 隐藏帧（FINALIZE TREE） | 30.4（17.0） | 22.6（13.8） |

页面计数：显示上屏 182 ms（四次里三次；上屏按 vsync 取整，差一帧就是 16.7 ms）。

- A 做了：`_FjsNodeView` 自己监听节点信号（每节点 −1 Element）。
- B 做了：装饰盒不经 `Container`，零宽边框不包 `Padding`（每个带装饰的节点 −2 Element、−1 RenderObject）。
- C 没做：`Text` 会合并 `DefaultTextStyle`（MaterialApp 的默认字体等）、处理文字缩放与选中区域，直接建 `RichText`
  有改变文字外观的风险，收益只有每个文字节点 1 个 Element。
- 测试里 14 个文件按 `Container` 找节点盒，改为 `test/support/node_box.dart` 的 `nodeBoxes` / `nodeBoxColor`
  （找背景 `DecoratedBox`）；断言的尺寸 / 颜色不变。`flutter test` 552 条全过。
- 剩下的：build 26 + GC 28 + 纯布局 20，JS 约 88。
