# Spec: 批量挂载——新子树的样式登记与计算合成一遍 + class 字段保留原生

- **ID**: 149-batch-mount
- **状态**: done（目标按实测修订，见 §8.3）
- **日期**: 2026-09-28

## 1. 要解决什么

specs/148 之后的测量（fjsrun，Mac，flat-4050 树，4050 元素只有 3 种样式）：

| 层 | VDOM 挂载 | Vapor 挂载 |
|---|---:|---:|
| 元素层 create / insert / setText + op 编码 | ~9 ms | ~9 ms |
| 渲染器登记（track、children 表、标签映射、class / scope 派发） | ~9 | ~9 |
| 样式引擎逐元素登记（ensure / addScope / setClasses / markDirty / noteStructureChange） | ~10 | ~10 |
| 样式 flush（逐元素 recompute） | ~19 | ~19 |
| Vue（VDOM diff / Vapor 运行时 + DOM 外壳） | ~20 | ~36 |
| **合计** | **66** | **83** |

不经过 Vue 直接调渲染器 nodeOps，同一棵树挂载 + 卸载 55 ms；只调元素层 12 ms。
也就是说 **约 37 ms 在渲染器与样式引擎，与 Vue 无关**，VDOM、Vapor 都付。

逐方法计时（包装计时，绝对值虚高，看占比；无结构规则 / 有结构规则）：

| 每元素 | 无结构规则 | +结构 / 兄弟规则 |
|---|---:|---:|
| `recompute`（flush 内，含下列） | 6.3 µs | 9.9 µs |
| ├ `matchRules`（147 的同形共享命中） | 1.8 | 5.3 |
| ├ `compute` 其余（byParent 命中后拷十几个字段） | 1.2 | 1.3 |
| └ `applyStyle`（渲染器回调 + SetStyle 编码） | 1.7 | 1.7 |
| `nodeOps.createElement`（含 `ensure` 1.2） | 3.7 | 3.9 |
| `nodeOps.insert`（含 markDirty、noteStructureChange） | 3.2 | 3.4 |
| `patchProp('class')`（含 `setClasses` 1.2） | 1.9 | 2.0 |
| `setScopeId`（含 `addScope` 1.1） | 1.6 | 1.7 |
| `markDirty` | 3 次 / 元素 | 3 次 / 元素 |

现象：

1. **新挂载的子树被逐元素、分两段处理**：patch 期每个元素进样式引擎 5 次（登记、标脏、结构变化通知），
   flush 期再按 id 逐个 recompute。对一棵刚建好的子树，这些信息在 flush 时一次遍历就都能拿到：
   父节点已算好、兄弟顺序就是遍历顺序、前一个兄弟刚算过。
2. **有结构 / 兄弟规则时（hello-fjs、vant 都有）命中路径贵一半多**：每个元素单独找自己在父节点
   child list 里的下标算首尾位、单独取前一个兄弟的签名；刚建好的一行里，这些在顺序遍历时是现成的。
3. **同形兄弟仍然各算一遍 compute**：147 只共享了 match，byParent 命中后的字段拷贝、recompute 的
   比较逻辑每个元素照走。
4. **依赖包里的 class 字段被降级成 `Object.defineProperty`**：esbuild 对 node_modules 的 `.js` 一律按
   define 语义降级（target es2019）。PrimJS 上每个字段每次构造多约 0.22 µs（约 4 倍于直接赋值）；
   PrimJS 原生 class 字段只比赋值慢约 7%。runtime 自己的 TS 源码不受影响（tsconfig ES2021 → 赋值）。
   目前 motion 这类库中招，vant 没有。

## 2. 不做什么（Non-goals）

