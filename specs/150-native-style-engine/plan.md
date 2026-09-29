# Plan: 样式引擎下沉 C++（libfjs-style）

对应 spec：`./spec.md`。本文件先覆盖**阶段 0（门控 spike）**；阶段 1 在 spike 过门后补。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 只动 Flutter 路径；web 用浏览器 CSS |
| II 边界即契约 | 是 | 新增 JS → libfjs-style 的样式输入 op（Dart 不可见，`ops.ts` 注明 native-only）；natives 新增 `styleAttach`，`native-global.d.ts` 同步；`fjs_style.h` 是 libfjs-style 唯一的 ABI 描述 |
| III 同步单线程零序列化 | 是 | 全部在 `uiOps` 调用内同步完成；回调是同线程的 JS 调用；样式输入走现有 op 帧，不另开 JSON 桥（样式表与未命中回调除外，都是每页个位数次） |
| V 静默失效是 bug | 是 | spike 遇到不支持的选择器特性 → 整体回落 TS 引擎并告警，不静默算错；fjsrun 对拍 |
| VI 注释记录权衡 | 是 | — |
| VII JS 能包就不要下 Dart | 是 | 有实测性能理由（spec §1），下沉的是 C++ 而非 Dart |
| VIII 变更落到文档 | 是 | 阶段 1 落地时写 architecture.md / css-compat.md / performance.md；spike 结果写 spec §8 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| C++ 新库 | `packages/flutter_fjs/native/style/`：`include/fjs_style.h`、`src/style.cpp`、`test/style_test.cpp` | 引擎无关的样式核心，CMake target `fjs_style`（静态库）+ `fjs-style-test` |
| C++ libfjs | `native/CMakeLists.txt`、`native/src/natives.cpp`、`native/src/fjs_internal.h` | 链接 `fjs_style`；`__fjs.fns.styleAttach(callbacks)`；`uiOps` 在已 attach 时先交给 libfjs-style 处理再给 Dart |
| JS runtime | `fjs-runtime/src/ui/ops.ts` | native-only 样式输入 op（DefineAtom / StyleEl / StyleClasses / StyleScope / DefineRules） |
| JS runtime | `fjs-runtime/src/css/style.ts` | 抽出两个纯函数：`buildMatch(命中列表)`、`computeStyle(输入)`，TS 引擎自己也走它们（行为不变） |
| JS runtime | `fjs-runtime/src/css/native-style.ts`（新） | `NativeStyleEngine`：渲染器用到的 StyleEngine 接口的 native 版——写样式输入 op、回调里建 match / 算样式 |
| JS runtime | `fjs-runtime/src/vue/renderer.ts` | spike 期间由开关选择引擎（`globalThis.__fjsNativeStyle`），默认仍是 TS |
| JS runtime | `fjs-runtime/src/native-global.d.ts` | `styleAttach` 类型 |
| bench | `examples/bench/vapor/main.ts` 或新脚本 | 同一棵树 TS / native 两种模式对比，native 侧耗时单独计 |

## 3. 方案

### 3.1 libfjs-style 的数据与 ABI

- **原子**：tag、class、scope 都是 JS 驻留的整数 id。第一次出现时 JS 在帧里写 `DefineAtom(id, utf8)`，
  libfjs-style 记下（class 串还要拆成单个 class 原子，按串缓存）。
- **样式表**：`DefineRules(json)` 一次下发 JS 解析好的规则（规则序号、scope 原子、每个选择器的
  compounds：tag / classes / 首尾位 / attrs、combinators、deep / active / hover / pseudo、specificity）。
  spike 只支持 flat-4050 与 hello-fjs 用到的子集；遇到不支持的（@media、属性选择器等）→ 返回失败，
  JS 整体回落 TS 引擎。
- **元素**：结构 op（Create / Insert / Remove / RemoveChild）照读照转发；`StyleEl(id, tag, defaults, rawText)`
  使元素参与样式（没登记的 = 锚点 / 伪元素盒，不参与位置，与 TS 一致）；`StyleClasses(id, atom)`、`StyleScope(id, atom)`。
- **flush**：处理完一帧的输入后，按 id 升序对脏元素：签名（tag / class 集 / scope 集 / 首尾位 / 前兄弟签名）→
  chain 缓存 → 未命中则候选桶 + 选择器匹配，把命中列表（规则序号 + 三种 cascade 的最佳 specificity）驻留成
  match id，**新 match id 回调 JS `defineMatch`**；再以 (match id, 父结果 id, defaults, rawText) 查 compute 缓存，
  **未命中回调 JS `compute`**，拿回 JS 结果 id 与样式 JSON（+ :active / :hover 变体）。样式 JSON 在
  libfjs-style 里驻留成线上 style id，第一次用时写 DefineStyle；元素的线上 id 变了才写 SetStyle。
- **ABI**（`fjs_style.h`，C，无 JS 类型）：`fjs_style_create(callbacks, user)` / `destroy` /
  `fjs_style_process(in, len, out)` / `fjs_style_computed_result(id)`。回调是 C 函数指针，libfjs 的绑定把它们
  转成对 JS 函数的调用——换引擎只换这层。

