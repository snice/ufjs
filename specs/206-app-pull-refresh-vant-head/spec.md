# Spec: PullRefresh 的 App 端头部对齐 web（vant 样式）

- **ID**: 206-app-pull-refresh-vant-head
- **状态**: done
- **日期**: 2026-10-04

## 1. 要解决什么

`vant: scroll` 页的 PullRefresh 在 App 端走 specs/205 §7.8 的分派：
`refresh` 标签 = Flutter `RefreshIndicator`（Material 转圈，指示器自管、
参数不经标签透出），web 端 van-pull-refresh（文案头部：下拉刷新 / 松开
刷新 / 加载中... / 刷新成功）。用户对照两端截图：**拉动指示器的样式完全
不同**，要求 App 端与 web 一致。

§7.8 已把结论挂起：「要换拉动样式需扩 refresh 标签的 props
（needs-a-spec）」——本 spec 就是它。纯 JS 自绘仍被手势层否定（§7.8①）：
拉动只发生在「内层滚动体已到顶」时，「到顶 + 拖动距离」这组信号只有原生
滚动层有，所以几何与手势必须留在 Dart，**内容（文案/转圈）留在 JS**。

## 2. 不做什么（Non-goals）

- 不动 web 端：van-pull-refresh 原路径原样（refresh 标签在 web 适配层本
  就没有拉动语义，两端各自的实现同 §7.8 取舍，登记进 css-compat 的边界
  由本 spec 记录，不新开引擎项）。
- 不做 pull-distance / disabled / 头部插槽等 vant 的其余 props——用到再
  加（与 §7.8 的最小面一致）。
- 不追求手感逐像素等价：App 端拖动距离经滚动物理的过摩阻（iOS bouncing /
  Android clamping 各自的 friction），再叠 vant 的 ease 曲线，阻尼比 web
  略重；视觉（头部高度、文案、转圈）对齐即可。
- 不解决「内容矮于视口时拉不动」：fjs scroll-view 的物理不接受无余量拖动
  （与今天的单子模式同边界），demo 列表恒高于视口。

## 3. 用户可见的行为

- App 端下拉：顶部出现与 web 相同的头部——灰色 14px 文案，50px 高；
  未过阈值「下拉刷新」，过阈值「松开刷新」，松手刷新中「加载中...」+
  16px 转圈，完成后短暂「刷新成功」再收口。
- 列表滚动、刷新触发、`v-model:refreshing` 契约（specs/205 §7.11）全部
  不变；web 端回归无变化。

## 4. 两端约定（宪法 I）

- `refresh` 标签新增**双模式**：单个子级 = 现状（RefreshIndicator，600ms
  自动收口）；两个子级 = **自定义头部模式**——第一个子级是头部内容（JS
  渲染，原生只负责把它钉在内容上方并随拖动平移/裁剪），第二个子级是
  滚动体。判断按子级数（scroll-view 的 sticky 路由先例，specs/052）。
- 头部文案/转圈是 JS 子树（`pull-refresh.vue` 的 App 分支），与 web 的
  van-pull-refresh 取同一组 vant 数值：head 50px、color `#969799`
  （--van-text-color-2）、font-size 14px、loading 图标 16px、文案 下拉
  刷新 / 松开刷新 / 加载中... / 刷新成功，ease 曲线照抄 vant（过 50 后
  减半，过 100 后再减半）。vant 4 的头部没有箭头，纯文案，不引入图标。
- App 端 loading 转圈用 CSS 动画圆环（`animation` 引擎原生执行）：
  vant 的 spinner 是内联 SVG，`svg` 不在标签表、App 端会退化。
- 新事件 `statuschange`（编号 44）：`{"status":"pulling|loosing|loading|
  normal"}` JSON 串，只在状态变化时派。JS → 原子走 `refreshing` 布尔
  prop（true = 钉在 50px 等待；false = 收口），沿用 checkbox 的
  `_lastProp` 模式（specs/122 一族）。

## 5. 契约变更（宪法 II）

- [x] 涉及：`refresh` 标签新增头部模式（两个子级 + `head-height` /
  `refreshing` props）与 `statuschange` 事件（44）。同步点：
  `ffi.dart`（Dart 常量）、`ui/element.ts`（EventType + canonical 别名）、
  `event-emits.ts`（标签事件表）、`docs/ui-api.md`（标签表行）。C++ 侧
  dispatchEvent 对事件号是整数透传，无需改动。

## 6. 验收标准

1. `pnpm --filter demo run typecheck` / `pnpm test` 通过；新增 flutter
   widget 测试覆盖：拖动出头部 → 过阈值换文案 → 释放触发 refresh +
   loading 钉住 → `refreshing` 置 false 收口归位；未过阈值释放收口。
2. App 模拟器：vant: scroll 页拉动 UI 与 web 截图对照一致（头部高度、
   文案、转圈、刷新成功）；刷新链路（List 清空 → 续载）不回归。
3. web：van-pull-refresh 原路径回归无变化。

## 7. 过程发现

1. **这个 SDK 版本的 RefreshIndicator 是通知驱动的**（无自有手势识别器）：
   靠子滚动体的 `ScrollUpdate`/`OverscrollNotification` 拿拖动量，
   `dragDetails != null` 区分人手与惯性/程序滚动。FjsRefresh 照抄这套：
   无需自己进手势竞技场，「与内层 scroll-view 共存」自动成立。释放的
   判定分两条物理路径——iOS bouncing 的回弹更新（dragDetails == null 的
   ScrollUpdate）和 clamping 的 `ScrollEndNotification`（拖动到边后无
   ballistic，直接收尾）；两条都接。`depth == 0` 门把更深的嵌套滚动体
   （picker 列、内嵌列表）挡在外面。
