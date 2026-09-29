# Spec: 样式引擎下沉到 native（C++）

- **ID**: 150-native-style-engine
- **状态**: in-progress（阶段 1 实现完成，待真机验收）
- **日期**: 2026-09-28

## 1. 要解决什么

flat-4050（4050 元素、3 种样式）挂载，离线 fjsrun（PrimJS，Mac，specs/149 之后）：

| 层 | VDOM | Vapor | 说明 |
|---|---:|---:|---|
| 元素层 create / insert / setText + op 编码 | ~9.5 ms | ~9.5 ms | 已是底线 |
| 渲染器登记（track、children 表、事件 / 标签表、class / scope 派发） | ~7.5 | ~7.5 | |
| **样式引擎逐元素登记**（ensure / addScope / setClasses / 标脏 / 结构通知） | ~8 | ~8 | |
| **样式 flush**（逐元素 match / compute / SetStyle） | ~17（结构规则 ~25） | 同左 | |
| Vue（VDOM diff / Vapor 运行时 + DOM 外壳） | ~18 | ~36 | |
| **合计** | **~60** | **~74** | 真机约 ×2.5–3 |

样式引擎（登记 + flush）是 Vue 之外最大的一块：**25–33 ms，约占 VDOM 挂载的一半**，VDOM、Vapor 都付。
specs/146 / 147 / 149 在 JS 里连续三轮优化后，每元素仍约 6 µs——PrimJS 解释执行下，每元素十几个状态字段的
读写、几次 Map 查找就是这个量级，JS 里已经没有数量级的空间。

测量上限（`examples/bench` 临时脚本，把样式引擎的调用换成每次一个 13 字节 op——class / scope 驻留成 id——
JS 侧不再 flush）：不经过 Vue 的渲染器挂载 **42.6 → 21.6 ms（页面规则）、51.7 → 21.6 ms（+结构规则）**。
即 JS 侧省 21–30 ms（真机约 50–80 ms），代价是 native 侧多出一次级联计算（C++ 预计 1–3 ms，需实测）。

## 2. 不做什么（Non-goals）

- 不改 CSS 语义与支持范围（`docs/css-compat.md`），不新增支持的选择器 / 属性。
- 不改 Dart 侧的样式协议（DefineStyle / SetStyle / :hover op 照旧），Dart 渲染不动。
- web 端（浏览器 CSS）、小程序端（Skyline）不受影响。
- 不做 Vapor 模板整块实例化、不做原生克隆（另议）。

## 3. 用户可见的行为

页面代码零改动，渲染结果逐像素不变。可观察的只有耗时：

```text
# examples/bench（fjsrun，Mac）
pnpm run vapor     vdom 挂载 ~60 → ≤ 40 ms；vapor ~74 → ≤ 55 ms
# 真机 iPhone 12 --profile，flat-4050 显示
JS 177–196 → ≤ 130 ms；点击→上屏不回退
```

## 4. 方案轮廓（细节进 plan）

- **独立库 libfjs-style**（用户要求）：纯 C++17，**不依赖任何 JS 引擎**，C ABI（`fjs_style.h`）。libfjs 的
  两个引擎 flavor（PrimJS / QuickJS-ng）各自只写一层薄绑定（natives），同一个库多引擎共用；将来换引擎或
  接别的宿主只需重写绑定。自带 C++ 单测（`fjs-style-test`）。
- **分工：逐元素的热路径下沉，CSS 语义留在 TS。**
  - libfjs-style：元素树（从现有结构 op 读）、tag / class / scope / rawText（新样式输入 op）、签名与 chain
    缓存、候选桶 + 选择器匹配（tag / class / 首尾位 / `+` / 后代 / 子代 / scope / :deep / 属性）、脏标记与
    flush、match 缓存与 compute 缓存查找、按 id 顺序写 SetStyle / DefineStyle op。
  - TS：样式表解析（现有 parser，选择器结构一次下发）；**只在未命中时被回调**——新的匹配集合折叠成
    cascade（现有代码）、compute 管线（继承、默认值、var()、em、calc、currentColor、keyframes、
    :active / :hover 变体、伪元素）。这些每页只发生「不同样式数」次，flat-4050 是个位数。
  - 这样 CSS 语义仍只有一份（TS），C++ 只做与语义无关的索引与缓存；移植量从 ~4500 行降到 ~1000 行。
