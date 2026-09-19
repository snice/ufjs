# 069 实施记录：两端对拍与验证期修复

日期：2026-09-18。设备：iPhone 17 Pro 模拟器（iOS 26.5，`fjs run ios` debug 构建）
↔ 浏览器 375×812（`vite` dev:web）。demo 三个 vant 页逐屏对照。

**2026-09-19 续（T023/T032 + 扩展对比测试、两项引擎修复）见文末「第二轮记录」一节。**

## T021 web 侧零改动（宪法 I 登记）

`packages/fjs-runtime/src/web/` 无任何改动。五条差异在 web 天然不成立（浏览器
原生 fixed / 伪元素 / % 圆角 / 行内流）；本 spec 的全部改动落在共享 CSS 引擎、
vue renderer（仅 App 构建经过的 `vue-shim.ts` / `renderer.ts`）与 Dart 渲染层。

## T022 逐屏对拍结论

| 页面 | 项 | iOS 结果 |
|---|---|---|
| vant-feedback | Popup | 全屏遮罩、全宽贴底、圆角朝上；点遮罩关闭 ✅ |
| | ActionSheet | 同上，「取消」关闭 ✅ |
| | Dialog | 水平居中、按自身高度上移、按钮区发丝线；取消/确认回派 `v-model:show` ✅ |
| vant-basic | Tag 朴素 | 蓝色描边（currentColor）✅ |
| | Cell | 发丝线从 padding 边起算，位于行底 ✅ |
| | Divider | 线—文字—线；虚线；左对齐（10% 上限）✅ |
| | Grid | 三列（flex-basis）、发丝线格线、文字居中 ✅（图标 = iconfont，非目标）|
| | Badge | ✅ |
| vant-form | Switch | 圆钮在右（calc 符号修复）✅ |
| | Stepper | 横排 28px、−/+ 线条、点 + + − → 2，`v-model` 回显同步 ✅ |
| | Radio / Checkbox | 圆形选中态 ✅；对勾是 iconfont 字形（非目标，web 有、App 空）|
| | Rate | 星星为 iconfont（非目标）|

仍然存在、未在本 spec 范围内的差异：iconfont 字形（另立项）；van-loading 的
SVG 转圈；按钮字号在 App 端略大；Field 行 label 与输入框基线未对齐。

## 验证期修掉的引擎缺口（对拍中逐个暴露）

1. overlay 宿主不给 `positionedChild` 传屏幕尺寸 → 遮罩 `100%` 解析不出、弹层收缩
2. `translate(%)` 被当 0；`margin: 0 auto` 在绝对定位盒上不居中（对话框）
3. 绝对定位偏移从内容边量起（应为 padding 边）；`%` 偏移参照约束上界而非布局后
   尺寸 → 改为 `Positioned.fill` + 布局委托（宫格发丝线）
4. `text` 段落把绝对定位伪元素当行内片段（朴素 Tag 前的点）；`button` 不渲染子节点
   （步进器 ± 线）
5. 边框简写无颜色时画黑色（应为 currentColor）；`border-width` 多值不分边
6. `inherit` 关键字原样透传；`[class*=…]` 属性选择器不支持（vant 全部 hairline）
7. 纯绝对 calc 折叠丢减号（`50.8px - 26px` 变加法，开关圆钮飞出）
8. 增长项的 `max-width` 上限丢失；`flex-basis` 不支持
9. `:active { opacity }` 让按下帧插入 Opacity、重挂手势识别器，点击丢失
   （既有 bug，所有带 `:active` 透明度的可点元素都受影响）
10. 无载荷事件（tap）回调拿到 `undefined`，vant `preventDefault(event)` 抛错
11. `v-show` 整张替换计算样式为 `{display}`，组件重渲染后元素丢光样式
    （既有 bug，步进器改值后输入框与加号失去样式）
12. `pointer-events: none` 不生效（叠在按钮上的装饰盒吃掉点击）

每条都有回归：`fjs-runtime/test/css.test.ts`、`test/vue_overlay_pseudo.test.ts`、
`flutter_fjs/test/vant_layout_test.dart`。

## T019 / T020 溢出红条

