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

first-paint 没有进到 ≤ 30 ms（debug 模拟器、598 个 widget 仍要逐个 build/layout/paint）。驻留削的是派生对象分配，测出来被噪声盖住；不拿 GC 凑数。CSS flush 同样停在 37 ms 量级——076 已经把 custom 拷贝砍掉，本轮 inherit 合并在 QuickJS 上不够单独成行。match miss 哨未退。

## navMount 内推迟同步 layout（specs/086）

084 之后 `[nav] mounted` 仍约 250ms。模拟器拆账（chunk 预热、debug）：

| 片段 | 耗时 |
|---|---:|
| Vue `app.mount`（506 节点） | 39ms |
| CSS flush + encode + applyFrame | ~49ms |
| 一次 `fjs.ui.rect` → `flushLayout`（573 dirty） | **158ms** |
| 其余微任务 | ~1ms |

Widget build 已经是 1ms。卡的是 layout，而且叠在 `dispatchEvent(navMount)`
的 JS 栈上，Navigator 转场画不了下一帧。GC 阈值（001）和缩 JS 树都不打中。

086：`navMount` 当次跳过 `_reflow`。未 layout 的新节点读 rect 得全零；
`dispatchEvent` 返回后既有 notify 让下一帧 layout 上屏。页面已挂上之后的
同 tick 量高（073 collapse）不变。

iPhone 17 模拟器、`fjs run ios` debug、chunk 预热后（完整五页见
`specs/086-defer-navmount-reflow/spec.md` §8）：

| 页面 | 086 后 `[nav] mounted` |
|---|---:|
| vant-basic | 40 ms |
| vant-feedback | 13 ms |
| vant-form | **91–98 ms**（086 前 249–267 ms） |
| vant-more | 62 ms |
| vant-nav | 55 ms |

那 160ms layout 不再叠在 JS 栈上。转场不再冻这一拍。layout 仍在下一 Flutter
帧发生——那是后续刀。

## 086 之后还剩什么：三分账与 Vue 3.6 评估（2026-09-24）

086 之后模拟器上 vant 页 `[nav] mounted` 是 40–98 ms。目标是「16 ms 里挂更多
节点」，所以先把剩下的钱按层分开。这一轮只做测量与原型，**没有改生产代码**。

### 方法：离线挂载基准

没有 Flutter 的机器上也能量 JS 侧：临时入口（不提交）直接把 demo 的
`src/plugins/*` 装进 `createApp(page)`，在 `fjsrun`（PrimJS，Release）里挂载 →
卸载，每页 1 次冷 + 7 次热（取最小）。同一棵树再用一个**空渲染器**
（`createRenderer` 的 nodeOps 只建普通 JS 对象）挂一遍，那就是「Vue 自己」的价钱。

```bash
cd demo && pnpm exec fjs build src/_vbench.ts --out /tmp/vb
../packages/flutter_fjs/native/build-native/fjsrun --frames --pump 50 /tmp/vb/app/bundle.js
```

注意：vant 在 mount 过程中读 rect（`ui/geometry.ts` 同步 `flushNow()`），所以
CSS flush 发生在 `app.mount()` **里面**，不能用 mount 前后两段计时分账，要读
`styleEngine.stats` 的差值。

### 三分账（Linux 容器 CPU，约为模拟器的 2 倍慢，看比例）

vant-form（346 元素）：

| | 冷（首开） | 热（重开，min） |
|---|---:|---:|
| 合计 | 200–237 ms | 106 ms |
| CSS 重算（flushMs） | 78–90 ms | 29 ms |
| 标脏（markMs） | 6 ms | 6 ms |
| Vue 本身（空渲染器） | 37 ms | 34 ms |
| fjs renderer + element API + op 编码（余数） | ~80 ms | ~37 ms |

其它页同构：热态 Vue ≈ 1/3、fjs 这一层 ≈ 1/3、CSS ≈ 1/3；**冷态 CSS 占到 40%**
（267 次 match miss 是首开专有的账）。

换成单价：热态约 **300 µs/节点**（模拟器约 150 µs）。按这个价，16 ms 只够
~100 个 vant 节点——单靠削常数到不了「346 节点 16 ms」，见下文结论。

### Vue 3.6（Vapor）：对这条管线基本无效

1. **Vapor 用不上。** `@vue/runtime-vapor@3.6.0-rc.9` 直接 import
   `@vue/runtime-dom`，模板实例化是 `document.createElement('template')` +
   `innerHTML` + `cloneNode`，**没有 `createRenderer` 那样的自定义渲染器入口**。
   接进来等于在 QuickJS 里实现一个带 HTML 解析的 mini-DOM。
2. **就算接上也打不到 vant。** Vapor 只编译 SFC 模板（`<script setup vapor>`）；
   vant 组件是 TSX 渲染函数，照样走 VDOM（interop 模式还要额外付一层）。
   vant 页里页面自己的模板只是薄壳，钱花在 vant 组件的 setup + 渲染上。
