# Spec: vant Picker/Calendar 的 App 端对齐（vant: pickers 页）

- **ID**: 205-vant-pickers-app-alignment
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

`vant: pickers` 页在 App 端与 web 端差距明显（用户截图对照）：

1. **DatePicker 列拖动被页面滚动接管**：列拖不动，手势被外层
   scroll-view 判给页面滚动（与 specs/126 的 Slider、specs/127 同族——
   列拖动靠非 passive `touchmove` 里 `preventDefault()`，App 端监听晚
   手势竞技场一帧）。TimePicker 同。
2. **Calendar 月水印层级过高**：`__month-mark`（absolute, z-index:0）
   在 App 端压住日子格子（web 按 DOM 顺序日子在上）。
3. **Calendar 头部背景不对**：header 区域在 App 端透出灰色（web 白），
   视觉上还把首行日子衬得错位。
4. **首周 1/2/3 位置疑似错位**：与 header 灰底叠加难以判断，先修 3 再
   对照；若仍在，查第一个 day 的 `margin-left: 100*offset/7%` 百分比
   margin 在 App 端的支持。

## 2. 不做什么（Non-goals）

- 不动 fjs 样式引擎的 stacking/百分比 margin 语义——先在 demo 层用显式
  CSS 对齐 web 视觉；若暴露引擎级缺陷记入 spec 供后续评估。
- 不做 Calendar/Picker 的全量对拍（只覆盖 demo 页用到的默认形态）。
- 不迁既有 Slider/Rate 的 touch-action 源码补丁（已在生产验证）。

## 3. 用户可见的行为

- DatePicker / TimePicker 列可在原位拖动选择，页面不跟着滚。
- Calendar 弹层：月水印在日子下层；头部白底与 web 一致；首周位置与
  web 一致。

## 4. 两端约定（宪法 I）

