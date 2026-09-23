# Plan: hello-fjs 共享元素动画示例

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | ✅ | 一份 Vue 组件 + 既有 CSS 能力：fixed 几何 transition、`<Transition>`、`getBoundingClientRect`，两端跑同一套代码；差异只有「飞行盒是否参与路由淡出」，登记进 spec 第 4 节 |
| II 边界即契约 | ✅ | 零协议变更（spec 第 5 节） |
| III 同步单线程零序列化 | ✅ | 只用既有 `boundingRectOf` 同步测距，无新宿主调用 |
| IV 外观照 WeUI | — | 示例页不是内置组件，白幕/✕ 取 hello-fjs 现有主题变量（`--fjs-page` / `--fjs-muted`） |
| V 静默失效是 bug | ✅ | 无来源槽位（直达详情页）显式跳过飞行而非飞到 (0,0)；连点用状态机闸住（spec 第 6 节第 5 条） |
| VI 注释记录权衡 | ✅ | 为什么用 left/top/width/height 而不是 transform+scale、为什么 transition 写在初始 style、为什么 ✕ 关闭才飞而手势返回不飞——都写进组件/页面头注释 |
| VII JS 能包就不要下 Dart | ✅ | 全部 JS/Vue，Dart、C++ 零改动 |
| VIII 变更落到文档 | — | 示例页自描述（`<route>` 的 desc + 页内 Panel 说明）；能力本身的文档（css-compat 的 transition 行）已存在，无新能力需要写 docs；不改用户可见的 runtime 行为 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动 |
| JS runtime | — | 不动（能力全在应用层） |
| Web 适配层 | — | 不动 |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | — | 不动 |
| 示例应用 | `examples/hello-fjs/src/hero.ts`（新增） | Rect 类型、`rectOf` 跨端测距、跨页面来源槽位登记表、按 id 的共享隐藏开关 |
| 示例应用 | `examples/hello-fjs/src/components/HeroFly.vue`（新增） | 飞行盒：初始 style 带 from 几何 + transition，rAF+强测距后切 to 几何，到点发 `done` |
| 示例应用 | `examples/hello-fjs/src/pages/example/animation/shared-element.vue`（新增） | 场景 1 同页面展开 + 场景 2 push 详情 |
| 示例应用 | `examples/hello-fjs/src/pages/example/animation/shared-element-detail.vue`（新增） | 飞入、✕ 飞回、直达降级 |

路由表由构建自动收录，`<route>` 块给列表页分组「动画演示」，详情页
`"transition": "fjs-fade"`；无文件需要手改清单。

## 3. 方案

**选定：JS 侧盒子飞行（一个 Vue 组件 + 一张模块级登记表）。**

- 起点/终点都是 `getBoundingClientRect()`（web 原生 DOM，App 端
  `fjs.ui.rect` 同步宿主调用，坐标都是视口逻辑像素）——同一套数字两端通用。
- 飞行盒 `position: fixed`：App 端 renderer 自动提进页面的
  `fjs-overlay-host`（不随滚动、盖住 NavBar），web 端原生 fixed——
  这正是 vant 弹层已验证过的置顶通道，不需要新原语。
- 补间用 `transition: left/top/width/height`（spec 045/073/078 两端支持）。
  不用 transform translate+scale：两个场景的终点宽高比都可能变
  （方形缩略图 → 详情页横条大图），scale 会把图拉变形，而且 css-compat
  里尺寸/inset 的 transition 就是现成能力。
- 跨页面交接走**模块级登记表**（`hero.ts`）：列表页 push 前记下槽位矩形，
  详情页挂载读它当起点、回飞时它当终点。分包下这个模块被两个页面引用，
  自动进 `shared.js` prelude，同一 VM 内就是同一个 Map。
- 共享隐藏开关按 id 一把（`heroHidden(id)` 返回的 ref）：飞行期间两个页面
  的真身一起藏（一个在底层、一个在顶层，视觉上都不可见），落地时开伞。
  手势返回时开关是开的（上次飞行已复位），底层真身自然可见——这就是
  spec 第 3 节降级路径不闪不跳的原因。

