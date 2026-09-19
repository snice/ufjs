# Tasks: vant-more 组件 App 端修复

对应 spec：`./spec.md`。按顺序做，做完一条勾一条。

## 实现

- [x] T001 `renderer.ts`：HTML 块容器映射（div/section/… → view）注入元素级
  缺省样式 `flexShrink: 1`，并写明为什么（HTML 初始值 vs fjs view 的钉死约定）
- [x] T002 `svg.dart`：paint server 收集（defs 内 linear/radialGradient，按 id
  建索引）；`url(#id)` 解析为 `ui.Gradient`（objectBoundingBox 单位、stop 列表、
  stop-opacity、gradientTransform 的 matrix/translate/scale/rotate/skew）。
  实现中追认了三个必要的补充：
  - 属性读值带 kebab→camel 回退（`stroke-width` 属性此前读不到）；
  - 零长度渐变向量（vant 手柄 `-2-10`：x1==x2 且 y1==y2）画各 stop 的平均色
    （浏览器实测行为），Skia 对等点未定义；
  - 渐变几何全部活在 objectBoundingBox **单位方块**（坐标、半径、
    gradientTransform 一起），最后各向异性映射到盒子——浏览器采样证实半径
    随盒子各轴伸缩，不是"像素空间 + 归一对角线"。
- [x] T003 demo `vant-more.vue`：过时文案更新（page-note、Circle、Empty）

## 过程中追加的修复（对拍暴露的同类缺口）

- [x] T004 demo 全部 11 页 `.page` 加 `height: 0px`：flex 基数归零——内容高
  当基数时 App 端不收缩，整页 BOTTOM OVERFLOWED 2137px（本 spec 外壳改造
  引入的回归；web 靠默认 shrink 掩盖）
- [x] T005 CSS 引擎支持 `:not(:first-child)/:not(:last-child)`
  （`parser.ts` + `style.ts`）：vant 骨架屏行距全靠它，此前整条规则被跳过
- [x] T006 `renderer.dart isHidden` + `text.dart`：空文本 + 显式宽高不再是
  v-if 锚点被跳过，画出一个可装饰的盒（van-skeleton title 是空 `<h3>`）

- [x] T007 van-card 行内排布（`node_adapters.dart _buildBlockFlow`）：块盒里
  连续的行内级子项（inline-block/inline-flex 盒 + 文本）合成一行 Wrap——
  即浏览器的匿名行盒，块级子项照旧堆叠；行内盒挂 `FjsShrinkCross` 收缩到
  内容宽（`IntrinsicWidth` 撞子树 LayoutBuilder 断言，不可用）。判定看
  display 不看 htmlBlock（价格是 inline-block 的 div）。另支持
  `float: right`（van-card__num）。`flex.dart`：inline-flex 也收缩；
  `style.ts`：inline-flex 默认 wrap
- [x] T008 `text-decoration` 传播（`style.ts`）：不继承但画穿行内文字——
  下发到文本节点与 span（原价删除线）

- [x] T009 NoticeBar 省略号：`text-overflow` 由 runtime 下传到文本节点
  （`style.ts`），Dart 只在单行（nowrap/maxLines）时画省略号（`text.dart`）
- [x] T010a demo `src/plugins/vant/dom-env.ts`：App 端无 window，vant 的
  `inBrowser` 为假，`raf/doubleRaf` 直接返回 -1——跑马灯起不来、Circle 不动。
  只为 vant 装一个最小 window/document（raf、事件空实现、按样式引擎已解析
  样式的 getComputedStyle、body.classList），vant.ts 第一行引入以先于 vant
  求值；fjs runtime 仍不造全局 window（specs/070 的决定不变）
- [x] T010b 事件 42 `transitionend`（`element.ts` / `ffi.dart` / `fjs.h`）：
  transform/opacity 过渡跑完派发，中途改目标视为取消不派发
  （`decoration.dart` TickerFuture）
- [x] T010c 声明了过渡（含 0s）就保留 `_TransitionNode`：vant 同一次改动里
  同时设 transform 与时长，此前包装层新插入、initState 直接取终值（跳变、
  无 transitionend）
- [x] T010d 绝对定位 + nowrap、无 width/max-width 的盒按整行收缩并溢出
  （`flex.dart _UncappedWidth`）：vant 量内容宽决定滚动距离；全无偏移的
  abspos 在 Flutter Stack 里是非 positioned、拿紧约束，这里解除宽度上限
- [x] T010f 绝对定位子项的静态位置（`flex.dart positionedChild`）：CSS flex
  容器里交叉轴两端 inset 都是 auto 时，按 `align-items`/`align-self` 的
  center/end 放置（NoticeBar 文字在 40px 条内居中，此前贴顶差 8px）；
  有交叉轴 inset 的不受影响
