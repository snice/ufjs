# Spec: 样式引擎挂载期逐元素登记瘦身

- **ID**: 146-style-mount-registration
- **状态**: done（真机 ≤ 150 ms 未达，见 §8；flush 兄弟共享另立 spec）
- **日期**: 2026-09-28

## 1. 要解决什么

specs/145 的 4050 元素同屏压测（`examples/hello-fjs` 的 `example/interaction/flat-4050`，uni-app x
vapor benchmark 同构页）在 iPhone 12（`fjs run ios --profile`）上，点击 → nextTick 的 JS 段约
**190 ms**，其中样式引擎约 **100 ms**——而这 4150 个元素只有 3 种样式（`.row` / `.cell` / `.tiny`，
全部 scoped、无 inline style）。对照 uni-app x vapor 在更老的 A13 上的总耗时是 160 ms。

拆账（specs/145 §4；离线 = `examples/bench` 的 `flat-bench.ts`，fjsrun，Mac，min）：

| 环节 | 离线 | 真机 |
|---|---:|---:|
| patch 期登记：`ensure` 5.8 / `addScope` 7.9 / `setClasses` 6.4 / `recomputeSubtree` 4.3 / `noteStructureChange` 1.9 | 26.0 ms | ~55 ms（其中 mark 实测 10 ms） |
| flush 重算（4150 次 recompute，几乎全部 compute 命中） | 23.6 ms | 45.5 ms（实测） |

读代码看到的现象（`packages/fjs-runtime/src/css/style.ts`）：

1. **每个元素挂载要进引擎 5 次**，Vue 的顺序是 createElement（`ensure`）→ mountChildren →
   setScopeId（`addScope`）→ patchProp class（`setClasses`）→ insert（`recomputeSubtree` +
   `noteStructureChange`）。其中 `addScope`、`setClasses` 各自调一次 `markDirty(id, true)`（子树
   遍历 + 每次读一遍 `globalThis.__fjs.fns.nowMs` 计时）和 `markNextSibling`，insert 再来一次
   `markDirty(id, true)`。**此时元素还没挂到父节点上**，在 insert 之前标脏 / 排 flush 的工作
   都会被 insert 那一次覆盖。
2. `addScope` 首次写入时给每个元素新建一个 `Set`；`setClasses` 走 `parseClassValue`（共享 Set）
   后再 `sameSet` 比较。
3. flush 阶段每元素约 11 µs（真机）：即使 compute 命中，每个元素仍要各自算 selfSig、拼 chain
   key、查 matchCache、查 byParent、调 `applyStyle`。同一父节点下 40 个签名完全相同的兄弟
   （`.cell`）各自把这条路走一遍。

## 2. 不做什么（Non-goals）

- 不改 CSS 语义：选择器、级联、继承、变量、结构伪类、`+`/`~`、`:active`/`:hover`、伪元素的结果
  一律不变；`styleEngine.stats` 的 match / compute 命中数不作为语义哨（登记方式变了，计数可能变），
  但**每个元素最终的 computed style 与发出的 op 帧**必须与改前逐字节一致。
- 不改 Vue runtime-core、不改渲染器之外的元素层（`ui/element.ts`）与 op 协议。
- 不做 uni-app x 式的 `flatten`（拍平节点），不做样式引擎下沉到 C / Dart。
- 不动卸载路径（specs/145 已修 Dart 侧，JS 侧的 `forget` 另议）。

## 3. 用户可见的行为

页面代码零改动，两端渲染结果不变。可观察的只有耗时与计数：