3. **3.6 的 VDOM 模式（新响应式内核）实测**：把 `fjs-runtime` 钉住的
   `@vue/{runtime-core,reactivity,shared}` 临时换成 3.6.0-rc.9，与 3.5.42 交替
   各跑 3 轮——热态 **零差别**（vant-form 106 对 106–110 ms，空渲染器 34 对
   32 ms）；冷态部分页面好一些（vant-feedback 余数 43 → 13 ms，vant-form
   117–140 → 70–98 ms），CSS 段不动。可以跟正式版升级，不能指望它解决问题。

### fjs 这一层：分配是主因（已原型验证）

单价（PrimJS，2000 次取 min）：

| 操作 | 现在 | 原型 |
|---|---:|---:|
| `utf8Encode("view")` | 2.3 µs | — |
| `create("view")` | 12.1 µs | **2.7 µs** |
| `setProps({htmlBlock:true})` | 14.3 µs | 10.2 µs |
| `setProps({style: ANCHOR})`（v-if 锚点） | 19.6 µs | 13.5 µs |
| `setText("hello")` | 6.3 µs | 4.6 µs |

原型三刀：①`makeElement` 的 9 个方法 + `style`/offset getter 挪到共享原型
（现在每节点 9 个闭包 + 2 次 `defineProperty`）；②`OpWriter.create` 按标签缓存
UTF-8 字节；③ASCII 字符串直接写进帧缓冲，不再经过临时 `Uint8Array`
（`setText`/`setProps` 的 JSON 几乎都是 ASCII）。页面上 vant-form 挂载期的
renderer ops **51 → 34 ms（−33%）**，整页热态 106 → 98.5 ms。

还没原型、但数据已经指向的：

- `setProps` 每个布尔/常量 prop 都 `Object.entries` + `JSON.stringify` +
  devtools 记账；锚点 141 个每个都重新序列化同一份 `ANCHOR_STYLE`。常量
  props 可以预编码成字节缓存，或者给 `htmlBlock` / 事件标记这类布尔开一个
  二进制 op（**动 op 协议，两端同步改**）。
- 标脏：Vue 自底向上挂载，每次 `insert` 子树根都 `recomputeSubtree`，同一
  节点被祖先链上的每次插入重复走一遍（6 ms）。未计算过的新子树只需标根。
- **卸载一个 vant-form 要 ~27 ms**（`remove` 一次调用）：返回时那一拍的来源，
  和首开是两笔账。

### 结论：常数优化的上限，与 Lynx 式的「首屏优先」

把三块都削到位（元素层 −50%、冷态 CSS 接近热态、Vue 不动）大约是 vant-form
热态 ~70 ms（模拟器 ~35 ms）——仍然到不了 16 ms。**瓶颈是解释器下的每节点
单价**，想要「16 ms 出首屏」必须减少首帧要挂的节点数，这正是 ReactLynx
「首帧直出」那类方案的核心：首屏先出、其余后补。

在 fjs 的单线程模型里（threading-model.md），可落地的对应物按投入排：

1. **首屏优先的分片挂载**（应用层即可验证）：一个内置 `<defer>` 类组件，
   首帧只渲染占位，下一帧 / 转场结束后再挂真正内容。vant-form 这种长表单
   首屏可见的通常不到一半。
2. **样式缓存持久化**：冷态 CSS 比热态多出 ~50 ms（容器），全是首开 match /
   compute miss。链签名 → 匹配结果是纯函数于样式表，可以在构建期（fjsrun
   无头跑一遍页面）或首次运行后落盘，下次冷启动直接命中。
3. **构建期首帧快照（Lynx IFR 的对应物）**：构建期无头挂载，把首帧 op 帧
   存进包里；navMount 时 Dart 先上快照，JS 转场后再按确定的节点 id 补挂载。
   收益最大也最重：需要「挂载确定性 + 节点 id 对齐」这层水合协议，另立 spec。

以上每一条落地前按规矩先 `/spec`；原型 diff 没有提交。

## 元素层削分配 + 首屏优先 `<defer>`（specs/118）

上一节的三分账落地成两件事：**把每节点单价削下来**（元素层、标脏、卸载），
以及**让首帧少挂节点**（`<defer>`）。数字全部来自入库的离线基准：

```bash
pnpm --filter demo run bench:mount     # 需先编好 native 的 fjsrun
```

`demo/bench/mount-eager.ts`（`<defer>` 当场渲染 = 整页进首帧）与
`demo/bench/mount.ts`（页面原样）各跑一个**全新 VM**——冷数字只在没挂过这页
的 VM 里才是冷的。列的含义见 `demo/bench/mount-core.ts` 顶部注释。以下为
Linux 容器 CPU、PrimJS Release，**约为模拟器 2 倍慢**；改前 / 改后交替跑、取 min。

### 单价：元素层、标脏、卸载（整页进首帧，热态）

