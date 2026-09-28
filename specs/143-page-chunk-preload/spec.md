# Spec: 页面 chunk 提前执行（把 fetch + eval 移出打开页面的等待）

- **ID**: 143-page-chunk-preload
- **状态**: done（验收 4、5 待用户）
- **日期**: 2026-09-28

## 1. 要解决什么

分包构建（`fjs build`、`fjs run --profile` / `--release`）里，每个页面是一个独立
chunk，**第一次打开时才读取并执行**。这笔钱落在打开页面的等待里：

- `engine.dart` 的 `_mountWhenReady()` 从 `_ensureChunk()` 开始计时，
  `[nav] mounted … in Nms` 包含 chunk 的读取与执行。
- 真机（iPhone，2026-09-24，specs/120 记录）日志：同一页前一行
  `[nav] chunk … fetch 0–3ms, eval 12–16ms`。vant 页的 `[nav] mounted` 是 59–81 ms，
  其中 12–19 ms 是 chunk。
- 这段执行和转场动画在同一根 UI 线程上（threading-model.md），push 转场第一拍会顿。

现状：只有 dev 分包模式会在连接后逐个预加载所有 chunk（`engine.dart`
`_preloadDevChunks()`）；release 宿主（`fjs run` 生成的 `main.dart`
`loadReleaseAssets()`）和 fjs go 的 hosted 模式（`hosted_build.dart` 只预取字节，
不执行）都是打开时才执行。

**chunk 的执行本身没有页面级副作用**：页面模块顶层代码 + `definePage(path, C)` 注册
+ 注册该页的 scoped 样式表。specs/120 之后，注册一张没有元素用过的 scoped 表不会
清样式缓存，所以提前执行不会让已挂载的页面重算。

## 2. 不做什么（Non-goals）

- **不提前挂载页面**（不跑 setup / onMounted）。那是另一个方向（预挂载），会改变页面
  生命周期语义，另立 spec。
- 不改 chunk 的构建产物格式、不改分包策略、不改 manifest 结构。
- 不做 CSS 命中路径优化（下一个 spec）。
- 不做网络层预取的改动（fjs go hosted 已有 `_prefetchRest()` 预取字节，保持原样）。
- 小程序端不涉及（分包由微信自己加载，见 miniprogram.md）。

## 3. 用户可见的行为

### 3.1 自动：页面停稳后空闲预执行

默认开启，页面代码零改动。首个页面 `onPageSettled` 之后，运行时在空闲时逐个执行
尚未进 VM 的页面 chunk：

- 一次只执行一个 chunk，两个之间至少让出一帧，不在转场或手指按住期间执行；
- 用户在预执行过程中点进某个页面：该页 chunk 若已在执行队列中则直接复用，不重复执行；
- 某个 chunk 执行失败：记一行告警（宪法 V），跳过它；打开该页时仍按现有逻辑再试一次
  并报错。

效果：打开页面时 `[nav] mounted` 不再包含 chunk 的读取与执行，日志里这一页的
`[nav] chunk …` 行出现在打开之前（带 `preload` 标记）。

### 3.2 手动：`router.preload(path)`

给「按下时预执行」和按需控制用。router 上新增一个方法：

```vue
<script setup lang="ts">
import { useRouter } from 'fjs/router';
const router = useRouter();
</script>

<template>
  <view @touchstart="router.preload('/vant/form')" @tap="router.push('/vant/form')">
    表单
  </view>
</template>
```

- 返回 `Promise<void>`，chunk 进入 VM（web 上模块加载完成）后 resolve；已加载的直接 resolve。
- 路径不存在或该路由没有 chunk（单包构建）：立即 resolve，不报错。
- 可以在 `createFjsApp` / router 选项里关闭自动预执行，只留手动。
- 构建期样式快照（specs/119）仍然在打开页面时导入，不参与预执行（Q2 撤回的原因见第 7 节）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 自动预执行 | 首页停稳后空闲逐个执行未加载的页面 chunk | 首页停稳后空闲调用路由表里的 `() => import(...)`，让浏览器把页面模块拉下来并执行 |
| `router.preload(path)` | chunk 执行完成后 resolve | 对应页面的动态 import 完成后 resolve |
| 单包构建 / `fjs dev` 单包 | 页面由 `definePageLoader` 在首次打开时 `require()`；自动队列与 `preload` 提前调用它（Q3） | 不适用（web 始终按页面拆分动态 import） |
| 已知差异 | 执行发生在 UI 线程，需要避开转场与触摸 | 浏览器模块求值同样在主线程，但下载是异步的，对帧的影响更小 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

JS → Dart 预计新增一个宿主方法（例如 `fjs.nav.preload(chunk)`），走现有
`invokeHost` + `dispatchEvent` 回结果的模式，和 `fjs.nav.load` 同级，不在上面三张表里。
具体形状在 plan 里定。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；新增的 `router.preload` 在
   `@ufjs/runtime` 有单测（自动队列的顺序、去重、失败跳过）。
2. `cd packages/flutter_fjs && flutter test` 通过（先编 native），空闲判定（手指按住时
   暂停、转场中暂停、常驻动画兜底）有测试覆盖。
3. demo `fjs run ios --profile`（模拟器）：启动后停在首页 ≥ 2 s，再点进 vant-form，
   日志里 vant-form 的 `[nav] chunk …` 行出现在点击之前，`[nav] mounted` 比不开预执行
   时少掉该页的 fetch + eval（对照组：关闭自动预执行跑同一操作）。
4. 同上操作，启动后**立即**点进 vant-form（预执行还没轮到）：页面正常打开，chunk 只执行
   一次（日志里只有一行该页的 `[nav] chunk`）。
5. 预执行期间在首页连续滑动：Flutter DevTools / perf overlay 无因 chunk 执行造成的
   连续掉帧（单帧超时允许，但不得在手指按住时执行）。
6. `fjs dev --web` 与 `pnpm --filter demo run build:web` 产出的 web 站点：首页停稳后，
   Network 面板里各页面 chunk 已请求；点进页面不再有新的页面模块请求。
7. `router.preload('/vant/form')` 在两端都 resolve；对不存在的路径调用不报错。
8. 文档：`docs/routing.md` 写 `router.preload` 与自动预执行开关；`docs/code-splitting.md`
   写 chunk 何时执行；`docs/vant-mount-perf.md` 补一节实测。

## 7. 待澄清

- [x] **Q1 自动预执行的范围** → 全部页面 chunk 都预执行（和 dev 分包现有行为一致）。
- [x] **Q2 样式快照是否一起提前导入** → ~~一起导入~~ **撤回（2026-09-28，真机 + bench 实测）**：
  样式引擎只保留 512 条无人引用的链（`RETIRED_CHAIN_LIMIT`，先进先出）。预先导入全部快照时，
  先导入的会被后导入的挤出，而 epoch 没变，打开时也不会再导入，结果是冷缓存打开，比不预执行
  还慢（bench：vant-form match miss 1 → 270，首帧 21.0 → 30.5 ms）。改回打开时导入。
- [x] **Q3 单包构建也做吗** → 一起做：同一个队列，单包下提前调用 `pageComponent(path)`。
