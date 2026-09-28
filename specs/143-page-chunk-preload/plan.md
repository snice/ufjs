# Plan: 页面 chunk 提前执行

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | `router.preload(path)` 与自动预执行两端都有：Flutter 在 `router/flutter.ts`（chunk 执行交给 Dart），Web 在 `router/web.ts`（调用路由表里的 `() => import()`）。小程序 `wx/router.ts` 补一个立即 resolve 的 `preload`，保持 `Router` 形状一致（小程序分包由微信加载，不在范围内）。自动队列共用 `router/preload-queue.ts`。 |
| II 边界即契约 | 否 | 三张表都不动。JS → Dart 走现有的 `invokeHostAsync`（spec 039，复用事件 32 `asyncResult`），新增一个 async 宿主模块名 `fjs.nav.preload`，和 `fjs.nav.load` 同级，不是新的 C ABI，也不是新事件号。 |
| III 同步单线程零序列化 | 是 | 预执行仍在 UI isolate 上同步执行 chunk，没有引入跨线程。"空闲"由 Dart 判定（见 §3.3），这正是为了不和转场、触摸抢同一根线程。参数只有 `chunk: string`、`idle: boolean` 两个标量。 |
| IV 外观照 WeUI | 否 | 无 UI。 |
| V 静默失效是 bug | 是 | 自动队列里某个 chunk 失败时 `warnOnce('[fjs-router] preload <chunk> failed: …')` 并跳过，不会吞掉；打开该页时仍走原有加载路径，失败按现有逻辑报错并弹回。`router.preload()` 失败会 reject，由调用方处理。不存在的路径 resolve（spec §3.2）属于约定行为，不算静默失效：路径拼错在 `push` 时自然会暴露。 |
| VI 注释记录权衡 | 是 | 需要写明理由的地方：为什么由 JS 驱动队列而 Dart 判定空闲；为什么 `hasScheduledFrame` 可以作为空闲信号，以及 2 s 兜底的来由；为什么删掉 `_preloadDevChunks`；为什么预执行时一并导入样式快照。 |
| VII JS 能包就不要下 Dart | 部分下 Dart | 队列、去重、路由到 chunk 的映射、单包 `pageComponent()`、快照导入都在 JS。必须落 Dart 的两件事：①chunk 的读取与 eval 本来就在 Dart（`_ensureChunk`），JS 无法自己 eval 一个 asset；②"手指是否按着、转场是否在跑、是否还有帧在排队"只有 Flutter 知道。JS 端只能看到 `touchstart` 派发，看不到 fling 惯性、Ticker 动画这些。 |
| VIII 变更落到文档 | 是 | `docs/routing.md`：`router.preload()` 和 `preload: false` 开关。`docs/code-splitting.md`：chunk 什么时候执行。`docs/vant-mount-perf.md`：实测一节。`docs/roadmap.md`：打勾（如有对应条目）。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | —（不动） | 路由表、chunk 名与 manifest 都已具备所需信息：Flutter 表的 `RouteRecord.chunk`、单包的 `definePageLoader`、web 表的 `component: () => import()`。 |
| JS runtime | `packages/fjs-runtime/src/router/types.ts` | `Router` 加 `preload(to: RouteLocationRaw): Promise<void>`；`RouterOptions` 加 `preload?: boolean`（默认 true）。 |
| JS runtime | `packages/fjs-runtime/src/router/preload-queue.ts`（新） | 与平台无关的自动队列：`startPreloadQueue(paths, preloadOne)`。一次一个、按路由表顺序、跳过已加载的；单条失败时 warnOnce 后继续；返回一个 stop 函数，给 VM 重建或测试用。 |
| JS runtime | `packages/fjs-runtime/src/router/flutter.ts` | `FlutterRouter.preload(to)`：按 `matcher.record(path)` 找到 `chunk`。有 chunk 且未注册时 `await invokeHostAsync('fjs.nav.preload', chunk, idle)`；然后 `pageComponent(record.path)`（单包在这里执行页面模块），再 `importPageStyleSnapshot(record.path)`。无原生宿主（fjsrun / 测试）时直接走 `pageComponent`。自动队列在首个页面 `markSettled` 之后启动一次，每条带 `idle = true`。 |
| JS runtime | `packages/fjs-runtime/src/router/web.ts` | `preload(to)`：用 `vueRouter.resolve(to).matched` 取 `components.default`，是函数就调用它并 await。自动队列在首页 settled（`whenSettled`）之后，按 `requestIdleCallback` 逐条执行，浏览器不支持时退回 `setTimeout(…, 50)`。 |
| JS runtime | `packages/fjs-runtime/src/wx/router.ts` | `preload: () => Promise.resolve()`，注释说明小程序分包预下载属于 `preloadRule`，不在这里做。 |
| JS runtime | `packages/fjs-runtime/src/app/flutter.ts`、`app/web.ts` | `FjsAppOptions` 透传 `preload` 选项（`createRouter(options)` 已经整体透传，确认类型能过即可）。 |
| Web 适配层 | —（不动） | web 侧的差异全部在 `router/web.ts` 里。 |
| C++ 引擎 | —（不动） | |
| Dart 宿主 | `packages/flutter_fjs/lib/src/idle_gate.dart`（新） | `FjsIdleGate`：一个全局 pointer route 统计按下 / 抬起 / 取消的计数，`routeAnimating(key, bool)` 登记正在转场的路由。`Future<void> whenIdle()` 在满足"没有手指按着、没有路由在转场、本帧结束后 `hasScheduledFrame == false`"时完成。连续 2 s 始终有帧排队（常驻动画，如 swiper autoplay、loading）时，只要手指没按着、没有转场，就放行。纯 Dart、不依赖 VM，可以单测。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | ①`_setupNavModules` 里 `host.registerAsync('fjs.nav.preload', …)`：`idle` 为真时先 `await _idle.whenIdle()`，再 `await _ensureChunk(chunk)`（chunk 为空就只等空闲）。②`_loadChunk` 带上来源，日志写成 `[nav] chunk X … (preload)`。③转场登记：`_pushRoute` 且 `anim != 'none'` 时置 animating，`onRouteSettled` 清除；`onRouteRemoved` 置 animating，`onRouteTransitionComplete` 清除。④删除 `_preloadDevChunks` 及两处调用，dev 分包改走同一条 JS 队列。⑤`dispose` 里卸掉 gate 的 pointer route。 |
| Dart 测试 | `packages/flutter_fjs/test/idle_gate_test.dart`（新） | 手指按住时不放行，抬起后放行；转场中不放行；持续有帧时 2 s 兜底放行。 |
| JS 测试 | `packages/fjs-runtime/test/preload-queue.test.ts`（新） | 顺序、跳过已加载、失败时 warn 后继续、stop 生效、同一 chunk 只执行一次（与手动 `preload` 并发时去重，依托 Dart 侧 `_loadingChunks` 和 JS 侧 `pageComponent` 的幂等性）。 |
| JS 测试 | `packages/fjs-runtime/test/router-preload.test.ts`（新） | Flutter router 在无宿主模式下：单包 `preload` 会执行 loader 且只执行一次；不存在的路径 resolve；快照在 preload 时导入、mount 时不再重复导入（`snapshotImported` 同一 epoch）。web router：`preload` 调用了 lazy component。 |
| 文档 | `docs/routing.md`、`docs/code-splitting.md`、`docs/vant-mount-perf.md` | 见 VIII。 |