| vant-form（348 元素） | 改前 | 改后 |
|---|---:|---:|
| 同步挂载合计 | 100.2 ms | **78.5 ms** |
| CSS 重算（flushMs） | 28.8 | 27.3 |
| 标脏（markMs） | 5.7 | **1.4** |
| 元素层（合计 − CSS − 标脏 − 空渲染器 Vue 32.8） | 32.5 | **16.9（−48%）** |
| 卸载 | 28.5 | **6.5** |
| match miss（语义哨） | 267 | 267 |

元素层 vant-more −43%、vant-basic −43%、vant-feedback −40%；vant-nav 本来就薄
（~10 ms，大头在 Vue 与 CSS），降得少。五页卸载都 ≤ 7 ms。

做了什么（都在 Flutter 路径，web 走 DOM 不经过这些层）：

1. **Element 挪到共享原型**（`ui/element.ts`）：每节点 9 个闭包 + 2 次
   `defineProperty` 没了。`create()` 12.1 → 2.7 µs。
2. **OpWriter**（`ui/ops.ts`）：标签字节缓存；ASCII 字符串直接写进帧缓冲，
   不经临时 `Uint8Array`（非 ASCII 回落 `utf8Encode`，字节逐一相同）。
3. **常量 props 只序列化一次**（`setConstProps`）：v-if 锚点、`htmlBlock`、
   `multiline`，缓存的是编码好的字节。锚点一次 19.6 → 3.2 µs。
4. **`forgetHandlers` 只删节点注册过的事件类型**：原来每个被删节点都拼
   33 × 2 个字符串键——卸载 29 ms 的主体。
5. **惰性 HTML 属性不过桥**：`role` / `tabindex` / `aria-*` / `data-*` 占 vant
   普通 prop 写入的 60%，Dart 与 CSS 引擎都不读，现在只记进 DevTools。
6. **子树标脏去重**（`css/style.ts`）：同一待算批次里已整棵标过的子树不再
   下探。Vue 自底向上挂载，原来 N 层深的节点被走 N 次。
7. **空 class/scope 集共享、class 串解析缓存**：`ensure()` 不再给每个元素
   新建两个 `Set`。

对拍：整套基准 80 次挂载 / 卸载的 op 流，1–4、6、7 **逐字节相同**；加上 5 之后，
去掉那几类属性的 SetProps 后逐字节相同（帧里少 20% 的 SetProps）。

### 首屏优先：`<defer>`（页面原样，冷 = 首开）

vant-form / vant-more / vant-nav / vant-basic 把首屏以下的分组包进 `<defer>`
（用法见 [ui-api.md](ui-api.md#首屏优先defer)）。navMount 里用户等的只剩首屏
那一段：

| 同步段（navMount 里） | 改前 冷 | 改后 冷 | 改前 热 | 改后 热 |
|---|---:|---:|---:|---:|
| vant-form | 204–214 ms | **37–38 ms** | 100 ms | **20 ms** |
| vant-more | 110–116 | **38–41** | 63 | **19** |
| vant-nav | 80 | **44–45** | 58 | **27** |
| vant-basic | 80–82 | **50–55** | 44 | **20** |

模拟器约为这里的一半：vant-form 首开同步段 ~20 ms 量级（spec 目标 ~35 ms）。
**模拟器 / 真机的 `[nav] mounted` 未在本轮复测**（容器里没有 Flutter），按附录
流程复核。

补挂那一段在转场结束后执行，不在 navMount 里，但它是真实的一帧：vant-form 冷
~115 ms / 热 ~62 ms（容器口径）。它落在页面已停稳、用户还没开始滑动的时候；
要再压，压的是冷态 CSS（下一条）。

### 冷态数字里有一次 GC，归属会漂

改后 eager 模式下 vant-more 的冷态 CSS 读到 114–173 ms（改前 61–65 ms），
像是退化。**不是**：分配是确定性的，全堆回收每次落在同一点；bundle 大了 31 KB
（基准多引了 `fjs/app`），那一点就从别处挪进了 vant-more 的冷挂载。在每页冷
挂载前手动 `gc()`（诊断用，量完撤回）后 vant-more 冷态 CSS 回到 60 ms，那 ~50 ms
挪到了 vant-form 身上。所以：**单页冷数字对比要看量级、看多页合计，不要逐页
抠**；引擎收益以热态为准。

### 还没做的

- **冷态 CSS**：首开比重开多出的 match / compute miss（vant-form 冷 ~80 ms，
  热 ~28 ms，容器口径）。样式匹配结果落盘或构建期预热，另立 spec。
- IFR / 构建期首帧快照：不做（spec 118 Non-goals）。

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

要把 `[nav] mounted` 再拆到 JS_Call / 微任务 / 同步 layout，用
[navmount-probe.md](navmount-probe.md)（C++ pump + Dart `_reflow`，量完还原
`vm.cpp` 和模拟器 `libfjs.a`）。

数字口径的提醒（同 performance.md 的规矩）：单次读数含 GC 运气，结论看**两轮
独立测量的一致性**与**量级差**（本例 14–25×），不要抠个位数；模拟器 debug 与
真机的差异在 CPU 与堆压力，方向是真机更慢。
