# vant 页面打开慢：分析与优化（2026-09）

> 第四层，是 [performance.md](performance.md) 的专题续篇：那篇讲的是「重排」（已挂载
> 页面上的样式变更），这篇讲「首开」（一个页面从 `navMount` 到可交互的账）。
> 结论先说：**慢在 JS 侧 CSS 引擎的选择器匹配，不在网络、不在 Vue、也不在 native。**

## 现象

demo 加了 vant 演示（specs/068–073）之后，从首页点进任何 vant 页面，push 转场
动画会明显冻一下才出内容。fjs go 日志面板里的 `[nav] mounted` 一行给出量化：

```
[nav] mounted key=2 chunk=(inline) in 401ms     ← vant-form
[nav] mounted key=5 chunk=(inline) in 16ms      ← /about（对照）
```

这行日志打在 `packages/flutter_fjs/lib/src/engine.dart` 的 `_mountWhenReady()`：
计时窗口 = 页面 chunk 拉取 + `dispatchEvent(navMount)` 一次同步 JS 执行，**不含**
前后的转场等待与下一帧的 widget build。dev 单 bundle 模式下 chunk 是内联的
（`manifest.json` 里 `split:false, units:false`），所以窗口里几乎只剩 JS 侧
navMount 本身。

## 实测

