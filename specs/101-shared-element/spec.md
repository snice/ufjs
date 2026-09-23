# Spec: hello-fjs 共享元素动画示例（同页面 / 跨页面）

- **ID**: 101-shared-element
- **状态**: done
- **日期**: 2026-09-23
- **来源**: 用户提供的 gif（点图片，缩略图放大成大图，左上角 ✕ 收回），
  要求「尽量支持 web 和 dart」，覆盖同页面与跨页面两个场景。

## 1. 要解决什么

hello-fjs 的示例集里没有共享元素（shared element / hero）动画的可运行样例。
这类效果（缩略图放大成大图、详情页回飞到列表槽位）是相册、商品图、头像
这类应用最常见的转场，开发者想知道在 ufjs 里**一份代码**怎么写、两端
（浏览器 / Flutter）各自会跑成什么样。

## 2. 不做什么（Non-goals）

- **不改 runtime / Dart / C++**：整个能力用既有原语包出来——
  `getBoundingClientRect()` 测起点终点、`position: fixed` 进 overlay 宿主、
  `transition: left/top/width/height` 两端补间（宪法 VII：JS 能包就不要下 Dart）。
  UI op 协议、natives 表、事件类型零变更。
- **不做展开态白幕（遮罩）**：gif 原片里展开时背景就是干净的页面底色，
  没有遮罩，示例照做。曾实现过一版全屏 fixed 白幕，App 端挂载 ✓、
  rect 全屏 ✓，但底色任何写法都画不出来（见 §7，未根因）；两端同步
  移除后行为反而更一致。展开期间因此也不拦截底层滚动，收回时重新测
  槽位矩形兜底。
- **不做 Flutter 原生 Hero / Navigator 层的飞行**：JS 侧驱动的盒子飞行两端
  同源；原生 Hero 需要 Dart 侧按 tag 匹配两条路由，单为示例不值当。
- **不覆盖非 JS 发起的返回**：iOS 边缘手势、Android 返回键、浏览器后退
  发生时 JS 收不到「pop 开始」的信号（navPop 只在转场结束后派发），
  这些路径退回普通转场——底层页面的真身全程可见，淡出后自然落位，
  不做飞行。X 按钮是 JS 发起的关闭，走完整飞回。
- **只做 image 盒子**：共享元素是一个图片盒子的几何飞行，不做文本、
  圆角半径、内容差异（caption 交叉淡入）等进阶形态。
- **不验证小程序端**：`position: fixed` / transition 在 mp 端的行为不在
  本 spec 验收范围（mp 渲染器是 webview，后续单独立项）。
- 不给 hello-fjs 之外的工程引入示例依赖；不新增 npm 依赖。

## 3. 用户可见的行为

新增示例页 `/example/animation/shared-element`（示例页 → 动画演示分组），
一个页面里两个场景：

```vue
<!-- 场景 1：同页面展开（gif 复刻） -->
<view class="thumb" @tap="open(src)" :style="{ opacity: hidden ? 0 : 1 }">
  <image :src="src" mode="aspectFill" />
</view>
<!-- 展开时：飞行盒从缩略图槽位飞到页面中央的大图槽位（280ms），
     大图左上方出现 ✕；点 ✕ / 大图 → 反向飞回，缩略图原位接住 -->

<!-- 场景 2：跨页面 -->
router.push({ path: '/example/animation/shared-element-detail', query: { src } });
// 详情页挂载后：飞行盒从列表页缩略图槽位飞到详情页大图位置，
// 落地后交还给详情页自己的 <image>；点 ✕ 逆向飞回列表槽位后 router.back()
```

具体交互：

1. **同页面**：点缩略图 → 同图飞行盒从缩略图位置放大到页面中部的方卡
   （280ms，`cubic-bezier(0.32,0.72,0,1)`），✕ 出现在大图左上方、白底
   描边小方块（与 gif 一致）。点 ✕ / 大图 → 飞行盒飞回缩略图槽位
   （收回时重新测一次槽位，滚动漏进来也不飞偏），落地瞬间缩略图
   重新出现（opacity 瞬切，无过渡）。展开期间真身 opacity 0、几何不动，
   网格不塌陷。