## 3. 方案

### 3.1 JS 驱动队列，Dart 判定空闲

```
首个页面 settled
  └─ startPreloadQueue(路由表里所有 path)
       for path of paths（已加载的跳过）:
         await router.preload(path, { idle: true })
            ├─ Flutter 分包: invokeHostAsync('fjs.nav.preload', chunk, true)
            │     Dart: await idle.whenIdle(); await _ensureChunk(chunk)
            ├─ Flutter 单包: invokeHostAsync('fjs.nav.preload', '', true) 只等空闲，
            │     然后 pageComponent(path) 在 JS 执行页面模块
            ├─ 然后 importPageStyleSnapshot(path)
            └─ Web: await requestIdleCallback; await component()
```

- 队列按路由表顺序执行，tab 页在表里通常排在前面。
- 手动 `router.preload(path)` 不等空闲：手指按下的那一刻正是要执行的时机。它与自动队列共享去重，Dart 的 `_loadingChunks` 保证同一 chunk 同时只有一次读取和执行；JS 的 `pageComponent` 删 loader 后再次调用是空操作。
- 公开签名只有 `preload(to)`；`idle` 是内部参数，不暴露出去。

### 3.2 为什么删 `_preloadDevChunks`

它只在 dev 分包模式生效，按固定 16 ms 间隔执行，不看触摸和转场。统一走 JS 队列后，dev、profile、release、fjs go hosted 四种宿主是同一套行为，dev 下看到的就是 release 的样子。VM 重建（dev reload）后 `router.start()` 会重新跑，队列自然重启，不需要 Dart 再在 `onReload` 里补调。

