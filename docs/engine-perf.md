# 引擎性能对比：PrimJS 4.1.1 vs quickjs-ng 0.9.0

> spec 091 把引擎做成双 flavor 之后的一次实测（2026-09-22，commit `16222fd`）。
> 方法论（min 而非均值、GC 噪声的成因）与 [performance.md](performance.md) 相同，
> 本文只回答一个问题：**同一个 app 管线里，两个引擎各快在哪**。

## 一句话结论

**业务页面走的负载（分配主导：样式 cascade、挂载、字符串处理）PrimJS 快
1.3–1.7×；解释器密集的纯计算 quickjs-ng 快 1.7–2.2×。** 内存与体积 quickjs
更省（同驻留堆 -16%，Android `.so` -27%），启动两者无差。spec 088 选 PrimJS
换调试器的决定不受影响——真实页面恰好是 PrimJS 占优的那一类负载；quickjs
flavor 作为更小、更快的纯计算回退，定位不变。

## 环境

- Apple M4 Pro、64 GB、macOS 26、Apple clang 21.0.0
- 两个 flavor 都是各自 CMake 默认的 Release（`-O3 -DNDEBUG`）host 构建，
  同一份 HEAD 增量重编，`fjs-test` 双双全绿后才开测
- 两层基准：**裸引擎**（`examples/bench/engine-raw.js`，fjsrun 源码模式，
  不带 fjs runtime，引擎差异不经稀释）+ **管线**（`examples/bench` 的
  Vue + 样式引擎 + op 编码全链路，与 docs/performance.md 的历史数字同源）
- 报 min：样式用例内部 7 趟取 min，进程级再跑 3–5 趟取 min-of-mins。
  回收落在哪一趟是运气，这条路上的均值没有意义

## 裸引擎微基准（ms，越小越好）

| 用例 | PrimJS | quickjs-ng | 快者 |
|---|---:|---:|---|
| fib(27) 递归 | 16 | 9 | Q 1.8× |
| int 循环 20M | 598 | 281 | Q 2.1× |
| 浮点运算 10M | 302 | 135 | Q 2.2× |
| **字符串 `+=` 10 万次** | **6** | **91** | **P 15×** |
| 模板字符串 20 万次 | 40 | 21 | Q 1.9× |
| split/join 类名 5 万次 | 62 | 49 | Q 1.3× |
| JSON.stringify 5k 对象 | 6 | 8 | P 1.3× |
| JSON.parse ~5MB | 72 | 119 | P 1.65× |
| 数组排序 10k | 4 | 3 | Q 1.3× |
| map/filter/reduce 20 万 | 22 | 14 | Q 1.6× |
| 对象churn 100 万个弃置 | 171 | 133 | Q 1.3× |
| 热属性读写 5M 次 | 284 | 128 | Q 2.2× |
| 建+遍历 20 万对象图 | 154 | 210 | P 1.4× |
| for-of Map+Set 20 圈 | 814 | 878 | ≈平 |
| 闭包分配 100 万 | 230 | 197 | Q 1.2× |
| 正则匹配 20 万次 | 210 | 174 | Q 1.2× |
| promise 链 1200 个 await | ~1 | ~1 | 分辨率以下，平 |
| promise 分配+then 20 万 | 196 | 227 | P 1.2× |

## 管线基准（examples/bench，ms，5 进程取 min）

| 用例 | PrimJS | quickjs-ng | 快者 |
|---|---:|---:|---|
| fib(27)（带 runtime） | 16.6 | 9.5 | Q 1.75× |
| 字符串 `+=` 10 万 | 6.7 | 94.0 | P 14× |
| JSON.stringify 5k | 9.9 | 10.5 | ≈平 |
| 数组排序 10k | 3.8 | 3.1 | Q 1.2× |
| UI 建 1000 节点 | 19.5 | 15.0 | Q 1.30× |
| UI 改 1000 文本 | 2.6 | 2.2 | Q 1.2× |
| **样式挂载 1000 行** | **92** | **145** | **P 1.58×** |
| **切主题（翻 root class）** | **22.0** | **31.6** | **P 1.44×** |
| **切主题（改自定义属性）** | **15.0** | **25.9** | **P 1.73×** |
| 切主题（只跑 cascade 不过桥） | 15.8 | 23.3 | P 1.48× |
| 切主题 + 400 条噪声规则 | 15.0 | 24.0 | P 1.60× |
| 重渲染（只换处理器身份） | 1.6 | 1.2 | Q 1.3× |
| 单节点换 class | 0.03 | 0.02 | 分辨率以下，平 |
| Vue 切主题（列表内联） | 43.2 | 35.9 | Q 1.20× |
| Vue 切主题（列表隔离） | 13.7 | 17.8 | P 1.29× |

帧字节数（`frameBytes`）两个引擎逐项**完全一致**——op 协议输出与引擎无关，
跨引擎渲染结果可比。

## 内存、体积、启动

| | PrimJS | quickjs-ng | 差 |
|---|---:|---:|---|
| 启动（trivial 脚本，进程到退出） | 2.1 ms | 2.1 ms | 平 |
| 引擎裸 RSS | ~2.4 MB | ~2.4 MB | 平 |
| **驻留堆**（60 万个存活对象） | 182.8 MB | **154.1 MB** | **Q 省 16%** |
| 峰值 RSS（churn 压测脚本） | **728 MB** | 778 MB | P 省 6% |
| Android arm64 `libfjs.so` | 1.94 MB | 1.41 MB | Q -27% |
| （debug 附加）`libfjs_debugger.so` | +0.49 MB | 无此文件 | release 两侧都不背 |
| abi/ 双平台缓存总量 | 30 MB | 17 MB | — |
| 字节码 bundle（161 KB 源码） | **473 KB** | 613 KB | **P -23%** |
| fjsc 编译同包 | 0.02 s | 0.02 s | 平 |