- **帧流程**：JS `uiOps(frame)` → libfjs 绑定 → libfjs-style 消费样式输入 op、维护树、flush，未命中经回调
  进 JS，输出帧（结构 op 原样 + SetStyle / DefineStyle）→ Dart。**Dart 协议不变**。
- **JS 还要读结果的地方**：`computedOf` / `classesOf` / matched rules → 同步查询 libfjs-style；渲染器依赖计算
  结果的副作用（fixed 提升、modal、伪元素盒、placeholder、:active）→ compute 回调时 JS 给该样式打标记，
  libfjs-style 对应用了带标记样式的元素回调 JS，JS 照旧处理。
- **退路与对拍**：TS 引擎完整保留（vitest、web 之外的无 native 环境、对拍参照）；运行时检测到 natives 才走
  native。fjsrun 里同一棵树两边各算一遍，比每元素样式。

## 5. 契约变更（宪法 II）

- [x] UI op 协议：新增样式输入 op（JS → native 样式层；Dart 不可见）。`ops.ts` 与 native 解码同步改。
- [x] natives 表：样式表下发、计算结果查询、结果变化回调；`native-global.d.ts` + `natives.cpp`。
- [ ] 事件类型
- [ ] 都不涉及

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`、`flutter test`、`fjs-test`（native 自测）通过。
2. fjsrun 对拍：现有样式单测的场景 + hello-fjs / demo 全部页面，TS 引擎与 native 引擎的每元素样式、
   op 帧逐字节一致。
3. `examples/bench` 达到 §3；`bench:mount` 五页不回退。
4. 真机 iOS + Android：flat-4050 达到 §3；theme、vant、nutui、动画页外观与改前一致（截图对比）。
5. HarmonyOS（ohos）预编译产物重新生成并跑通。
6. 文档：architecture.md、css-compat.md、performance.md。

## 7. 待澄清

- [x] Q1 位置 → **C++，独立库 libfjs-style**（不依赖 JS 引擎，多引擎共用），libfjs 薄绑定；Dart 协议不变。
- [x] Q2 分阶段 → **先门控 spike**：C++ 只实现 flat-4050 用到的子集，实测 native 级联耗时与 JS 收益，
  离线 VDOM 挂载 ≤ 40 ms 才进全量移植。
- [x] Q3 → 先收尾 149（真机复测 → 按实测修订 → 文档 → 用户说提交再提交），150 从 149 分支开。

## 8. 阶段 0 结果（2026-09-28）

测法：`examples/bench` `pnpm run native:ts` / `pnpm run native:on`（同一份 `native/bench.ts`，只差
`__fjsNativeStyle`），fjsrun `--frames`（帧交给宿主，两种模式同样），Mac，7 次取 min/med/max 的中位数。

**对拍**：flat-4050 首次挂载后每个元素的 computed style 按 id 顺序 hash——TS / native、PrimJS / quickjs-ng
四种组合同一个 hash（`48142bbd`，4153 个样式元素）；match 命中 / 未命中（4147/6，结构规则 4106/47）、compute
（同）、applied（4153）计数与 TS 引擎逐项相同。`fjs-style-test`（C++ 单测：列表共享、首尾位、`+`、scope、
`:deep`、回调、坏帧）通过。

**VDOM 挂载（ms，中位数）**

| | TS | native | 变化 |
|---|---:|---:|---:|
| PrimJS，页面规则 | 59.3 | 42.5 | −28% |
| PrimJS，+结构规则 | 69.0 | 42.5 | −38% |
| quickjs-ng，页面规则 | 58.5 | 36.3 | −38% |
| quickjs-ng，+结构规则 | 61.0 | 33.7 | −45% |

- native 侧（`uiOps` 内：解析 + flush + 回调进 JS）全部 **0.6–0.7 ms**，C++ flush 本身 0.2–0.3 ms——spec §1
  估的「1–3 ms」偏保守。结构规则不再额外付费（TS 多 8–10 ms）。
- 卸载不变（~8.3 ms）。
- 剩下的 42 ms（PrimJS）≈ Vue ~18 + 元素层 ~9.5 + 渲染器 ~7.5 + 样式输入 op ~6。样式输入那部分每元素 3 次调用
  （ensure / addScope / setClasses），每次 ~0.5 µs，已是解释器下函数调用的底线：试过把 addScope / setClasses
  直接 bind 到后端省一层调用，差异在噪声内，已回滚。
- 与 §1 的上限实验（42.6 → 21.6 ms，不经过 Vue）比：省下的 17–27 ms 与上限实验省的 21–30 ms 同量级。

**门槛**：PrimJS 42.5 ms，差 2.5 ms 未过 ≤ 40；quickjs-ng 过。

**spike 的已知缺口**（阶段 1 要补，现在走 native 会静默或大声出错的地方）：属性选择器（`[class*=]` /
`[data-*]`，规则表里跳过并 console.error）、快照导入、DevTools matched rules、伪元素 / fixed 元素的 SetStyle
由 JS 再写一遍（多一帧字节）、C++ 侧 style 表不做 ResetStyles、match / result 表不回收、坏帧后只 detach 不回落
TS 引擎（该帧丢失）、Apple / Android / ohos 预编译脚本没带 `libfjs_style.a`。

## 9. 阶段 1 结果（2026-09-28）

用户决定进阶段 1。补齐 spike 缺口、默认开启：

- **C++**：属性选择器（`[class<op>v]` 按源顺序 class 列表、`[name<op>v]` 经 `ATTR` op，只有被测的名字进签名）、
  `RULES_APPEND`（逐 sheet 追加）、hits 记录（DevTools）、坏帧仍输出剔掉样式 op 的结构帧并转入只剔除模式、
  快照种子 `SEED_CHAIN` / `SEED_COMPUTE`（JSON 首次命中时经回调取）。`fjs-style-test` 覆盖属性、追加、坏帧。
- **JS**：默认开启（`__fjsNativeStyle` = false 关 / `'verify'` 双跑对拍）、match 按 hit 集合复用、结果表两代回收、
  NOTIFY 元素不再由 JS 重复写 SetStyle、`matchedRulesOf`、快照导入走种子。
- **对拍**：verify 模式下 flat-4050（66451 次比较）、demo 16 页 + bench:mount（含快照种子路径）、hello-fjs 66 页
  （17745 次），**0 不一致**。hello-fjs 里 5 页（rich-text / canvas / form / picker / textarea）单独挂载时栈溢出、
  list-view 抛 `cannot convert to object`：纯 TS 模式同样发生，与本 spec 无关（疑为 AGENTS §4.6 的 CLI 标签清单
  过期，未深究）。
- **测量**：见 [performance.md](../../docs/performance.md)「样式引擎下沉 C++」。flat-4050 VDOM 42.5 ms（PrimJS）/
  34–36 ms（quickjs-ng），Vapor ~74 → 60.5 ms；bench:mount 五页冷首帧 −3 ~ −6 ms、热 css 减半，带快照也更快。
  §3 的「vapor ≤ 55 ms」「VDOM ≤ 40 ms（PrimJS）」仍未达，差在 Vue / 元素层，不在样式。
- **预编译产物**：Apple（`build-apple.sh` 现把 `libfjs_style.a` 并进 `libfjs.a`）、Android、ohos 全部重新生成。
- **模拟器冒烟**（iPhone 17，`fjs run ios`，默认 native）：hello-fjs 4050（VDOM 显示 JS 80.5 ms，样式 flush 0.3 ms）、
  主题切换（CSS 变量 / 根 class）、伪类增删行、定位、弹窗；demo vant Popup（fixed 提升 + 遮罩，NOTIFY 回调路径）、
  Dialog、showToast / showLoadingToast、表单——外观与交互正常，日志无样式错误。主题页「帧大小」只计 JS 发出的字节，
  native 下偏小。
- **未做**：真机 iOS / Android 截图对比与 flat-4050 真机耗时（§6 第 4 条）；DevTools matched rules 在 native 下
  只能标出「可能匹配」的选择器（C++ 不记录具体哪个选择器命中）。
