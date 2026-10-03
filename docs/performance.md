# 性能测试

> 第四层。为什么这条管线快，见 [principles.md](principles.md)；
> 帧预算和 pump 的时序，见 [threading-model.md](threading-model.md)。

## 测试方法

`examples/bench` 内置微基准，通过 fjsrun（离线，无 Flutter UI 开销）执行：

```bash
cd examples/bench
pnpm run build
../../packages/flutter_fjs/native/build-native/fjsrun --pump 8000 dist/app/bundle.js
```

机器基线：Apple Silicon (M 系列)，macOS 26，flutter 3.24.5。历史数据采集于 quickjs-ng 0.9.0；spec 088 起引擎为 PrimJS 4.1.1（es2021→es2019 降级），数字待重测。两个引擎的同机对比（2026-09-22：分配主导的页面负载 PrimJS 快 1.3–1.7×，纯计算 quickjs-ng 快 1.7–2.2×）见 [engine-perf.md](engine-perf.md)。

### 样式基准报 min，不报单次耗时

`src/main.ts` 里的引擎/UI 用例是单次计时；`src/style.ts` 里的样式用例不是，
**它们建一次世界、预热一轮、重复 7 次、报最小值**。原因是实测出来的：4000
节点规模的重排样式，耗时由分配主导，哪一轮碰上 GC 哪一轮就背下全部账单——
第一版逐配置只跑一次的写法，把自己的结果排序颠倒了 2 倍。最小值是那次没有
回收的运行，描述的是代码而不是它恰好落在的堆状态。输出里同时给 med/max：
**当 min 和 max 拉得很大时，故事是 GC，盯着均值看没有用**。

样式用例还会报 `frameBytes`（自己换掉 op sink 统计），因为过桥的字节数和
毫秒数一样是要盯的指标。要看真实 app 的帧大小，用 fjsrun 的 `--frames`：

```bash
../../packages/flutter_fjs/native/build-native/fjsrun --frames --pump 1500 dist/app/bundle.js
# [frame] ops=374 bytes=6604
# [frames] total=1 ops=374 bytes=6604
```

`--frames` 与默认的逐 op 转储互斥：转储对每个 op 都 printf，比被测的东西贵
得多。

## fetch 体通道：句柄替代 base64-in-JSON（2026-09）

二进制体过 App 内通道的成本（不含网络，`packages/flutter_fjs/test/
handle_bench_test.dart`，M 系列宿主机实测）：旧路径
`base64Encode → jsonEncode → jsonDecode → base64Decode` 对比句柄通道
`malloc 拷入 → fjs_handle_put_bytes → fjs_handle_bytes 拷出`：

| 体积 | 旧（base64+JSON） | 新（句柄） | 倍数 |
|---|---|---|---|
| 1MB | 7053µs | 505µs | 14× |
| 5MB | 27748µs | 864µs | 32× |

倍数随体积增长：旧路径的 base64 膨胀（×1.33）与 JSON 转义是 O(n) 常数更大的
纯 CPU 工作，句柄路径只有两次 memcpy。见 [jsi-and-native-modules.md](
jsi-and-native-modules.md)。

## 结果（2026-09 实测）

| 基准 | 耗时 | 吞吐 |
|------|-----:|-----:|
| fib(27) 递归 | 9.7 ms | — |
| 字符串拼接 100k | 88 ms | ~1.1k ops/ms |
| JSON.stringify 5k 对象 | 10.0 ms | ~500 ops/ms |
| 数组排序 10k | 3.0 ms | ~3.3k ops/ms |
| **UI 创建 1000 节点**（encode + 原生提交） | **11.0 ms** | ~91 节点/ms |
| **UI 更新 1000 文本**（setText 批量帧） | **1.4 ms** | ~724 更新/ms |

样式引擎（1000 行 × 4 节点 = 4002 个节点的主题页，含 `:active` 与 CSS 变量）：

| 基准 | 耗时 (min) | 帧大小 |
|------|-----:|-----:|
| 挂载 1000 行 | 118 ms | 189 KB |
| **切主题（翻 root class）** | **34.0 ms** | **52 KB** |
| **切主题（改自定义属性）** | **35.4 ms** | **53 KB** |
| 切主题，只跑 cascade 不过桥 | 29.1 ms | — |
| 重渲染 1000 行（只有事件处理器变了）| 1.2 ms | **0 B** |
| 单节点换 class | 0.03 ms | 39 B |

解读：

- **主题切换的成本按节点数线性增长，约 8.5 µs/节点**，其中 7 µs 是引擎自身
  的 cascade，1.5 µs 是序列化 + op 编码。想再压，压的是引擎里每节点的分配，
  不是过桥。
- **翻 class 和改自定义属性一样快。** 翻 root class 会让全部后代的
  `chainKey` 失效、`matchCache` 整体落空，直觉上应该更贵——实测不是：
  两条路都是 `computeCache` 全体失效，而规则匹配在这个规模下不是瓶颈。
  所以**选哪种写法按可读性来，不用为性能纠结**。
- **帧内大批量更新仍是本管线的甜点区**；单节点更新在 JS 侧已经是 0.03 ms，
  剩下的成本在 Flutter 的重建粒度上（见下）。
