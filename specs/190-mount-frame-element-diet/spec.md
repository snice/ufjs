# Spec: 挂载帧瘦身——每节点更少的 Element / RenderObject / Inherited 依赖

- **ID**: 190-mount-frame-element-diet
- **状态**: in-progress（第 3 项完成，第 4 项待定）
- **日期**: 2026-10-02

## 1. 要解决什么

specs/186–189 之后，hello-js 4050 屏（克隆挂载）真机 profile：show 上屏
132–136ms，其中 JS ~30ms 已到底，**挂载帧 ~85–95ms** 是剩下的大头，且与
hello-fjs 的 VDOM/Vapor 共享（三条路径镜像树同构，Dart 侧同一个渲染器）。
specs/189 的归因：GC 旧代标记 ~40ms（存活的 Element/RenderObject）、
Inherited 依赖 ~46ms（主要在卸载期反注册）、Map/HashSet 操作。

一个格子（cell view + text）现在是 **9 个 Element / 6 个 RenderObject**：

```
FjsShrinkCross → _FjsNodeView → Padding(margin) → DecoratedBox → FjsFlex
  → FjsAdaptiveShrinkCross → _FjsNodeView → Text → RichText
```

- `Text` 是一层 StatelessElement，build 时注册 5 个 Inherited 依赖
  （DefaultTextStyle / MediaQuery×2 / SelectionContainer / DefaultSelectionStyle），
  2000 格 = 2000 个多余 Element + 10000 次依赖注册与卸载反注册。
- 简单盒子的 margin / 背景 / 子布局是三个 RenderObject。

Element / RenderObject 数就是挂载帧的分配量、晋升量和卸载量——减它们
直接减 BUILD、GC、卸载三笔账，对 Vue 两条路径同等生效。

## 2. 不做什么（Non-goals）

- 不跨节点复用 Element（Flutter 的 Element 绑定树位置，不可共享）。
- 不改 op 协议、不改 JS 侧。
- 不动 update2000 的 TextPainter 重排版。
- 不改 flex 布局语义（ShrinkCross 族的拉伸/收缩判定保持原样）。

## 3. 用户可见的行为

页面无变化（像素一致）。可观察的是：

- `test/node_widget_count_test.dart` 的格子计数下降（9/6 → 目标 ≤7/≤5）。
- 新基准 `test/mount_bench_test.dart`（FJS_BENCH 开关）：4050 网格的
  mount / unmount 时间与 Element / RenderObject 普查。
- 真机 frame-timeline / cpu-profile 的挂载帧下降。

方案候选（以基准与真机 profile 定取舍）：

1. **纯文本叶子直接出 RichText**：段落环境（DefaultTextStyle、textScaler、
   boldText、选择注册器）按无依赖查找读取；由页面根 `FjsNodeRenderer`
   单点依赖这些环境，环境变化时把其下文本节点标脏——每文本 0 个依赖。
2. **简单盒子合并 margin/装饰进一个 RenderObject**：无过渡、无 %、无
   边框特例的 view，Padding + DecoratedBox 合成一个渲染对象。
3. 真机 profile 指出的其他每节点开销。

hello-js 增加脚本手柄 `globalThis.__helloTab(i)`（切 tab），供
`fjs eval` 在真机上驱动 4050 屏，不必手点。

## 4. 两端约定（宪法 I）

纯 Dart 渲染侧内部实现，不涉及页面能力；web 不适用。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `cd packages/flutter_fjs && flutter test` 全部通过（native 已编译）。
2. `node_widget_count_test` 格子计数下降；`mount_bench_test` mount/unmount
   较基线下降。
3. 真机（iPhone，`fjs run ios -- --profile`，克隆模式）：show 上屏、挂载帧
   较 specs/189 下降；改 1 格上屏不回退；画面与改前一致。
4. `pnpm test` 通过。

## 7. 待澄清

- 无。