**被否的备选：**

1. **Dart 侧 Hero（Navigator 按 tag 匹配两条路由）**：原生流畅度更好，
   但要动路由栈和镜像树两层、加协议字段，且 web 端还得再写一遍——
   违反宪法 VII，示例不值当。
2. **动画期间隐藏整页、只飞盒子（`transition: false` 关路由转场）**：
   push 时整页瞬切太生硬，`fjs-fade` 的 280ms 与飞行 280ms 同拍，
   两端一致还白得一层渐变。
3. **✕ 之外拦截所有返回做飞行**：JS 收不到手势/系统返回的起点信号，
   硬做要加 Dart→JS 的 pop-start 事件（协议变更），划出范围（spec 第 2 节）。

### 实施中的方案修订（2026-09-23）

原方案的「白幕 `<Transition>` 淡入」在 App 端不显形（挂载 ✓、rect 全屏 ✓、
底色任何写法都画不出来——类+var / 内联+字面量 / 内联 opacity 翻转均无效），
且 gif 原片展开时本就没有遮罩。按 §2 的 gif 对齐原则**两端同步移除白幕**，
未根因问题登记到 spec §7 另行立项；状态机、飞行、✕、跨页面登记表均不变。
同页面收回因此不拦滚动——收回时重测槽位矩形兜底（原方案已有此路径）。

### 实施中的方案修订二：Android 起飞时序（2026-09-23，用户实测反馈）

用户在 Android 上实测「点开放大没动画」（盒子瞬移到终点）。根因是 HeroFly
的起飞时序：原实现 rAF 里强测距后**立刻**切终点几何，而 App 端的几何补间
由 `TweenAnimationBuilder`（flex.dart `_animateAbsGeometry`）驱动——它只在
「已经用起点值出生过一帧」之后拿到新 end 才补间；rAF 回调跑在 Flutter
build 阶段之前，起点与终点被挤进同一次 build = 首建即终值 = 瞬移。web 端
浏览器原生 transition 不依赖这个前提，所以两端表现分叉。
修复：rAF 强测距后**隔一个 setTimeout(50)**（≥ 一个完整 build+paint 帧）
再切终点。Android 用 `screenrecord` 逐帧复验：连续帧盒子逐帧变大（补间
生效）；web 回归不变。

### 实施中的方案修订三：跨页面飞入的测距时序（2026-09-23，用户实测反馈）

用户再测发现「跨页面飞入也没动画」。根因与修订二不同：详情页的测距原本写在
`onMounted` 同步执行——而它跑在 navMount 的 dispatch 栈里，此时
`flushNow + fjs.ui.rect` 在 Android 上拿到**全 0 矩形**，守卫
`if (!from?.width || !to.width) return` 静默跳过整个飞行（转场帧证实：
hero 直接停在终点随路由淡入、列表缩略图也不藏）。同页面场景的测距发生在
tap 栈里、同步测量是好的，所以只有跨页面炸了。
修复：测距挪进 `requestAnimationFrame`（dispatch 返回后执行，宿主已收到
本页节点）。模拟器探针 `PROBE-OK`（两矩形均非零）+ 录屏帧（盒子从列表
槽位起飞）+ web 回归（中间帧 t334/w251 插值、真身藏/揭正确）三重验证。
该守卫保留给真正的直达降级（web 手输 URL 无来源槽位）。

### 实施中的方案修订四：Android 飞行盒裁切与缩略图不一致（2026-09-23，用户实测反馈）

用户对比截图：同一条 `test-portrait.png`（红橙黄绿蓝紫六条），web/缩略图
裁出居中的橙/黄/绿蓝，Android 飞行盒却裁出顶部的红/橙/黄 —— 顶对齐。
探针（设备 logcat，三段证据链）定位，**不是 `image_mode` 的 mode 映射**
（`aspectFill → cover+center` 本身正确，飞行盒上探针也读到 `mode=aspectFill`），
而是布局约束链：

