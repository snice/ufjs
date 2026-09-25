# vant 适配记录

> 第四层。vant 4.10 在 fjs 上两端（web 浏览器 ↔ iOS/Android）跑通的完整
> 账：为了适配补了什么、补在哪一层、花了多少。打法与分级判据沉淀在
> [third-party-components.md](third-party-components.md)；首开性能的方法论
> 与打点附录在 [vant-mount-perf.md](vant-mount-perf.md)。本篇是**记录**，
> 每一条都带 spec 编号可回查。

## 总账（截至 2026-09-25，spec 135）

| 维度 | 数字 |
|---|---|
| 直接由 vant 驱动的 spec | **31 个**（068–073、075–077、084、086、100、103、118–126、128–135、137；另有 078/104/106/127 等相邻 spec） |
| 相关非 merge 提交 | 41 个，变更 479 个文件、约 3.2 万行（含 runtime / Dart / CLI / 测试 / 文档） |
| demo 项目本地适配代码 | **1112 行**（5 个文件，见下「接入面」；另 bench/wm-smoke.ts 34 行离线冒烟入口） |
| 全局注册的 vant 组件 | 46 个 + 1 个本地复刻（`van-watermark`，spec 135）+ toast / notify / image-preview 样式（命令式 `showToast` / `showDialog` / `showNotify` / `showImagePreview` 两端可用，specs/137） |
| 对拍页面 | 7 个：`vant-basic` / `vant-form` / `vant-feedback` / `vant-more` / `vant-nav` / `vant-float` / `vant-watermark` |
| 注册进 CSS 引擎的样式 | vant 源 CSS 1056 个选择器 → 639 条规则、约 80 KB；`--van-*` 主题 token 494 个键 |
| vue-shim 补齐导出 | 5 个：`Transition` / `vShow` / `withKeys` / `createApp`（068）+ `measureTextBlock`（128） |
| 元素上补齐的 DOM 形状 API | 约 20 个成员（明细见下表） |
| 新增宿主模块 | `fjs.font.load`（071）、`fjs.control.focus/blur`（077）、`fjs.ui.measureText`（128）、document 级 pointer-down 流（073） |
| demo 源码补丁 | 19 条（vite 插件锚点替换，见下表） |
| 回归网规模（时点数） | specs/069：JS 811 + flutter 364；specs/071：runtime 523 + flutter 378；specs/120：runtime 748 + cli 391；specs/132：flutter 515 通过。含专门以 vant 命名或由 vant 场景钉住的测试（`vant_layout_test`、`icon_line_height_test` 等，另带真实字体 `fixtures/vant-icon.ttf`） |

## 现状结论

- demo 六个 vant 页在 web 浏览器与 iOS / Android（模拟器 + 真机）上结构、
  位置、交互一致；页面源码对两端无差别（无平台分支）。
- 首开性能经 8 个 spec 治理后，vant-form（约 350 元素）`[nav] mounted`
  从 401 ms 降到模拟器 ~12–20 ms 量级（见下「性能演进」）。
- 登记在案的已知差异见文末——主要是命令式 API 与 DOM 语义层面的
  （组件式写法两端一致）。

## 接入面（demo 是参考实现）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `demo/src/plugins/vant.ts` | 164 | 46 个组件 `app.use` 全局注册 + 按需样式 import（一份清单喂两端）。**无平台后缀**；第一个 import 是 dom-env |
| `demo/src/plugins/vant/dom-env.ts` | 459 | 为 vant 一个库 opt-in 的最小 `window` / `document` 侧影：rAF、读 fjs 样式引擎的 `getComputedStyle`（transform 转 `matrix(...)`、line-height 折 px、scroll-view 两轴答 scroll）、document pointer-down 流（NumberKeyboard 点外关闭）、首见型 `IntersectionObserver`、`Element` / `HTMLElement` 的 `instanceof` 垫、测量盒（`document.createElement`）、resize 监听、rootElement（吸收 lock-scroll 类写入）。**只在 App 构建运行** |
| `demo/src/plugins/vant/VanWatermark.vue` | 248 | **本地复刻的 Watermark**（spec 135）：vant 的 SVG→Blob→位图背景平铺管线 App 端三处不可用（无 innerHTML 读、无 Blob/URL、CSS 无位图背景），改用 absolute 格子 + `transform: rotate` 重建，props / `#content` 插槽与 vant 对齐，两端同一份实现。格数按根节点 rect 实测（rAF 采样到 rect 连续两帧不变才收敛，转场中途的“非零但偏小”rect 不能采信；上限 64×64 并告警一次） |
| `demo/vite/vant.ts` | 313 | 带 `fjs.app` 钩子的本地 vite 插件，19 条字面量锚点补丁（见下表）；锚点失效告警一次并写明哪个功能失效 |
| `demo/src/plugins/vant-touch.web.ts` | 13 | 只 web：引 `@vant/touch-emulator`，桌面浏览器鼠标转 touch（specs/123） |
| `demo/vite.config.ts` | +1 行 | `plugins: [fjs(), vant(), vue()]` |