- [x] T010g Collapse 展开出现 BOTTOM OVERFLOWED（window shim 让 vant 的
  高度动画路径首次真正跑起来后暴露）：①宽高过渡结束派发 transitionend
  （`decoration.dart` TweenAnimationBuilder.onEnd → `FjsSizeTransitionEnd`
  通知，`renderer.dart` 在声明了过渡的节点处接住、不外溢）——vant 据此把
  高度清回 auto / 收起后 v-show 隐藏；②`overflow: hidden` + 固定高度的盒里
  内容按自然高度排、被裁剪（OverflowBox），不再被压扁画溢出条纹
- [x] T010h Collapse 箭头无旋转过渡：①有 `:active` 的标题按下/松开时装饰层在
  Container 与裸内容间切换、整棵子树重挂载（`FjsStyle.keepsBox`，
  `decoration.dart` 始终保留盒）；②展开时标题多出绝对定位 `::after`，
  `buildBox` 从 Flex 切到 Stack 同样重挂载——定位上下文始终用 Stack
  （`flex.dart`，单子项 passthrough 布局等价）
- [x] T010i Collapse 高度无展开动画：vant 取消 display:none/懒渲染后同一 tick
  读 `offsetHeight`，fjs 只有上一帧布局 → 0 → 跳过动画。rect 读取改为
  DOM 式强制同步重排：JS `boundingRectOf` 先 `flushNow()`，Dart
  `fjs.ui.rect` 在非 build/layout/paint 阶段 `buildScope` + `flushLayout`；
  LayoutBuilder 子树的脏元素在 idle 阶段被推迟到下一帧，直接对其最近的
  LayoutBuilder `scheduleLayoutCallback()`；系统字体刚变化到下一帧之间
  跳过（RenderParagraph 的「下一帧前不许拆」断言，fjs 启动加载图标字体
  时必现）。`MirrorTree.flushDirty` 返回本次 ping 的 id
- [x] T010e demo：Circle 绑 `v-model:current-rate`（两端此前都停在 0）、
  Progress 条间留 pivot 空间、页面文案更新
- [x] T010j Progress 无进度动画（`flex.dart`）：portion 的 `width: 70%` 与
  pivot 的 `left: 70%` 都是百分比，由 `_AbsLayoutDelegate`/Positioned 在布局
  期一步解析成终值，vant 声明的 `transition: all` 落不到——布局结果没有补间。
  新增 `_animateAbsGeometry`：left/top/right/bottom/width/height 里声明了
  live track 的属性各挂一个 TweenAnimationBuilder，`FjsLength` 是 px+百分比
  线性对，逐项插值恒合法（等价 CSS 的 calc() 插值），delegate 对插值后的
  长度走与静态值同一条解析路径；plain Positioned 路径（纯 px inset）同样
  经过这里，与 web 一致。pivot 的 `translate(-X%,-50%)` 本就走
  `_TransitionNode` 动画，两端合成后与浏览器一致。inset 不派发
  transitionend（width/height 仍由 decoration.dart 的尺寸动画派发）；
  transition-delay 缺口同前。用例 `transition_abs_test.dart`（百分比宽/
  百分比 left/px inset 三条插值 + 无 track 跳变守卫）

## 测试

- [x] T010 TS：renderer 缺省样式用例（`html-tag-defaults.test.ts`）
- [x] T011 Dart：skeleton 收缩用例 + 空文本盒子用例（`vant_layout_test.dart`）
- [x] T012 Dart：svg 渐变用例（`svg_gradient_test.dart`——线性/径向钳位/
  stop-opacity/gradientTransform 压扁/渐变描边/逐形状盒子/真实 vant 插画
  全树/搜索阴影，像素采样断言）

## 验收

- [x] T020 `pnpm run typecheck` + `pnpm test`（914 通过）
- [x] T021 `cd packages/flutter_fjs && flutter test`（410 通过）
- [x] T022 web 实测 vant:more 不回归（浏览器布局探针：导航栏/内容几何不变）
- [x] T023 iOS 模拟器（iPhone 17, `fjs run ios`）实拍对拍：
  `shots/app-vant-more-skeleton-empty.png`——Skeleton 四条错位与 web 一致、
  Empty 两幅插画（含渐变楼群/云朵/手柄/椭圆阴影）与 web 一致、页面无溢出条纹。
  逐像素交叉验证：web canvas 光栅 vs Dart painter 光栅，40×40 网格平均差
  0.7/1.7（余量均为边缘抗锯齿）。
- [x] T024 Card 对拍：`shots/app-vant-more-card.png`——与 web 几何一致
  （标签同行、价格行贴底、x2 右钉、原价删除线）
- [x] T025 NoticeBar/Circle/Progress 对拍：`shots/app-vant-more-noticebar.png`
  ——静态条省略号；跑马灯设备采样：匀速左移→transitionend→复位右侧→以
  (630.64+314)/60=15.7s 重跑，与 vant 浏览器行为一致；Circle 30%/65% 弧、
  Progress pivot 与 web 几何一致