### 3.2 JS 侧

- `buildMatch(pairs)`：matchRules 未命中路径里「命中列表 → decls / custom / active / hover / 伪元素 cascade」那段，
  原样抽出；TS 引擎和 native 回调共用。
- `computeStyle(match, parentResult, defaults, rawText, inline, tag)`：compute 未命中路径原样抽出，返回
  ComputeResult；TS 引擎和 native 回调共用。
- `NativeStyleEngine`：`ensure` / `addScope` / `setClasses` 写 op；`recomputeSubtree` / `noteStructureChange` /
  `flushPending` 空操作（结构从 op 流来，flush 在 native）；`computedOf` 查 native 结果 id → JS 结果表。

### 3.3 被否的备选

- **整个引擎移植 C++**：4500 行 TS 的语义（var / em / calc / keyframes / 伪元素 / 快照）要写第二份并长期保持一致，
  而这些只在未命中时运行，下沉它们不省 JS 时间。
- **每个样式调用一次 JSI 调用**（不走 op 帧）：每次跨界的固定开销与现在的 Map 写入同量级，省不下来。
- **放 Dart**：用户选 C++。

## 4. 风险

- **回调重入**：compute 回调在 `uiOps` 内部调用 JS。JS 在回调里不得再 flush（写入 JS 的 op 缓冲会进下一帧）。
- **两张 style 表**：JS 的 OpWriter 也写 DefineStyle（锚点以外极少，但伪元素盒会）。spike 不支持伪元素规则；
  阶段 1 让 libfjs-style 接管全部 DefineStyle（把 JS 定义的 style id 重映射进自己的表）。
- **渲染器副作用**：fixed 提升、modal、伪元素盒依赖计算结果；spike 里 compute 结果带标记，遇到需要副作用的样式
  整体回落 TS 引擎，阶段 1 再做 `styled` 回调。
- **GC / 句柄**：JS 回调函数在 attach 时 dup，VM 销毁时释放。

---

## 阶段 1：全量（用户 2026-09-28 决定进入）

spike 已证明方向（§8）；阶段 1 把 spike 缺口补齐、默认打开、上真机。CSS 语义仍只在 TS。

### 5. 改动

| 层 | 文件 | 改什么 |
|----|------|--------|
| C++ | `style/src/style.cpp`、`fjs_style.h` | 属性选择器：`[class<op>v]`（按**源顺序**的 class 列表，另存一份）、`[name]` / `[name<op>v]`（新 op `ATTR`，只有选择器测到的名字进签名）；`RULES_APPEND`（新 scoped 表追加、不清缓存，shape 旗标翻转时自己整体失效）；每个 match 记下 hits，`fjs_style_hits_of` 供 DevTools；坏帧时仍输出剔掉样式 op 的原帧（Dart 不丢结构） |
| libfjs | `natives.cpp` | `styleMatchedRules`；d.ts 同步 |
| JS | `css/native-style.ts`、`css/style.ts` | 属性输入与表编码；scoped 表走追加快路径（条件同 TS register 的快路径：scope 未见过、无 :root / keyframes、shape 旗标不变）；**match 按 hit 集合复用**（同一组规则的不同 chain 共用一个 MatchResult → compute 也共用）；结果表分代回收（超上限 → RESTYLE(0) 换代，旧代留一轮）；NOTIFY 元素不再由 JS 重复写 SetStyle；`matchedRulesOf`；坏帧后回落：native 断开时 JS 打错误并整页重发（见下） |
| JS | `vue/renderer.ts` | 默认开启：宿主有 `styleAttach` 即走 native，`__fjsNativeStyle = false` 关闭；`'verify'` = 双跑对拍模式 |
| 对拍 | `css/style.ts` verify 模式 | TS 引擎照常跑（状态、flush、SetStyle），native 同时跑；每帧送出后逐个比较本帧 TS 重算过的元素，不一致打印元素 id、两边样式 —— 任何 app 在 fjsrun / 真机上都能对拍 |
| 构建 | `tool/build-apple.sh` | 归档加 `libfjs_style.a`（Android / ohos 是共享库，CMake 已静态链入） |
| 文档 | `architecture.md`、`css-compat.md`、`performance.md` | libfjs-style 的位置与数据流、开关、对拍模式、实测 |

**坏帧回落**：libfjs-style 失败只可能来自协议 bug 或 JS 回调抛错。回落 = 断开 native（C++ 仍把该帧剔掉样式 op 交给 Dart），
JS 侧 `console.error` 并把引擎切回 TS：TS 引擎没有逐元素状态，所以不做无缝迁移，只保证不丢结构、错误可见（宪法 V）。

**快照**：native 模式不导入 build-time 快照。补偿是「match 按 hit 集合复用」；是否还需要快照看 `bench:mount` 实测，写进 §8。

### 6. 风险

- verify 模式下一帧里 TS 与 C++ 各写一份 SetStyle（C++ 的在帧尾，生效）—— 只用于对拍。
- 默认开启后，所有 app 走 native：demo / hello-fjs 全页面 verify 无差异才打开默认。