本轮对拍的 debug 构建里，Checkbox / Radio 行**未再出现**溢出红条。没有在修复前
用 widget 检查抓到具体是哪个 RenderFlex，因此根因**没有被直接证实**。最可能的
来源是第 4 条：伪元素装饰盒（绝对定位）以前被当成流内子项/行内片段参与布局，
把行撑高约数像素——这正是 `overflow: hidden` 掩盖、App 端不裁剪就露出红条的形态。
回归由 `vant_layout_test.dart` 的「a paragraph lays absolute children over itself」
覆盖（绝对子项不再占行内空间）。若以后再现，按 plan 3.6 用 `debugDumpRenderTree`
定位。

## 弹层第二步的验收边界

`fjs-overlay-host` 经 `OverlayPortal` 渲染在根 Overlay 上，结构上不随页面滚动；
但 demo 的 vant-feedback 页内容不足一屏、无法滚动，「弹层打开时滚动页面、遮罩与
弹层不动」这一条**没有在设备上实际滚动验证**。

## 第二轮记录（2026-09-19：T023、T032、扩展组件对比）

### 两项已落地的修复（各有回归）

1. **overlay host 单例跨页失效（fjs-runtime/src/vue/renderer.ts）**。
   `overlayHost` / `hoisted` / `pageRoot` 是 renderer 模块级单例。热更新或切页
   重新 `flutterRoot()` 后，Dart 侧旧根连同旧 host 一起销毁，但单例仍持死 id；
   下一次 hoist 写出 `insert(死id, …)`，Dart 侧整帧丢弃
   （`UiOpException: op references unknown parent NNN`），表现为整页空白。
   修复：`flutterRoot()` 创建新页面根时 forget 旧 host 子树并清空 `hoisted`。
   回归：`vue_overlay_pseudo.test.ts`「re-creates the overlay host when a new
   page root mounts (hot swap)」（不带修复时该测试红，已验证）。

2. **微任务 job 抛错不再中断排空（native/src/vm.cpp）**。
   `fjs_vm_pump` 的 `JS_ExecutePendingJob` 循环遇 job 抛错原先直接
   `fail_with_pending_exception` + `break`，同一 tick 排在其后的 job（含 Vue
   调度器的 flush）全部丢弃。现按浏览器语义改为：取异常、按 console.error
   级别上报（`[fjs] unhandled rejection in a microtask job: …`）、继续排空。

### 重要发现：overlay 第二步此前从未真正上过设备

预编译 `ios/fjs.xcframework/libfjs.a` 是 09-18 10:30 的产物，而 overlay 第二步
（fb9c07c）当天 23:24 才提交——上一轮对拍（T022）跑的是**旧引擎**（弹层走
第一步的内联挂载形态）。本轮 `tool/build-apple.sh` 重建后，第二步首次上设备，
随即暴露下述问题。宪法 VIII 的教训：改 native 必须重建预编译产物，否则设备
测的不是你以为是的那份代码。

### 扩展对比测试：新页 vant-more / vant-nav（18 个新组件）

新增 `demo/src/pages/vant-more.vue`（NoticeBar、Collapse、Card、Progress、
Circle、Steps、CountDown、Skeleton、Empty、TextEllipsis）与
`vant-nav.vue`（NavBar(fixed)、Tabs、Sidebar、Swipe、Search→后移除、
Popup+Picker、NumberKeyboard、Tabbar(fixed)）；`plugins/vant.ts` +
`vant-components.d.ts` 同步注册（现 44 个组件）。

两端一致的 ✅：Collapse 展开收起、Steps 结构、CountDown 走秒、Skeleton 骨架、
Empty 文案、Tabs 切换与下划线、Sidebar 选中/badge/disabled、Swipe 拖动、
Tabbar 贴底与 badge、Picker 弹层工具栏、NumberKeyboard 展开、NavBar/Tabbar
的内容滚动穿透。

App 端差异（本轮新登记）：