- [x] T026 Progress 动画验收（T010j）：iPhone 17 模拟器（`fjs run ios`）
  连按「增加」，portion 宽度与 pivot 滑动逐帧插值、无跳变，pivot 的
  `translate(-X%,-50%)` 同步动画，与浏览器一致（用户录屏确认）；
  `flutter test` 430 通过（含 `transition_abs_test.dart` 4 条）

## 遗留（超出本 spec，另立）

- [x] T027 vant-nav 白屏与溢出告警治理（对拍暴露）：①页面早期调测遗留的
  `.page{width:100%;height:0}` 让 scroll-view 塌成 0 高（整页白屏）——已删，
  连同 DEBUG-TMP 布局探针死代码一并清理；②`overflow:hidden` 盒与裁剪祖先
  （`FjsClipScope`，decoration.dart 打标、flex.dart 读取）内的 flex 不再画
  debug 条纹/报异常——同样的几何在 web 就是 scrollWidth > clientWidth，不是
  错误（vant swipe track 为 N×100%，App 端被钳到槽宽后 item 溢出 692px），
  `RenderFjsFlex.cssOverflowClip` 跳过指示器、paint 照常被 ClipRect 裁剪；
  ③wrap 项主轴自然尺寸溢出 run（sidebar item 文字盒 56px vs 文本 1px 盈余）
  此前由 UnconstrainedBox 逐帧报异常——换成 `FjsFreeMainAxis` proxy：子项
  自然布局、盒子钳回 run 尺寸、paint 照常溢出（CSS inline 语义），不报。
  iOS 模拟器实测：热重启后 0 溢出异常、无条纹
- [x] 遗留（超出本 spec，另立）：wrap/收缩行内 run 级 cross stretch——
  web 上 `.row[align-items:stretch]` 把 sidebar-body 拉到整行高（180），
  App 端 Flex 无界交叉轴不做 run 内拉伸（body 仅内容高）。属 stretch_flex
  两遍布局的推广，需要单独 spec
- [x] T028 tabbar 圆点位置错误（对拍暴露）：`.van-badge--dot` 声明
  `top:0; right:0; margin-top:4px; translate(50%,-50%)`（宽高都是
  `--van-badge-dot-size: 8px`），web 上圆点中心贴图标右上角；App 端两点
  偏差——①绝对定位子项自身的 margin 以 Padding 形式骑在 Positioned 的紧
  约束槽内，把 8×8 盒压成 8×4（CSS：margin 是相对 inset 的偏移，不缩小
  声明尺寸）；②`translate(50%,-50%)` 的百分比平移按含 margin 的链尺寸
  解析，多移 2px。最终方案取简单的一步：positionedChild 把节点自身的
  margin 折进 inset（`_inset`，`top:0; margin-top:4px` ⇒ 边框盒 top=4），
  decoration 对 out-of-flow 盒跳过 margin Padding——链即边框盒，紧约束
  不再压扁、百分比平移参照自动正确，`FractionalTranslation` 原样可用。
  百分比 margin 因参照系不同（margin 按宽、top/bottom 按高）无法折算，
  abs 盒上暂不生效（css-compat 记录）。真机像素扫描：圆点 8×8、中心
  (212.0, 798.83) vs CSS 期望 (212.13, 799)，badge"9" 同步修正。回归用例
  `abs_child_margin_test.dart`
- [x] 遗留（超出本 spec，另立）：wrap/收缩行内 run 级 cross stretch——
  web 上 `.row[align-items:stretch]` 把 sidebar-body 拉到整行高（180），
  App 端 Flex 无界交叉轴不做 run 内拉伸（body 仅内容高）。属 stretch_flex
  两遍布局的推广，需要单独 spec
- [x] T028 tabbar 圆点位置错误（对拍暴露）：`.van-badge--dot` 声明
  `top:0; right:0; margin-top:4px; translate(50%,-50%)`，web 上圆点中心
  贴图标右上角；App 端两点偏差——①绝对定位子项自身的 margin 在
  Positioned 的紧约束内部把 8×8 盒压成 8×4（CSS：margin 是相对 inset 的
  偏移，不缩小声明尺寸）→ 槽位按 margin 量扩展（声明尺寸才扩展，inset
  拉伸场景 margin 本就占空间），`_AbsGeometry.childMargin` 传入
  delegate/Positioned 两条路径；②`translate(50%,-50%)` 的百分比平移按
  含 margin 的链尺寸解析（12 而非边框盒 8），多移 2px →
  `FjsBorderBoxTranslation`（decoration.dart）：百分比以边框盒为参照、
  margin 在链内保持布局偏移，`applyPaintTransform` 使 localToGlobal/
  JS rect 与绘制一致。真机像素扫描：圆点中心 (212.0, 798.83) vs CSS
  期望 (212.13, 799)，badge"9" 同步修正。回归用例
  `abs_child_margin_test.dart`