- 不改 CSS 语义：每个元素的 computed style、`:active` / `:hover` / 伪元素样式与 op 帧与改前逐字节一致。
- 不改 op 协议与帧字节：写入器内部可以合并写（一次扩容、内联写字节），帧必须逐字节不变；不下沉到 C / Dart。
- 不做引擎原生克隆（结论：单独做只省元素层 ~9 ms，样式登记仍要逐元素；等本 spec 落地后再评估）。
- 不改 Vue、不改 Vapor 运行时；不改构建期样式快照格式（specs/119）。
- class 字段：只放开 PrimJS 与 QuickJS-ng **都支持**的 class 语法；web / 小程序目标不动。

## 3. 用户可见的行为

页面代码零改动，渲染结果不变。可观察的只有耗时：

```text
# examples/bench（fjsrun，Mac，med）
pnpm run vapor     vdom 挂载 66 → ≤ 55 ms；vapor 挂载 83 → ≤ 72 ms
pnpm run run       flat-bench style.flush：页面规则 18.9 → ≤ 13 ms，+结构规则 30.4 → ≤ 18 ms

# 真机 iPhone 12 --profile，hello-fjs flat-4050 显示
JS 152–166 → ≤ 140 ms
```

构建：依赖包里的 `class A { x = 1; #y = 2 }` 在产物里保持原生 class 字段，不再出现 `__publicField` 辅助函数。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `css/style.ts` + `vue/renderer.ts` 内部优化，结果不变；构建保留原生 class 字段 | 不涉及：web 用浏览器 CSS，web 构建 target 不变 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无新增 | 无新增 |

小程序端不经过本引擎，构建 target 不变。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及；`StyleEngine` 公开方法与 `stats` 字段保持兼容（计数口径若变，写进文档）。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；现有样式 / 快照 / 渲染器单测不改期望值。
2. 新增对拍单测：新挂载子树（含 `:first-child` / `:last-child` / `:not(:first-child)` / `+`、`:active`、
   `:hover`、伪元素、scoped、继承与变量、inline style、兄弟 class 不同、v-if 锚点、raw text、
   `position: fixed` 提升），挂载后再做插入到中间、keyed move、改 class、删首尾，每个元素的样式与 op 帧
   与「逐元素完整计算」参照一致；参照组不走批量路径。
3. `examples/bench`：达到 §3 离线目标，帧字节数不变；其余 `[bench]` 各项不回退超过 5%。
4. `pnpm --filter demo run bench:mount`（prewarm）：五页 CSS 段不回退，match miss 数不变。
5. class 字段：CLI 单测断言 node_modules 的 `.js` 与 TS 源里的 public / private 字段、private 方法
   在 Flutter 目标产物里保持原生；static block、`#x in o` 仍被降级（PrimJS 不支持，已实测）。
   `packages/flutter_fjs/native` 的 fjsrun（PrimJS 与 QuickJS-ng 两个 flavor）都能跑含这些语法的 bundle。
6. `cd packages/flutter_fjs && flutter test` 通过。
7. 真机 `fjs run ios --profile`：flat-4050 显示 3 次达到 §3；theme 页、vant 页外观与改前一致。
8. `docs/performance.md` 4050 元素一节、`docs/toolchain.md` 构建 target 说明补上本次结果。

## 7. 待澄清

- [x] **Q1 Vapor 的模板整块实例化** → 先不放，149 做完实测后再评估。本 spec 只做 VDOM / Vapor 共用的部分。
- [x] **Q2 目标值** → 按 §3；实测不可达时按实测修订并跟用户确认（同 147）。

## 8. 结果（2026-09-28）

### 8.1 离线（fjsrun，Mac）

| | 149 前 | 149 | §3 目标 |
|---|---:|---:|---:|
| `pnpm run vapor` VDOM 挂载（med） | 66.4 ms | **59.6–62.2** | ≤ 55 |
| `pnpm run vapor` Vapor 挂载（med） | 82.7–83.4 | **73.5–77.4** | ≤ 72 |
| flat-bench `style.flush`，页面规则 | 18.9 | **17.6** | ≤ 13 |
| flat-bench `style.flush`，+结构 / 兄弟规则 | 30.4 | **26.4** | ≤ 18 |
| `style-mount-1000-rows` | 42.7 | **38.9** | — |
| 渲染器挂载底线（不经过 Vue，页面 / 结构） | 50.2 / 63.0 | **42.5 / 51.8** | — |
| 帧字节 | 175166 B | 175166 B | 不变 |