早期手写的 `src/vant-components.d.ts` 已删：vant 4.10 起自带
`GlobalComponents` 类型声明。（`docs/vue3.md` 里对它的描述待随本篇更新。）

## 第一波：接入与兼容（specs/068–073，2026-09-19 前后）

### Vue API / vue-shim（specs/068）

vant barrel 无条件从 `'vue'` 导入四个只在 runtime-dom 存在的名字，App
构建直接失败。`vue-shim.ts` 一次性补上（语义按 fjs 现实重述，见
[third-party-components.md](third-party-components.md) 的 vue-shim 表）：
`Transition`（fjs 版，animation 型规则由 keyframes 引擎原生播放）、
`vShow`（只碰内联 `display`，整张替换计算样式会让组件丢样式——specs/069
步进器改值后输入框与加号样式丢光的根因）、`withKeys`（直通）、
`createApp`（指名抛错；vant 的命令式 API 由补丁改从 `fjs/vue` 取 `createApp` +
游离根，specs/137）。specs/070 另
以 `hoistStatic: false` 编译 SFC（`createStaticVNode` 需要本 renderer 没有
的 `insertStaticContent`）。

### DOM 形状 API（specs/070/072/077/128/129）

| API | spec | 驱动场景 |
|---|---|---|
| `input`/`textarea` 的 DOM 式 `value` | 070 | Field 按 `event.target.value` 实现 v-model |
| `el.contains(other)` | 072 | Checker 判断是否点在图标上（缺它抛 `TypeError`，勾选无反应） |
| `focus()` / `blur()` → `fjs.control.*` 宿主模块 | 077 | Field 只读拒焦时调 `inputRef.value.blur()` |
| `el.isConnected` | 128 | TextEllipsis 只在挂着时才测量截断 |
| `parentNode` / `parentElement` / `nodeType` / `tagName` / `nodeName` | 129 | `useScrollParent` 沿父链找 `overflow-y` 滚动祖先（Sticky/Tabs） |
| `setAttribute` / `removeAttribute` | 129 | popperjs 写 `data-popper-placement` 定弹层 |
| `scrollTop` / `scrollLeft` / `clientTop` / `clientLeft` | 129 | popperjs 定位读这些值，缺了坐标 NaN |
| tap 沿父链冒泡 + `stopPropagation()` + `target`/`currentTarget` | 129 | Popover 点了不弹（此前 tap 不冒泡、`.stop` 空操作） |
| `clientX` / `clientY`（click 载荷） | 073 | NumberKeyboard click-away 判点击位置 |
| 伪元素盒上的按下 target 映射回宿主元素 | 129 | 按钮盖满 `::before` 时点外关闭误判 |

### CSS 引擎（specs/068/069/071/073）

- `:root` / `:host` 自定义属性作为继承链起点（vant 全部 `--van-*` 声明在
  这，此前整条被跳过）；`var()` 替换后 em 折算 px（`calc(1.8em + 4px)`）
- 伪元素 `::before` / `::after`（装饰型）：引擎按层叠算样式、renderer 合成
  真实子节点；`content` 支持引号字符串与纯空白空盒（发丝线惯用写法）
- `display: inline-block` / `inline` 映射横排可换行收缩盒（Stepper 横排）；
  `display:flex` 未写方向时补 CSS 初始 `row + stretch`（Cell/Grid 竖排）
- `border-radius: %` 逐角解析；`position: fixed` 两步走（JS hoist → Dart
  置顶 overlay 宿主）；flex 的 `flex-basis`、`margin: auto`、`max-width`
  冻结等修正（vant Cell / Grid / 分割线 / NavBar 居中）