| # | 现象 | 备注 |
|---|---|---|
| D1 | **含关闭态弹层的页面整页空白**：vant-feedback（popup/dialog/sheet 关闭态挂载）与 vant-nav（含 Picker/Keyboard 的版本）在重建后的引擎上整页空白、无任何报错 | 第二步 overlay 上真机后首次暴露。关闭态 popup（lazyRender=false）即 v-show 隐藏 + position:fixed → 挂载即 hoist，这条路径有 Dart 侧 bug。二分定位：tabs/field/tabbar/sidebar 单独或组合均正常；stash 我的 runtime 改动、插件注册增量均不消失。本地（Node）同样组合可完整构建 op 流。需 flutter attach 专项定位 → **下个 spec 的第一项**。demo 临时绕过：vant-nav 不放 Search（tabs+field 同页也触发同类静默失败） |
| D2 | **vant Tabs 在无 window 环境抛 ReferenceError**：`isHidden`（dom.mjs:49，window.getComputedStyle）与 `useRect`（@vant/use，isWindow→window）无 inBrowser 守卫，在 nextTick 链中抛 `window is not defined` | 栈已捕获（本地复现）。下划线在 App 端停在最左（测量从未成功）即此因。与 D1 的关系待查 |
| D3 | **NavBar(fixed) 的 top:0 未落到 overlay 顶部**，与 Tabbar 叠在屏幕底；Tabbar(fixed) 的 bottom 生效（贴底 ✓） | 两者同为 hoisted，偏移解析不对称 |
| D4 | **Sidebar 条目横向溢出**：debug 红条 BOTTOM OVERFLOWED BY 119/80px（badge 与标题同行的行内排布撑破 80px 条目宽） | |
| D5 | **Swipe 右缘溢出红条**（Y OVERFLOWED）：指示点区域超出容器高 | 演示页给容器锁了 height:100px，vant 自身布局超出 |
| D6 | **NumberKeyboard 12 键排成一行**（应为 3×4 网格） | flex-wrap 场景未生效 |
| D7 | **Picker 弹层列区空白**：工具栏（取消/确认）在、列选项（杭州…）整段缺失 | 弹层内嵌套滚动选择结构未渲染 |
| D8 | **Card 内部行内流失败**：价格 ¥/2/./00 竖排、tags 变整行红条 | van-card__price/-tags 的行内布局映射缺口 |
| D9 | **Progress 填充块不贴轨道左侧**：percent 宽度未按轨道解析，蓝色填充缩成居中小块、pivot 错位 | portion 为 absolute + width% + left:0 组合 |
| D10 | **Empty 图片槽位过高**（约一屏）且 BOTTOM OVERFLOWED 60px；SVG 图缺（预期内） | |
| D11 | **TextEllipsis 降级为全文**（rows 截断依赖 DOM 测量，未崩溃） | 预期内，登记为降级形态 |
| D12 | CSS @keyframes ❌（NoticeBar 滚动、Skeleton 闪烁静止） | css-compat.md 已登记，本页实测确认降级可读 |

### T023（hello-fjs 画廊回归）：通过

`build:pages` 全量构建成功；浏览器 375×812 过检 内置组件/flex 布局/表单分组/
textarea 页，无意外横排。画廊源码本就不用 inline-block，映射为显式声明才生效，
无全局横排回归。

### T032（验收逐条核对）

- 验收 1（测试全绿）：`pnpm run typecheck` ✓、`pnpm test` 811 ✓（20+59+1 文件）、
  `flutter test` 364 ✓、native `fjs-test` ✓（含本轮新增回归）。
- 验收 2（五条现象消失）：T022 已录 ✅。但注意那是旧引擎下的结论；重建引擎后
  需要连 D1 一起在新引擎上重跑（属下个 spec）。
- 验收 3（弹层打开时滚动页面）：**仍未设备实测**。已给 vant-feedback 追加垫底
  内容使页面可滚动，但当前构建下该页触发 D1 空白，测试被阻塞。
- 验收 4（Stepper 两端各点一次）：T022 已录 ✅。
- 验收 5（docs 更新）：上轮已完成。

### 工程备忘

- 设备调试链路：`agent-device`（XCTest 后端）可对 fjs-go 做语义树/点击/滚动；
  `idb` 不可用。simctl 直接启动的 app 不向 `fjs run` 控制台回流 flutter 日志，
  要看日志需由 `fjs run ios` 自己拉起 app，或 `simctl spawn booted log show`。
- 演示页出现「整页被宽内容撑破再水平居中」时，先查 Shell（align-items:center）
  与 scroll-view 的 fit-content 宽度退化：页面根补 `width: 100%`。