字节码更小、源码 `+=` 更快，两个优势都指向同一件事：PrimJS 的字符串/
元数据表示更紧凑。bundle 头锁 engine id，跨 flavor 运行会得到明确的
mismatch 报错（双向实测过），不会静默错配。

## 差距从哪来

### 1. 引用计数 vs tracing GC——PrimJS 的优势项全在这

quickjs(-ng) 的内存管理是引用计数 + 周期回收；PrimJS 把它换成了 tracing GC
（vendored 树里的 `gc/collector_ms.cc`）。上面两个引擎各自主场的用例全部能
用它解释：

- **字符串 `+=` 14×**：RC 引擎每次追加都要调整引用计数、扩容拷贝；tracing
  GC 没有每操作的计数流量，PrimJS 把这条路径做到了接近零分配。
- **样式引擎 1.4–1.7×**：4000 节点的主题切换是分配风暴（performance.md 的
  老结论"约 8.5 µs/节点，压的是每节点的分配"），少了 RC 流量的 PrimJS
  在每个级联用例上都反超。带 400 条噪声规则不变速，说明与规则匹配无关，
  就是纯分配/GC 的账。
- **驻留堆 -16%**：RC 即死即收，常驻堆紧；tracing GC 在两次回收之间留着
  垃圾，且 PrimJS 的对象头带着编译期常开的 debugger / heap-profiler 字段
  （`ENABLE_QUICKJS_DEBUGGER`、`ENABLE_HEAPPROFILER`，见其 CMakeLists）。

### 2. 解释器内核——quickjs-ng 的优势项，且不是开关问题

fib / 整数循环 / 浮点 / 属性访问这类无分配的纯解释器负载，quickjs-ng 快
1.7–2.2×。两点排除了"配置没对齐"的可能：

- **对照实验**：PrimJS 的 CMakeLists 无条件 `add_definitions(-DEMSCRIPTEN)`，
  这会让它的解释器走 `DIRECT_DISPATCH 0`（switch 派发而非 computed-goto）。
  在 /tmp 的拷贝里删掉该宏、重编、重测——fib 17 ms 对 16 ms，**纹丝不动**。
  差距不在派发方式，在内核本身。
- PrimJS 官方"比 QuickJS 快 28%"（Octane）的基线是 bellard QuickJS，不是
  quickjs-ng；后者同期对解释器做了大改。另外 Lynx 的模板解释器在被剪掉的
  `src/interpreter/primjs/` 里（见 `primjs/VENDORED.md`），vendored 树里
  本来就没有——我们测的就是发布形态。

### 3. UI 管线：混合负载，互有胜负但都在 1.3× 以内

建/改节点、重渲染这类「一半解释器、一半分配」的用例没有一边倒：建树、
改文本 quickjs 略快，Vue 列表隔离版 PrimJS 略快。真实页面是这些用例的
加权混合，再叠上 Flutter 侧的 build/layout/paint（performance.md 里最慢帧
的那本账，与引擎无关）。

## 对工程的含义

- **默认 PrimJS 维持**：调试器只有它有（且是当初切换的原因），而业务页面
  的主要成本（挂载、切主题、样式重排）恰好全是 PrimJS 占优的负载。
- **内存敏感场景留意驻留堆 +16%**：长驻页面、低端机上要多看一眼。拿内存
  换流畅的阈值话题（performance.md 的"空闲时收"一节）在两个引擎上表现
  会不同，真机复测时别混用两 flavor 的数据。
- **纯计算型 worker**（排序、解析大 JSON、搜索）quickjs flavor 更快；
  但这些按 threading-model 应该已经在 Worker 里，不占 UI 帧。
- **包体积**：quickjs 每架构省约 0.5 MB；release 本来就不带 debugger 文件，
  差距全在引擎本体。
- **升级 PrimJS 时重跑本对比**：`engine-raw.js` 与 `examples/bench` 的命令
  在下面，十几分钟出全套数字。

## 兼容性差异（简要，细节见 [toolchain.md](toolchain.md)）

- PrimJS 是 **ES2019**（spec 088 从 quickjs-ng 的更高基线降下来的），
  quickjs-ng 支持更新的语言特性。
- PrimJS 没有 `queueMicrotask` 全局——runtime 已在 `fjs-runtime/src/
  microtask.ts` 兜底（specs/091 T057），新代码不要裸调引擎全局。
- quickjs flavor 无 CDP 调试器，`fjs debug` 会明确提示降级。

## 复现

```bash
cd packages/flutter_fjs/native
cmake --build build-native -j                       # primjs（默认）
cmake --build build-native-quickjs -j               # quickjs（已配好 flavor）
./build-native/fjs-test && ./build-native-quickjs/fjs-test

# 裸引擎
../../examples/bench/engine-raw.js 两边各跑 3 遍取 min-of-mins：
./build-native/fjsrun ../../examples/bench/engine-raw.js
./build-native-quickjs/fjsrun ../../examples/bench/engine-raw.js

# 管线
cd ../../examples/bench && pnpm run build           # 或 fjs build --js-engine quickjs
../../packages/flutter_fjs/native/build-native/fjsrun --pump 8000 dist/app/bundle.js
../../packages/flutter_fjs/native/build-native-quickjs/fjsrun --pump 8000 dist/app/bundle.js

# 内存（macOS 的 time -l 报的是字节）：
/usr/bin/time -l <fjsrun> heap-heavy.js 2>&1 | grep "maximum resident"
```

本文数字的采集脚本：`examples/bench/engine-raw.js`（裸引擎）与
`examples/bench/src/`（管线）。数字随机器和版本变化，升级引擎后请重测，
不要沿用。