- `font` 简写展开、`font-family` 字体栈（`-apple-system` 等截止在系统族）、
  **`@font-face` 整条支持**：parser 收集、构建期 WOFF/WOFF2 → TTF 内联为
  data URL、新宿主模块 `fjs.font.load` 下发、Dart `font_loader.dart` 注册
  （specs/071——vant 全部图标此前 App 端空白）；PUA 字形放行规则
- SVG `linearGradient` / `radialGradient` / `stop-opacity` /
  `gradientTransform`（specs/073，Empty 插画）
- `currentColor` 替换（spinner、Popover 箭头）

### Dart 渲染（specs/068/069/073）

`button.dart` label 沿全部后代递归收集（vant 的
`button > div.content > span` 结构）；`input.dart` 无界宽度兜底
（`<input>` 固有宽度 ≈178px）；HTML `div` 等标签恢复 CSS 初始
`flex-shrink: 1`（Skeleton 内容列让位）；overlay 宿主 + z-index 排序。

## 事件契约（specs/103/129）

specs/070 为 vant Field 加的「所有 `on*` 包 DOM 事件对象」误伤 fjs 标签
（Android 图片页 14 个按钮整块空白）。specs/103 定死契约：首参形状按
**编译期标签**判定——fjs 标签收裸载荷、HTML/SVG 标签收模拟事件对象，
demo 补丁里 Field/Stepper 的输入处理器做载荷容忍。specs/129 补 tap 冒泡
与 `stopPropagation`（Popover 触发）。specs/124 在 Dart 手势层补点外失焦。

## 表单与输入（specs/077/100/122/124/125/126）

| spec | 缺口 | 落法 |
|---|---|---|
| 077 | readonly/disabled 可编辑、`blur()` 不存在、宿主主题灰底 | 控件属性透传 peer + `fjs.control.focus/blur` 宿主模块 + 压住宿主 `InputDecorationTheme` |
| 100 | Field label 与输入文字不同线（web 基础样式 + Flutter 行高）、`::placeholder` 只有 web 对 | CSS 引擎新增 `::placeholder` 伪元素（四键落 `placeholderStyle`）；web `base-css` 的 `label` 规则向浏览器 UA 收敛；行高 52→44px，对拍 ≤1px |
| 122 | autosize 多行不长高（两段式 stretch flex 把子项变成 relayout boundary）、Search 清除无效（prop 同值写入被忽略） | `FjsCrossLineItem` 让 `markNeedsLayout` 上传；input value 首次出现即对账 |
| 124 | 聚焦后点外面键盘不收 | 页面根部 + 弹层宿主挂 tap 识别器；只听 touchstart 的节点（vant 清除图标）由 `pointer_claim` 标记补漏 |
| 125 | `type="password"` 明文、`digit/number/tel` 键盘不匹配 | input 补 DOM 属性别名 `type` / `inputmode` / `enterkeyhint`（优先级对齐浏览器） |
| 126 | 占位文字比 label 高 1.5–2pt | input 支持绝对 px 行高（`24px` 按字号折倍数），占位与正文共用 |

## 浮层体系（specs/069/070/129/133/134）

specs/069 立 overlay 宿主（fixed 元素 hoist 置顶）；specs/129 补定位生态
（popperjs 全套读面、`[data-*]` 属性选择器、overflow 简写与阴影出裁剪、
CSS 三角形的 currentColor/calc 乘除/border-box 下限、宿主按 z-index 稳定
排序）；specs/133 收口宿主归属——宿主贴本页 entry、随路由转场、按形状
自动判模态（`.van-overlay` 拦返回，Toast/Sticky 吸顶不拦）；specs/134 把
toast 宿主提升为每 app 一个（`FjsApp` 挂载），页面乱序销毁不再丢宿主。

## 布局与文本（specs/130/131/132）

- **specs/130**：Grid `square`（`flex-basis:25%; height:0; padding-top:25%`）
  格子高度为 0——`% padding` 参照改按包含块宽（新 `FjsPercentBase`），
  border-box 下限纳入 % padding，模拟器格子 86.5×86.5 精确成方
- **specs/131**：图标比 web 高 1–2px——无自身字形段落的 strut 修正 +
  WidgetSpan 不带 lineGap（`font: 28px/1 vant-icon` 两端同为 28 高，测试
  内置 vant 真实字体）
