# Plan: 样式引擎挂载期逐元素登记瘦身

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 纯 Flutter 端 JS 引擎内部优化；web 用浏览器 CSS，不经过 `css/style.ts`；小程序同样不经过 |
| II 边界即契约 | 否 | op 协议、natives 表、事件类型都不动；`StyleEngine` 公开方法签名不变 |
| III 同步单线程零序列化 | 是（维持） | 仍在同一 microtask flush 里完成，不引入异步或批量延迟 |
| IV 外观照 WeUI | 否 | 不改任何默认样式 |
| V 静默失效是 bug | 是 | 风险在「漏标脏 → 元素样式不更新」，这种错不报错。靠逐字节对拍单测兜住（§5） |
| VI 注释记录权衡 | 是 | 每个快路径写清「为什么等价」：依赖的是哪条不变式 |
| VII JS 能包就不要下 Dart | 否 | 不下 Dart |
| VIII 变更落到文档 | 是 | `docs/performance.md` 补 4050 元素挂载一节 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · 样式引擎 | `packages/fjs-runtime/src/css/style.ts` | `markDirty` 入口快路径、计时 clock 缓存；`addScope` scope 集合驻留；`noteStructureChange` 同 epoch 去重（视 §3 第 0 步的量测决定） |
| JS runtime · 渲染器 | `packages/fjs-runtime/src/vue/renderer.ts` | 预计不改；若第 0 步显示 `insert` 里的调用顺序可省一次，才动 |
| 测试 | `packages/fjs-runtime/test/`（新增 `style-mount-registration.test.ts`） | 对拍：新旧实现同树逐字节一致 |
| Bench | `examples/bench/src/flat-bench.ts` | 已有；补一个带结构伪类 / 兄弟选择器规则的变体，量 `noteStructureChange` |
| 真机页 | `examples/hello-fjs/src/pages/example/interaction/flat-4050.vue` | 不改，用来验收 |
| 文档 | `docs/performance.md` | 新增一节 |

C++ / Dart / CLI / web 适配层：不涉及。

## 3. 方案

**原则：只删「可证明重复」的工作，不改标脏语义。** 每条快路径都建立在引擎已有的不变式上，
改前改后 dirtyList 的内容（集合意义上）完全相同。

### 第 0 步：先量 app 里的 `noteStructureChange`

`flat-bench` 只注册了页面自己的 3 条规则，`hasStructural` / `hasSiblingRules` 都是 false，
`noteStructureChange` 直接返回（1.9 ms 纯调用开销）。真机 hello-fjs 注册了整个 app 的样式表，
很可能打开了结构伪类开关——那时每次 insert 都把父节点**全部**子节点重新 mark 一遍，40 个兄弟
就是 1+2+…+40 = 820 次 `mark()`，整页约 4.2 万次。先在 flat-bench 加一个注册了 `:first-child`
规则的变体量出来，再决定第 3 条做不做。

### 1. `markDirty(id, true)` 入口快路径

子树遍历里本来就有「这个节点本轮已经整棵入队（`subtreeEpoch === dirtyEpoch`）就跳过」的判断，
但每次调用都要先付：读两次 `globalThis.__fjs?.fns?.nowMs`（属性链 + 两次原生调用）、清空并压栈、
算 `cap`。挂载时同一个元素会进 `markDirty(subtree)` 三次（`addScope`、`setClasses`、insert 的
`recomputeSubtree`），后两次都命中这个跳过条件。

改法：在入口先查根节点的 state，已盖本轮章就只 `scheduleFlush()` 返回。**等价性**：这正是遍历
第一步会做的事——遍历对根节点 `continue` 后栈空结束，什么都不标。clock 函数改成模块级惰性缓存
（查一次 `globalThis`），`markMs` 计数保持，但快路径不计时（它没有遍历）。

预期：`setClasses` 与 `recomputeSubtree` 的大部分成本消失（离线 6.4 + 4.3 ms 里的大头）。

### 2. `addScope` 的 scope 集合驻留

