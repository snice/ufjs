# Spec: 原生模板克隆（VDOM 路径）

- **ID**: 153-vdom-clone
- **状态**: done
- **日期**: 2026-09-29

## 1. 要解决什么

specs/152 让 Vapor 路径的模板实例化走一条 `CLONE` 词（libfjs-style 展开节点并登记样式），flat-4050 Vapor
挂载 49.4 → 36 ms。VDOM 路径（绝大多数页面）没有吃到：Vue 对每个 vnode 走一遍 `mountElement` →
`createElement` / `setElementText` / `setScopeId` / `patchProp(class)` / `insert`，flat-4050 VDOM 挂载仍是
~37.5 ms。其中 2000 个格子（`view.cell > text.tiny{{ i }}`）是结构固定、只有文字在变的子树——specs/151 的
spike 量过，这类子树走克隆能省 ~12 ms（离线）。

VDOM 缺的是「模板从哪来」：Vapor 的 `template()` 天然是静态片段，VDOM 的 render 函数只有逐个 vnode。

## 2. 不做什么（Non-goals）

- 不改 Vue、不改 Dart、不改 CSS 语义；libfjs-style 与词流协议沿用 specs/152（不新增 op）。
- web / 小程序构建不变（web 走 runtime-dom，本 spec 的编译改写只在 Flutter 构建开启）。
- 只克隆「结构和 class 全静态、只有文字插值」的子树；带事件、动态 class / style、其他属性、ref、指令、
  组件、`v-if` / `v-for` 的子树照旧逐节点。
- 不做组件根（会有透传 attrs / scope 继承）。
- TS 样式引擎路径（无 natives、`__fjsNativeStyle = false`）不克隆，逐节点建（结果与现在一致）。

## 3. 用户可见的行为

页面代码零改动，渲染结果不变。可观察的只有耗时：

```text
# examples/bench（fjsrun，Mac，PrimJS）
pnpm run native:on     flat-4050 VDOM 挂载 ~37.5 → ≤ 30 ms
pnpm run vapor         VDOM 行同上；Vapor 行不回退
```

## 4. 做法

**编译期**（`@ufjs/cli` 的 SFC 模板编译，Flutter 构建）：新增一个 nodeTransform，在 ROOT 退出时（所有元素的
codegenNode 都已生成）找出**最大的合格子树**：

- 原生元素（非组件 / slot / template），不是模板根；
- 属性只有静态 `class`，子树根另允许 `key`；
- 子节点要么全是合格元素，要么只有文字（静态文字 / 插值 / 二者混排 → 一个字符串）；
- 至少 2 个元素。

把子树根的 VNodeCall 原地改成 `createVNode(_hoisted_N, { key, t }, null, PROPS, ["t"])`：`_hoisted_N =
fjsTemplate(<节点表>)`（从 `vue` 导入，'vue' 已解析到 fjs 的 shim），`t` 是按先序排的动态文字（1 个时直接是
字符串）。原地改，v-for / block 对它的引用自动跟着变。

**运行时**（`fjs-runtime`）：`fjsTemplate` 返回一个走 Vue Teleport 协议的 vnode 类型（`__isTeleport` +
`process` / `move` / `remove`，runtime-core 对这类 vnode 不调 mountElement，整棵子树交给它）：

- 挂载：libfjs-style 可克隆时，首次按组件的 scopeId 调 `prepareClone`（specs/152），之后每个实例一次
  `cloneTemplate` + 动态文字 `setElementText`；否则（TS 引擎 / 模板里有不能克隆的标签 / 有 slotScopeIds）按
  mountElement 的顺序逐节点建。
- 更新：只比较 `t`，变了的 `setElementText`。
- 移动 / 卸载：搬 / 删根元素（渲染器的 remove 带走整棵子树的记账）。

## 5. 契约变更（宪法 II）

- [ ] op 协议 / 词流（沿用 specs/152 的 TEMPLATE / CLONE）
- [ ] natives 表
- [ ] 事件类型
- [x] 编译产物：Flutter 构建的 render 函数里出现 `fjsTemplate`（'vue' shim 新导出）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`（含编译改写的单测：合格 / 不合格样例的产物）通过。
2. 对拍：flat-4050 VDOM 在 TS / native / verify 三种模式每元素样式 hash 一致、verify 0 不一致；demo 16 页、
   bench:mount、hello-fjs 66 页 verify 0 不一致。
3. 更新正确：`vapor` bench 的 FlatLive（VDOM）改 1 / 200 / 2000 格后文字正确（hash 对拍），耗时不回退。
4. 不泄漏：flat-4050 挂载 / 卸载 8 轮后 libfjs-style `elements` 回到基线。
5. `examples/bench` 达到 §3；demo `bench:mount` 不回退。
6. 模拟器冒烟：demo 与 hello-fjs 4050 页显示正常。

## 7. 待澄清

无。风险记在这里：Teleport 协议是 runtime-core 的内部约定（`shapeFlag & 64` 分支），升级 Vue 时要看
`process` / `move` / `remove` 的签名；有单测兜底。

## 8. 结果（2026-09-29）

离线 fjsrun（PrimJS，Mac），机器空闲时中位数 ms；「改前」是同一代码去掉编译改写的构建：

| | 改前 | 改后 |
|---|---:|---:|
| flat-4050 VDOM 挂载（`native:on` 页面） | 37.5 | 20.3 |
| flat-4050 VDOM 挂载（`vapor` bench） | 39.5 | 20.1 |
| VDOM 挂载首帧 | 121 KB | 51 KB |
| FlatLive VDOM 改 1 / 200 / 2000 格 | 14.5 / 15.3 / 25.5 | 11.1 / 12.2 / 22.6 |
| flat-4050 Vapor 挂载 | ~36 | ~36.6（持平） |
| TS 引擎下 VDOM 挂载（兜底逐节点） | 58.2 | 53.1 |

- §3 目标 ≤ 30 ms 达到。更新也变快：每格少了一个 text vnode 的创建与 diff。
- 对拍：flat-4050 页面 hash 改前 / TS / native / verify 都是 `48142bbd`，verify 132121 次 0 不一致；更新帧
  的 op 数与字节数和改前完全相同；demo 16 页 2359 次、bench:mount（含 / 不含快照）各 11160 次、hello-fjs 66 页
  17745 次，0 不一致（demo 产物里 8 个模板块、hello-fjs 79 个）。
- 不泄漏：`native:on` 全部轮次后 elements 回到 3。
- bench:mount 五页交替各跑三次，冷开持平（vant 组件多带事件 / 绑定，几乎不产生模板块）。
- `pnpm run typecheck`、`pnpm test`（runtime 852、cli 429，含新增 `template-block.test.ts` 2 条、
  `clone-blocks.test.ts` 19 条）通过。没改 native，预编译产物不用重生成。
- 模拟器冒烟（iPhone 17）：hello-fjs 4050 页 VDOM 显示 / 改 2000 格 / 隐藏正常（挂载帧 50 KB，走克隆）；demo 首页、
  fetch 页（行内文字是模板块，请求返回后更新）正常。
- 真机（iPhone，`fjs run ios --profile`，hello-fjs 4050 页）：VDOM 显示 JS 92–93 ms（specs/149 后 163 ms，
  150–153 合计）、上屏 215 ms、隐藏 46 ms；改 1 / 200 / 2000 格 32 / 45 / 76 ms。Vapor 显示 121–144 ms、改格
  4.7–5.9 / 16.9 / 70 ms。未做去掉 153 的真机对照。
- 未做：带动态 class / style / 事件的子树（需要块内的 patchProp 定位）；模板根。