- 清单页用 `list-view`（ListView 懒构建），不要用 `scroll-view`。门槛比这里
  以前写的「~2000 常驻节点」低得多：1000 行就已经差 5.7 倍，见下文
  [两个开关，两条独立的账](#两个开关两条独立的账)。

数字随机器和版本变化。改过渲染管线（op 编码、镜像树、样式引擎）后请重新实测
再更新上表，不要沿用旧值。

## 元素层单价（2026-09，specs/118）

挂载一个节点，除了 Vue 与 cascade，还要付元素层的钱：建 `Element`、编码 op、
登记事件。解释器下这些全是分配的价格。PrimJS Release、Linux 容器（约为模拟器
2 倍慢），2000 次取 min：

| 操作 | 之前 | 之后 | 省在哪 |
|---|---:|---:|---|
| `create("view")` | 12.1 µs | **2.7 µs** | Element 方法 / getter 挪到共享原型；标签字节缓存 |
| `setText("hello")` | 6.3 µs | **4.7 µs** | ASCII 直写帧缓冲，不经临时 `Uint8Array` |
| `setProps({htmlBlock: true})` | 14.3 µs | 9.7 µs | 同上 + `for...in` 代替 `Object.entries` |
| v-if 锚点的常量 props | 19.6 µs | **3.2 µs** | `setConstProps`：同一对象的编码字节只算一次 |

页面级：vant-form 挂载的元素层 32.5 → 16.9 ms（−48%），卸载 28.5 → 6.5 ms。
另外两处不在单价里、但在页面上更大：`role`/`tabindex`/`aria-*`/`data-*` 不再
过桥（vant 普通 prop 写入的 60%），以及 Vue 自底向上挂载时的重复标脏。整本账和
对拍方法见 [vant-mount-perf.md](vant-mount-perf.md) 的 specs/118 一节。

读这张表的方式：**解释器里「逐字符走一遍字符串」和「新建一个对象」都是微秒级
的**。`JSON.stringify` 一个小对象 1.3 µs，而把同样 30 个 ASCII 字符逐个写进缓冲区
也要几微秒——所以常量 props 缓存的是编码好的字节（一次 `set()` 拷贝），不是 JSON 串。

## 首开的冷缓存：构建期预热（2026-09，specs/119；specs/172 已移除）

> native 样式引擎（specs/150）上线后收益变小，快照在 specs/172 整个移除；下面是当时的记录。

页面第一次打开时 CSS 引擎的匹配 / 计算缓存是空的，vant-form 为此多付 ~50 ms（容器
口径）。`fjs build` 现在在 Node 里把每个静态路由挂一遍，把缓存以快照的形式带进包里，
路由挂载前导入：vant-form 首开 navMount 同步段的 CSS 22 → 8 ms，match miss 270 → 1，
导入本身 ~4 ms。快照与运行时的样式表 / 视口 / 引擎开关不一致就整份放弃。细节、代价
（包体积）与对拍见 [vant-mount-perf.md](vant-mount-perf.md) 的 specs/119 一节。

分包构建（`--pages` / `fjs run --profile|--release`）里，页面 chunk 注册自己的 scoped
样式表时以前会清空整个样式缓存，每个新页面都从全冷开始；specs/120 之后，新作用域的表
不再触发失效。见 [vant-mount-perf.md](vant-mount-perf.md) 的「真机复核」一节。

## 样式驻留带来的变化（2026-09）

把 style 从「每节点一份内联 JSON」改成「一次 DEFINE_STYLE + 每节点 13 字节
SET_STYLE」之后（协议见 [architecture.md](architecture.md#ui-帧协议二进制)）：

| | 之前 | 之后 |
|---|---:|---:|
| 切主题（4002 节点）| 66.3 ms | **34.0 ms** |
| 帧大小 | 613 KB | **52 KB** |
| 过桥部分（总耗时 − cascade）| 39.2 ms | **6.2 ms** |
| Dart 侧 `jsonDecode` 次数 | 每节点一次 | 每种样式一次 |

Dart 侧那一行离线基准量不到（fjsrun 没有镜像树），但 1000 行的页面上是
4002 次降到个位数。

## Vue 重渲染的过桥成本（2026-09）

模板里的 `@tap="() => open(item)"` 每次渲染都是一个新闭包，Vue 因此认为这个
prop 变了、对每一行都调一次 `patchProp`。**原生侧只知道「有没有处理器」**，
闭包换身份它根本看不见——所以这里以前每次重渲染都会给每行写一条
`SetProps {onTap:true}`，值和上一次一模一样。

| 1000 行重渲染，只有处理器身份变了 | 耗时 | 帧 |
|---|---:|---:|
| 之前 | 4.27 ms | 23 KB |
| 之后 | **1.22 ms** | **0 B** |

现在只有**存在性**变化（无 → 有、有 → 无）才发 op；闭包在注册表里就地换掉。
Vue 自己的 DOM 渲染器用 invoker 解决同一个问题。省掉的不只是这 23 KB，还有
Dart 侧 1000 次 `jsonDecode` 加 1000 次 props map 拷贝。

**样式那条路没有这个问题**：`theme-switch` 的帧是 13 字节/节点，正好是一条
`SET_STYLE`，一条不多。真机上 4000 节点切主题是 11.3 字节/节点——比一条还少，
因为有些节点的样式确实没变，`sameStyle` 早退了。**所以 Vue 的重复渲染只从
事件处理器这一个口子漏到桥上，不是样式。**

### 但 Vue 自己的 diff 还是要钱

过桥不多发，不等于不花时间。1000 行的主题切换，同一份 UI 两种写法
（`examples/bench` 的 `vue-theme-switch-*`）：

| | min | med | 帧 |
|---|---:|---:|---:|
| 行内联在读主题 ref 的组件里 | 55.6 ms | 56.0 ms | 65,481 B |
| 行放进一个不读主题的子组件 | **34.6 ms** | **35.5 ms** | 65,481 B |

**帧字节数一模一样**，差的 21 ms（38%）全是 Vue 重建并 diff 4000 个输出没变的
vnode。作为对照，不经过 Vue 的 `theme-switch-vars` 是 36.7 ms——和隔离版基本
重合，也就是说隔离之后 Vue 这一层几乎不要钱了。

两个变体是**交替**跑的，不是先跑完一个再跑另一个。顺序跑的时候后跑的那个白
拿 JIT 预热：真机上按顺序测，结论会整个反过来（内联 179ms、隔离 304ms）。
**debug 构建的真机读数不能用来做这种 A/B**，只能看帧字节数那种和时间无关的量。

原因很直接：**主题是通过继承的自定义属性到达每一行的，不走 props**，所以行
的 vnode 输出跟主题无关。只要承载列表的组件不读主题 ref，
`shouldUpdateComponent` 就会整个跳过它。

这是纯应用层的写法问题，不需要改引擎。规则：**长列表放进自己的组件，别和
会频繁变的状态挤在同一个组件里**。`examples/hello-fjs` 的 `example/interaction/theme`
页有个「列表」开关，可以在真机上看两种写法的观感差别——但要比时间，看
`examples/bench` 的数字。

## Flutter 侧的重建粒度（2026-09）

以前每个节点的 widget 都是父节点 build 时新造的实例，所以**任何一次
`notifyListeners()` 都会重建整棵树**——改一个字，1200 个节点全部重建。

现在每个节点是一个 `_FjsNodeView`，监听它自己的信号，而且**实例缓存在
MirrorNode 上**。缓存就是机制本身，不是机制之上的优化：`Element.updateChild`
只有在 `child.widget == newWidget` 时才跳过子节点，而 `Widget.==` 是
`@nonVirtual` 的**同一性**比较——Flutter 明确禁止重写它。所以把同一个实例交
回去，是让父节点的重建停在子节点这一层的唯一办法。

`flutter test --dart-define=FJS_BENCH=true test/render_bench_test.dart`
（1200 节点，改一个叶子文本再重建根）：

| | 节点 build 次数 | 耗时 |
|---|---:|---:|
| 绕过视图缓存 | 1201 | 12.31 ms |
| 走缓存 | **2** | **0.76 ms** |

**16.2×**。那 2 次是文本节点自己，加上它的父节点——父节点必须重建，因为
`display: none` 的过滤和 `flex.dart` 读子节点 `position`/`flexGrow` 都发生在
父节点的 build 里。

一个连带的必要修复：`flex.dart` 给子节点套的 `Expanded` / `Align` 以前没有
key。父节点 reconcile 的是**包装层**，包装层没 key 就退化成按位置匹配，重排
之后位置 0 换了个节点，里面的 key 对不上，整棵子树重建。包装层现在带上子节点
自己的 key，一次移动才真的只是移动。

**主题切换不在此列**：那时每个节点确实都变了，1200 次重建一次不少，这是对的。
粒度是为了不做多余的事，不是跳过该做的事。

## Dart 侧解析缓存（2026-09）

`FjsStyle` 以前每次 build、每个节点、每次 getter 访问都重新解析原始样式值。
样式驻留之后，共享同一份 style 的节点在 Dart 侧拿到的是同一个 Map，值也就是
同一批字符串，所以解析是几乎纯粹的重复劳动。

`flutter test --dart-define=FJS_BENCH=true test/parse_cache_bench_test.dart`
（1200 节点，一次整树重建）：

| | 解析次数 | 整树重建耗时 |
|---|---:|---:|
| 绕过缓存 | 10000 | 14.56 ms |
| 走缓存 | **0** | **12.89 ms** |

一次整树重建省下 1.7 ms（1.13×）。注意这个基准现在要**主动关掉视图缓存**才
量得到——否则根节点重建根本传不下去，没有整树重建可言。换句话说，解析缓存的
收益随重建粒度落地而变小了：它现在只在真正需要全树重建的场合（比如切主题）
才生效。

**这个基准的对照组必须是「绕过缓存」，不能是「每次 build 前清空缓存」**：
清空之后本次 build 的第一个节点就会把缓存填满，后面 399 个节点照样命中，
于是量出来两边一样快。第一版就是这么写的，结论是错的。

## 定位一次慢重排：先看 `styleEngine.stats`

`StyleEngine` 一直在记数，`fjs/vue` 导出的 `styleEngine.stats` 读得到：

```ts
import { styleEngine } from 'fjs/vue';
styleEngine.resetStats();
// ...触发重排...
console.log(JSON.stringify(styleEngine.stats));
// {"recompute":2983,"computeHit":2901,"computeMiss":82,"matchHit":2983,
//  "matchMiss":0,"applied":2739,"flushMs":77.7,"flushes":1,
//  "markMs":92.0,"markCalls":4,"markVisited":7288,
//  "elements":3500,"rules":234}
```

**`markMs` 和 `flushMs` 是要先分开看的两半**，而且第二个不包含第一个：
`flushMs` 是重算那一趟，`markMs` 是把子树标脏的遍历——后者发生在**框架的
patch 期间**，所以任何裹在 flush 外面的计时都看不见它。真机上第一次量出来，
标脏比重算还贵。

`computeMiss / recompute` 的比例是第二个要看的。设计上它应该接近 0：N 个相似
元素会塌缩到同一份 computed style。**一旦这个比例上去了，每节点的开销会跳一个
数量级，而表面上什么都看不出来。**

### 三个真实的坑（2026-09 实测，hello-fjs 主题页 4000 节点）

| | JS 耗时 | 说明 |
|---|---:|---|
| 起点 | 278 ms | |
| 修 Vue 锚点 | 278 ms | 未命中 968→105，但真机上耗时没动 |
| 修标脏遍历 | 215 ms | |
| 修匹配/计算缓存的键 + 比较路径的分配 | **213 ms** | |

1. **Vue 的 `v-if` 锚点在吃 cascade。** `createComment` 以前给锚点设内联样式
   `display:none`，而**内联样式正是让元素永久失去 memoize 资格的条件**。锚点
   不可见、无子节点、样式永不变，却每次重排都要走一遍完整 cascade。1000 行的
   列表里每行一个 `v-if` 就是 ~1000 个：在这个页面上它们是 4364 个元素里的
   968 个，也几乎是全部的 compute 未命中。现在锚点根本不进样式引擎。

2. **标脏遍历比它要调度的重算还贵。** 每节点一个闭包帧、一个 `for...of` 的
   迭代器对象、每个叶子一个 `?? []` 的空数组，外加一个长到全树的 `seen` Set。
   换成复用的显式栈 + 索引循环之后 199 ms → 111 ms。

3. **每节点两次模板字符串拼缓存键。** 匹配结果现在直接记在元素上（只在自身
   签名或祖先链变了才重算），计算缓存挂到 MatchResult 上、用父节点的
   computed-style id 这一个数字做键——那一个数字就是完整的键，因为父节点的
   computed style 和它的自定义属性是一起产生的，而标签（进而它的默认样式）
   已经在 chain key 里了。

**试过并回退的**：标脏超过半棵树就「整棵都算」。离线基准立刻变慢——路由会把
tab 页 park 住而不是卸载，于是可见页切主题会把每个 park 住的页面一起拖进重算。

## 真机复核（examples/hello-fjs 的主题压测页）

离线基准只量 JS 侧。`examples/hello-fjs` 的 `example/interaction/theme` 页把三段成本
分开报，**这是唯一能看到 Flutter 侧那一半的地方**。

iPhone 17 Pro 模拟器、**debug 构建**、4000 节点，CSS 变量写法：

| | 值 |
|---|---:|
| JS（重算 + 编码，含标脏）| 213 ms |
| 过桥 + Dart 应用帧 | **0 ms** |
| 帧大小 | 37 KB |
| 最慢帧 / 30 | 184 ms |

页面把 JS 和过桥分开量：先空跑一个来回把帧丢掉（纯 JS），再真跑一趟，差值就是
过桥。**这一步是必要的**——`uiOps` 是同步调用，不拆的话 Dart 侧的 `applyFrame`
会被算进「JS」里。量出来过桥+应用是 **0 ms**：样式驻留之后镜像树那一侧已经不
值得优化了，成本全在 JS。

**注意 debug/release 对这个数字的影响比想象的小。** QuickJS 是预编译的
Release 静态库，Flutter 的 debug 模式**完全不影响 JS 侧**；它只影响 Dart 侧，
而 Dart 侧已经量到 0 ms。模拟器与真机的差别主要是 CPU——**模拟器跑的是 Mac 的
核**，比 iPhone 快，所以真机上这个数字会更高，实测约 250 ms。

### 真机上是 GC 在主导

同一个页面、同一份工作，真机 debug 连测三次的计数器**一模一样**
（recompute 3498、markVisited 8554、computeMiss 107），耗时却是：

| | flushMs | markMs |
|---|---:|---:|
| 第 1 次 | 1354 | 1151 |
| 第 2 次 | 1263 | 403 |
| 第 3 次 | 228 | 801 |

**工作量完全相同，耗时差 5 倍，而且两个阶段轮流背锅。** 这是 GC 的签名：哪一
趟碰上回收，哪一趟就付全部账单。真机的内存压力比模拟器大得多（模拟器用的是
Mac 的内存），所以每次分配都可能触发一次扫过整个堆的回收。

堆有多大，性能面板的 `heap` 行会说（读 `fjs_vm_heap`，不触发回收，见
[toolchain.md](toolchain.md#性能面板)）。`gc()`（`import { gc } from 'fjs'`）也报同样两个数，
但它要先把全堆扫一遍——**只能在调试时临时加，页面和示例里不许留**。
hello-fjs 的主题页上是 **16.8 MB / 60056 个活对象**——QuickJS 的 GC 是全堆标记
清扫，每次都要遍历这 6 万个对象，在手机上就是几百毫秒。**触发点由分配决定，
所以它落在哪一帧完全是运气。**

### 空闲时收——试过，撤了

曾经的做法是：`host.ts` 每提交一帧把一个 1.2 秒的定时器往后推，UI 静下来才收一次，
理由是"把堆压低，下一次交互撞上自动回收的概率就小"。

**它从来没有被量过，而且后来的数据说它的方向是反的。** 压载实验（见
[两个开关，两条独立的账](#两个开关两条独立的账)）证明 QuickJS 的自动阈值跟着堆
走：堆**大**了阈值才高，同一次切换从 98 ms 变成 35 ms。空闲回收干的正相反——趁
没人看把堆压小，阈值跟着降下来，下一次交互更容易撞上全堆回收。已经删掉。

留下的是 `gc()` 本身，而且**只作调试工具**：这一节和下面几节的数字，是当时压测页
在每趟计时前先 `gc()`（把回收从计时窗口里赶出去、顺便读堆的大小）量出来的。
2026-09-11 起 `examples/` 里的压测页与 `examples/bench` 都不再调用它——示例是业务
代码照抄的样板，手动全堆回收本身就是一次卡顿。排查时要排除回收就临时加上、量完撤回，
读堆看性能面板。它不是优化。真要拿内存换流畅，该动的是自动阈值，而那是产品决定，记在
`specs/001-restyle-performance` 的待澄清里。

结论是：**这条路上真正要省的是分配，不是指令**。已经拔掉的每节点分配有——
`Object.keys` 的比较（改成把 key 列表缓存在共享的 computed style 上，一份样式
一次而不是一个元素一次）、脏集合的 Set（改成复用数组 + 元素上打戳去重，避免
Set 扩容和导出时的整份拷贝）、比较前的 `?? {}` 空对象。

真正没解释掉的差距是：同一份工作在离线基准（同一台 Mac、release QuickJS、
生产 bundle）里是 **19 ms**，装进 app 之后是 213 ms。**11 倍，同样的 JS、
同样的引擎、同一颗 CPU。** 差别只剩堆的大小——app 里是整个应用（24 个页面
chunk、Vue、路由、3500 个元素状态），基准里只有基准自己。指向分配与 GC，但
还没被证实，这是下一个要查的。

两件事被这组数字钉住了：

1. **两种写法确实一样。** 早前实测 CSS 变量 160.6 ms 对根 class 161.8 ms，
   帧大小差 0.1 KB。离线基准的结论在真机上成立。
2. **过桥已经不是成本。** 剩下的全在 JS 侧的样式引擎里，见上一节的
   `markMs` / `flushMs` 拆分。

## 拆掉 Vue：examples/hello-js 的主题压测屏

上一节的数字是「Vue + 样式引擎 + 桥 + Flutter」四层叠在一起的总账。要知道钱花
在哪一层，需要一份**同构但没有 Vue** 的对照：`examples/hello-js` 的「主题压测」屏就是
它——底层 element API + `StyleEngine` 手搭出和 `example/interaction/theme` 一样的树（同一份
CSS、同样 12 个自定义属性、同样的 `:active`、同样七行一个徽章），但没有 vnode、
没有 patch、没有路由、没有页面 chunk。屏上四格和那一页一一对应，可以直接对读。

```bash
cd examples/hello-js && fjs run ios      # 「4050 压测」「主题压测」「组件总览」三个 tab
```

iPhone 17 Pro 模拟器、debug、CSS 变量写法、每次都是刚启动的 VM：

| 节点数 | elements | JS 重算+编码 | 过桥+应用 | 最慢帧/30 | 帧 | 堆 | 一次 gc |
|---|---:|---:|---:|---:|---:|---:|---:|
| 800 | 695 | 4.4 ms | 0.3 ms | 66.6 ms | 10.1 KB | 4.3 MB / 8891 | 2 ms |
| 4000 | 3323 | **106.4 ms** | **0.00 ms** | **233.2 ms** | 41.9 KB | 7.9 MB / 28856 | 3 ms |
| 8000 | 6609 | **101.2 ms** | 0.00 ms | 316.0 ms | 81.9 KB | 16.7 MB / 57960 | 6 ms |

（这一张是**单次**读数，容器都是 `scroll-view`，而且是**离屏 paint 裁剪落地之前**
量的——「最慢帧」那一列后来降了三成，见[下面](#离屏-paint-裁剪scroll-view)。单次
读数在这条路上不够用，为什么、以及六趟 min/med/max 的版本，见下面两节。）

对照组是上一节那台机器上的 `example/interaction/theme`：4000 节点（4364 个元素，多出来的是
v-if 锚点）JS **213 ms**、过桥 0 ms、最慢帧 184 ms。（那是**优化前**的它；同样
两下用在它身上之后的数字见 [下面](#同样两下用在-vue-页上)。）

### 三条读得出来的结论

1. **过桥仍然是 0，和有没有框架无关。** 三种规模都是 0.00 ms（695 节点那次
   0.32 ms 是唯一一个非零，仍然可以忽略）。样式驻留之后镜像树那一侧确实不值得
   再优化了。

2. **Vue 占 JS 侧的三到四成。** 同容器、同方法（六趟 min）对读：`scroll-view`
   下 98 ms（无 Vue）对 168 ms，`list-view` 下 55 ms 对 83 ms。多出来的是 Vue
   重建并 diff 四千个输出没变的 vnode，以及那 1000 个 v-if 锚点（hello-fjs 那边
   元素数也多 5%）。离线基准是同一个方向：`vue-theme-switch-inline` 32.6 ms 对
   `theme-switch-vars` 25.5 ms。

3. **最慢帧比 JS 还大，而且它和 Vue 无关。** 「过桥+应用」量的是 `applyFrame`
   把 op 写进镜像树；真正的 widget 重建 + 布局 + 绘制发生在**下一帧**，那正是
   「最慢帧」抓到的东西。它随节点数长（66 → 233 → 316 ms），两个 app 上是同一
   个量级。**换句话说：JS 侧优化到零，这一页仍然会掉十几帧。** 这一条把下一节
   的问题问出来了：Flutter 那一半的钱花在哪。

### 两个开关，两条独立的账

页面上的「堆压载」只改活对象数，「容器」只改 Dart 侧建多少个 widget；两个都
不改 JS 要做的工作——`recompute` 3330、`applied` 3175、帧 42.0 KB，四格里前三格
的输入一模一样。所以这是一张干净的 2×2（4000 节点 = 3330 个元素）：

| 容器 \ 堆压载 | 无 | 6 万对象 |
|---|---|---|
| **scroll-view** | js 98/101/111 ms · 最慢帧 **166.4 ms** | js 35/37/46 ms · 最慢帧 150.9 ms |
| **list-view** | js 55/57/69 ms · 最慢帧 **29.0 ms** | js 34/37/48 ms · 最慢帧 **17.5 ms** |

（`js a/b/c` 是六趟空跑的 min/med/max，见下一节为什么必须报分布。「最慢帧」那两
格是**离屏 paint 裁剪之前**的：裁剪落地后 `scroll-view` 那一格是 100 ms，
`list-view` 不受影响——它本来就不画看不见的行。这张表是压测页当时「每趟计时前先
`gc()`」量的；页面现在不再这样做，重测时回收更容易落进某一趟，单趟会更抖，按 min 对读。）

两条账各走各的：

- **「最慢帧」由容器决定**：166 → 29 ms，**5.7×**。`scroll-view` 里是一个
  `SingleChildScrollView` 套一个 `Column`，而 Column 会 build、layout 并且
  **paint 它的每一个孩子**，屏上放不放得下都一样——1000 行里有 990 行是画给
  没人看的。`list-view` 走 `ListView.builder`，只落实视口里的那十几行。
- **「JS」由堆的余量决定**：98 → 35 ms，**2.8×**，而变的只是多了 6 万个死活
  对象。这就是下一节。

两个开关都打开：一次 4000 节点的主题切换从「JS 98 ms + 最慢帧 166 ms」变成
「JS 34 ms + 最慢帧 17.5 ms」。

### GC 就是那 90 ms（前一版结论是错的）

之前这一节写的是「模拟器上堆不是主因」，依据是一次单次读数（106.4 → 107.5 ms）。
改成报六趟的 min 之后，同一个开关的效果是 **98/101/111 → 35/37/46 ms**。单次
读数不足以下这个结论，前一版的结论作废。

机制和真机那一节是同一个：**QuickJS 的自动回收由分配触发，阈值跟着堆走**。堆
小的时候阈值也低，一次 3330 个元素的重排分配得足够多、正好越过它，于是这一趟
付一次（或几次）全堆扫描的钱；把堆撑大之后阈值抬高，同样的分配再也够不着它。
**多留 6 MB 内存，换掉 60 ms**——这正是规格 001 待澄清 (b)（把自动阈值交给宿主
配置）说的那笔交易，现在有数了。

它也解释掉了上一版记的「4000 节点 106 ms、8000 节点 101 ms」那个非线性：节点
多一倍反而不慢，是因为大的那棵树把堆撑到了阈值之上。**不是每节点的工作在变，
是回收落在哪一趟在变。**

顺带的方法论结论：**这条路上的单次读数不可信**，压测页现在默认报六趟空跑的
min/med/max，和 `examples/bench` 的样式基准同一套方法。压测页计时前也不再手动 `gc()`
（它只能用于调试），回收落在哪一趟全凭运气，就更要看 min。

### 所以 Dart 侧怎么优化

按收益排序，前两条是应用层的写法，不用改框架：

1. **长列表用 `list-view`，不要用 `scroll-view`。** 上表：最慢帧 166 → 29 ms
   （离屏裁剪落地之后是 100 → 29；差距变小了，但没有消失，因为裁剪只省 paint）。
   `scroll-view` 适合「一屏多一点」的内容；一旦行数上百，它就是在为看不见的
   行付 build + layout + paint。**门槛比之前文档写的「~2000 常驻节点」低得多**：
   1000 行（3330 个元素）在 debug 模拟器上已经是 166 ms 一帧。
   现在 debug 构建里超过 200 个孩子的 `scroll-view` 会打印一次提醒。
2. **长列表放进自己的组件**（Vue 侧，见上文）：省掉 Vue 的 vnode diff。
3. 引擎侧还剩的每节点成本——`_PressedNode` 给每个带 `:active` 的节点加一层
   `Listener`——在上面两条之后是次要项。已经拔掉的：`isHidden` 不再为一次
   `display` 查询分配一个 `FjsStyle`；收集孩子从三次 `tree.node(id)` 变成一次；
   **specs/084** 让共享 `styleId` 的节点共用一份 interned `FjsStyle` view，
   padding / 边框 / 圆角等派生值按 entry 驻留（`keepsBox` 挪到 `decorateNode`
   参数，避免按下态写穿共享 view）。`flutter test --dart-define=FJS_BENCH=true
   test/render_bench_test.dart` 上整树重建不再走进 `style_parse`（1200 节点
   parse-on-rebuild 0）。

**没有做、但下一步该评估的**：让 `scroll-view` 在孩子多且没有绝对定位的时候
自动走 sliver（懒构建）。收益就是上表那 5.7×，代价是它会改变一批边界语义
（`justify-content`、`align-items` 非 stretch、intrinsic 宽度、`gap`），所以
应该单独立项，不该顺手改。

## 并发上限：每帧能改多少个节点

主题切换是一次性的峰值。另一个问题是**稳态**：持续地每帧改 N 个节点，这条管线
能撑住多少个还不掉帧。压测屏的「找并发上限」按钮逐档加倍地压（每档 40 帧，改动
发生在 rAF 回调里，帧间隔取 rAF 自己的时间戳），报最后一个 p50 ≤ 17ms 的档。

**先说结论：这条管线上没有并发。** JS、过桥、Dart 的 build/layout/paint 全排在
同一根 UI 线程上（[threading-model.md](threading-model.md)），所以上限就是这三段
的**和**跨过 16.7ms 的那一点。

iPhone 17 Pro 模拟器、debug、树里 1000 行（3330 个元素）：

| 容器 | 并发上限 @60fps | 各档帧间隔 p50（ms）|
|---|---:|---|
| `scroll-view`（裁剪之前）| **< 10 节点/帧** | 10:50　25:50　50:67　100:67　200:67　400:67　800:100 |
| `scroll-view`（裁剪之后）| < 10 节点/帧 | 10:**33**　25:**33**　50:**33**　100:**33**　200:**33**　400:67　800:117 |
| `list-view` | **400 节点/帧** | 10:17　25:17　50:17　100:17　200:17　400:17　800:67 |

（「裁剪」= 下一节的离屏 paint 裁剪。它把每一档从 3 个 vsync 压到 2 个，但没有
把任何一档带回 60fps。）

**40 倍，而 JS 侧一模一样**（每帧 134 B / 0.46 ms 那一档两边同价）。看
`scroll-view` 那一行的形状就明白了：**改 10 个和改 400 个一样慢**。因为耗时根本
不在改的那几个节点上——`Column` 每一帧要把它的 1000 个孩子全部 paint 一遍，屏上
放不放得下都一样。这不只是主题切换的事，**这是那一页上任何一次交互的天花板**：
一个 1000 行的 `scroll-view` 把整个 app 锁在 20fps。

`list-view` 那一行是干净的线性：400 以内满帧，800 掉到 67ms。跨过去的是 JS——
每帧 800 个节点的重排在这台机器上要 37 ms，一帧的预算就没了。

### 上限怎么抬

三条路，按性价比排：

1. **别把用不着的节点放进 widget 树**（`list-view`）：< 10 → 400，40×。已经能做。
   `scroll-view` 上的离屏 paint 裁剪（下一节）值 1.5–2×，但**替代不了它**。
2. **让重排的规模跟「有多少种样式」走，而不是跟「有多少个节点」走**：引擎的计数器
   自己就说了，一次 4000 节点的切换里 `computeMiss` 是 24、`computeHit` 是 3299
   ——3330 个元素塌到 27 种样式，只是这件事被重新证明了 3330 遍。设计见
   `specs/002-style-slots/spec.md`。
3. **把 JS 挪出 UI 线程**：上限就从「三段之和」变成「三段的最大值」，而且 JS 再长
   也不会卡住滚动。代价是 [threading-model.md](threading-model.md) 里那条
   「点击到界面更新在同一帧」的同步保证要换成异步——按压态（`:active`）已经不走
   JS 往返，所以最要紧的那类反馈不受影响，但这是个大动作。**没有立项**。

## 离屏 paint 裁剪（`scroll-view`）

上一节里 `scroll-view` 那一行的形状——改 10 个和改 400 个都是同一个数——说的是
一件很具体的事：`SingleChildScrollView` 里是一个 `Column`，而 **Column 会 paint
它的每一个孩子**，屏上放不放得下都一样。Flutter 只在 sliver 里裁剪（`ListView`
就是这么来的）；一棵 RenderBox 子树没有这个机制。

**Dart 提供的钩子是 `RenderAbstractViewport`**：每个滚动容器的 render object 都
实现它，`maybeOf` 能从任意后代找到最近的一个，`getTransformTo` 把孩子映射进它的
坐标系——滚动偏移也算在内，因为 viewport 在 `applyPaintTransform` 里报告了它。所以
一个 RenderFlex 只要问一下窗口在哪，就能对窗口外的行跳过 `paintChild`。这就是
`render/cull.dart` 的 `FjsCullingFlex`，只在 `scroll-view` 的内容上启用。

> 走过的弯路：第一版用的是 `Canvas.getLocalClipBounds()`。它只在「外层的裁剪恰好
> 落在画布上」时有效——viewport 一旦合成，裁剪是一个 `ClipRectLayer`，录制画布
> 报回 `Rect.largest`，于是一个都裁不掉。测试里是 200 个孩子画了 200 个。

**刻意只裁 paint**：

- **布局不动。** 每个孩子照样 layout，所以滚动长度、intrinsic 尺寸、
  `align-items` 全部和以前一模一样——这是它能对现存页面直接打开的原因，没有任何
  东西会挪位置。
- **命中测试不动。** `hitTestChildren` 照样走到每个孩子。

iPhone 17 Pro 模拟器、debug、1000 行（3330 个元素）：

| | 之前 | 之后 |
|---|---:|---:|
| 主题切换的最慢帧（`scroll-view`）| 166.4 ms | **100.4 ms** |
| 每帧改 10–200 个的帧间隔 p50 | 50–67 ms | **33 ms** |
| 每帧改 800 个 | 100 ms | 117 ms |

最后一行是它的代价：裁剪循环本身是 O(孩子数)，在「反正每帧都要改一大半」的时候
是净亏。那一档已经是 6–8fps，两边都不能用，所以没有为它加开关。

**它替代不了 `list-view`。** 33ms 仍然是两个 vsync：paint 拿掉之后，剩下的是
1000 个孩子的 build 与 layout 仍然挂在树上，那一半只有懒构建能去掉。两条是叠加
关系——`scroll-view` 里放长列表仍然是错的，裁剪只是让「错得没那么厉害」。

## 同样两下用在 Vue 页上

`examples/hello-fjs` 的 `example/interaction/theme` 也加了「容器」开关，和 hello-js 的那一屏
一一对应。同一台 iPhone 17 Pro 模拟器、debug、4000 节点（3510 个元素）、CSS 变量
写法、列表在独立组件里，`js` 是六趟空跑的 min/med/max：

| | 优化前 | `scroll-view` | `list-view` |
|---|---:|---:|---:|
| JS 重算 + 编码 | 213 ms | 168/173/176 ms | **83/87/90 ms** |
| 过桥 + 应用 | 0 ms | 0 ms | 0 ms |
| 最慢帧 / 30 | 184 ms | 165.9 ms | **23.8 ms** |
| 帧大小 | 37 KB | 44.5 KB | 44.5 KB |

**JS 213 → 83 ms，最慢帧 184 → 23.8 ms。** 页面的写法一个字没改——变的是行装在
哪种容器里，加上下面这三件配套的事。

### 1. 外壳的 scroll-view 要能关掉

`Shell.vue` 以前把每个页面都塞进一个 `scroll-view`。那不是个偏好问题，是个正确性
问题：**外壳的滚动容器给内容的是无界高度**，所以页面里再套一个滚动容器，内层视口
就和它的内容一样高——`list-view` 没有可虚拟化的窗口，离屏 paint 裁剪也没有可裁的
窗口。自带长列表的页面必须关掉它：

```vue
<route>
{"title": "主题切换压测", "scroll": false}
</route>
```

外壳看 `route.meta.scroll !== false` 决定用 `scroll-view` 还是 `view` 包页面。

### 2. 裁剪要问遍每一层滚动容器

上一节的第一版只问最近的一个 viewport。在 hello-fjs 上那是**内层**那个——无界、
和内容一样高——于是一行都没裁掉。现在 `render/cull.dart` 会一路往上问，孩子要落在
**所有**窗口里才画。嵌套不是罕见形状：一个包页面的外壳加一个自带滚动的页面就是两层。

### 2b. 问了外层，就得跟着外层重画（2026-09 补）

上面那条只对了一半。每一个滚动 viewport 都是 **repaint boundary**
（`_RenderSingleChildViewport.isRepaintBoundary` 是 true），所以内层滚动容器画过
一次之后，外层再滚动只是把它那层已录好的图层挪个位置——它的 paint 不会重跑。
于是「按外层窗口裁掉」的那批孩子就永远裁在那儿了：页面往下滚，内层容器进了可视区，
里面却是**空白**，手指去碰一下那个内层列表它才画出来。iOS 模拟器上一整页由内层
scroll-view 组成的示例就是这个样子。

修法不是少裁，是**让它知道要重画**：凡是拿了「跨过 repaint boundary 的那层窗口」
来裁的 flex，会把自己登记到 `cull.dart` 的一张表里；`scroll_view.dart` 与
`list_view.dart` 每收到一次滚动通知就调 `fjsScrollerMoved()`，把表里的 flex
`markNeedsPaint`。单层滚动的页面这张表是空的，一分钱不花；嵌套的页面每帧多一次
「只画可见行」的 paint，正是裁剪本来就要做的那件事。

回归测试在 `scroll_cull_test.dart`——注意 widget 测试环境比真机重画得勤，
光断言「画了几个」两种实现都能过，所以那条用例断的是登记与失效这套接线本身。

### 3. 卸载一棵子树要忘掉整棵

Vue 只对子树的**根**调 `remove`，后代是隐式跟着走的，它再也不会提起它们。渲染器
以前只 `styleEngine.forget` 那一个节点，于是每个被卸载的页面都把自己的元素永远留
在样式引擎里，之后每一次重排都还在走它们。实测：在压测页上把容器从一种切到另一种，
`elements` 从 3510 变成 6798——**一次切换就翻倍**。现在 `remove` 会走完整棵子树，
切几次容器 `elements` 都稳在 3510。

这条和主题切换无关，是「用得越久越慢」那一类问题：看不见，只有计数器会说。
回归测试在 `vue_rerender.test.ts`。

## Worker 加速

长任务（大数组排序/解析/搜索）应放入 Worker（独立 isolate + 独立 VM），
主线程保持响应——JS 跑在 UI isolate 上，一段同步长计算就是一次卡帧，
见 [threading-model.md](threading-model.md#worker真正的并行)。
worker 写成 `src/workers/<name>.ts`、用 `new Worker('/workers/<name>.js')` 启动，参考 `examples/hello-fjs/src/workers/sqrt.ts` 与 `examples/hello-js/src/workers/fib.js`。消息为字符串（JSON 序列化结构化数据），
序列化成本 O(数据量)——高频率小消息建议合并后发送。

## 量路由动画流畅度：量帧间隔，别量 CPU（2026-09-10）

这条是踩出来的。上面那组 CPU 数字（920 → 750ms）看着像「修好了」，实际
**用户仍然看得见卡顿**——因为一个 200ms 的停顿摊进 2 秒的 CPU 总量里只占
10%，均值完全盖得住它，而用户看到的就是那一下。

要判断「转场顺不顺」，直接量真实呈现帧的间隔：

```bash
L='<layer> SurfaceView[<pkg>/<pkg>.MainActivity](BLAST)#<id>'   # dumpsys SurfaceFlinger --list 里找
adb shell dumpsys SurfaceFlinger --latency "\"$L\"" | tail -n +2 | awk 'NF>=3 && $1+0>0 {print $1}'
# tap 前取一次尾部时间戳当基线，tap 后 2.5s 再取一次，取比基线新的那些，算相邻差
```

环形缓冲只有 128 帧，所以窗口别超过 2 秒。读法是**看序列，不看均值**：

```
F2:      34 211 14 24 14 17 16 18 15 17 ...   ← 第 2 帧 211ms，一次性停顿
ECharts: 18  27 18 15 16 19 15 17 17 18 ...   ← 干净
```

中位数两边都是 16-17ms，p95 甚至 F2 更好看——**只有原始序列会说实话**。
和本文开头「样式基准报 min，不报单次耗时」是同一个道理：会掩盖故事的统计量
就是错的统计量。

**第二个陷阱：绝对值跨时段不可比。** 同一份 ECharts 代码、同一台模拟器，不同
时段测出 16-17ms 和 30-60ms——期间跑过两次 `flutter build apk`，还有个 iOS
模拟器在吃 40% CPU。所以只有**同一次、同样负载下**的对照和 A/B 能下结论。

这条也是踩出来的：最初拿「`tap → +2s` 窗口的进程 CPU」当验收，数字降了、判过了，
用户仍然卡——一个 200ms 的停顿摊进 2 秒 CPU 里只占 10%，均值完全盖得住，
而用户看到的就是那一下。

## rich-text 的节点数（2026-09，specs/035）

iOS 15 的老真机上打开 hello-fjs 的富文本示例页卡 UI，模拟器和 web 上看不出来。
spec 034 的实现把每个行内片段做成嵌套 `text`、每截纯文字做成一个文本节点：一个
混排 `<p>` 是 12 个节点，一个 `li` 是 5 个。035 让一个段落一个节点（片段拍平进内部
prop `richSpans`）、只含一段文字的块与段落合并、单字符串走元素文本，**外观两端逐段不变**。

节点数（`packages/fjs-runtime/test/rich-text-node-budget.test.ts`，Flutter 渲染路径，
含 `flutterRoot` 的容器节点）：

| 内容 | 035 之前 | 之后 | 帧字节 |
|---|---:|---:|---|
| 1 标题 + 3 段混排 | 42 | 6 | 2809 → 1017 B |
| 8 项三层列表 | 67 | 39 | 5320 → 3786 B |
| 4 × 3 表格 | 41 | 18 | 3147 → 1815 B |
| 30 段 + 10 项列表 + 5×3 表 + 3 图 | **486** | **91** | 34.6 → 15.3 KB |

**同引擎 A/B**（`fjsrun`，即 app 里的 QuickJS；production 版 Vue；上面最后一行内容，
挂载 + 卸载 20 次）：

| 阶段 | 之前 | 之后 |
|---|---:|---:|
| HTML 解析 | 1.30 ms | 1.27 ms |
| 白名单 / 实体 | 0.20 ms | 0.20 ms |
| 布局（之后含拍平） | 1.04 ms | 1.31 ms |
| **完整挂载**（Vue + 样式引擎 + op + `flushNow`，含上面三项） | **21.0 ms**（中位 24.7） | **6.9 ms**（中位 7.9） |

解析和布局只占两三毫秒，**挂载成本在节点上**，这就是这次优化的着力点。拍平本身让布局
贵了 0.3 ms，换来 3 倍的挂载。

### 示例页计时的陷阱：窗口里的那次 GC

示例页「长文」段的「重新挂载」按钮第一版量的是「翻 `v-if` → `nextTick` → `flushNow`」，
在 iOS 模拟器上改动前 72 / 76 ms、改动后 72 / 73 / 80 ms——**看起来毫无改善**，和上面
3 倍的 A/B 对不上。诊断时临时把窗口拆开、计时前先手动 `gc()`（**只在调试时这么做**：
`gc()` 是调试工具，页面代码不允许调用，示例页里没有这一句）：

```
article mount 12.2ms (render 12.1 · bridge 0.1 · gc before 8.1)
```

模拟器上挂载本身 12–13 ms，过桥 0.1 ms；**第一版数字里的大头是恰好落在窗口里的整堆
回收**。这个堆不是 rich-text 的：dev 模式预载了 44 个页面 chunk，富文本页面板上是
26.7 MB · 4.8 万个活对象（改动前 29.8 MB · 6.3 万，页面 `nodes` 914 → 393）。和本文
「真机上是 GC 在主导」是同一件事——节点少了，每次回收要标记的对象也少了，但回收本身
仍然可以比挂载贵。

真机（dev 构建，同一页同一按钮）：

| | 035 之前（第一版计时，窗口可能含 GC） | 之后（调试时先 `gc()` 再计时） | 之后单独量的那次 GC |
|---|---:|---:|---:|
| iOS 15.8.8 老 iPhone | 446.5 / 860 / 1172 ms | 76.8 – 93.3 ms | 31.5 – 52.2 ms |
| Android | 241.8 – 270.1 ms | 41.3 – 47.8 ms | 35 – 49 ms |
| iOS 模拟器 | 72.0 / 76.4 ms | 12.2 – 18.5 ms | 8 – 13 ms |

两列口径不同（前一列里有没有 GC 看运气），但把后一列的 GC 加回去，iOS 也只有
110–145 ms、Android 80–95 ms，仍是原来的几分之一。**真机上该看的是这两部分之和**：
挂载那一半这次压下去了，剩下的整堆回收要从堆的大小入手（dev 预载的页面 chunk、
页面自己的常驻对象），不是 rich-text 能解决的。

## 4050 元素同屏：对标 uni-app x（2026-09，specs/145 / 146）

`examples/hello-fjs` 的 `example/interaction/flat-4050` 是 uni-app x vapor benchmark 的同构页：
点一下，挂 50 × 40 格（每格 view + text，约 4050 个元素）。页面把点击 → nextTick 的 JS 拆成
过桥 / 样式 flush / 样式 mark / 其余；`examples/bench` 的 `flat-bench.ts` 在 fjsrun 里把「其余」
再按样式引擎登记、元素层、Vue 分开（包装计时自身约 0.55 µs/次，报表另给扣除后的 `.net`）。

**没有 Vue 的对照组**（specs/186）：`examples/hello-js` 的「4050 压测」tab 用底层 element API +
`StyleEngine` 搭同一棵树、同一套量法（JS / 上屏 / 最慢帧 + 同款拆账），没有 vnode、没有 patch——
它的「其余」就是纯 element 层的账，和这一页的「其余」（Vue + element 层）对着读，差额即 Vue。
console 行同前缀 `[flat-4050]`（第二段是 `element`，本页是 `vdom` / `vapor`），可以一起 grep；
`globalThis.__flat4050` 的 `show / hide / bump` 返回读数，供 fjsrun 离线驱动。

iPhone 12，`fjs run ios --profile`：

| | JS | 过桥 | 样式 flush | 样式 mark | 其余 | 点击→上屏 |
|---|---:|---:|---:|---:|---:|---:|
| 显示，145 基线 | 187–195 ms | 2 ms | 45.5 | 10 | 133 | 316–350 ms |
| 显示，146 之后 | 163–175 ms | 2 ms | 45.5 | 0 | 115–126 | 299–332 ms |
| 显示，147 之后 | **152–166 ms** | 2 ms | 35.5–37 | 0 | 114–127 | 282–316 ms |
| 隐藏，145 修前 | 109–136 ms | 78–84 ms | 0 | 0 | 30–53 | 133–166 ms |
| 隐藏，145 修后 | 52–60 ms | **1 ms** | 0 | 0 | 51–59 | 94–115 ms |
| 显示，153 之后（VDOM） | **92–93 ms** | 3.5–3.9 ms | 0.5–0.9 | 0 | 88 | 215 ms |
| 显示，153 之后（Vapor） | 121–144 ms | 3.0–3.3 ms | 0.5–0.6 | 0 | 117–140 | 248–265 ms |
| 隐藏，153 之后（VDOM / Vapor） | 46 / 42–55 ms | 1.6 ms | 0 | 0 | 45 / 41–53 | 82–94 ms |
| 显示，158 之后（VDOM） | **87.9–91.4 ms** | 3.1–4.1 ms | 0.5–1.0 | 0 | 83.8–87.5 | 181.7–198.6 ms |
| 显示，158 之后（Vapor） | 119.5–122.7 ms | 3.0–3.3 ms | 0.5–0.7 | 0 | 115.6–119 | 215.1–215.7 ms |
| 隐藏，158 之后（VDOM / Vapor） | 21–36 / 46.2–55.1 ms | 1.3–2.1 ms | 0 | 0 | — | 65.6–98.5 ms |

（「158 之后」= 2026-09-30 复测，specs/149–158 全部落地后，同机多次取样；离群值不计入区间。）

**JS 之后的上屏链路**（specs/154，`packages/flutter_fjs/tool/frame-timeline.mjs` 录 VM timeline）：显示那一帧
UI 线程 99.6 ms，其中 LAYOUT 89 ms = 布局期 build 30（每个 flex 容器的子节点在 `LayoutBuilder` 里建，一格一次）
+ GC 35 + 纯布局 24；PAINT 10 ms；光栅化只有 4 ms。

**flex 免 LayoutBuilder**（specs/156）：用不上约束的 flex 盒直接建，column 的 stretch / start 挪进
`RenderFjsFlex` 的 layout。显示帧 LayoutBuilder 回调 2060 → 4、UI 帧 99.6 → 87.7 ms、GC 36 → 31 ms；连同
specs/155 的文字引用，真机 VDOM 显示 JS 77–89 ms、上屏 181–199 ms。剩下的 GC 来自每节点展开的 Widget 串。

**每节点 Widget 层数**（specs/157）：节点视图自己监听信号（去掉 ListenableBuilder）、装饰盒不经 Container
（零宽边框不再包 Padding），一格 13 → 9 个 Element。显示帧 87.7 → 80.5 ms（build 29 → 26、GC 31 → 28），隐藏帧
30 → 23 ms；上屏 182 ms。

153 之后改 1 / 200 / 2000 格（JS）：VDOM 32 / 45 / 76 ms，Vapor 4.7–5.9 / 16.9 / 70 ms（2026-09-29，
样式引擎已在 libfjs-style，specs/150–153）。2026-09-30 复测：VDOM 30.8–61.4 / 56.6–65.2 / 63.2 ms，
Vapor 2.4–2.9 / 18.3–23.3 / 81.9 ms（单次）——改 1 / 200 格 Vapor 领先一个数量级，改 2000 格两边都进
设备 GC 噪声区，样本不足以分先后。

**显示帧的两半（2026-09-30，frame-timeline）**：JS 之前 VDOM 88 / Vapor 120 ms；JS 之后那一帧
VDOM 83.6 / **Vapor 82.8 ms——Flutter 侧两条路径完全一致**（镜像树同构），构成 BUILD ~46–50
（内嵌 Scavenge 18.7–22.1，扣除后 build ~24–32）+ 纯布局 24.5–28.3 + PAINT ~6.5；隐藏帧
22.7–24.7 ms（FINALIZE TREE ~15）；raster 最长 17.0 ms（一个 vsync），不是瓶颈。与 specs/157 的
80.5 ms 在噪声内。**渲染瓶颈没有单项大头：build、GC、纯布局各约 25 ms，继续压要三线并进。**
Vapor 挂载比 VDOM 慢的 32 ms 全在 JS（拆账见 specs/148 §8.3：外壳对象 ~10、runtime-vapor
per-item 块/scope ~15、逐格 renderEffect 比克隆块的 text 贵一倍 ~8）。

uni-app x 官方 iOS 数字：iPhone SE2 vapor 160.6 ms / UIKit 328.75 ms（终点是渲染指令交给系统，
不含最后一帧 GPU；上表的「上屏」多含约一帧）。

两处修复：

1. **卸载的 80 ms 在 Dart**（specs/145）：`mirror_tree.dart` 的 `_removeDeep` 每删一个节点都扫
   一遍全部节点的 child list，删子树是二次方。`insert` 是唯一加入 child list 的地方且先
   detach，节点只可能在一个父节点下，那一遍扫是多余的兜底。
2. **挂载期登记**（specs/146）：每个元素挂载要进样式引擎 5 次，其中 `addScope` / `setClasses` /
   insert 各触发一次子树标脏遍历。新元素还没有孩子，`ensure` 时就给它盖「子树已入队」的章，后面
   三次都走 `markDirty` 入口的早返回；scope 集合按成员驻留共享；`noteStructureChange` 同一轮
   同一个父节点只全标一次（一行 40 个孩子原来是 1 + 2 + … + 40 次）。离线登记净值 15 → 8 ms，
   开了结构伪类规则时 22 → 10 ms。`stats.markMs` / `markVisited` 在挂载时因此接近 0——口径变了，
   不是标脏没发生。

3. **flush 的同形共享**（specs/147）：一轮 flush 里，同一父链下 tag / class 集合 / scope 集合 / 首尾位 /
   `+` 邻居签名都相同（按对象同一性比，不拼字符串）的元素，直接借用先算的那个的 chain key 与 match。
   格子是兄弟、格子里的 text 是表亲，一行 40 格只拼约十次 key。兄弟下标每轮一建、前一个兄弟的签名按
   集合同一性缓存。真机 flush 45.5 → 35.5 ms；顺带让「根节点翻 class、全体后代重建 key」的主题切换
   也走共享，离线 `theme-switch-class` 20.6 → 18.0 ms。

剩下的 JS：flush 重算约 36 ms——离线逐方法计时，页面规则下是 op 编码（`applyStyle`）6.5 ms + compute
3.4 ms + recompute 自身 2.8 ms 的地板，开了结构规则再多约 11 ms 的首尾位 / 邻居签名计算；Vue + 元素层
约 115 ms。op 编码是下一个方向，没有立项。

**Vue Vapor：自研运行时（specs/161，2026-09-30 起）**：`fjs/vapor` 是 fjs 自己的实现
（runtime.ts 直连元素 API，Flutter 走 libfjs-style 原生克隆、web 走 DOM 后端），运行时回
`vue@^3.5` stable，编译器（构建期依赖）仍是 3.6。specs/148 的官方 runtime-vapor + DOM 外壳
已删除。flat-4050 离线（TS 引擎模式，优化前）：VDOM 挂载 18.0 / 自研 Vapor 46.5 ms；改 1 格
11.7 → **0.0 ms**、200 格 12.7 → **1.9 ms**、2000 格 21.3 → **19.1 ms**。真机（iPhone 12，
profile，同一版）：显示 JS 129.3–154.5 ms（官方 runtime-vapor 同口径 119.5–122.7——per-item 块记账
省不掉，详见 specs/161 §8），隐藏 21.3 ms（官方 46–55），改 1 格 **1.0–5.8 ms**（VDOM
41.2–56.4）、200 格 **8.9–26.1**、2000 格 **59.4**。原生样式（`fjsrun --frames`，2026-09-30）：
ONCE 且文本只读循环变量的格子在编译期收成 `repeatTemplate`（一批克隆，不建 per-cell effect /
scope），挂载 VDOM 18.3 / 自研 Vapor **12.6 ms**；更新不变，改 1 格 **0.0**、200 格 **1.7**、
2000 格 **17.2 ms**。真机（iPhone，hello-fjs 4050 页，profile）：Vapor 挂载 99–103 ms / VDOM
89–92 ms——这页 GridVapor 的格子读 `vals` prop，走不到静态批量，吃到的只有 runtime 侧
（50 行共用一个 scope + 首挂载快插入）；更新路径无回退，改 1 格 3.1–4.6 ms（VDOM 53–64）。
`repeatTemplateLive` 后同页复测：Vapor 挂载 85.6–108.4 ms（中位 ~92，与 VDOM 88–92 持平），
更新不变（改 1 格 3.2–4.7、200 格 17–20、2000 格 63–71 ms，首按一次 106 ms 是冷启离群）。

**格子读 prop 的静态列表（`repeatTemplateLive`，2026-09-30）**：结构仍是「一模板 + 一文本」但
表达式读了 prop/ref 的格子（真实页面的 GridVapor 就是），编译期收成 `repeatTemplateLive`——
同一批克隆，每格一个 renderEffect（首个列表级 scope，效果的首跑即初次写文本）。离线
flat-4050（bench 的 FlatLiveVapor）挂载 35 → **30.3 ms**。真机（iPhone，hello-fjs 4050 页，
profile）复测：Vapor 挂载 85.6–108.4 ms（中位 ~92，与 VDOM 88–92 持平），更新不变（改 1 格
3.2–4.7、200 格 17–20、2000 格 63–71 ms，首按一次 106 ms 是冷启离群）。

**批量执行下 native（`W_CLONE_MANY`，specs/162，2026-09-30）**：整张静态列表一个字 op——
libfjs-style 循环展开 N 份、帧末按 anchor 落 root 插入、（静态变体）首写文本随 op 走；
Dart 只见普通 op，零改动。宿主从每格 3 次 op（clone/insert/text）变成整表 1 次。离线
flat-4050（原生样式）：静态挂载 12.4 → **10.2 ms**、Live 30.3 → **26.4 ms**，帧体积
47.8KB → **3.8KB**（静态）/ 21.8KB（Live）——op 编码与派发省掉，剩余大头是 JS 侧逐格
host 记账（adoptElement/track/映射表，静态约 7 ms）与 per-cell effect（Live 约 18 ms）；
更新路径不变（0.0 / 1.7 / 16.7 ms）。真机（iPhone，hello-fjs 4050 页，profile）复测：
Vapor 挂载 75.6–103.7 ms（中位 ~87，VDOM 91.7–113.6）、帧流量 21KB vs VDOM 47KB；更新
**1.1–1.2 ms 改 1 格**（VDOM 59.6–61.9，约 50x）、200 格 4.7–18.4、2000 格 32.3–67.1
（中位 ~48，VDOM 37.5–83）——双峰是测量窗口里的 GC 停顿，非回退。再往下的选项：批量
格子的轻量记账（跳过非 root/text 节点的包装与映射）、每行一个 effect（50 个代替 2000 个，
挂载估再省 13–16 ms，代价是改 1 格重写整行文本，更新换挂载）——均未立项。同一轮
（specs/161 侧）修复：数字源 `v-for="r in N"` 的 item 此前 0 基（VDOM 是 1..N），静态格子
只读 index 掩住了它，格子一读 `r` 首行即空、整体错位一行；已按 Vue 语义改 1..N 并加
parity 用例（ba98359）。

**官方 runtime-vapor 的历史数字（specs/148 阶段 0，已被上者取代）**：`examples/bench/vapor/` 用 Vue 3.6.0-rc.9，把同一个
`Flat4050.vue` 分别以 VDOM（fjs 渲染器）和 Vapor（官方 runtime-vapor 跑在一层落到同一套 nodeOps 的 DOM 外壳上）
挂载，同一份 runtime-core、同一个样式引擎。离线挂载 VDOM **65.5 ms**、Vapor **81.5 ms**，卸载 8.2 / 9.5 ms。
逐段计时：两边的宿主工作（建元素、scope、class、insert、文本）都约 32 ms，flush 都约 18.5 ms；VDOM 的
runtime-core 只占约 15 ms，Vapor 运行时约 17 ms（每个 v-for 项一个 effect scope + 两个 ref + 一个
renderEffect），外壳再约 13 ms。**这页的 JS 大头是宿主工作和样式，不是 vnode**——框架层整个拿掉，离线上限
也只有约 15 ms。
但**更新**差一个数量级：同一棵树每格文本读响应式数组，改 1 格 VDOM 16.0 ms、Vapor 0.0 ms；改 200 格 17.1 / 2.1 ms；
改 2000 格 27.8 / 21.4 ms。VDOM 改一格也要重跑整页 render、diff 4050 个 vnode。若加一个原生「按模板克隆子树」op，
Vapor 挂载估算可到约 59 ms（省掉外壳 14.2 ms 与 create / insert 编码 8.6 ms）。

之后 Vapor 做成了可选（specs/148 阶段 1，用法见 [vue3.md](vue3.md#vue-vapor可选specs148)）。真机（iPhone 12，
`--profile`，flat-4050 页切到 Vapor 网格）：改 1 格 JS **52–68 → 5.4–6.0 ms**、上屏 82–99 → 49 ms；改 200 格
55–66 → 17–22 ms；显示 177–196 → 212–216 ms（首次挂载慢约 25 ms，与离线一致）。

**批量挂载（specs/149）**：把 8.6 ms 的元素层底线之外的时间逐层拆开——渲染器登记 ~8、样式引擎逐元素登记 ~8、
样式 flush 17–25、Vue 18（VDOM）——然后逐项削：op 写入器一次扩容内联写字节（帧不变，元素层 12 → 9.5 ms）；
新元素的 scope / class 在插入前落地时跳过必然空转的标脏；渲染器不再逐元素给元素对象加 `contains`、不预建空
child list；flush 里按父节点的 child list 顺序游标一次得到首尾位与 `+` 邻居，不再每元素找下标、两侧扫描。
离线 VDOM 挂载 66 → ~60 ms、Vapor 83 → ~74 ms，结构规则下 flush 30.4 → 26.4 ms，帧字节不变；真机 VDOM
显示 JS 177–196 → **162–165 ms**（flush 33 ms）。启动后头两次显示 flush 可能读到 52 ms 而「其余」同步变小——
是 GC 落在了 flush 里，看总 JS。

JS 里的样式引擎到此为止：每元素约 6 µs（十几个状态字段、几次 Map 查找）是 PrimJS 解释执行的地板。量过的上限——
样式调用换成每次一个 op、JS 不再 flush——不经过 Vue 的渲染器挂载 42.6 → 21.6 ms，所以下一步是样式引擎下沉 C++
（specs/150，门控 spike）。

## Vapor 包体（2026-10，specs/166–168）

同一个应用（`examples/vapor-app`：两页 + vapor Shell + pinia store）分别按 enableVapor 与 VDOM
构建（VDOM 版 = 去掉 `enableVapor` 与 `vapor` 属性，其余不动），`fjs build --analyze`：

| | VDOM | enableVapor（spec 168 前） | enableVapor（spec 168 后） |
|---|---|---|---|
| Web 总量 | 257.0 KB / gz 94.3 KB | 214.2 KB / gz 76.5 KB | **116.3 KB / gz 43.7 KB** |
| Flutter `shared.js` | 313.7 KB / gz 113.6 KB | 336.4 KB / gz 120.7 KB | 同左（168 未动 Flutter） |
| Flutter `shared.js`（specs/169，`--release`） | — | — | **207.3 KB / gz 71.6 KB** |

- **web 的大头是被一个样式函数拖进来的**：每个带 `<style>` 的 SFC，生成代码都
  `import { injectStyle } from 'fjs/web'`，而 `fjs/web` 入口静态导入整张 VDOM web 组件表
  （canvas 2d、form、rich-text、picker、swiper、list-view……约 100 KB）。纯 vapor 应用从不
  实例化它们。specs/168 把 `injectStyle` 拆成叶子模块 `fjs/web-style`，enableVapor web 包体减半。
  剩下的：base-css 26 KB、vue-router 25.2 KB、@vue/reactivity 16.6 KB、vapor host 9.4 KB、
  runtime-core 8.3 KB（tree-shake 后）、pinia 5.9 KB。
- **Flutter 端（specs/169）**：原先 enableVapor 反而更大（336.4 KB），两层原因——分包的
  shared.js 用 `import * as` 整命名空间导出（runtime-core 68.4 KB 整包可达），以及
  `vue/renderer.ts` 顶层的 `createRenderer` 调用把 VDOM 渲染引擎钉进任何导入它的包。169 把
  渲染器无关的宿主原语拆到 `vue/host-ops.ts`、enableVapor 走纯 vapor 面（无互操作、无内置
  VDOM 组件），release 的 shared.js 只导出页面用到的名字：**207.3 KB / gz 71.6 KB**（runtime-core
  11.3 KB），比同内容 VDOM 版的 313.7 KB 小 34%。L2 单独（不收窄）为 304.4 KB。release 收窄
  对 VDOM 应用同样生效：hello-fjs 436.3 → 375.9 KB、demo 809.4 → 652.9 KB。剩下的大头是 TS
  样式引擎 `css/style.ts` 41.9 KB（有原生样式引擎时仍进包，另立 spec）。

### 2026-10 复测与优化（specs/184–185）

vapor-app（此时已含 Transition / KeepAlive / TransitionGroup / Teleport 等）Flutter shared.js，fjsrun 在 Mac 上单独求值，
30 次中位数、减去进程启动：

| | VDOM | Vapor（优化前） | Vapor（184+185 后） |
|---|---|---|---|
| 开发构建 `--pages` | 316.6 KB / 26.3 ms | 342.7 KB / 28.6 ms | **294.5 KB / gz 101.5 KB / 24.5 ms** |
| release shared.js | 247.3 KB / gz 89.6 KB / 21.3 ms | 225.0 KB / gz 79.3 KB / 19.0 ms | **204.6 KB / gz 73.2 KB / 17.9 ms** |
| release 字节码 shared.fjsbundle | 736 KB / 3.8 ms | 663 KB / 3.1 ms | **607 KB / 3.2 ms** |

- **开发构建比 VDOM 还大的原因**：shared 入口对 `vue` / `@vue/runtime-core` / `fjs/vapor` 整模块导出（热重载的页面可能
  用任何名字），runtime-core 的渲染引擎（`createRenderer` / `createHydrationRenderer`）、`Suspense`、`KeepAlive`、`ssrUtils`
  全部可达（70 KB），vapor 运行时又叠在上面。specs/184：纯 vapor 应用的开发构建对这三个模块导出「全部导出名 − 这些
  VDOM 专属名字」（导出名构建时从模块读出），runtime-core 70 → 27.7 KB。
- **canvas 2d（specs/185）**：`ui/element.ts` 静态引入 canvas surface，context-registry 顶层注册 2d 工厂，所有应用都带
  context-2d / path2d / display-list。改为 canvas 组件的 Flutter 注册引入 surface、2d 工厂随 surface 注册：没用 `<canvas>`
  的应用 release 再省约 20 KB（VDOM 应用的 `app/flutter.ts` 注册了 canvas 组件，仍然带）。
- 未做：把 list-view / picker / form 等组件型标签与 render-host 挪进页面分包（约 20 KB）。它们以相对路径引用 vapor 运行时
  与 host-ops，放进页面分包会带第二份运行时与元素注册表；收益（字节码载入 < 0.3 ms）不抵改动面。

## 样式引擎下沉 C++：libfjs-style（2026-09，specs/150）

specs/146 / 147 / 149 连续三轮之后，样式引擎在 JS 里每元素仍约 6 µs（十几个状态字段的读写、几次 Map
查找），flat-4050 挂载里登记 + flush 占 25–33 ms。把逐元素那一半（元素树、签名、chain / match / compute
缓存、选择器匹配、脏标记、flush、style 表）搬进引擎无关的 C++ 库 libfjs-style，CSS 语义留在 TS、只在未命中时
回调（数据流见 [architecture.md](architecture.md)「样式引擎分两半」）。native 侧整个 flush 连回调 **0.2–0.7 ms**。

离线（fjsrun，Mac，`examples/bench`：`pnpm run native:ts` / `native:on` / `vapor`，中位数 ms）：

| | TS 引擎 | libfjs-style |
|---|---:|---:|
| flat-4050 VDOM 挂载，PrimJS | 59.3 | 42.5 |
| 同上 + 结构 / 兄弟规则 | 69.0 | 42.7 |
| flat-4050 VDOM 挂载，quickjs-ng | 58.5 | 36.3 |
| 同上 + 结构 / 兄弟规则，quickjs-ng | 61.0 | 33.7 |
| flat-4050 Vapor 挂载，PrimJS | ~74 | 60.5 |

`demo` `pnpm run bench:mount`（`<defer>`，首帧 sync / 其中 css，ms）：

| 页 | TS 冷 | native 冷 | TS 热 css | native 热 css | TS 快照 导入+sync | native 快照 导入+sync |
|---|---:|---:|---:|---:|---:|---:|
| vant-basic | 19.8 / 13.7 | 13.8 / 7.8 | 2.4 | 1.2 | 2.6 + 10.4 | 3.3 + 7.8 |
| vant-feedback | 12.3 / 7.2 | 7.1 / 2.2 | 1.7 | 0.9 | 0.7 + 7.4 | 1.1 + 6.2 |
| vant-form | 27.7 / 16.7 | 24.2 / 8.5 | 3.0 | 1.3 | 3.2 + 15.1 | 4.7 + 13.0 |
| vant-more | 14.7 / 9.7 | 10.5 / 5.3 | 1.6 | 0.6 | 3.3 + 7.6 | 4.5 + 6.1 |
| vant-nav | 19.0 / 12.0 | 13.0 / 6.0 | 1.6 | 0.4 | 2.1 + 10.0 | 2.8 + 7.8 |

读法与踩过的坑：

- **剩下的时间不在样式。** PrimJS 上 flat-4050 的 42 ms ≈ Vue ~18 + 元素层 ~9.5 + 渲染器 ~7.5 + 样式输入 op
  ~6（每元素 ensure / addScope / setClasses 三次调用，每次 ~0.5 µs，解释器下函数调用的底线；把后两个直接
  bind 到后端省一层，差异在噪声内）。
- **每元素的 JS 调用必须比 TS 的快路径还便宜**，否则 flush 省下的又还回去：第一版每元素记一份 class 表、调用链
  多两跳，登记反而比 TS 慢 30%。现在不存逐元素记录（class 表在 C++，罕见的读经 `styleClasses`），按 tag /
  class 串 / scope 缓存原子，每个 op 一次写入。
- **读 C++ 状态会 flush**：表单控件的 `:disabled` 状态若去 C++ 读 class 表，Vue patch 中途就会发帧，半棵树被
  反复重算（vant-basic 重算 275 → 1076 次）。改成 JS 侧为表单控件稀疏记一份。
- **规则表逐 sheet 追加**：每注册一个 sheet 重发整张表，vant 几十个 sheet 让首帧涨到 1.3 MB；改成追加 + 需要时
  RESTYLE(0)。
- **快照要种进 C++，JSON 延迟取**：native 不导入快照时，带快照的 TS 冷开反而更快。把快照的 chain / compute
  灌进 C++ 缓存后首开零回调；但从 JS 往帧里逐字写 JSON（~20 µs / 条）比整个 TS 导入还贵——改成种子不带 JSON，
  第一次命中时经回调取（回调返回的字符串在 C 里 memcpy）。
- **match 按 hit 集合复用**：同一组规则的不同 chain 共用一个 MatchResult，compute 结果也跟着共用（结构规则下
  flat-4050 的 compute 未命中 47 → 6）。
- **样式输入走词流**（specs/151）：拆开量才看清，每元素 `ensure` 的 0.77 µs 里光写 14 字节的 EL op 就占 0.52 µs——
  解释器下每次 typed-array 字节写约 37 ns，一次 Map 写反而只有 0.07 µs。逐元素的样式输入改写进一个 Uint32 词缓冲
  （随帧作为 `fjsStyle` 交给 uiOps），加上「待写元素槽」把 scope / class 折进同一条 EL：样式输入 7.1 → 3.2 ms。
  同期渲染器的按 tag 描述缓存与 insert 快路径把 renderer 层 9.7 → 7.1 ms；flat-4050 VDOM 挂载 43 → 38.5 ms，
  Vapor 60.5 → 49.4 ms（`examples/bench/native/floor.ts` 逐层量）。
- **原生模板克隆**（specs/152）：Vapor 的 `template()` 在 libfjs-style 注册一次，之后每个实例一条 `W_CLONE`，
  C++ 展开成 Create / Insert / SetText 并直接登记样式。同一个格子模板实例化 2000 次 24.6 → 10.6 ms，flat-4050
  Vapor 挂载 49.4 → ~36 ms，首帧 120 → 49 KB。顺带量出外壳 `Element` 构造 17 个字段就要 1 µs（解释器下每加一个
  属性一次形状迁移），减到 8 个后逐节点路径也受益。
- **VDOM 模板块**（specs/153）：编译期把「结构和 class 全静态、只有文字在变」的子树编成一个走 Teleport 协议的
  vnode，挂载时一次克隆。flat-4050 VDOM 挂载 39.5 → 20.1 ms、首帧 121 → 51 KB；改 1 / 200 / 2000 格
  14.5 / 15.3 / 25.5 → 11.1 / 12.2 / 22.6 ms（少了一半 vnode 的 diff）。vant 页几乎没有这类子树，bench:mount 持平。
- **文字走引用**（specs/155）：一次 setText 1.36 µs 里，`drawableText` 的正则 0.45、逐字节写 1–2 个字符 0.64——
  解释器下循环本身就贵。改成字符串随帧交给 host（数组 push + 9 字节 op），C++ 展开成同样的 SetText：flat-4050 VDOM
  挂载 20.3 → 17.7 ms，改 2000 格 VDOM 22.6 → 20.1、Vapor 21.2 → 18.5 ms。
- 对拍（specs/172 起要 `fjs build --ts-style`）：`__fjsNativeStyle = 'verify'` 下两个引擎同时跑、每帧逐元素比较——flat-4050、demo 全部页面
  （`demo/bench/verify-pages.ts`、`mount-verify.ts`，当时还有已删的 `mount-prewarm-verify.ts`）、hello-fjs 66 页
  （`examples/hello-fjs/bench/verify-pages.ts`）共 3 万余次比较，0 不一致。

## 自绘表面：纯展示子树不建 widget（specs/192 / 193）

**方法**：离线用 `flutter test --dart-define=FJS_BENCH=true`（`test/phase_bench_test.dart` 拆阶段、
`test/flat_bench_test.dart` 对照；JIT + assert，**读比例不读绝对值**）；模拟器用 hello-js 4050 屏、
`__flat4050.setFlat('off'|'force')` 在同一进程里 A/B，读 `[flat-4050]` 日志与
`tool/frame-timeline.mjs`。**模拟器是 debug，且语义树一直开着（所以必须 `force`），绝对值不可信；真机 profile 待复核。**

**mount 帧占比**（4050 树，离线两次一致）：build ≈ 75%（嵌在 layout 里）、layout ≈ 19%、paint ≈ 5%；
光栅线程最长仅 ≈ 5 ms。所以只换排版（方案 A）上限 19%，必须连 build 一起去掉（方案 B：不建 widget）。

**对照**（4050 网格，离线）：

| | mount | 改 1 格 | unmount |
|---|---:|---:|---:|
| 现有渲染器 | 58.2–58.6 ms | 8.0–9.5 ms | 2.8–3.0 ms |
| 192 C++ 探针（无增量） | 1.94–2.02 ms | 1.92–1.98 ms | 0.04 ms |
| Dart 自绘 | 2.46–2.67 ms（4.0–4.4%） | 0.95–1.00 ms（11–12%，重排 4 节点） | 0.12–0.16 ms |

首版 Dart 自绘 mount 3.85 ms（C++ 的 189–199%，未过 1.5 倍判据）；2000 个文字节点各自构造 span / strut 与共享缓存的键
是最大一项，按（样式、文本）共享 spec 与 painter 后降到 2.5 ms。**教训：4050 树只有 40 种段落，按节点算是浪费，
任何「每节点一份」的小对象都先想能不能按样式 / 内容共享。**

**模拟器**（iPhone 17 Pro，debug，5 轮，`off` vs `force`）：

| | off | force |
|---|---:|---:|
| show 上屏 min / med / max | 218 / 246 / 277 ms（首轮冷启动 467） | 43 / 50 / 61 ms |
| 改 1 格上屏 min / med | 106 / 116 ms | 25 / 30 ms |
| 最长 UI 帧（frame-timeline，show/hide ×3） | 196 / 190 / 88 / 79 ms | 8.1 / 7.6 / 7.4 / 7.3 ms |
| LAYOUT 最长 / BUILD 最长 | 95.6 / 76.5 ms | 4.2 / 0.8 ms |
| 光栅线程最长 | 4.7 ms | 5.5 ms（持平） |

hide 两边持平（≈ 55 ms，vsync 受限）。画面：4050 网格开 / 关逐像素一致；组件总览除进度条动画外一致。

**门控自己的成本**：一棵纯展示子树被门控判为「纯」但没有自绘（节点数不到阈值，或 `fjsFlatMinNodes` 被调到很大）时，
子树纯度只算一次并缓存，ordinary mount 多 ≈ 2.8%（4050 节点：57.8 → 59.4 ms，离线）。语义开启时 `accept` 在
子树遍历之前就返回，零开销；根节点本身有事件 prop 等 O(1) 局部拒绝的页面同样几乎无成本。

**局限**：只对纯展示子树成立（门控见 [architecture.md](architecture.md#自绘表面纯展示子树不建-widgetspecs192--193)）；
带事件 / 交互 / 子集外样式的子树不受益。**真机 profile 待复核**（要复测：show 上屏、改 1 格上屏、最长 UI 帧，
以及 `auto` 模式在无语义客户端时是否真的走自绘）。

## 已知热点（优化路线）

按 2026-09-03 那轮真机/模拟器实测重排过（**2026-09-30 增补**见第一条）：

- **4050 显示帧，2026-09-30 复盘**：JS 段 VDOM 88 / Vapor 120 ms；之后的一帧 build（扣 GC）
  ~25–32 + GC ~19–22 + 纯布局 ~25–28，三块均衡无单项大头，raster 一帧封顶。Vapor 与 VDOM 的
  Flutter 侧完全相同，差值全在 JS（specs/148 §8.3）。
- **第三方组件库页面的首开**：CSS 规则全集常驻（demo 注册 639 条）× 每个
  新元素签名的线性扫，vant 页首开 200–400 ms，且卸载即逐出缓存、重开重付。
  **2026-09 已修**：specs/075 索引把匹配从 ~240 ms 压到 7.2 ms；specs/076
  计算段分配瘦身（custom 表共享 + resolveVars 快路径）把 attributed 段压到
  13.7 ms，重开经 retire 保留近零——数字见 [vant-mount-perf.md](
  vant-mount-perf.md)。**2026-09-20 specs/084**：Dart interned `FjsStyle`
  view + JS compute miss 再瘦（冻结 `INHERITABLE_KEYS`、inherit 并进 merged）。
  匹配 miss 哨仍是 275。剩的曾经记成 GC；模拟器拆账后，`[nav] mounted`
  里最大头是 **navMount 当次一次 `fjs.ui.rect` → `flushLayout`**（vant-form
  ~160ms），不是全堆回收。**2026-09-20 specs/086**：那次 layout 移出
  navMount 同步窗口，转场不再被冻；layout 仍在下一 Flutter 帧发生。

- **QuickJS 的自动 GC 阈值**：一次 4000 节点的重排里，堆余量决定了要不要付
  一次全堆扫描——98 ms 对 35 ms。把阈值交给宿主配置是拿内存换流畅，需要产品
  决定（规格 001 待澄清 (b)）。
- **`scroll-view` 不懒**：孩子多的时候整棵都 build/layout/paint。让它在
  安全的形状下走 sliver 是最大的一块，见
  [所以 Dart 侧怎么优化](#所以-dart-侧怎么优化)。
- **样式引擎每节点的分配**：cascade 的时间花在每节点的缓存键、`sameStyle` 里的
  `Object.keys` 数组，以及 `markDirty` 的子树遍历上。在上面两条之后是次要项。
- Dart 侧 `Uint8List.fromList(ops.asTypedList(len))` 有一次拷贝，可换
  零拷贝视图。

## 小程序端：一页 Anime.js 为什么卡（2026-09）

> 这一节不是 Flutter 管线的账，是小程序端的。渲染在另一个进程里，页面能优化的
> 只有过桥这一件事：`setData` 发多少次、每次带多少字节。

症状：`examples/hello-fjs` 的 animation 组开放到小程序端（specs/061）之后，
Anime.js 那页明显卡（用户报告）。这一页同时在动 25 个圆点（stagger 网格）、
3 个方块（时间轴）、5 条缓动轨和一个计数器，全部通过「动普通对象 + 模板绑定」
实现——每帧都有大量响应式写入。

排查下来是两笔账，都与 Anime.js 无关。

### ① 每一次属性写入都过一趟桥

[`wx/instance.ts`](../packages/fjs-runtime/src/wx/instance.ts) 用
`watch(render, cb)` 驱动 `setData`：getter 建整份 data 的深快照（顺带完成深度
依赖扫描），回调做 `shallowDiff` 再发。

问题在于**这个目标只装 `@vue/reactivity`**——`vue` 在小程序端解析到
[`wx/vue.ts`](../packages/fjs-runtime/src/wx/vue.ts)，里面是反应式内核，没有
vdom，也**没有 runtime-core 的任务队列**。而独立的 `@vue/reactivity` 里，
不给 scheduler 的 `watch` 是**同步**的：

```js
// @vue/reactivity（独立包）
const o = reactive({ a: 0, b: 0, c: 0 });
let n = 0;
watch(() => JSON.stringify(o), () => n++);
o.a = 1; o.b = 2; o.c = 3;
n; // → 3（同步跑了三遍；完整的 vue 包里这里是 0，微任务后才 1）
```

于是 Anime.js 一帧写 25 个对象 × 3 个属性 = **一帧 75 次**「整份深快照 +
整份 deepEqual + `setData`」。渲染进程一帧收到 75 条数据更新。

**改法**：给 `watch` 传 scheduler——首跑同步（挂载那一帧不能延后），其余把 job
排到一个微任务，期间重复触发只排一次。这正是 runtime-core 的 pre-flush 队列在
做的事，也保证 `nextTick()`（同样是微任务）仍排在 `setData` 之后：

```ts
scheduler: (job, isFirstRun) => {
  if (isFirstRun) return void job();
  if (queued) return;
  queued = true;
  void Promise.resolve().then(() => { queued = false; job(); });
}
```

一拍里写多少次都只有一次 `setData`。75 → 1。

### ② 列表整份过桥，而且整份算「变了」

`wx:for="{{ dots }}"` 要的只是走一遍列表；模板真正读的只有 `dot.id`（位移是
`__d1[index]` 这张按项算好的表——模板里没有函数调用，`dotStyle(dot)` 早就被
提成 setup 里的 computed）。但 25 个 dot 的 `scale / rotate / y / color` 也在
data 里，动画每帧改 `scale`，**整个数组每帧重发**。

`lanes` 更典型：数组项里挂着 Anime.js 的 `Spring` 求解器实例，它的
`completed / v / …` 每帧在变，而模板只读 `lane.name`。

**改法**：编译器把 v-for 列表按**模板真正读到的字段**投影。`genFor` 在生成完
循环体之后，扫描**已经产出的那段 wxml**——模板读什么，字面就写在里面——取
`{{ }}` 里对 item 的属性读取（字符串字面量不算；`class="dot"`、
`wx:for-item="dot"` 这些非表达式位置也不算），加上 `wx:key` 用到的那个属性：

```js
// 产出
const __l0 = __fjsComputed(() => __fjsProject(dots, ["id"]));
// wxml: wx:for="{{ __l0 }}"
```

投影后的数组通常是**常量**，diff 相等就再也不发。原列表名也不再进
`__fjsData`。原样放过的情况：整项被读（`{{ chip }}`、`dot[key]`、事件的
`data-args`）、`wx:key="*this"`、嵌套 v-for 的内层列表（内层列表表达式在外层
item 的作用域里，setup 看不到）、运行时才知道是不是数字的列表；非数组（对
object 做 v-for）与原始值项由运行时 `project()` 透传。

顺带把几处「生成 computed」的地方不再往 `dataNames` 里登记**computed 自己在
setup 里读的**依赖——`__fjsData` 现在就是「模板真正读到的名字」，与它的注释
一致。

### 账面

按这一页自己的数据形状算出来的每帧负载（**计算值，不是真机测量**）：

| | 改前 | 改后 |
|---|---:|---:|
| `dots`（25 × 5 字段） | 1616 B | — |
| `lanes`（含 Spring 求解器） | 614 B | — |
| `boxes` | 214 B | — |
| 位移表 `__d1` / `__d4` / `__d7` + 标量 | 2703 B | 2703 B |
| **合计 / 帧** | **~5.1 KB** | **~2.7 KB** |
| **`setData` 次数 / 帧** | **~75** | **1** |

投影是通用收益，不止这一页：2048 的 tile 现在只带 `value` + `id`，
`CELLS` 只带 `x` / `y`。

### 没做的与剩下的

- **路径级 `setData`（`__d1[7]`）没做**：这一页 25 项**全部**每帧在变，发 25
  个 key 并不比发一个数组便宜。列表里只有少数几项在动时才划算。
- 剩下的 2.7 KB 基本就是 25 个点的 transform 字符串，是这个 demo 的量级本身。
  还想再降的话，`dotStyle` 里那句常量 `background-color` 可以挪出动画样式
  （约省 600 B/帧）——那是示例代码的取舍，不是管线的。
- 一个更早的同类问题：`snapshot()` 原本把**函数**原样拷进 `setData`
  （Anime.js 的缓动实例上挂着 `ease` / `onComplete`），宿主 `JSON.stringify`
  直接抛 `Cannot convert object to primitive value`。函数与 symbol 现在在快照
  阶段就丢掉。