2. **跨页面**：push 详情页（路由转场 `fjs-fade`，两端一致的 280ms 淡入）；
   详情页挂载后飞行盒从列表槽位飞到详情大图位置（280ms，与淡入同拍），
   落地交还给详情页真身。点详情页 ✕ → 飞行盒从详情大图飞回列表槽位
   （240ms，先于 280ms 的路由淡出结束），同时 `router.back()`，落地时
   列表缩略图重新出现。
3. **降级路径**（两端行为一致）：详情页直接打开（web 刷新、无来源槽位）
   不飞，直接显示大图；NavBar 返回 / 手势 / 浏览器后退走普通 `fjs-fade`
   转场，列表真身从头到尾可见，淡出后自然对位，无飞行。
4. 连点被状态机闸住：`closed → opening → open → closing → closed`
   单向推进，飞行未落地时的点击直接忽略，不会出现两盒并存或真身
   永远 opacity 0 的错位。

新增二级页 `/example/animation/shared-element-detail`（不在列表分组里，
带 `<route>{"transition": "fjs-fade"}</route>`）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 飞行盒 | `position: fixed` 被 renderer 提进页面的 `fjs-overlay-host`（OverlayPortal），不随页面滚动 | 原生 `position: fixed`，视口定位 |
| 几何补间 | Dart 引擎按 inline `transition` 简写补间 left/top/width/height（spec 045/073/078 既有能力） | 浏览器原生 transition |
| 事件载荷 | 无新事件，全部是 `@tap` | 同 |
| 宿主子树里的颜色 | ✕ /（曾经的）白幕走 `useTheme()` 字面量而非 `var()`——原因见 §7；普通树里的 `var()` 不受影响 | 原生 CSS，`var()` 正常 |
| 已知差异 | **飞行盒不参与路由转场**：overlay 宿主是独立条目，`fjs-fade` 淡入淡出只作用于页面本体，飞行盒全程满透明度 | 飞行盒是页面 DOM 的一部分，会随页面一起淡入淡出（视觉上是飞行途中渐显/渐隐） |

两端一致的降级（见第 3 节第 3 条）不算差异：JS 没有 pop 起点信号是两端
共同的边界，不是某端的缺陷。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及：全部用既有标签 / 样式 / 事件 / 路由能力在应用层组装。

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过；`pnpm test` 无回归。
2. **Web**（`pnpm --filter hello-fjs run dev:web`）：动画演示分组出现
   「共享元素」；场景 1 展开/收回各跑一遍（飞行中间帧为插值、落地为
   目标几何、缩略图接位）；场景 2 push 后飞行落位、点 ✕ 飞回并回到
   列表；浏览器后退不飞但列表缩略图在；连点闸门不产生错位。
3. **Flutter**（`fjs dev` + fjs-go 宿主，Android 模拟器）：场景 1、2
   与 web 行为一致（登记的差异除外）；飞行盒不随页面滚动、✕ 可点可收回；
   Android 返回键降级路径回来后缩略图全部复位。
4. 详情页直接访问（web 上手动输入 URL）不报错、不飞、大图直接可见。
5. 飞行期间连点（展开途中再点缩略图、落地前点 ✕）不产生状态错乱：
   盒子、真身 opacity 最终一致（真身可见、盒子移除）。

## 7. 待澄清

- [ ] **（后续 spec）App 端 overlay 宿主子树里的背景色不显形**：全屏
  fixed 白幕挂载 ✓、`fjs.ui.rect` 全屏 (0,0,426.67×952) ✓、hoist ✓，
  但底色画不出来；`<Transition>` + 类 `background-color: var()`、
  内联 + `useTheme()` 字面量、opacity 动画等多种写法逐一试过均无效，
  同页 ✕ 的白底也疑似透明（白底贴浅灰页面看不出）。vant 遮罩用
  字面量 rgba 且 spec069 未覆盖「宿主子树里 var() / backgroundColor
  的级联」，嫌疑集中在宿主（style 引擎里的 fixture 节点）对级联/
  装饰的处理。本 spec 按 §2 移除白幕交付，问题独立立项排查。
- [ ] （信息）验证期发现两个环境事实，记录备查：uiautomator 的
  semantics dump 不包含 OverlayPortal 子树（白幕/✕ 这类宿主节点
  树里不可见，不代表没挂载）；fjs-go 的开发菜单浮层跨热重载存活，
  会挡住底层页面的自动化点击。