1. `decoration.dart`：飞行盒满足 `overflow:hidden && height!=null &&
   animatesHeight`（`.hero-fly` 的 inline `transition` **永久声明**了
   height 过渡 → `animatesHeight` 恒真）→ 内容被
   `OverflowBox(maxHeight: ∞, alignment: topCenter)` 包住（该启发式本意是
   vant collapse 收缩时内容不被压扁）—— **∞ 和顶对齐都出自这里**；
2. `flex.dart`：`mainAxisMax = constraints.maxHeight` 因此为 ∞ →
   `height:100%` 子节点的 `ConstrainedBox`（`isFinite` 门）被跳过；
3. 图按 intrinsic 高度被 `topCenter` 顶着裁 → 顶裁。缩略图无 transition
   不进 OverflowBox，`maxMain=150` 有限 → 居中 ✓。

**修复（flutter_fjs/render/flex.dart，运行时代码 —— 宪法自查的必要例外：
验证中发现的两端 bug，属「静默偏差是 bug」的修复；UI op 协议/natives/
事件仍零变更）**：两个 LayoutBuilder 的主轴参考值加回退——`maxHeight`
无限但 `minHeight > 0`（Positioned 强加的盒高，正是装饰盒解封前的盒子
尺寸）时用 `minHeight` 作百分比参照；scroller 内容（min 0）保持原无限
参照，vant collapse 的 OverflowBox 行为不动。
备选方案（在 decoration.dart 收窄 `animatesHeight` 启发式）被否：那是
vant collapse 内容不被压扁的承重逻辑，改动面更大。
验证：设备录屏帧显示飞行盒裁切 = 橙/黄/绿蓝（与缩略图逐带一致，红条
消失）；`flutter test` 475 全过；web 不受影响（原生 object-fit，CSS
已恢复 width/height:100%）。
⚠️ 该修复在 `packages/flutter_fjs`（Dart）—— **宿主要重新构建**，
JS 热重载不带它。三个 [pct]/[fixed]/[fb]/[chain] 探针已全部移除。

## 4. 风险

1. **inline `transition` 与几何同帧下发**：web 与 Dart 都从「变化后的样式」
   读过渡配置，所以 transition 写在初始 style 里即可；但 web 端必须保证
   起点几何在切换终点前**被算过一次**——HeroFly 在 rAF 里先
   `getBoundingClientRect()` 强制布局，再改终点，否则浏览器把插入与改值
   合并成一帧，transition 没有前值可比（静默变成瞬移）。
2. **overlay 宿主分层**：飞行盒提进的是「自己页面」的宿主，push 后它在
   顶层路由里、盖过底层页面；回飞时它随顶层路由一起销毁（280ms > 240ms
   飞行时长），要在组件 unmount 兜底复位共享开关，否则列表缩略图可能
   永远 opacity 0（静默失效，宪法 V）。
3. **连点**：展开未落地就再点、落地前点 ✕——状态机只允许
   `closed→opening→open→closing→closed` 单向推进，非法状态的点击直接忽略。
4. **白幕不拦截底层滚动/点击**（App 端 hit-test 与 web 不同的可能性）：
   白幕与 ✕、飞行盒都带 `@tap`，带监听的节点必进竞技场；即使滚动漏过去，
   收回时是**重新测一次**缩略图槽位，位置仍然正确。
5. **`fjs-routes.d.ts` 是生成物**：跳转用 path 字符串不依赖路由名类型，
   typecheck 在 dev/build 跑过之前也能绿。

## 5. 验证路径

```bash
pnpm --filter hello-fjs run typecheck        # 类型
pnpm test                                     # 无回归（未动 runtime）

# Web
pnpm --filter hello-fjs run dev:web           # 浏览器走 spec 第 6 节 2、4 条

# Flutter（先编 native 不需要——本 spec 没动 native；直接 fjs dev + 宿主）
cd examples/hello-fjs && fjs dev              # 另开终端
# iOS 模拟器 / Android 模拟器跑 fjs-go 或 demo 宿主，走第 6 节 3 条
```
