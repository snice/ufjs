# Spec: flex 容器免 LayoutBuilder 的快路径

- **ID**: 156-flex-no-layoutbuilder
- **状态**: done
- **日期**: 2026-09-29

## 1. 要解决什么

specs/154 的真机 timeline：flat-4050 显示那一帧 UI 线程 99.6 ms，其中 LAYOUT 89 ms = 布局期 build 30 + GC 35 +
纯布局 24。原因是 `render/flex.dart` `buildFlex` 把每个 flex 容器的子节点放在 `LayoutBuilder` 里建——一格一个
回调、一格一套闭包与 Element，整棵子树推迟到布局阶段才建。

LayoutBuilder 拿约束做四件事：交叉轴 stretch 在无界时退成 start（column）/ 两遍测量（row）、主轴百分比与
basis / grow 的换算、百分比 gap、主轴 auto margin。绝大多数盒子一件都用不上。

## 2. 不做什么（Non-goals）

- 不改 CSS 语义、不改 JS / op 协议；web 不涉及。
- 用得上约束的盒子（任一子节点有主轴百分比 / 百分比 padding / flex-basis / flex-grow / 主轴 auto margin /
  交叉轴尺寸或 inline 盒，百分比 gap，`align-self`，横向 stretch，wrap，滚动容器的 culling flex，page 根的
  growChildren）照旧走 LayoutBuilder。

## 3. 用户可见的行为

渲染结果不变。可观察的是真机上屏：

```text
iPhone，fjs run ios --profile，hello-fjs 4050 页 VDOM 显示
  上屏 198–215 ms → 更低；timeline 里显示帧的 LAYOUT 89 ms → 更低、BUILD 不再在 LAYOUT 里
```

## 4. 做法

快路径（资格见 §2 的反面）直接返回 `FjsFlex`，不包 LayoutBuilder：

- 交叉轴对齐不是 stretch：结果本就与约束无关，直接建。
- column + stretch（默认）：原来按交叉轴有无界选 stretch / start，子节点在 start 时包 `FjsShrinkCross`。现在
  `FjsFlex(startWhenUnbounded: true)`，`RenderFjsFlex` 在 layout 时看约束决定；子节点包「自适应」的 shrink 标记，
  只在父 flex 当次退成 start 时才算数（`_shrinkToFit` 否则当它不存在）——两种情形都与原来逐项等价。
- `overflow` 裁剪作用域（`FjsClipScope`）改在 `createRenderObject` / `updateRenderObject` 里读。

## 5. 契约变更（宪法 II）

无。

## 6. 验收标准

1. `flutter test` 通过；新增用例：快路径与 LayoutBuilder 路径在有界 / 无界交叉轴、嵌套 shrink-to-fit 下的
   布局尺寸一致。
2. hello-fjs / demo 在模拟器上逐页截图与改前一致（抽查 flex / vant 页）。
3. 真机 timeline：4050 显示帧的 LAYOUT 与上屏前后对比。

## 7. 待澄清

无。

## 8. 结果（2026-09-29，iPhone，profile，含 specs/155）

hello-fjs 4050 页 VDOM 显示，`frame-timeline.mjs` 录的那一次（ms）：

| | 改前（specs/154） | 改后 |
|---|---:|---:|
| JS（指针事件） | 94.5 | 79.1 |
| 显示帧（UI 线程） | 99.6 | 87.7 |
| 　BUILD 次数 | 2060 | 4 |
| 　BUILD（含其中的 GC） | 60.0 | 51.9 |
| 　LAYOUT | 89.2 | 80.7 |
| 　GC | 36.1 | 31.1 |
| 光栅化 | 3.9 | 3.8 |

页面计数：VDOM 显示 JS 77.5–89.3 ms、上屏 181–199 ms（改前 84–116 / 198–232）；隐藏 37–52 ms。

- LayoutBuilder 回调 2060 → 4：格子树仍在上层一个 LayoutBuilder（页面容器）的回调里建，build 仍落在 LAYOUT 里，
  省下的是每个盒子一个 Element + 闭包——帧 −12 ms、GC −5 ms。
- 剩下的大头是 GC 31 ms：分配量来自每个节点展开出的 Widget 串（decoration / padding / 文字等），下一步是数清并压缩
  每节点的 Widget 层数（specs/154 §8 第 2 项）。
- `flutter test` 545 条全过（大量 vant 布局用例走快路径）；`flex_direct_path_test.dart` 6 条逐节点对拍，变异检验
  （标记恒生效）能抓到。