其余 `[bench]` 各项持平或更快（`theme-switch-cascade-only` 13.0 → 13.5，+4%，在 5% 内）。`bench:mount`（prewarm）
五页 CSS 段 3.6/2.1/4.5/2.4/3.3 ms（前 4.4/2.1/4.5/2.6/3.3），miss 1/0/1/1/20 不变。vant-feedback 冷启动
rest +3 ms 是 GC 时机：冷测前加 `gc()`（临时调试改动，未提交）两边都是 ~10.5 ms。

逐项收益（floor 脚本，页面规则）：op 写入器合并写 −3.3 ms（元素层 12 → 9.5）、`ensure` 内联入队 −1.3、
`queuedAlone` −0.7、渲染器四处 −2.5、顺序游标（仅结构规则）−2.2。

### 8.2 真机（iPhone 12，`--profile`，hello-fjs flat-4050）

| | 148 | 149 |
|---|---:|---:|
| VDOM 显示 JS | 177–196 ms | **162–165 ms**（5 次） |
| ├ 样式 flush | 36–38 | 33.0–33.2 |
| └ 其余 | 138–158 | 127–130 |
| VDOM 点击→上屏 | ~298 | 249–299 |
| VDOM 隐藏 JS | 37.5–51 | 35–55 |
| Vapor 显示 JS | 212–216 | 199.5–212 |
| Vapor 改 1 格 / 200 格 | 5.4–6.0 / 17–22 | 2.6–6.3 / 17–27 |

启动后前两次 VDOM 显示 flush 为 52 ms、其余同步降低、总 JS 不变（181 ms），之后稳定在 33 ms：GC 恰好落在
flush 里，不是 flush 变慢（离线同页复现——hello-fjs 的 `GridVdom.vue` + 预加载进来的 `pseudo.vue` 结构规则——
HEAD 挂载 86.1 / flush 23.5 ms，149 为 75.4 / 21.2 ms）。

### 8.3 偏差与修订（按 Q2）

- §3 的目标**都没达到**，按实测收尾：离线 VDOM ~60 ms、Vapor ~74 ms、flush 17.6 / 26.4 ms，真机 VDOM 显示 JS
  162–165 ms。地板在逐元素状态：PrimJS 解释执行下，每元素十几个状态字段的读写与几次 Map 查找约 4 µs（flush）+
  2 µs（登记），JS 内已无数量级空间。再往下要换位置：样式引擎下沉 C++（specs/150，已按门控 spike 立项）。
- T6（同形复用整份 compute）不做：byParent 命中后的字段拷贝与复用时的字段拷贝是同一件事，只省一次 Map 查找。
- 试过无收益而回滚：ElementState 一次成形（flush −2.7、登记 +3.3）、chain 引用计数改按 id、createElement 按标签合并查表。
- class 字段：真机发现 PrimJS 缺陷——静态字段初始化里引用自身类名报 "lexical variable is not initialized"
  （spine 的 `static WHITE = new Color()`；QuickJS-ng 正常）。静态字段（公有 / 私有）改回降级；esbuild 对含要降级
  静态字段的类会把整个类降级，这类类与改前相同，不含静态字段的类拿到原生字段。worker 构建（web 与 device 共用
  一份 es2020 产物）未动。
- 对拍单测的变异检查：位置首位、前兄弟位置位、游标跨越的间隙、raw text 推进、游标校验、起步时 prevFirst 六处
  改坏各自有用例失败；`queuedAlone` 的无父节点条件与 `locate` 的独子校验是防御性冗余（不变式下不可达）。
  判据除样式外还比每元素的位置位 / 前兄弟签名 / chain key 与 recompute 次数——错的键在不撞车时不改变样式，
  错的签名会被下一轮自愈，只多算一遍。