现在每个元素首次加 scope 都 `new Set()`。同一个 SFC 的元素 scope 集合几乎总是同一个
`{data-v-xxx}`。改成按「排序后拼接的 key」驻留共享的只读 Set（和 `parseClassValue` 的
`classSetCache` 同一个思路），加 scope 时换成另一份共享 Set，不就地修改。

**前提**：`s.scopes` 只在 `addScope` 里被写（已 grep：`style.ts` 1482–1483 是唯一写点；
其余都是 `.has()` / `joinSorted` 读），驻留后改成「换引用」即可。

`seenScopes.add(scope)` 仍每次都做：驻留表是模块级的、跨引擎实例共享，只在新建 Set 时登记会漏掉后来的引擎（实现时发现）。

### 3. `noteStructureChange` 同 epoch 去重（第 0 步证明值得才做）

同一轮 pending 里，父节点的孩子只要已经全部标过一次，之后再 insert 进来的新孩子由它自己的
`recomputeSubtree` 标记（renderer 的 insert 先 `recomputeSubtree(child)` 再 `noteStructureChange`），
已有孩子仍在 dirtyList 里。所以对同一个 parent，本轮第二次起只需要确保新孩子已入队。
实现：`Map<parentId, epoch>` 记「本轮已全标」，命中时只 `mark` 列表最后插入位置附近的孩子——
**具体取舍在实现时对拍后定**；若不能严格证明等价（例如外部调用方不先标新孩子），这条不做。

### 被否掉的备选

- **未挂载元素整体延后登记**（`ensure` 带 `pending` 标记，insert 之前的 `addScope` / `setClasses`
  都不标脏，insert 时一次补上）：收益更大，但语义会变。KeepAlive 的 storage container、Suspense
  的隐藏容器是 `createElement` 出来、永不 insert 的节点，孩子会被 move 进去；pending 的容器永远
  不被计算，里面的孩子会以「无父样式」算出不同的结果，op 帧不再逐字节一致。要修就得在 attach 时
  向上解 pending，而 Vue 自底向上挂载会让行 / 格子在自己的 `setScopeId` 之前就被孩子解掉，收益
  归零。否掉。
- **渲染器侧攒齐再一次 `register(id, tag, classes, scopes)`**：Transition 在 insert 之前就读写
  class（`vue-shim.ts` 的 `classesOf` / `setClasses`），攒在渲染器里就要给这些路径都加一层
  「查 pending」，改面大、易漏。否掉。
- **flush 阶段同签名兄弟共享结果**：spec Q1 已定为下一个 spec。

## 4. 风险

- **漏标脏是静默的**（宪法 V）：元素保持旧样式，不报错。快路径 1 的等价性依赖「盖了本轮章的
  子树已整体入队，之后挂进来的节点由自己的 insert 入队」这条既有不变式——它在 specs/118 引入，
  本次只是把检查提前到入口。对拍单测覆盖「先设 class 再 insert」「insert 后再改 class / scope」
  「keyed move」「Transition 在 insert 前加 class」四种顺序。
- **scope Set 驻留后被就地修改**会污染所有共享者。所有写点改为换引用，并在单测里断言两个元素
  的 scope 集合互不影响。
- **`markMs` 口径变化**：快路径不计时，`stats.markMs` / `markVisited` 会变小——这是计数口径，
  不是语义；在 `docs/performance.md` 写明。
- 快照（specs/119）导入不经过 `markDirty` 的入口快路径以外的新逻辑，不受影响；仍跑
  `bench:mount` 确认 match miss 数不变。

## 5. 验证路径

```bash
# 单测 + 类型
pnpm run typecheck
pnpm test

# 离线：改前先记基线（main 上跑一次），改后对比
cd examples/bench && npx fjs build && \
  ../../packages/flutter_fjs/native/build-native/fjsrun --pump 20000 dist/app/bundle.js | grep -E '\[flat\]|\[bench\]'

# vant 页不回退
pnpm --filter demo run bench:mount

# Dart 侧（没改，但按惯例跑）
cd packages/flutter_fjs && flutter test

# 真机：flat-4050 显示 3 次；theme 页、vant 页截图对比
cd examples/hello-fjs && npx fjs run ios --profile -d 00008101-000978E201FA001E
```