```text
# examples/bench：fjsrun --pump 20000 dist/app/bundle.js
[flat] mount  (min/med/max ms, frame 175166 B)   ← 帧字节数不变
[flat]   style.patch  26.0 → ≤ 10
[flat]   style.flush  23.6（不回退）

# 真机 flat-4050 页：显示
js=190ms | 样式 flush 45.5 mark 10.0 其余 133  →  js ≤ 150ms
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `css/style.ts` 与 `vue/renderer.ts` 内部优化，结果不变 | 不涉及：web 用浏览器 CSS，不经过本引擎 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无新增 | 无新增 |

小程序端不经过本引擎，不涉及。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及——`StyleEngine` 的公开方法签名（`ensure` / `addScope` / `setClasses` /
  `recomputeSubtree` / `noteStructureChange` / `stats`）保持兼容；若 plan 决定新增批量入口，
  旧入口保留原语义。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；`packages/fjs-runtime` 现有样式 / 快照 / Vue 渲染器单测
   **不改期望值**即通过。
2. 新增单测：同一棵树（含 scoped、class、结构伪类、`+` 兄弟选择器、`:active`、继承与变量）在
   「逐个挂载后再 insert」与「改前实现」下，每个元素的 computed style 与整份 op 帧逐字节一致；
   覆盖「元素先设 class 再 insert」「insert 之后再改 class / scope」「keyed move」三种顺序。
3. `examples/bench` 的 `flat-bench`：`style.patch` 与 `style.flush` 达到 Q2 定下的目标，
   `frame` 字节数与改前一致；`vue-theme-switch-*` 与 `runStyleBenches` 各项 min 不回退超过 5%。
4. `pnpm --filter demo run bench:mount`（prewarm）：五页 CSS 段不回退，match miss 数不变。
5. `cd packages/flutter_fjs && flutter test` 通过（先编 native，确认不是 `No tests ran`）。
6. 真机 `fjs run ios --profile -d 00008101-000978E201FA001E` 的 flat-4050 页：显示 3 次的 JS 与
   点击→上屏达到 Q2 目标；hello-fjs 的 theme 页、vant 页外观与改前一致（截图对比）。
7. `docs/performance.md` 补一节：4050 元素的拆账、改动、前后对比。

## 7. 待澄清

- [x] **Q1 范围** → 只做 patch 期登记；flush 的同签名兄弟共享留作下一个 spec，量完再定。
- [x] **Q2 目标值** → 离线 `style.patch` 26 → **≤ 10 ms**（`style.flush` 不回退）；
  真机显示 JS 190 → **≤ 150 ms**。
  - 实现中修正口径：26 ms 是含 bench 计时包装的毛值（≈0.55 µs/次 × 2 万次 ≈ 11 ms），
    `flat-bench` 现在另报扣除包装后的 `style.patch.net`，目标按净值 ≤ 10 ms 验收。
  - 真机 ≤ 150 ms **未达到**，见 §8。
- [x] **Q3 分支基线** → 145 已合入 main，本分支从 main 切出。

## 8. 结果（2026-09-28）

离线（`examples/bench` 的 `flat-bench`，Mac，min）：

| | 改前 | 改后 |
|---|---:|---:|
| `style.patch.net`（页面规则） | ~15.0 ms | **8.2 ms** |
| `style.patch.net`（+结构伪类 / 兄弟规则） | ~21.8 ms | **9.8 ms** |
| `noteStructureChange`（+结构规则，含包装） | 8.5 ms | 3.0 ms |
| 挂载总计（页面规则 / +结构规则） | 94.4 / 118.9 ms | 86.6 / 107.6 ms |
| `style.flush` | 24.0 / 41.9 ms | 23.7 / 42.9 ms（不变） |
| 帧字节 | 175166 B | 175166 B |

真机（iPhone 12，`--profile`，flat-4050 显示 3 次）：

| | 改前 | 改后 |
|---|---:|---:|
| JS | 187–195 ms | **163–175 ms** |
| 样式 mark | 10 ms | 0 ms |
| 样式 flush | 45.5 ms | 45.5 ms |
| 其余（Vue + 元素层 + 登记） | 133 ms | 115–126 ms |
| 点击→上屏 | 316–350 ms | 299–332 ms |

`bench:mount`（prewarm）五页 CSS 段 3.7/2.0/4.4/2.6/3.1 → 3.8/2.1/4.5/2.4/3.2 ms（噪声内），
match miss 1/0/1/1/20 不变。

**真机 ≤ 150 ms 没有达到**：登记路径已经压到离线净值 8 ms，剩下的 JS 是 flush 重算（~45 ms，
开了结构规则的 app 还会更高）和 Vue + 元素层（~110 ms）。要再往下走得做 Q1 里留到下一个 spec 的
「flush 同签名兄弟共享」，以及 Vue 挂载本身。