### 3.3 空闲判定

`hasScheduledFrame == false` 覆盖了 fling 惯性、Ticker 动画、转场、Navigator 动画等所有"还在动"的情况，比逐个登记动画源更完整。路由转场单独登记，是因为转场的首帧之前可能出现短暂的无帧间隙。常驻动画会让帧永远在排队，所以设 2 s 兜底：此时只要手指没按着、没有转场就放行，执行一个 chunk（12–16 ms）最多掉一帧，可以接受。

### 被否掉的备选

| 方案 | 否掉的原因 |
|---|---|
| **纯 Dart 预执行**（把 `_preloadDevChunks` 推广到 release） | 单包构建的页面执行（`pageComponent`）和快照导入都在 JS，Dart 做不到；web 端也需要同一条队列，逻辑会分裂成两份。 |
| **纯 JS 判定空闲**（`setTimeout` + 监听 `touchstart`） | JS 看不到 fling 惯性和转场动画帧，会在滚动惯性中执行 12–16 ms 的 chunk，正好造成 spec 验收 5 要防的掉帧。 |
| **新增系统事件号**（Dart 推 "idle" 给 JS） | 事件号是稀缺预算（ffi.dart 注释），而 `invokeHostAsync` 已经提供"JS 发起、Dart 在未来某刻回结果"的通道，不需要新增。 |
| **按下时由框架自动识别目标页**（例如给带 `@tap="router.push(x)"` 的元素自动预执行） | 编译期无法可靠识别 handler 里的 push 目标；fjs 也没有 `<router-link>` 这类声明式链接组件。先提供 `router.preload()`，将来加链接组件时再接进来。 |
| **按需只预执行 tab 页 / `meta.preload`** | 用户选了全部（spec Q1）。 |

### 3.4 实施中追加：页面级全局样式与样式快照（模拟器实测发现）

模拟器实测时，vant-form、more、nav、watermark 的快照全部被拒：
`global sheet 55b048ad42c2 was not there at build time`。来源是 `demo/src/pages/vant/float.vue`
里一段**不带 scoped** 的 `<style>`（`.van-sticky--fixed { left: 28px }`）。原因有两层：

- **构建期**：分包模式下每页一个全新 VM、只执行该页的 chunk（`bundler/build.ts`），所以一页的
  快照里只有 shared 的全局表和它自己的。而运行时预执行之后，**所有**页面的全局表从启动起就都
  注册了。`snapshotMismatch` 要求运行时的每张全局表构建期都出现过，所以被拒，而且拒得对：
  那条规则确实会影响其它页的 sticky 元素。单包模式的抓取在同一个 VM 里按路由表顺序累积，
  排在前面的页同样会缺后面页的全局表。
- **运行时**：队列是"执行一页 → 导入这一页的快照"。后面执行到的页面注册全局表时会清掉样式
  缓存（epoch 变化），前面已导入的快照就白导了，挂载时还要再导一次。

改法：

1. **构建期**：`FlutterRouter.captureStyles()` 在挂载任何页面之前，先按路由表顺序执行所有静态
   页面的代码（分包调 `loadChunk`，单包调 `pageComponent`），也就是和运行时预执行一样的状态。
   快照依赖的表只来自真正匹配到的规则（`trackSheets`），所以别的页的 scoped 表不会成为依赖；
   `globals` 会包含所有页的全局表，于是"运行时全局表 ⊆ 构建期全局表"无论预执行进行到哪一步都
   成立。应用设了 `preload: false` 时保持原来的只执行本页。