iPhone 17 模拟器、fjs go（debug）、`fjs dev` 单 bundle、QuickJS-ng。每个页面
都是本次会话首次打开（连接后重新加载 bundle）。方法：临时在运行时里加三处
打点（测完已撤，加法见[附录](#附录怎么复现与怎么量)）：

1. `fjs-runtime/src/router/flutter.ts` 的 `mount()` —— Vue `app.mount()` 耗时；
2. `fjs-runtime/src/host.ts` 的 `flushNow()` —— pre-flush（CSS 重算）与整次
   flush 的分账；
3. `fjs-runtime/src/css/style.ts` 的 `flushPending()` —— 样式引擎计数器
   （matchHit/matchMiss/rules）。

| 页面 | navMount 总计 | Vue render | CSS 匹配（flush） | 新增 match miss | op 帧大小 |
|---|---:|---:|---:|---:|---:|
| /about（普通页） | 16 ms | 1.5 ms | ~10 ms | 11 | — |
| vant-basic | 196 ms | 17.6 ms | ~140 ms | ~160 | 49 KB |
| vant-feedback | 66 ms | — | — | — | — |
| vant-form | 401 ms | 45.8 ms | **299 ms** | ~275 | 87 KB |
| vant-more | 341 ms | 28.4 ms | **282 ms** | ~276 | 64 KB |
| vant-nav | 228 ms | ~30 ms | ~173 ms | ~185 | 4.8 KB |

（CSS 匹配一列是相邻两次计数器快照的差值；不带打点的第一轮读数 —— basic 236 /
feedback 66 / form 433 / more 364 / nav 240 ms —— 与之一致，打点本身没有扰动结论。）

三笔账的分法与 [performance.md](performance.md) 里主题切换的结论完全同构：

- **Vue render 占 10–15%**：17–46 ms，是页面节点数的函数，不随 vant 特别恶化。
- **CSS 匹配占 70–75%，且与页面「新出现的元素签名」数成正比**——这就是主因。
- **native 侧几乎为零**：op 帧最大 87 KB，编码 + 镜像树应用合计 < 1 ms（对照
  performance.md「过桥已经不是成本」）。widget build/layout/paint 发生在下一帧，
  不在这个计时器里，但见下文「为什么观感是卡」。

### 二次打开同样慢（缓存被卸载逐出）

样式引擎对匹配结果有两级缓存（链签名 → `matchCache`）。直觉上第二次打开同一页
应该近乎免费——实测不是：**关掉再重开 vant-basic 依旧 194 ms，CSS flush 依旧
144.6 ms**。

原因在 `style.ts` 的 `releaseChain()`：链引用计数归零（页面卸载正是全归零）时，
`chainIds` 和 `matchCache` 条目**一并删除**。缓存只在「同一页面挂载期间」和
「同时挂载的页面之间」复用，跨访问一律重付。普通页面重开无感（/about 重开
16 ms），是因为它的 miss 基数只有 11。

## 原因链

1. **规则全集常驻**：`demo/src/plugins/vant.ts` 全局注册 69 个 vant 组件及其
   全部样式（一个插件同时喂两端，见 specs/068 的取舍）。这些样式在 bundle 求值
   时一次性注册进 CSS 引擎：**639 条规则**（vant 源 CSS 1056 个选择器，共享
   base 去重 + 多选择器合并后的规则数），约 80 KB，无论打开哪个页面都在。
2. **未命中 = 全量线性扫**：`style.ts` 的 `matchRules()` 对每个「链签名没见过」
   的元素 `for (const rule of this.rules)` 逐条 × 逐 selector 匹配（含 media、
   scope、specificity 记账）。vant 页面的一次挂载产生几百个新链签名
   （van-* 组件的包裹层级深、组合多），vant-form 是 ~275 个。
3. **QuickJS 无 JIT**：~275 miss × 639 规则 ≈ 17.6 万次规则访问 ≈ 299 ms，即
   **~1.7 µs/规则访问**。浏览器对同样的工作用的是索引 + JIT，这就是「web 端
   完全无感、app 端很卡」的出处；小程序端样式走 Skyline 自己的系统，同样没有
   这笔账。
4. **UI 线程同步**：JS 与渲染在同一根线程上（threading-model.md），navMount 的
   200–400 ms 把 push 转场动画冻在半路——这是「打开很耗时」的观感来源。

**release 构建解决不了这件事**：字节码只省掉解析，匹配是运行时 JS 工作，数字
基本不变。分包/units 也无关——样式随插件进共享 prelude，规则全集一样常驻。

## 为什么是 vant 触发，而账在引擎

vant 只是「一次挂载产生大量新元素签名」的放大器，任何满足同条件的页面（深层级
包裹、组件化拼装）都会踩到同一笔账。按最右复合选择器统计 demo 实际注册的选择器
形状：

| 最右侧复合 | 占比 | 说明 |
|---|---:|---|
| 单个 class（`.van-cell`） | **50.7%** | 索引收益最大的一批 |
| 裸标签（`input`、`button:active`…） | ~45% | vant 的元素默认样式，按标签分桶 |
| 属性 / 通配等（`[class*=van-]:focus`） | 少数 | 落保守的兜底桶 |

（来源：`node_modules/vant/es/*/style/*.css` 全量解析；引擎注册后的 639 条规则
同分布。）

## 优化方向（按 ROI 排）

以下都还没做；按仓库规矩，动 CSS 引擎属于 spec 级改动，落地前先 `/spec`。
每条附验证方法——验收口径就是本文的表。

> **更新（2026-09，specs/075）**：方向 1 已落地，实测见下文
> [优化落地](#优化落地specs075最右复合选择器索引)。
> **更新（2026-09，specs/076）**：方向 2 已落地（重开命中），计算段分配瘦身
> 也已落地，实测同见下节。
> **更新（2026-09，specs/084）**：首开剩余的 Dart 派生驻留 + compute miss
> 再瘦，见 [解析驻留](#解析驻留与-compute-miss-再瘦specs084)。

### 1. 按最右复合选择器建规则索引（主修）

`matchRules()` 先把规则按**最右侧复合选择器**的 class / 标签预分桶（注册时做
一次）；匹配时从元素自己的 class / 标签查桶，只在候选集（通常 < 30 条）里扫，
而不是 639 条。设计要点：

- 兜底桶：无 class 无标签的选择器（`*`、纯组合器结尾）进一个恒扫的小桶，
  保证正确性不依赖「选择器都有归属」。
- 级联顺序必须保持：桶内按 (specificity, 源顺序) 排序、跨桶合并时同样排序；
  `@media` 过滤、scoped/scope 检查、`:active`/`:hover` 三 Cascade 的分装、
  `::before/::after` 独立规则表，全部维持现有语义（索引只改「哪些规则参与
  匹配」，不改「匹配上之后怎么算」）。
- 预期：miss 成本降 1–2 个数量级，vant-form 的 ~299 ms 到个位十 ms。
- 验证：`packages/fjs-runtime` 现有 CSS 引擎测试全绿 + 本文附录的采集流程重测
  对比表 + performance.md 的 `styleEngine.stats` 口径（matchMiss 总数不应变化
  ——索引改变的是每次 miss 的价格，不是 miss 的数量）。

### 2. 链缓存跨卸载保留（止血，改动最小）

`releaseChain()` 归零时不再立刻删 `matchCache` / `chainIds`，改为有上限的保留
（LRU 或按代际批量回收，比如保留最近 N 条链）。重开同一页面从 ~200 ms 掉到
只剩 Vue render（20–45 ms）。风险是内存驻留：一条 MatchResult 带声明表与
byParent 映射，上限设在几百条的量级即可，代价可控。**它治不了首次打开**，
与第 1 条是叠加关系，不是替代。

### 3. 应用层杠杆（demo 可选，不是通用解）

按页面注册用到的 vant 组件样式而非全量（插件拆分 / 页面级 import）。demo 的
五个 vant 页组件高度重合，规则全集缩不下来多少；列在这里只为完整——**它改变
的是 miss 的数量，第 1 条改变的是 miss 的单价**。

### 不值得做的

- 把 CSS 匹配挪去 Worker：匹配结果被 op flush 消费，跨 VM 传样式表的成本会
  吃掉收益，且 Worker 与 UI 的同步语义是 threading-model 明确不碰的领域。
- 期待 release / 字节码 / 分包：见上文，均与这笔账无关。

## 优化落地（specs/075：最右复合选择器索引）

`packages/fjs-runtime/src/css/style.ts` 的 `matchRules()` 不再全量扫规则：
注册时按**选择器主体（最右复合）**入桶——主体的第一个 class（主体匹配要求
元素持有主体全部 class，第一个 class 是必要条件，漏桶不可能漏掉真匹配）、
无 class 则按标签，两者都没有（`*`、`[class*=…]`）进恒扫的兜底桶。匹配时
走元素自己的 class 桶 + 标签桶 + 兜底桶，stamp 去重；media/scope/`:deep`/
三 Cascade/伪元素分桶语义逐字未动。既有 `css.test.ts` 一个用例没改、全过；
新增 `css-selector-index.test.ts` 17 个专项用例钉住"索引不能让选择器不可达"。

iPhone 17 模拟器、fjs go、dev 单 bundle，同口径复测：

| 页面 | navMount 总计 | CSS 匹配+重算（flush） | 其中匹配段 | match miss 增量 |
|---|---:|---:|---:|---:|
| vant-basic | 236 → **141 ms** | ~140 → ~42 ms | — | ~160 → 180 |
| vant-form | 401 → **228 ms** | 299 → **70 ms** | 7.2 ms | 275 → **275** |
| vant-more | 364 → **147 ms** | 282 → ~59 ms | — | 276 → **276** |
| vant-nav | 240 → **110 ms** | ~173 → ~45 ms | — | 185 → **185** |
| /about | 16 → **11 ms** | ~10 → ~3 ms | — | 11 → **11** |

三个读数：

- **miss 数量逐页相等（275/276/185 分毫不差）**——索引改变的是 miss 的单价，
  不是 miss 的个数，和设计完全一致。这也是回归哨：哪天这个数变了，就是
  匹配语义变了。
- **匹配段 240 → 7.2 ms（33×）**。flush 剩下的 ~62 ms 是 recompute 的计算段
  （继承、缓存键、sameStyle 比较），不是匹配——那是 performance.md
  「已知热点」里样式引擎每节点分配那条线（specs/001/002），不在索引的射程内。
- **mounted 总量的波动是 GC**：同一份代码两轮量出 228 和 167 ms（上表取的
  前者），performance.md「真机上是 GC 在主导」同款现象；看量级和 miss 数，
  不要抠单次读数。

小规则集不回退：`examples/bench` 同机 A/B（stash 对照），`style-mount-1000-rows`
min 143.8 → 142.8 ms、切主题 34.5 → 35.0 ms——索引查询是每 miss 几次
Map.get，量不出来。

### shared.js 里的 vant 样式（同一件事的 release 形态）

分包构建下 vant 样式并不在页面 chunk 里，而是在 **shared.js**（共享 prelude）
里注册——56 处 `registerStyles` 调用、约 80 KB CSS，应用一启动就全部注册。
机制：样式 import 写在 `src/plugins/vant.ts`，这个插件是 app 入口（`main.ts`
→ `fjs/plugins`）的依赖，**入口引到的东西必然进 prelude**。把 `vant` 从
`fjs.config` 的 `shared` 清单里拿掉**没有用**（实测复-build 后 shared.js 依旧
56 处调用）——`shared` 清单管的是"npm 包的模块是否提升进 prelude"，管不住
入口自己 import 的模块。

索引落地后，这笔常驻的代价只剩两笔一次性账：启动时解析 639 条规则（一次）、
prelude 体积。想把样式挪出 prelude，方向是**页面级注册**——页面只 import 自己
用到的组件样式、样式随页面 chunk 走，或者运行时按"首次用到该组件标签"懒注册。
两者都动 demo 的插件组织方式，另立 spec。

## 计算段瘦身与重开命中（specs/076）

075 之后对 vant-form 首开 flush 的子段打点（same-session 计，模拟器）给出了
剩余的账：**每次 compute miss 把父级 custom 属性表整个拷贝一遍**——vant 的
`--van-*` token 表实测 **494 个键**，286 次 miss ≈ 14 万次属性拷贝，custom 段
30–35 ms 恒定是最大头；`resolveVars` 无论有没有 var() 都先 `Object.entries`
+ 整份拷贝再判断；其余 merge/keys/pseudo 各 <1 ms。同时连续开关同一页的
flush 总量以 **+82 ms/轮** 线性爬升而 attributed 段恒定——分配驱动的全堆
回收（performance.md「真机上是 GC 在主导」的模拟器版）。

076 的四刀（全部在 `css/style.ts`，语义零变化）：

1. **custom 表共享**：compute miss 按来源数分派——0 来源 `undefined`、
   恰 1 来源**直接引用该表**（父表 / matched.custom / 内联 `--x`）、
   ≥2 来源才写拷贝。前提是 `s.custom` 全部下游只读（已核查 + 注释钉住）。
2. **resolveVars 快路径**：先空手扫 `var(`，没有就原对象返回（零分配）。
3. 折叠循环 `Object.entries` → `for-in`（plain/active/hover/pseudo 四处）。
4. **链缓存 retire**：卸载不再立刻删 `chainIds`/`matchCache`，进有上限的
   保留队列（512 条 ≈ 0.2 MB），修剪跳过被重新引用的键；`register()` /
   `setViewport()` 换样式表照旧整体失效并重置队列。

同打点同方法 A/B（reload 后首开 / 返回再开）：

| 指标 | 075 后 | 076 后 |
|---|---:|---:|
| 首开 flush 总量 | 223.5 ms（且 +82/轮爬升） | **47.4 ms**（稳定） |
| 其中 custom 段 | 30.3 ms | **4.3 ms**（残值是打点自身开销） |
| 其中 attributed 总段 | ~39 ms | **13.7 ms** |
| 重开（返回→再开）match miss | 299（全款） | **53** |
| 重开 CSS attributed | ~39 ms | **3.3 ms** |

读数三条：

- 重开剩下 53 次 compute miss 是 `byParent` 的键（父 computedId 每次挂载
  新发号）导致的重算——matchCache 命中后 match 成本是零，重算的那点账
  已经不重要（3.3 ms）。
- 重开 flush 总量（~84 ms）里剩的是 Vue 挂载 + GC，不是 CSS；口径要看
  attributed 段，别看总量。
- bench 同机 A/B 无回退，`theme-switch-cascade-only` 22.9 对 28.0 ms——
  resolveVars 快路径在纯级联路径上的直接收益。

## 解析驻留与 compute miss 再瘦（specs/084）

075/076 之后 vant-form 首开的匹配已经不是主因（match miss 仍 275，语义哨）。
剩下两段能量到、且不动 GC：

1. **Dart**：`FjsStyleEntry` 挂 interned `FjsStyle` view（`Object? resolvedView`，
   与 `MirrorNode.view` 同层，op 解码器不 import painting）。共享同一
   `styleId` 的节点共用 padding / `boxBorders` / 圆角等派生对象；`DEFINE_STYLE`
   换对象即失效。`:active`/`:hover` overlay 按 `(hoverId << 32) | activeId`
   缓存在 **base** entry 上，不写穿共享 view。`keepsBox` 从 `FjsStyle` 挪到
   `decorateNode` 参数（per-node 的 widget 形状，不是 per-style）。
2. **JS**：compute miss 用冻结 `INHERITABLE_KEYS` 按下标拷继承，defaults /
   decls / inline 用 `for-in` 盖到同一 `merged` 上。076 当时否掉这刀是因为
   custom 拷贝 30 ms 把 merge <1 ms 盖住了。

验收测试：`resolved_style_test` 钉住 identical / 换 id / overlay 不写穿；
`css-compute-diet` 补无自带声明的子元素仍继承 color/fontSize。`pnpm test` /
`typecheck` / `flutter test` 全绿；render_bench 重建不再走进 `style_parse`。

iPhone 17 模拟器、`fjs run ios` debug、chunk 预热后同口径（附录打点，量完已撤）：

| 指标 | 076 后（084 前） | 084 |
|---|---:|---:|
| vant-form 首开 Vue mount | 40 ms | **40 ms** |
| vant-form 首开 CSS flush | 37.4 ms / compute miss 286 | **37.8 ms / compute miss 286** |
| vant-form 首开 applyFrame | 7.5 ms / 87 KB | **8.1 ms / 87 KB** |
| vant-form 首开 `[nav] mounted` | 259 ms | **250 ms** |
| vant-form 首开 first-paint | 57 ms / 598 节点 | **61 ms / 598 节点** |
| vant-form 重开 first-paint | 28 ms | **32 ms** |
| match miss | 275 | **275** |

first-paint 没有进到 ≤ 30 ms（debug 模拟器、598 个 widget 仍要逐个 build/layout/paint）。驻留削的是派生对象分配，测出来被噪声盖住；不拿 GC 凑数。CSS flush 同样停在 37 ms 量级——076 已经把 custom 拷贝砍掉，本轮 inherit 合并在 QuickJS 上不够单独成行。match miss 哨未退。下一步若还要压首帧，得动包装层个数（另立项），不是再瘦 `FjsStyle` getter。

## 附录：怎么复现与怎么量

```bash
# 1. dev server
cd demo && pnpm run dev                 # :38900，单 bundle 模式（manifest: split:false）

# 2. 模拟器跑 fjs go（本机 flutter 是 OHOS fork，fjs-go 带 ohos/ 目录，
#    不关 ohos 开关会被 HOS_SDK_HOME 卡死；测完记得恢复）
flutter config --no-enable-ohos
cd examples/fjs-go
flutter run -d <simulator-udid> --dart-define=FJS_DEV=127.0.0.1:38900
# 恢复：flutter config --enable-ohos

# 3. 看 [nav] mounted：fjs go 界面里 dev 菜单 → 日志；
#    要在终端抓，临时在 log_store.dart 的 addEngineLog() 加一行 print（用完撤）
```

三处临时打点（对应正文方法一节，量完即撤，不要提交）：

- `router/flutter.ts` `mount()`：`app.mount(root)` 前后 `nowMs()` 差值；
- `host.ts` `flushNow()`：pre-flush 循环前后与总耗时分账，超阈值才打印；
- `css/style.ts` `flushPending()`：打印 `counters`（matchHit/matchMiss/规则数），
  读差值而不是累计值。

数字口径的提醒（同 performance.md 的规矩）：单次读数含 GC 运气，结论看**两轮
独立测量的一致性**与**量级差**（本例 14–25×），不要抠个位数；模拟器 debug 与
真机的差异在 CPU 与堆压力，方向是真机更慢。
