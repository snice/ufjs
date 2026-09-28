# Plan: 批量挂载——新子树的样式登记与计算合成一遍 + class 字段保留原生

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 只动 Flutter 路径的 JS 内部；web 用浏览器 CSS，构建 target 不变 |
| II 边界即契约 | 否 | op 协议、natives、事件都不变；帧逐字节对拍 |
| III 同步单线程零序列化 | 是 | 仍在同一次 flush 内完成，不引入异步 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 批量路径与逐元素路径对拍单测；批量条件不满足时回落原路径 |
| VI 注释记录权衡 | 是 | 每个快路径写明依赖的不变式与被否的备选 |
| VII JS 能包就不要下 Dart | 是 | 全在 JS 内做，不下沉 |
| VIII 变更落到文档 | 是 | performance.md、toolchain.md |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/build.ts` | Flutter 目标的 esbuild 加 `supported`：保留原生 class 字段 / 私有成员 |
| JS runtime · op 写入 | `packages/fjs-runtime/src/ui/ops.ts` | create / insert / setText / setStyle 一次扩容 + 内联写字节 |
| JS runtime · 渲染器 | `packages/fjs-runtime/src/vue/renderer.ts` | createElement / insert / track 去掉逐元素的冗余分配与查找 |
| JS runtime · 样式引擎 | `packages/fjs-runtime/src/css/style.ts` | 新元素登记快路径；flush 内按父节点顺序游标算位置与前兄弟；同形复用整份 compute 结果 |
| 测试 | `packages/fjs-runtime/test/`、`packages/fjs/test/` | 批量 vs 逐元素对拍；class 字段产物断言 |
| 文档 | `docs/performance.md`、`docs/toolchain.md` | 结果、构建 target 说明 |

## 3. 方案

测量驱动，逐项做、逐项量（离线 `vapor/floor.ts` 临时脚本 + `pnpm run vapor` + `pnpm run run`），
不达收益的改动回滚。基线（fjsrun，med）：floor 挂载 patch 32 ms（元素层 12 / 渲染器 10 / 样式登记 10），
flush+编码 18.2 / 29.2 ms（页面规则 / +结构规则）。

**W1 op 写入器合并写**：现在一个 Insert 是 `u8` + 3×`u32`，四次方法调用、四次 `ensure`。改成一次
`ensure(13)` 后局部变量内联写。create、setText、setStyle 同理。帧字节不变（现有 op 单测 + 对拍帧）。

**W2 样式引擎登记快路径**：
- `ensure`：状态对象一次成形（字段固定顺序，避免后续加字段时换形状）；`childrenOf` 查询与 stamp 只做一次。
- `addScope` / `setClasses`：元素在本 pending set 已整棵入队（`subtreeEpoch === dirtyEpoch`）且还没有父节点时，
  `markDirty` / `markNextSibling` 必然是空操作，直接跳过。
- 否掉的备选：登记延迟到 flush（renderer 只记原始事实）。要改 `classesOf` / `computedOf` 等同步读接口的
  语义，且 VDOM 的 class / scope 仍是逐个调用，省不掉派发。

**W3 渲染器**：`track` 每元素给元素对象加 `contains` 属性（换形状）→ 放到原型上一次；`trackInsert` 追加到末尾用
`push`；`createElement` 不再预建空 children 数组（读取处已有 `?? []`，逐个核对）；`insert` 对新元素
（无父节点）跳过 detach。

**W4 flush 批量**（核心）：
- **顺序游标**：一次 pass 按 id 升序 recompute，同一父节点的新孩子基本按 child list 顺序到来。为每个父节点
  记一个游标（上次处理到的下标、之前是否有参与位置计算的兄弟、前一个参与兄弟的 id）。下一个孩子从游标往后
  找，通常一步命中；于是首尾位与前兄弟一次算出，不再每元素 `indexIn` + 向两侧扫描，`structuralBits`
  也不再一次 recompute 调多遍。找不到（乱序、移动）就回落现有路径。
- **同形复用 compute**：147 的 `sameShape` 命中后，若范例与本元素 parent computed id 相同、都无 inline、
  defaultsId / rawText 相同，直接拷范例已算好的 compute 结果（style / keys / custom / active / hover / pseudo），
  跳过 `byParent` 查找与逐字段赋值的分支。
- 否掉的备选：子树整体复制（按模板识别整棵子树同构后批量拷）。判同构本身要逐元素比较，收益与上面相当，
  但要新增一套子树签名，且 VDOM 下不知道模板边界。

**W5 class 字段**：`build.ts` 里所有 Flutter 目标（`target: 'es2019'` 的几处）加
`supported: { 'class-field': true, 'class-static-field': true, 'class-private-field': true,
'class-private-method': true, 'class-private-accessor': true, 'class-private-static-field': true,
'class-private-static-method': true, 'class-private-static-accessor': true }`。
PrimJS 实测不支持 static block 与 `#x in o`，保持降级。worker 构建（`workers.ts`，es2020）同样处理。

## 4. 风险

- **静默错样式**：快路径漏一个输入就会把错的样式交给元素。对拍单测覆盖 spec §6.2 的全部组合，参照组关掉批量路径；
  每个复用条件逐条去掉要有单测失败（同 147 的做法）。
- **游标失效**：flush 期间 hoist / unhoist 会改 child list。游标每次用前校验 `kids[at] === id`，不符回落。
- **形状改变影响其他页面**：跑 `bench:mount` 五页与 `[bench]` 全项，防止别处回退。
- **class 字段**：fjsc 字节码与两个引擎 flavor 都要能解析；`fjs dev` 的热更新 bundle 走同一 esbuild 配置，一起验。