2. **事件 44 只需两处同步**：`dispatchEvent` 过 C ABI 时事件号是整数
   透传（engine.dart → bind.dispatchEvent），C++ 侧无 switch，历史注释
   里的「fjs.h 镜像」不存在；实际同步点是 `ffi.dart`（Dart 常量）+
   `ui/element.ts`（EventType）。
3. **handler 首参形状由 `WEB_EMITS` 表路由（specs/104），两端共用**：
   表里没有的事件，app 端 handler 收到的是 DOM 形状事件对象而不是原始
   载荷——`@statuschange` 必须进表；而 event-emits 的对照测试钉死
   「表 = web 组件 emits」，所以 web 的 FjsRefresh 也要声明它（不发，
   纯契约声明：绑定被当组件事件消费而不是 fallthrough 属性）。
4. **prop 翻转门是正确性所系**：原生触发刷新时 prop 还是 false（包装
   组件事后才置 true），`didUpdateWidget` 若不按 `_lastRefreshing`
   翻转判定，loading 期间任何一次重建都会把头部立刻收掉——checkbox 的
   `_lastProp` 形状（specs/122）在这里不是风格而是必要条件。
5. **vant 4 的 PullRefresh 头部没有箭头**：纯文案 + loading 态一个
   van-loading（内联 SVG）。`svg` 不在标签表，App 端会退化，所以转圈
   用同视觉的 CSS 圆环（16px / #c8c9cc / 0.8s，vant 的 loading 变量值），
   `@keyframes` 引擎原生执行。文案与间距取 vant 数值：50px 头部、
   #969799、14px、文案间距 8px（--van-padding-xs）。
6. **手感与 web 的已知差异**（登记）：拖动量先过滚动物理的过摩阻
   （iOS bouncing / Android clamping 各自的 friction）再叠 vant 的 ease，
   阻尼比 web 的裸 touchmove 略重；内容矮于视口时 fjs scroll-view 不
   接受无余量拖动（与单子模式同边界）。视觉（头部几何、文案、转圈）
   两端一致。
7. 实测（iOS 模拟器，2026-10-04）：拉出「下拉刷新」→ 过 50px 翻「松开
   刷新」→ 释放钉住「加载中...」+ 转圈 → 列表清空重载 → 「刷新成功」
   500ms → 收口归位；未过阈值释放直接收口、无 refresh 事件。web 端
   van-pull-refresh 分支回归无变化（分支标记未动，web 渲染路径与
   specs/205 §7.11 复验时一致）。
8. **拉动时头部与内容之间空出一段**（用户复验发现）：iOS bouncing 物理
   的 rubber-band 会自己把内容视觉下拉一截，FjsRefresh 的 translate 又推
   一份——内容位移 ≈ 两倍，头部只走 ease 后的一份，中间露出空档。修法
   给 scroll-view 补 `bounces` 属性（微信同名同义，默认开），包装组件
   内层滚动体 `bounces="false"` → ClampingScrollPhysics：视觉过滚只剩
   translate 一份，两端一致；顺带成为 mp 对齐面（微信 scroll-view 同名
   属性）。头部与内容之间的位移自此严格相等（都来自 `_offset`）。
9. **spinner 与文字垂直没对齐**（同轮复验）：web 实测的对齐模型——头部
   50px、spinner 盒（16px）中心 = 头部中心、`.van-loading__text` 盒吃满
   50（继承 line-height:50px）且墨水中心 ≈ 盒子中心。App 端照抄盒子几何
   后仍有 ~2px 偏差：fjs 文字引擎在 50px 行盒里的字形墨水比盒子中心低
   （浏览器的行内居中结果不同）。修法给 spinner `position: relative;
   top: 2px` 做光学补齐（App 分支专属规则，web 不渲染该类），实测两侧
   一致。
10. **「刷新成功」跟 List 的「加载中...」行同屏**（用户复验发现）：List
   的加载行在 [check, onLoad 完成] 期间一直渲染，两端是同一份 vant 代码
   都会出现——页面旧时序把「清数据 + 收刷新态」放在同一拍，成功窗口
   正好撞上列表重载。修法在页面层按 vant 的标准时序重排：加载中的
   800ms 旧列表原样可见；数据填好、`refreshing` 置 false 后才进「刷新
   成功」，此刻列表已就位，成功窗口零加载行（web 同步受益）。顺带：
   App 端 List 加载行里的 van-loading spinner 是内联 SVG，App 端会退化
   成偏位的弧线——刷新链路不再出现它；无限滚动加载时的同款退化是
   specs/203 面的既有问题，本 spec 不处理。
11. 实操备忘（续 §205.9）：agent-device 的 `gesture pan`（XCTest 合成）
    在该模拟器上会静默不达（命令成功、界面无反应），拖拽用 `swipe`；
    app 偶发渲染冻结（进程活着、截图逐字节不变），重启 app 即恢复；
    fjs dev 热重载对页面 chunk 生效（pushed reload pages），Dart 侧
    改动仍需重跑 `fjs run`。