- **specs/132**：`<van-button>{{ text }}` 文本不即时更新——mirror tree
  对 button 标签快路径补 `_markButtonLabel` 上溯标脏

## 唯一的本地复刻：Watermark（spec 135）

vant 的 Watermark 把旋转内容渲染成 SVG → 读 `innerHTML` 序列化 → `Blob` +
`URL.createObjectURL` → 根节点 `background-image: url(blob)` 平铺。App 端
三处都不存在：fjs 元素读不到 `innerHTML`、QuickJS 没有 Blob/URL、CSS 引擎
不支持位图背景（只支持渐变）。机制层判 D（不硬模拟），但视觉效果用已有面
完整复刻：`demo/src/plugins/vant/VanWatermark.vue` 以 `van-watermark` 名注册
（vant 自带的不注册），props / `#content` 插槽对齐，两端同一份 DOM 平铺。

- 几何对齐 vant：内容贴格左上（foreignObject `x=0,y=0`）、绕内容盒中心旋转
  （两端 transform origin 默认同为盒中心）、格盒 `overflow: hidden` 出裁
  （vant 是 SVG 视口裁剪）；点穿靠 vant 水印 CSS 的 `pointer-events: none`
- 格数测量：挂载后 rAF 采样，**rect 连续两帧不变才收敛**——页面转场滑入
  途中量到的 rect 非零但偏小，首帧采信会让旋转示例只剩一格（specs/135
  实测踩坑）；硬上限 30 帧、格数封顶 64×64（超出告警一次）
- 图片模式直接 `<image :src>`，不做 vant 的 canvas→base64 转码（那是为绕
  canvas 跨域污染，这里不存在）；tile 尺寸需按图片原始比例给（如
  vant-watermark.png 606×194 → 125×40），否则拉伸

## 首开性能（specs/075/076/084/086/118/119/120/121）

慢的原因链与打点方法见 [vant-mount-perf.md](vant-mount-perf.md)：CSS
匹配占 70–75%（QuickJS 无 JIT，~1.7 µs/规则访问 × 17.6 万次规则访问），
其余为 Vue / 元素层 / 一次同步 layout。落地顺序与贡献：

| spec | 做了什么 | 关键数字 |
|---|---|---|
| 075 | 匹配按最右复合选择器分桶索引 | 匹配段 240 → 7.2 ms（33×）；match miss 数量逐页分毫不差（语义哨） |
| 076 | 计算段分配瘦身 + 链缓存跨卸载保留 | custom 表拷贝 30–35 → 4.3 ms；重开 miss 299 → 53；flush 总量 223.5 → 47.4 ms 且不再逐轮爬升 |
| 084 | Dart 侧 interned style 派生对象共享 + JS 继承合并瘦身 | 分配型收益，被 GC 噪声盖住；不拿 GC 凑数 |
| 086 | navMount 当次跳过同步 layout | vant-form `[nav] mounted` 249–267 → 91–98 ms；转场不再冻 |
| 118 | 元素层削分配（原型化、字节缓存、常量 props、惰性属性、标脏去重）+ 首屏优先 `<defer>` | 元素层 −48%、卸载 28.5 → 6.5 ms；vant-form 首开同步段 204–214 → 37–38 ms（容器口径） |
| 119 | 构建期样式预热（快照随 chunk 下发） | vant-form 首开 CSS 21.6–25 → 7.6–7.9 ms；match miss 270 → 1；构建 +0.5 s、chunk +50–75 KB/页 |
| 120 | 注册新 scoped 表不再整体清缓存 | 分包下重开 miss 234 → 86；真机 profile 反慢问题定位 |
| 121 | 预热改在分包产物本身上抓取 | 真机 `snapshot skipped` 消除；五页快照全部被接受（basic 157→1、form 278→1、more 279→1） |

汇总：vant-form 首开 `[nav] mounted` **401 ms（075 前）→ 91–98 ms（086）
→ ~20 ms（118 defer，模拟器）→ ~12 ms（119 预热，模拟器）**；真机
iPhone（分包 + 字节码）五页 59–81 ms（specs/120 复核口径）。

## demo 源码补丁清单（`demo/vite/vant.ts`，19 条）

