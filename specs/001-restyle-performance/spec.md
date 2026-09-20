# Spec: CSS 重排性能（主题切换）

- **ID**: 001-restyle-performance
- **状态**: in-progress
- **日期**: 2026-09-03

## 1. 要解决什么

**主题切换在真机上卡顿。** 一个 4000 节点的页面切换配色，用户看到明显的掉帧。

这不是一个 bug，是一整条链路上的多处成本叠加。把它量开之后（`examples/bench`
的样式基准 + `examples/hello-fjs` 的 `example/theme` 压测页 + `styleEngine.stats`）：

| 环节 | 起点 | 现状 |
|---|---:|---:|
| 过桥帧（4002 节点）| 613 KB | 52 KB |
| Dart 侧应用帧 | 每节点一次 `jsonDecode` | 每种样式一次 |
| 一次整树重建的样式解析 | 10000 次 | 0 次 |
| 一次 `setText` 的节点重建 | 1201 次 | 2 次 |
| 真机 debug，一次切换的 JS 耗时 | ~2500 ms | ~1000–1800 ms |

**当前的主导成本是 GC。** 真机上连测三次，计数器分毫不差（recompute 3498、
markVisited 8554、computeMiss 107），耗时却在 966–1829 ms 之间摆动——哪一趟碰上
回收，哪一趟付全部账单。堆是 **16.8 MB / 60056 个活对象**，QuickJS 是全堆标记
清扫，触发点由分配决定，所以它落在哪一帧是运气。

顺带暴露并修掉的、与主题无关但同源的问题：

- Vue 的 `v-if` 锚点带内联样式 `display:none`，而内联样式正是让元素永久失去
  memoize 资格的条件——1000 行的列表里每行一个锚点，它们是 4364 个元素里的 968
  个，也几乎是全部的 compute 未命中
- 模板里的 `@tap="() => f(x)"` 每次渲染都是新闭包，渲染器每次都把 `onTap: true`
  重发一遍——1000 行重渲染 23 KB 的纯浪费
- `flex.dart` 给子节点套的 `Expanded` / `Align` 没有 key，父节点 reconcile 的是
  包装层，于是一次重排退化成整棵子树重建

## 2. 不做什么（Non-goals）

- **不改 CSS 语义。** `docs/css-compat.md` 的支持矩阵一格不动；本规格是纯工程
  优化，现有的 `css.test.ts` / `vue_styles.test.ts` 必须原样通过
- **不把 `var()` 解析下沉到 Dart。** 曾评估过（主题切换可降到 JS 侧 O(1)），但
  它要求 invalid-at-computed-value-time、`normalizeValue` 的时机、继承值在谁的
  作用域里解析这三件事跨两种语言各实现一遍，违背「CSS 引擎单点在 JS」
- **不动 QuickJS 的自动 GC 阈值。** 调高阈值是拿内存换流畅，在手机上不该由框架
  替 app 做这个决定
- **不追求「主题切换 O(1)」。** 每个节点的颜色确实都变了，O(N) 重排与 O(N) 重建
  是正确行为；目标是把每节点的常数压到帧预算内，不是取消这个 N
- **不做 Flutter 侧的动画化主题过渡**（`transition` 仍未支持，见 roadmap）

## 3. 用户可见的行为

**页面代码写法不变。** 主题按 CSS 自定义属性写，和以前一样：

```vue
<script setup lang="ts">
import { useTheme } from '@/theme';
const { vars, toggle } = useTheme();
</script>

<template>
  <!-- 令牌挂在一个节点上，沿树继承；组件里只写 var(--fjs-card) -->
  <view class="shell" :style="vars">
    <NavBar />
    <!-- 长列表放进自己的组件：它的 props 不随主题变，Vue 会整个跳过 -->
    <Rows :items="items" />
  </view>
</template>
```

三件对写法有影响的事：

1. **长列表要放进自己的组件，并且装在 `list-view` 里。** 两件事各省一层：
   组件隔离省掉 Vue 重建并 diff 整张列表的 vnode（1000 行实测 55.6 → 34.6 ms，
   过桥字节一个不差）；`list-view` 省掉 Flutter 为看不见的行做的
   build/layout/paint（同样 1000 行，最慢帧 166 → 29 ms；离屏裁剪之后 100 → 29）。
   写在 `docs/vue3.md`
2. **主题用 CSS 变量还是翻 root class，随便。** 两者实测同价（离线 30.6 vs
   34.2 ms，真机 160.6 vs 161.8 ms）；按可读性选
3. **事件处理器用内联箭头函数不再有过桥代价。** 处理器只在**存在性**变化时过桥

**新增的可观测面**（都不是渲染能力，是给性能定位用的）：

```ts
import { gc } from 'fjs';               // 主动回收一次，返回前后堆大小
import { styleEngine } from 'fjs/vue';  // styleEngine.stats

styleEngine.resetStats();
// ...触发重排...
styleEngine.stats;
// { recompute, computeHit, computeMiss, matchHit, matchMiss, applied,
//   flushMs, flushes, markMs, markCalls, markVisited, elements, rules }
```

