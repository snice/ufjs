# Spec: 真机上屏链路拆解（JS 之后的约 120 ms）

- **ID**: 154-frame-timeline
- **状态**: done（阶段 0：测量；优化另开 spec）
- **日期**: 2026-09-29

## 1. 要解决什么

specs/153 之后，真机（iPhone，`fjs run ios --profile`）flat-4050 VDOM 显示：JS 92 ms，点击 → 上屏 215 ms。
`applyFrame`（镜像树还原）在 JS 的 uiOps 调用里同步跑，已算进 JS 的「过桥」3.9 ms——剩下的约 120 ms 发生在
JS 之后：Flutter 的 build / layout / paint、raster 线程光栅化、等 vsync。现在它比 JS 本身还大，但没有拆过。

## 2. 不做什么（Non-goals）

- 本 spec 先量后改：阶段 0 只交付测量工具与拆解结果；优化项按结果另列（小的在本 spec 内做，大的另开 spec）。
- 不动 JS 侧（文字写入另开 specs/155）。

## 3. 用户可见的行为

阶段 0 无行为变化。新增一个开发工具：

```text
node packages/flutter_fjs/tool/frame-timeline.mjs <VM service URL> [秒数]
  → 录制期间 UI / raster 线程上各事件的总耗时与最长一次（Build / Layout / Paint / Raster …），
    以及 fjs 自己打的 applyFrame / widget 建树区间
```

## 4. 两端约定（宪法 I）

不涉及：Flutter 端的测量与（后续）渲染优化。

## 5. 契约变更（宪法 II）

- [ ] op 协议
- [ ] natives 表
- [ ] 事件类型

## 6. 验收标准

1. `frame-timeline.mjs` 连上真机 profile 进程，录一次 4050 显示，输出 UI / raster 线程的分项耗时，
   分项合计与页面的「上屏 − JS」对得上（± 一帧）。
2. 结果写进本 spec §8 与 `docs/performance.md`，列出可优化项与各自的估计收益。
3. 若在本 spec 内做了优化：`flutter test` 通过，真机 4050 上屏数字给出前后对比。

## 7. 待澄清

无。

## 8. 结果（2026-09-29，iPhone，profile）

`frame-timeline.mjs` 录 hello-fjs 4050 页 VDOM 显示（JS 84–116 ms，上屏 198–232 ms）。一次显示的时间线：

| 段 | ms | 线程 |
|---|---:|---|
| 指针事件（JS 全程，含 applyFrame） | 94.5 | ui |
| 到下一帧 | 5 | — |
| **一帧 BeginFrame** | **99.6** | ui |
| 　└ LAYOUT | 89.2 | |
| 　　├ BUILD（2059 次，去 GC） | 30 | |
| 　　├ GC（Scavenge / 增量标记） | 35 | |
| 　　└ 纯布局 | 24 | |
| 　└ PAINT + compositing bits | 10 | |
| 光栅化 | 3.9 | raster |

合计约 203 ms + 等 vsync ≈ 页面的「上屏」。**raster 不是问题（4 ms），UI 线程的 LAYOUT 是**。

原因：`render/flex.dart` `buildFlex` 把每个 flex 容器的子节点放在 `LayoutBuilder` 里建（要用约束决定
交叉轴 stretch / start、主轴百分比、gap、auto margin），整棵 4050 节点的 Widget 子树因此都在布局阶段 build，
一格一个 LayoutBuilder 回调（2059 次 BUILD），分配出的大量 Widget / Element 又引出 35 ms 的新生代 GC。

隐藏那帧 30 ms：BUILD 11.4 + FINALIZE TREE 17（卸载 Element）。

可优化项（另开 spec）：

1. **flex 容器去 LayoutBuilder**：子节点不需要主轴上限（无百分比 / gap / auto margin）的盒子直接建，交叉轴
   stretch 在无界时退成 start / 两遍测量的判断挪进 `RenderFjsFlex.performLayout`。build 回到 BUILD 阶段且
   少一层 Element / 闭包。难点：`_flexChild` 按 `stretches` 包子节点，格子（row 里的 column，宽度无界）正是
   stretch→start 的情形，语义要逐项对齐。
2. **每节点 Widget 层数**：GC 与 build 都和 Widget 数成正比，先数清一格 view + text 实际展开多少层再定。