2. **运行时**：自动队列拆成两轮：第一轮逐页执行代码，第二轮逐页导入快照，每条都等空闲。
   手动 `router.preload(path)` 仍然立即导入该页快照。
3. **语义变化**（写进文档）：页面级全局样式从"打开过那一页之后生效"变成"首页停稳、预执行到那一页
   之后生效"。Web 端同样如此（Vite 在模块求值时注入 CSS），两端一致。

### 3.5 实施中追加：快照不参与预执行（真机对比发现）

真机对比（5 页各一次）：预执行确实去掉了打开时的 chunk 执行，但挂载本身每页平均慢了约 30 ms，
总计只从 403 ms 降到 364 ms。bench 加了一个"先导入全部快照，再逐页冷挂载"的变体复现：
match miss 回到冷态（vant-form 1 → 270），CSS 翻倍，Vue 和元素层不变。原因是导入的缓存条目
没有元素引用，按 retired chain 处理，而 `RETIRED_CHAIN_LIMIT = 512` 先进先出；十几页的快照
依次导入，前面的被后面的挤掉，页面切换时卸载也会继续挤。epoch 没变，`snapshotImported` 认为
已经导入过，打开时不会重导。

改法：删掉队列第二轮和 `router.preload()` 里的快照导入，快照回到 `mount()` 前导入（原行为，
每页 2–3 ms）。§3.4 的构建期"先执行全部页面代码再抓快照"保留，因为运行时全局表集合的变化
依然存在。

## 4. 风险

1. **样式快照被拒**（已在实施中触发，见 §3.4）：`snapshotMismatch` 要求运行时注册的每一张**全局**表都在构建期出现过。如果某个页面 chunk 注册了全局（非 scoped）样式，预执行改变了它和别的页面快照导入的先后，快照可能被拒。这个风险现有的"用户按不同顺序打开页面"也有，预执行只是让它更早、更确定地出现。验证：demo 跑完整队列后，日志里不应出现 `style snapshot skipped`。
2. **页面模块顶层副作用**：页面 `<script>` 顶层（非 setup）的代码会提前执行。这在 Vue SFC 里少见，但如果有顶层 `fetch`、定时器，就会提前触发。在 `docs/routing.md` 里写明"页面模块顶层代码会在预执行时运行"。
3. **内存**：所有页面的字节码和组件定义常驻，15 页的 demo 可以忽略；大应用可以用 `preload: false` 关掉自动预执行，只保留手动。
4. **快照导入后缓存被失效**：之后某次注册让 epoch 变化，mount 时会重新导入（现有 `snapshotImported` 的 epoch 判定），结果正确，只是多一次导入。
5. **`hasScheduledFrame` 在测试或无窗口环境下的行为**：`FjsIdleGate` 做成可注入"是否有帧排队"的函数，便于测试，也避免在 headless 引擎里卡住。
6. **`nav_router_test.dart` 没编 native 时静默跳过**（AGENTS.md §3）。Dart 侧新逻辑主要放在不依赖 VM 的 `idle_gate_test.dart` 里测。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test                                           # 含 preload-queue / router-preload 新测试
pnpm --filter @ufjs/cli run build                   # runtime 改了，dev/run 用的是内联产物
cd packages/flutter_fjs/native && cmake --build build-native -j && cd ../../..
cd packages/flutter_fjs && flutter test test/idle_gate_test.dart test/nav_router_test.dart && cd ../..
pnpm --filter demo exec fjs run ios --profile       # 模拟器：停首页 ≥2s 后进 vant-form，看日志
# 对照组：demo main.ts 临时传 preload: false，同一操作再测一遍（测完撤回）
pnpm --filter demo run build:web                    # web：Network 面板确认 chunk 在首页停稳后已请求
```

观察点（对应 spec §6）：
- `[nav] chunk vant-form … (preload)` 出现在点击之前，点击后的 `[nav] mounted` 下降，降幅约等于 fetch + eval。
- 启动后立即点击：该页只有一行 `[nav] chunk`。
- 整个队列跑完，日志里没有 `style snapshot skipped`。
