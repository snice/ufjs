# Plan: 样式引擎命中路径瘦身

对应 spec：`./spec.md`（范围 (a)+(b)，目标 vant-form 首帧 CSS ≤ 5 ms）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否（内部优化） | 改的是 Flutter 路径独有的两处：样式引擎 `packages/fjs-runtime/src/css/style.ts` 与 op 编码 `packages/fjs-runtime/src/ui/ops.ts`。Web 用浏览器原生 CSS，不经过这两层，无对应改动。面向用户的能力与结果不变。 |
| II 边界即契约 | 否 | `DefineStyle` 的字节格式不变（u32 id + u32 长度 + UTF-8 JSON），`ui_ops.dart` 不动、`uiOpsVersion` 不升。natives 表、事件类型不动。构建期样式快照的格式会变（见 §3.2），但它是 JS 自产自销的数据（`fjs build` 写、运行时读），不在三张表里；靠 `STYLE_SNAPSHOT_VERSION` 2 → 3 让旧快照被拒并提示，不会静默误用。 |
| III 同步单线程零序列化 | 是 | 不引入任何桥或线程，只减少同一线程上的工作量。 |
| IV 外观照 WeUI | 否 | 不改默认外观。 |
| V 静默失效是 bug | 是 | 快照版本升级后，旧快照走现有的 `version N` 拒绝路径（`warnOnce` 打出原因）。inline 记忆的键如果漏掉某个输入，就会给错样式而且不报错，所以键的组成写进注释，并加单测对比"命中"与"重算"的结果。 |
| VI 注释记录权衡 | 是 | 需要写明：为什么 `DefineStyle` 走 `str()` 而不是缓存字节；inline 记忆的键为什么是 JSON 内容而不是对象身份；Map 的容量上限。 |
| VII JS 能包就不要下 Dart | 不下 Dart | 全部在 JS 侧完成。备选里"加一个原生 UTF-8 编码 native"被否掉，见 §3.3。 |
| VIII 变更落到文档 | 是 | `docs/vant-mount-perf.md` 补一节（剖析表、改动、前后对比）。`docs/css-compat.md` / `ui-api.md` 不涉及（语义不变）。`docs/roadmap.md` 打勾一条。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | —（不动） | 快照由 `bundler/style-snapshot.ts` 调运行时 `exportSnapshot()` 产出，格式随运行时走，CLI 代码不用改。改完需要 `pnpm --filter @ufjs/cli run build`，dist 会内联运行时（AGENTS.md §4.6）。 |
| JS runtime | `packages/fjs-runtime/src/ui/ops.ts` | `styleId()`：`utf8Encode(JSON.stringify(style))` + `bytes()` 改为 `this.str(JSON.stringify(style), true)`。ASCII 直写，非 ASCII 自动退回 `utf8Encode`，写出的字节与原来逐字节相同。 |
| JS runtime | `packages/fjs-runtime/src/css/style.ts` | ① `ElementState` 加 `inlineKey?: string`：`setInlineStyle` / `patchInlineStyle` / `mutateInline` / `setInlineCustomProps` 改 inline 时清掉。② `MatchResult` 加 `byInline: Map<string, ComputeResult>`，键为 `${parentStyleId}\u0003${inlineKey}`，上限 128，满了整表清空（与 `byParent` 的 64 同一个思路）。③ `compute()`：有 inline 的元素查 `byInline`，未命中就照常计算后写入。④ `exportSnapshot()` / `importSnapshot()`：computes 行加第 10 列 `inlineKey`（`''` 表示无 inline），有 inline 的元素及其子树也导出；`STYLE_SNAPSHOT_VERSION` 2 → 3。 |
| Web 适配层 | —（不涉及） | |
| C++ 引擎 | —（不涉及） | |
| Dart 宿主 | —（不涉及） | |
| 测试 | `packages/fjs-runtime/test/`（新增 `css-inline-memo.test.ts`、`ops-define-style.test.ts`） | 见 §5。现有样式 / 快照测试不改期望值。 |
| 基准 | `demo/bench/mount-core.ts`（不改）、临时剖析脚本 `demo/bench/_css-prof.ts`（不提交，验收完删除） | 前后对比用。 |
| 文档 | `docs/vant-mount-perf.md`、`docs/roadmap.md` | 见 VIII。 |

## 3. 方案

### 3.1 (a) `DefineStyle` 走 ASCII 直写

`OpWriter.str(s, wide=true)` 本来就写"u32 长度 + UTF-8 字节"，遇到第一个非 ASCII 字符就退回
`utf8Encode`，这正是 `DefineStyle` 在 id 之后的字节布局。所以只需把

```ts
const json = utf8Encode(JSON.stringify(style));
this.u8(UiOp.DefineStyle); this.u32(id); this.u32(json.length); this.bytes(json);
```

换成

```ts
this.u8(UiOp.DefineStyle); this.u32(id); this.str(JSON.stringify(style), true);
```

