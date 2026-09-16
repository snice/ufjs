# Spec: 小程序 setData 每帧一次 + v-for 列表按模板所读投影

- **ID**: 062-mp-setdata-batching
- **状态**: done
- **日期**: 2026-09-16

## 1. 要解决什么

spec 061 放开 animation 组之后，anime 页在小程序端「很卡」（用户报告）。两处
原因，都在 wx 运行时与编译器这一侧，与 Anime.js 无关：

**① 每一次属性写入都过一趟桥。**
[`instance.ts`](../../packages/fjs-runtime/src/wx/instance.ts) 用
`watch(render, cb)` 驱动 setData，而这个目标只装 `@vue/reactivity`——**任务队
列在 runtime-core 里，这里没有**。没有 scheduler 的 `watch` 是同步的：getter
（整份 data 的深快照）与回调（diff + setData）在**每一次**属性写入后各跑一遍。
Anime.js 一帧写 25 个对象 × 3 个属性 = 一帧 **75 次**快照 + 75 次 deepEqual +
75 次 setData。

**② 列表整份过桥，并且整份算「变了」。**
`wx:for="{{ dots }}"` 要的只是走一遍列表，模板真正读的只有 `dot.id`（位移是
`__d1[index]` 这张按项算好的表）。但 25 个 dot 的 `scale/rotate/y/color` 也在
data 里，动画每帧改 `scale`，于是整个 `dots` 数组每帧重发。`lanes` 更糟：里面
有 Anime.js 的 Spring 求解器实例，它的内部状态每帧在变，模板却只读 `lane.name`。

## 2. 不做什么（Non-goals）

- 不做路径级 setData（`__d1[7]`）：25 项**全部**每帧在变时，25 个 key 不比一个
  数组便宜。
- 不改示例页的动画规模或写法。
- 不碰 Flutter / Web 两端（它们不过 setData 这道桥）。

## 3. 用户可见的行为

同一批写入合并成一次 setData，时机与 Vue 的 pre-flush 一致（微任务），
`nextTick()` 仍排在它之后。列表只带模板读到的字段，其余字段的变化不再触发重发。

## 4. 三端约定（宪法 I）

只影响小程序端的数据下发时机与内容，模板语义不变。

## 5. 契约变更（宪法 II）

- [x] 运行时新增导出：`@ufjs/runtime/wx` 的 `project`

## 6. 做法

- **合并**：给 `watch` 传 scheduler——首跑同步（挂载那一帧不能延后），其余把
  job 排到一个微任务，期间重复触发只排一次。
- **投影**：`genFor` 在生成完循环体之后，扫描**已产出的 wxml** 里 `{{ }}` 内对
  item 的读取（字符串字面量不算，`class="dot"` / `wx:for-item` 这类非表达式位置
  也不算），加上 `wx:key` 用到的那个属性，生成
  `const __l0 = __fjsComputed(() => __fjsProject(dots, ["id"]))`，`wx:for` 改读
  它；原列表名不再进 `__fjsData`。整项被读（`{{ chip }}`、`dot[key]`、事件的
  `data-args`）、`wx:key="*this"`、嵌套 v-for 的内层列表、运行时才知道是不是数
  字的列表：都原样放过。非数组（对 object 做 v-for）与原始值项由运行时
  `project()` 透传。
- 顺带：生成 computed 的几处不再把**computed 自己在 setup 里读的**依赖登记进
  `dataNames`——`__fjsData` 现在就是「模板真正读到的那些名字」，与它的注释一致。

## 7. 验收标准

1. `packages/fjs-runtime/test/wx-instance.test.ts`：一拍里的多次写入只产生一次
   setData，数据最终一致。
2. `packages/fjs-runtime/test/wx-list-projection.test.ts`：投影后未读字段的变化
   不改变投影结果；非数组与原始值项透传。
3. `packages/fjs/test/mp-compiler.test.ts`：投影的键集合（含 wx:key）、整项读取
   / 计算成员 / 嵌套 v-for 不投影、item 名出现在 class 里不算读取。
4. `pnpm test`、`pnpm --filter hello-fjs run typecheck`、`build:mp` 通过。
5. anime 页在开发者工具里目验流畅度（用户侧）。