全部修法走两端同源的 CSS（`demo/src/styles/vant-fix.css`，main.ts 引入）
或两端等价的组件 props；差异登记进 spec §7 / docs/css-compat.md。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter demo run typecheck` / `pnpm test` 通过。
2. App：Picker 列拖动只动列；Calendar 水印在日子下、头部白底、首周
   与 web 截图一致。
3. web：vant: pickers 页回归无变化（对照截图）。

## 7. 过程发现

全部修法落在 `demo/src/styles/vant-fix.css`（新，main.ts 引入，两端同源）
与 `demo/vite/vant.ts`（新增 Calendar body 补丁），逐一对照截图验证：

1. **Picker 列拖动被页面滚动接管**（问题 1/2 同根）：PickerColumn 与
   Slider 完全同构——非 passive touchmove 里 preventDefault()，App 端晚
   手势竞技场一帧。修法 `​.van-picker-column { touch-action: none }`：
   Dart 侧 style.dart/touch.dart 原生消费 touch-action（specs/126 的
   Slider 走的是源码内联补丁，本次验证纯 CSS 同样可达，新约束优先 CSS）。
   实测列可拖到边界、月/日列不动、页面不滚。
2. **月水印层级**（问题 3）：引擎的绘制模型（flutter_fjs render/flex.dart
   stackOutOfFlow）是「absolute 进 Stack 层、relative 留在 in-flow 层，
   Stack 永远画在 in-flow 之上」——水印 absolute(z0) 对 relative 的日子
   有绝对层级优势，day 写 `z-index: 1` 够不着 Stack 层（第一版修法无效的
   原因）。正解是给水印负 z-index（引擎把 z<0 的定位盒垫到 in-flow 之下，
   vant steps 的白点就是这么遮连接线的）：`.van-calendar .van-calendar__
   month-mark { z-index: -1 }`。web 端 -1 落到 popup 白底之上、内容之下，
   视觉不变（elementFromPoint 实测日子仍在上）。教训：**提升特异性的
   `.van-calendar .van-calendar__month-mark` 是必需的**——vant 自带的
   `z-index: 0` 与修复规则同特异性时按加载顺序胜出（web 端实测被覆盖）。
3. **头部背景**（问题 4 前半）：`.van-calendar__header` 自身无背景，web
   透出 popup 白底；App 端该区域透出遮罩灰。钉死
   `background: var(--van-calendar-background, #fff)`。头部白底后首周
   1/2/3 与 web 逐列一致（2026-10-01 周四 → offset 4），原「错位」观感
   是灰底与水印竖笔叠加造成的。
4. **Calendar 月份列表滚不动**（复验中发现的新问题）：月份列表靠普通
   div 的 CSS `overflow: auto` 滚动——App 端 overflow 只裁剪不滚动
   （滚动是 scroll-view 标签的职责）。`vite/vant.ts` 新增补丁：body 的
   div 换成 fjs scroll-view（scrollY），vant 的 onScroll 读元素
   scrollTop（fjs scroll-view 支持）与 scroll 事件名都对得上，月份高亮
   副标题跟随正常；web 端补丁不生效，仍是原生 div（两端各自最优）。
5. **首周偏移的真正根因**（用户复验后定位，问题 4 后半）：vant 用
   百分比 margin 把每月首日推到对应星期列（CalendarDay:
   `marginLeft = 100*offset/7 %`）——引擎对 in-flow 盒的百分比 margin
   参照系算错（实测按 ~370pt 而非 402 父宽解析，像素级测量：第二行
   4–10 七列逐列吻合、唯带 margin 的首行整体偏左 22pt），正是
   css-compat 挂着的「percent margin needs a spec」。修法避开百分比
   margin：补丁删掉 CalendarDay 的 margin，改为在 days 前插 offset 个
   `width: 14.285%` 的占位格子（百分比 **width** 参照正确，同页第二行
   已验证）——像素复测蓝块 346.7–399.3pt，与「六」列期望区间 345–402
   精确吻合；web 端补丁不生效，仍是 margin 方案（col index 5 不变）。
   引擎的百分比 margin 参照修正挂 needs-a-spec，另开。
6. **底部确认按钮落在 home indicator 区**（用户复验第三轮）：footer 的
   安全区来自 vant 自带的 `.van-safe-area-bottom` —— `env(safe-area-inset-
   bottom)` 长度，App 端 CSS 引擎不解析 env()、声明整条丢弃（宪法 V 静默
   失效）。修法与 specs/142 的 safe-area-top 补丁同构：`vite/vant.ts` 把
   Calendar footer 内容包进 fjs `<safe-area edges="bottom">`（App 是
   Flutter SafeArea；web 端 app hook 不跑，env() 类照常工作）。同族的
   `.van-safe-area-bottom` 使用方（ActionSheet、Popup 内 toolbar 等）遇到
   同样问题时套同一补丁；引擎级解法（env() 解析）挂 needs-a-spec。
7. **Picker toolbar 三元素不齐线**（用户复验第四轮）：title 是
   `absolute; left: 50%` 不写 top——web 语义「垂直取静态位置」（flex
   align-items: center 那行），引擎对已声明水平 inset 的 absolute 盒把
   top 钉 0（静态交叉轴居中只对完全无 inset 的盒生效——vant Noticebar
   的 absolute marquee 无任何 inset 所以居中正常），标题贴顶、
   height:100% 的按钮居中，二者错位。修法 `vant-fix.css`：
   `.van-picker__title { top: 50%; transform: translate(-50%, -50%) }`
   ——显式垂直居中，两端同义（web 中心线三值实测一致）。
8. **vant PullRefresh App 端拉不出来**（用户复验第五轮，vant: scroll 页）：
   双重原因。①手势竞技场把垂直拖动判给页面 scroll-view，track 的
   touchmove 收到 touchcancel——给根无条件 touch-action: none 又会杀死
   区域内的页面滚动（List 靠页面滚动），条件式让出是 Flutter
   RefreshIndicator 的能力。②vant 的滚动父级探测在 App 端不可靠。
   修法：两端同源包装组件 `demo/src/components/pull-refresh.vue`
   （对外契约 = @refresh + 默认插槽；内部 `navigator.userAgent ===
   'fjs'` 分派，dom-env 的标识）——App 端用 fjs `refresh` 标签（Flutter
   RefreshIndicator）包 **嵌套 scroll-view**（refresh 需要可见的滚动
   子级；滚动条目在内层滚，高度走 scrollHeight prop），web 端保留
   van-pull-refresh 原路径。页面一份写法，端差异封在组件里
   （VanWatermark 的本地封装模式）。连带发现：List 的 check 只由
   loading/finished 变化与滚动事件触发，刷新清空后两者都可能无变化，
   App 端无滚动事件兜底 → 手动 `listRef.check()` 重查（web 上靠滚动
   事件自然恢复，无需此步）。日志链路 onRefresh → check → load ×2
   → 20 条恢复，RefreshIndicator 转圈实测可见（包装组件重构后复验同）。
   web 端刷新周期实测 20 → 0 → 10 → 20（"刷新后 0 条"是浏览器缓存的
   旧构建，check() 修复已在现构建；强刷即恢复）。**自定义拉动 UI 的
   边界**：App 端 refresh 标签 = Flutter RefreshIndicator（Material
   转圈），color/位移等参数当前不经标签透出——要换拉动样式需扩
   refresh 标签的 props（needs-a-spec）；纯 JS 自绘被手势竞技场否定
   （上文①）。
9. 实操备忘：模拟器 UI 自动化用 `idb ui describe-all` 的 AXLabel 拿
   元素中心坐标再 `idb ui tap x y --udid`（zsh 里变量展开要 `${=V}`
   强制分词）；AX 树拿不到子像素几何时，直接对模拟器截图做像素测量
   （蓝块/文字簇的 x 区间对照期望列区间）；`fjs run` 自带的 dev server
   会随 run 退出而死，独立 `fjs dev --pages` + run 复用是稳定的调试
   结构。