样式 JSON 基本都是 ASCII（中文字体名、`content` 里的文字除外，它们会走原来的退回路径）。预计
省掉 utf8Encode 的两遍循环、临时数组和一次拷贝。`str` 自己还有一遍逐字符写入，所以收益大约是
现在的一半到三分之二（specs/118 给 SetText 做同样改动时是 6.3 → 4.6 µs）。

### 3.2 (b) inline 样式元素也进记忆和快照

**键**：`${parentStyleId}\u0003${inlineKey}`，其中 `inlineKey = JSON.stringify(s.inline ?? null) +
'\u0003' + JSON.stringify(s.inlineCustom ?? null)`，按元素缓存，inline 变化时清空。

**键为什么够用**：`compute()` 的输入有 (父计算样式, 父 custom, 匹配结果, tag 默认值, rawText,
inline, inlineCustom)。前四项已经由 `byParent` 所在的 `MatchResult`（链 key 含 tag）加
`parentStyleId`（父的计算结果和 custom 同出一次计算）确定，`defaultsId` / `rawText` 命中时照旧校验，
剩下只差 inline 两项，由 `inlineKey` 补齐。

**为什么用内容而不用对象身份**：Vue 每次渲染 `:style` 都会产生新对象，vant 的 Slider / Rate 每个
实例的 inline 也各不相同。内容键能让同一个组件的多个实例（例如一排 Rate 星星）共用一个结果，
也能在快照里跨进程对应。`JSON.stringify` 是原生的，一个 inline 对象不到 1 µs。

**快照**：export 时不再跳过有 inline 的元素，computes 行加 `inlineKey` 列；import 时有 inlineKey 的
行写进 `byInline`。连带收益：以前 inline 元素的整棵子树都拿不到快照（`parentCompute` 为 -1），
现在也能拿到。版本号升到 3。

**共享结果对象**：命中时多个元素拿到同一个 style 对象，和 `byParent` 命中一样，下游
（`recompute` 的恒等比较、ops 的 `styleIds` WeakMap）本来就按"共享、只读"处理。副作用是
DefineStyle 更少。

### 3.3 被否掉的备选

| 方案 | 否掉的原因 |
|---|---|
| **加原生 UTF-8 编码 native**（`natives.cpp` + `native-global.d.ts`，或实现 `TextEncoder`） | 编码能降到接近 0，但要动 natives 表（宪法 II），还要重编各平台预编译产物（AGENTS.md §4.8）。(a) 已经拿到大头，剩下的留作后续。 |
| **按样式对象缓存编码后的字节**（像 `setConstProps` 那样） | 同一个样式对象在一个 style epoch 里本来就只定义一次，缓存字节只对 ResetStyles 之后重定义有用，命中率低。 |
| **快照里直接带 DefineStyle 的字节 / 预定义样式表** | 需要构建期与运行时的 style id 对齐，要改协议，属于 IFR 那一类大改动，spec 144 Non-goals。 |
| **inline 记忆用对象身份做键** | Vue 每次渲染都产生新对象，命中率约为 0；也无法进快照。 |
| **(c) 命中路径固定开销** | 用户定为量完 (a)+(b) 再决定。 |

## 4. 风险

1. **inline 记忆键遗漏输入会静默出错**：比如 compute 依赖了某个不在键里的状态。对策：单测覆盖
   命中与重算结果逐项相等（含 inline `--x` 变量、em、calc、`:active` / `:hover` 变体、伪元素），
   并在注释里列出输入清单。
2. **快照体积变大**：多导出 inline 元素及其子树。验收时记录 `style prewarm: … (N KB)` 的前后值，
   超过 +30% 就回来评估。
3. **`byInline` 内存**：内容各不相同的 inline（例如拖拽时每帧都在变的 transform）会不断写入；
   上限 128，满了清空，所以有界。动画的每帧写 inline 属于 restyle 路径，本来就是 miss，行为不变。
4. **非 ASCII 样式**：`str` 的退回路径与原来字节一致，有单测对比。
5. **cli dist 内联运行时**：改完要重建 `@ufjs/cli`，否则 demo 构建出来的快照还是 v2（AGENTS.md §4.6）。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test                                     # 含新增 css-inline-memo / ops-define-style
pnpm --filter @ufjs/cli run build
pnpm --filter demo run bench:mount            # prewarm：vant-form css ≤ 5 ms，五页 miss 不变
cd demo && pnpm exec fjs build bench/_css-prof.ts --out dist/_css-prof \
  && ../packages/flutter_fjs/native/build-native/fjsrun --pump 50 dist/_css-prof/app/bundle.js   # 分项对比
cd packages/flutter_fjs && flutter test       # 先编 native，确认不是 No tests ran
cd demo && pnpm exec fjs run ios --profile -d 00008101-000978E201FA001E   # 真机逐页 [nav] mounted + 截图对比
```

基线（改前，本机）：vant-form prewarm cold `css 9.1`；剖析 `applyStyle 4.25 / compute 3.65 ms`，
`computeMiss 42`。