`markMs` 与 `flushMs` 是要分开看的两半，而且**后者不含前者**：标脏遍历发生在
框架的 patch 期间，任何裹在重算外面的计时都看不见它。

`examples/hello-fjs` 的 `example/theme` 是这套东西的活样例：节点数、列表归属、
主题写法三个开关，屏上直接显示 JS 耗时 / 过桥耗时 / 帧大小 / 最慢帧 / 引擎计数
/ 堆大小。**不依赖 dev server**——release 构建里没有那条通道。

`examples/hello-js` 的第一屏是它**不经过 Vue 的双胞胎**：底层 element API +
`StyleEngine` 搭出同构的树（同一份 CSS、同样 12 个自定义属性、同样的 `:active`），
同样四格读数，外加一个「堆压载」开关，用来单独改变活对象数而不改变工作量。两页
对着读，JS 那一格的差额就是 Vue 这一层的价钱。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 主题写法 | CSS 自定义属性沿树继承，由 fjs 的样式引擎解析 | 同一份源码，浏览器原生 CSS 变量 |
| 长列表隔离的收益 | 省掉 Vue 的 vnode diff **和**样式引擎的重排 | 只省 Vue 的 vnode diff |
| 事件处理器重发 | 已消除 | 不适用（DOM 渲染器本来就有 invoker） |
| `styleEngine.stats` | 真实计数 | 全零：浏览器做 cascade，fjs 的引擎没参与 |
| `gc()` | 回收并返回堆大小 | 返回 `null`（没有引擎） |
| 已知差异 | — | 「过桥」「帧大小」「最慢帧」在 web 上没有意义，压测页显示 `web 无桥` |

**本规格的优化项在 Web 侧没有对应物，而这不是「只做一端」**：op 协议、样式驻留、
Dart 解析缓存、Flutter 重建粒度这四样在 Web 上都不存在——浏览器有自己的 CSS 引擎
和渲染管线。唯一跨两端的用户可见约定是第 3 节的三条写法规则，它们两端同样成立
（收益不同，已在上表登记）。

## 5. 契约变更（宪法 II）

- [x] **UI op 协议**（`ops.ts` + `ui_ops.dart`）：新增 `7 DEFINE_STYLE` /
      `8 SET_STYLE` / `9 RESET_STYLES`。同一份 computed style 每帧只过一次桥，
      节点用 13 字节引用它。**第三处解码器 `native/tools/fjsrun.cpp` 必须同步**
      （不改则每帧静默截断）；宿主用 `globalThis.__fjsHost.uiOpsVersion` announce
      自己能解到哪一版，新 bundle 遇到老宿主时回落到 op 6 的老编码
- [x] **natives 表**（`native-global.d.ts` + `natives.cpp`）：新增
      `__fjs.fns.gc()`，返回 `{ before, after, objects }`
- [ ] 事件类型（`element.ts` + `fjs.h`）：不涉及

`FJS_ABI_VERSION` **不动**：它版本化的是 C ABI，op 帧对原生层是不透明字节。

## 6. 验收标准

1. `pnpm --filter @ufjs/runtime test` 通过（含 `ops_intern.test.ts` 的字节级契约、
   `vue_rerender.test.ts` 的重渲染/锚点/卸载子树断言）
2. `cd packages/flutter_fjs && flutter test` 通过（含 `mirror_tree_test.dart` 的
   驻留解码、`resolved_style_test.dart` 的解析计数、`node_rebuild_test.dart` 的
   重建计数）
3. `cd packages/fjs-runtime && pnpm run typecheck`、
   `cd examples/hello-fjs && npx vue-tsc --noEmit` 通过
4. `cd examples/bench && pnpm run build && ../../packages/flutter_fjs/native/build-native/fjsrun --pump 8000 dist/bundle.js`
   跑出样式基准，数字回填 `docs/performance.md`
5. `flutter test --dart-define=FJS_BENCH=true test/render_bench_test.dart`
   报出解析缓存与视图缓存的对照（对照组必须是**绕过**缓存，不是清空）
6. `cd examples/hello-fjs && pnpm run build:web` 通过，`example/theme` 页在浏览器
   里能渲染、能切主题、控制台无报错
7. `fjs run ios`（或 android）进 `example/theme`，2000 行下切主题：
   - 屏上「过桥 + 应用」为 0 ms
   - 引擎计数 `matchMiss` 为 0，`computeMiss / recompute` < 5%
   - 无 `visit cap` 告警
8. 拖拽排序页（`example/dnd`）拖动后顺序与颜色跟随各自的块——重建粒度没有破坏
   keyed 重排
9. `docs/performance.md`、`docs/architecture.md`、`docs/principles.md`、
   `docs/custom-renderer.md`、`docs/vue3.md` 与实现一致（宪法 VII）
10. `examples/hello-js` 的主题压测屏（不经过 Vue 的同一棵树）能在真机/模拟器上
    跑出同一组四个数字，用来把框架的账和引擎的账分开