| # | 目标文件 | 补丁 | 保护的 feature |
|---|---|---|---|
| 1 | @vant/use | `isWindow` 加 `typeof window` 守卫 | useRect（Rate 点击 / Slider 点按） |
| 2 | @vant/use | `useEventListener` 非浏览器早退只对默认 target | Slider 拖动（元素 target 监听） |
| 3–4 | use-lock-scroll | `lock` / `unlock` 加 `document` 守卫 | Popup 开 / 关 |
| 5 | Slider | 注入 `style: { touchAction: 'none' }` | scroll-view 里拖动 |
| 6 | Rate | 注入 `touchAction: 'pan-y'` | scroll-view 里横滑 |
| 7–8 | Field | autosize 的 window 守卫 + 换 `autoHeight` prop | textarea autosize（App 原生长高） |
| 9 | @vant/use | `getScrollParent` 非浏览器走 root | Tabs / Sticky 挂载 |
| 10 | utils/dom | `isHidden` 非浏览器算可见 | Tabs / Swipe 初始化 |
| 11 | Tabs | 下划线 0 尺寸时 rAF 重试至多 10 帧 | 首帧下划线位置 |
| 12 | Field | `onInput` 载荷容忍（值或事件对象都接） | Field 输入（v-model，specs/103） |
| 13–14 | Stepper | `onInput` / `onBlur` 载荷容忍 | Stepper 输入 / 失焦格式化 |
| 15–16 | utils/mount-component | `createApp` 改从 `fjs/vue` 导入；容器从 `document.createElement` 换成 `createDetachedRoot()`，卸载 `releaseDetachedRoot()` | showToast / showDialog / showNotify / showImagePreview（specs/137） |
| 17–19 | toast/lock-click | `forbidClick` 锁点击：`document.body` 的 `van-toast--unclickable` 类换成游离根里的全屏透明拦截层（进 app 级宿主，盖住所有页面），解锁时卸载 | showToast `forbidClick`（specs/137 追加） |

补丁纪律：字面量锚点、替换后逐字可读、锚点失效只告警不阻断（显式降级）。

## 已知差异（登记在案的）

- **Watermark 是本地复刻而非 vant 原件**（specs/135）：机制是 DOM 格子平铺
  而非 CSS 位图平铺，视觉等效、不是同一份光栅；水印文字默认字号 pin
  14px/20px（vant 的 span 继承文档字号，两端 text 默认字号不一致）；
  超大容器格数封顶 64×64。API（props / `#content` 插槽）与 vant 对齐
- **命令式弹层挂在 app 级宿主**（specs/137）：`showToast` / `showDialog` /
  `showNotify` / `showImagePreview` 的第二个 Vue app 挂进游离根，内容经
  Teleport / hoist 落到 app 级 overlay 宿主（画在所有页面之上，同 web 的 body）。
  可见期间系统返回被拦（specs/136），web 浏览器后退不拦
- **没有深层 target / 事件委托**：`target` 是被点中的有监听的最内层节点；
  Checker `label-disabled` 时点图标不切换（specs/072）
- **`position: fixed` 走 overlay 宿主**、`<Teleport to="body">` 落同一宿主：
  视觉与交互等效，不是 DOM 语义（specs/069/129/133）
- **`window.getComputedStyle` 是 dom-env 的最小 shim**：够滚动父级查找与
  隐藏判断，伪元素样式、百分比还原没有（specs/128 扩到可枚举 + 布局宽）
- **dom-env 给 popperjs 补了全局 `Element` / `HTMLElement`**（对 fjs 元素
  `instanceof` 为真）和 document 盒子的最小形状（specs/129）
- 点带 `@tap` / `@touchstart` 的节点输入不失焦（specs/124，与浏览器的
  「点可点元素不失焦」对齐；纯空白处才失焦）
- web 端浏览器后退不拦截模态（specs/133 的已知差异，App 端拦截）

## 对其他组件库的启示

vant 适配的产出大部分是**通用能力**：DOM 形状 API、vue-shim、CSS 支持
面、overlay 宿主、`<defer>`、样式预热对任何 DOM 式组件库都有效。接第二
个库时，预计的项目本地工作只剩：注册/样式清单、侧影裁剪到该库的真实
读面、少量 `window` / `document` 守卫与手势声明补丁、类型声明——规范与
分级判据见 [third-party-components.md](third-party-components.md)。