**尚未满足**：第 7 条在真机 release 上的「不卡顿」判定。当前真机 debug 一次切换
仍需 ~1000–1800 ms。

**新的定位数据（2026-09-03，iPhone 17 Pro 模拟器、debug）**：不经过 Vue 的同一
棵树（`examples/hello-js`，3323 个元素）是 JS 106 ms、过桥 0 ms、最慢帧 233 ms，
而 `example/theme`（4364 个元素）是 JS 213 ms、过桥 0 ms、最慢帧 184 ms。三件事
因此被钉住了，细节见 `docs/performance.md`：

- **Vue 大约占 JS 侧的一半**，剩下一半在样式引擎里
- **最慢帧比 JS 还大，而且两个 app 上是同一个量级**——那是 Flutter 的重建 + 布局
  + 绘制，和框架无关。JS 侧优化到零，这一页仍然会掉十几帧

再往下拆了一层（压测屏加了「容器」开关；两个开关都不改 JS 的工作量，
`recompute` 3330、`applied` 3175、帧 42.0 KB 三边一致），得到一张 2×2：

| 容器 \ 堆压载 | 无 | 6 万对象 |
|---|---|---|
| **scroll-view** | js 98/101/111 ms · 最慢帧 **166.4 ms** | js 35/37/46 ms · 最慢帧 150.9 ms |
| **list-view** | js 55/57/69 ms · 最慢帧 **29.0 ms** | js 34/37/48 ms · 最慢帧 **17.5 ms** |

（「最慢帧」两格是离屏 paint 裁剪之前量的；裁剪之后 `scroll-view` 那一格是
100 ms，`list-view` 不变。）

- **最慢帧由容器决定**：166 → 29 ms（**5.7×**；离屏裁剪之后是 100 → 29）。
  `scroll-view` 是
  `SingleChildScrollView` 套 `Column`，Column 会 build/layout/**paint** 每一个
  孩子——1000 行里 990 行画给没人看。`list-view` 走 `ListView.builder`
- **JS 由堆的余量决定**：98 → 35 ms（**2.8×**），变的只是多了 6 万个死活对象。
  自动回收由分配触发、阈值跟着堆走：堆小则阈值低，一次重排正好越过它
- 两个都打开：JS 34 ms + 最慢帧 17.5 ms（起点是 98 / 166）

## 7. 待澄清

- [x] ~~要不要把 QuickJS 的自动 GC 阈值交给宿主配置？~~
      **2026-09-20 产品决定：不开放、不改阈值，保持 QuickJS 默认。**
      压测屏「堆压载」量过这笔交易（多留 ~6 MB，4000 节点重排 98 → 35 ms），
      但框架不替 app 做「拿内存换流畅」。空闲回收那条已经撤了（方向是反的）。
- [x] ~~4000 节点 106 ms、8000 节点 101 ms，那 90 ms 是什么？~~ 是 GC。节点多
      一倍反而不慢，是因为大的那棵树把堆撑到了自动阈值之上，那一趟就不用付全堆
      扫描的钱。前一版依据单次读数写的「模拟器上 GC 不是主因」作废——改成报六趟
      的 min 之后，同一个压载开关是 98/101/111 → 35/37/46 ms
- [x] ~~剩下的每节点分配还值不值得压？~~ 不值得，换一条路：计数器说 3330 个元素
      塌到 27 种样式，而这件事被重新证明了 3330 遍。把重排的规模从「节点数」换成
      「样式数」，设计见 [002-style-slots](../002-style-slots/spec.md)
- [ ] **`scroll-view` 要不要变懒？** 孩子多且没有绝对定位的时候自动走 sliver，
      收益就是上表那 5.7×。代价是会改变一批边界语义（`justify-content`、
      非 stretch 的 `align-items`、intrinsic 宽度、`gap`），所以该单独立项。
      已经做的两件不改语义的：debug 构建下孩子 ≥ 200 的一句提醒，以及**离屏
      paint 裁剪**（`render/cull.dart`，靠 `RenderAbstractViewport` 找窗口，
      只裁 paint、不碰 layout 与命中测试）。裁剪把主题切换的最慢帧从 166 ms
      压到 100 ms、把「每帧改 ≤200 个」从 50–67 ms 压到 33 ms，**但一档都没有
      带回 60fps**——剩下的两个 vsync 是 1000 个孩子的 build 与 layout，只有
      懒构建能去掉
- [ ] **压测页读引擎内部，是否可接受？** `theme.vue` 从 `fjs/vue` 导入
      `styleEngine`，而 web 构建里 `fjs/vue` 解析到的是 Flutter 的自定义渲染器
      模块——能编能跑（web 上计数全零），但它把一个 web 侧用不到的模块拉进了
      bundle。是保持现状（示例页本就以 Flutter 为主），还是用 `hasNativeHost`
      把这段守起来？
- [ ] **`--dev-host` 要不要回来？** 真机 debug 时 `deviceAddress()` 只取
      `lanAddresses()[0]`，猜错就静默连不上、且无法覆盖。本轮加过又按要求移除，
      需要确认是长期不要，还是换个形式
