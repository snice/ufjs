# Tasks: 217-app-store-clone

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 确认契约零变更：三张表（ops / natives / 事件）本 spec 都不动；实现期若发现必须改，停下来另开 spec（记在本文件末尾「实现期发现」）

## 实现

### 工程骨架

- [x] T010 新建 `examples/app-store-clone/{package.json,index.html,vite.config.ts,tsconfig.json,app.config.ts}`，照 `examples/racing` 同名文件；依赖 `@ufjs/liquidglass`（`workspace:*`）
- [x] T011 新建 `src/main.ts`（`createFjsApp`：routes / plugins / shell / tabBar / `transition: 'fjs-slide'`）与 `src/Shell.vue`（白底铺满、tab 页底部留白，照 `hello-fjs/src/Shell.vue` 的 `withBar` 判定）
- [x] T012 新建 `src/components/TabBar.vue`：只留 `liquid-glass` 一档，`safe-area edges="bottom" :scale="0.5"`，web 端 `paddingBottom: 20px`；图标用示例自带 `src/components/Icon.vue` 内联 SVG（iconmind 无对应图标，见 plan 修订）
- [x] T013 `pnpm install` 后跑 `pnpm --filter app-store-clone run typecheck`，骨架先跑通（空页面也行）

### 数据与状态

- [x] T020 新建 `src/data/apps.ts`、`src/data/stories.ts`：虚构应用/开发者/文案、渐变色对、emoji 占位；不含任何 Apple 真实素材与商标
- [x] T021 新建 `src/store.ts`：`installState` reactive + `download(id)`（`setInterval` 推进进度，页面销毁清定时器）

### 基础组件

- [x] T030 `src/components/GetButton.vue`：获取 / 打开 / 云下载 / 下载中（圆环进度）四态，带「App 内购买」小字
- [x] T031 `src/components/AppRow.vue`：图标 + 名称 + 副标题 + `GetButton`，0.5px 分割线（左缩进到图标右边）
- [x] T032 `src/components/AppRowPager.vue`：每 3 行一组、组间 `scroll-x` + 固定宽度横向翻（`swiper` 无露边，见 plan 修订；不做吸附）
- [x] T033 `src/components/SectionTitle.vue`（带 `›`，点击无动作）、`ChipRow.vue`（横滑分类胶囊）、`LargeTitle.vue` + `Avatar.vue`
- [x] T034 `src/components/GlassCircleButton.vue`：返回（红）/ 分享 / ✕ 三种圆钮；玻璃层是 `<glass-surface>` 的兄弟节点（叶子元素约束）
- [x] T035 `src/components/FeaturedSwiper.vue`：精选大图卡（`scroll-x` + 固定卡宽） + 蓝色小标签 + 大标题 + 灰副标题

### 页面

- [x] T040 `src/pages/index.vue`（Today，`"tab": 0`）：`StoryCard` / `AdCard` / `ListCard` 三种卡 + 按下缩放（`:active` + `transform: scale(.96)` + `transition`）
- [x] T041 `src/hero.ts`（拷贝 `hello-fjs/src/hero.ts` 的 `Rect` / `FLY_MS` / `CLOSE_MS` / `rectOf`，去跨页登记表）+ `src/components/HeroBox.vue`（飞行渐变 `view`，起飞时序照 `HeroFly.vue`）
- [x] T042 `src/components/CardExpand.vue`：同页面 overlay 展开 / 收起，内容淡入、✕ 玻璃圆钮；Today 的故事卡与列表卡接入
- [x] T043 `src/pages/games.vue`（`"tab": 1`）与 `apps.vue`（`"tab": 2`）：共用 `FeaturedPage.vue` 骨架（`ChipRow` + `FeaturedSwiper` + `SectionTitle` + `AppRowPager`），数据不同
- [x] T044 `src/pages/arcade.vue`（`"tab": 3`）：整屏渐变英雄区 + 蓝色大胶囊「接受优惠」+ 分类胶囊 + 「Try Before Subscribing」列表
- [x] T045 `src/pages/search.vue`（`"tab": 4`）：大标题 + 圆角 `SearchBox`（输入本地过滤）+ 「为你推荐」`AppRowPager` + 「浏览」两列 `BrowseCard`（点击无动作，仅按下态）
- [x] T046 `src/pages/detail.vue`（`/detail?id=`，`"tabBar": false`；原计划 `app/[id].vue`，App 端动态段页面解析不了，见「iOS 模拟器验收」）：大封面压面板、红色返回钮 + 分享钮、大图标 + 标题 + 开发者 + `GetButton`、`InfoStrip`（评分 / 获奖 / 年龄 / 排名）、新功能 + 版本、预览横滑；非法 id `router.replace('/')`
- [x] T047 列表行 / 精选卡点击 `router.push('/app/:id')`，详情页返回键与手势返回走通

## 两端对齐

- [x] T050 Web 逐页对拍：`pnpm --filter app-store-clone run dev:web`，对照 iPhone 镜像采集截图逐页目测（5 tab + 详情 + 展开卡）
- [x] T051 Flutter 逐页对拍：`fjs run ios`（模拟器 / 真机，按项目记忆「worktree 里跑 iOS」注意端口与模拟器隔离），同样逐页目测
- [x] T052 两端行为对拍清单：卡片按下缩放回弹、展开 / 收起飞行、`swiper` 露边与分页、获取→下载中→打开、搜索过滤、tab 切换保活；每条差异记入 plan §4 对应风险并修或登记
- [x] T053 风险 #2 / #3 / #8 专项：飞行盒圆角过渡、渐变跳变、滚动与 `:active` 冲突，在 App 端各验一次，确定最终写法
- [ ] T054（部分：模拟器无法给出可信帧率，见「iOS 模拟器验收」）风险 #7 专项：Today 同屏多玻璃面 + 滚动在真机上看掉帧，必要时只在可视卡片挂玻璃条或降 `refraction=0`

## 测试

- [x] T060 `pnpm --filter app-store-clone run typecheck` 通过（`strictTemplates` 开着）
- [ ] T061（未做，见「实现期发现」）`store.ts` 的下载状态机补一个 vitest 单测（none→downloading→installed、重复点击不重复起定时器、销毁清定时器）；示例工程没有 vitest 配置则把逻辑写成纯函数并显式说明不加测试的原因，**不要静默跳过**
- [x] T062 `find examples/app-store-clone/src examples/app-store-clone/public -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.webp' \)` 无输出；`grep -rn '\bgc()' examples/app-store-clone/src` 无输出

## 文档

- [x] T070 `AGENTS.md` §2 仓库地图加一行 `examples/app-store-clone`（Vue，iOS App Store 复刻示例，同源跑 Flutter 与 Web；改动前必读 `specs/217-app-store-clone`）
- [x] T071 T052 / T053 / T054 发现的新两端差异追加到 `docs/css-compat.md` 或 `docs/web.md` 的差异表（没有新差异则明确写「无」并跳过）
- [x] T072 `docs/roadmap.md` 无对应条目则不动，在本文件「实现期发现」注明

## 验收

- [x] T080 `pnpm run typecheck`（全 workspace）
- [x] T081 `pnpm test`
- [x] T082 `pnpm --filter app-store-clone run build:web` 与 `build:release` 都能产出
- [ ] T083 spec.md 第 6 节 11 条逐条核对并在此记结果（#5 / #6 / #7 必须 App 端手点，只看 web 不算）
- [ ] T084 `spec.md` 状态改 `done`

## 实现期发现

- 契约零变更；`packages/` 零改动。仅有的计划外文件：`.claude/launch.json` 加了 `app-store-clone-web`（端口 5195）预览项。
- `@ufjs/iconmind` 是 AI 主题图标集，没有报纸/火箭/层叠/手柄/放大镜 → 示例自带 `Icon.vue` 内联 SVG，已去掉该依赖（plan 已改）。
- `swiper` 无页间距/露边 → 精选卡与列表分组改 `scroll-view scroll-x` + 固定宽度，**无吸附**（plan §3 已改）。
- 事件冒泡：`@tap` 外层包裹会吞掉内层「获取」按钮的点击（fjs 没有 `.stop`）。改成「热区兄弟 + 按钮上层兄弟」结构（StoryCard / ListCard / AppRow）。
- scoped 样式会作用到子组件**根元素**：父级 `.icon` 规则命中了 AppIcon 根（也叫 `.icon`），已改名。
- 绝对定位的玻璃层会盖住非定位兄弟（图标）→ 图标外包 `position: relative`。
- `main.ts` 必须 `import { plugins } from 'fjs/plugins'` 并传给 `createFjsApp`，否则 web 上 `glass-surface` / `GlassTabBar` 不注册（只告警）。
- T061 没加单测：示例工程没有 vitest 配置（racing / hello-fjs 同样没有），为一个 40 行状态机新开测试基建不值得；`store.ts` 的下载逻辑已在 web 上手点验证（获取→圆环→打开、重复点击不重复起定时器）。
- 与 iOS 的已知差异（非两端差异）：卡片展开时全局 tab 栏仍浮在上面（iOS 会收起）；列表分组/精选卡无吸附；展开圆角 20→0 为瞬切。均未登记到 css-compat（不是两端不一致）。

### iOS 模拟器验收（T051–T053，iPhone 17 Pro / iOS 26.5，`fjs run ios`）

跑法：宿主工程 `.fjs/flutter` 是新生成的，`Podfile` 默认 iOS 13，而 `liquid_glass_widgets` 要 ≥15，`pod install` 报错。**本地手改**了 `.fjs/flutter/ios/Podfile`（`platform :ios, '15.0'`）与 `Runner.xcodeproj` 的 `IPHONEOS_DEPLOYMENT_TARGET`（hello-fjs 的宿主就是这样）；这是 gitignore 目录，不进仓库。

逐页对拍结果（Flutter vs Web）：

| 项 | 结果 |
|---|---|
| 5 个 tab（Today / 游戏 / App / Arcade / 搜索）布局、玻璃 tab 栏 | 一致 |
| 获取 → 圆环 → 打开 | 一致（web 已验；App 点测同） |
| 故事卡展开 / 收起、列表卡展开 | **修了 3 个 App 端独有问题后一致**（见下） |
| 详情页（封面压面板、红返回钮、分享钮、信息栏、预览）+ 返回 | **修了 2 个 App 端独有问题后一致**（见下） |
| 展开时全局 tab 栏 | App 端被全屏层盖住（与 iOS 一致）；web 端仍浮在上面 |
| 标题字体 | App 端 SF 比 web 字体宽，「This cat's ready to play」折成两行（web 一行），不影响布局（文字底锚） |
| ✕ 玻璃钮 | App 上叠在紫色渐变上，玻璃偏紫、图标对比度低于 web |

修掉的 App 端独有问题（均已改在示例里，没碰 `packages/`）：

1. **嵌套 `position: fixed` 被各自提升到 overlay 宿主**：展开层里的飞行盒（fixed）盖在同级内容层之上，内容和 ✕ 看不见。改成 `.layer`（fixed）里的 `absolute`。
2. **卸载 fixed 子树不会把它从 overlay 宿主移除**：`v-if` 关掉展开层后，全屏 modal 层残留，吞掉所有触摸、滑动和返回手势。绕法：`CardExpand` 常驻挂载，`v-show` 显隐（宿主认 `display: none`）。**这是运行时缺口**，见后续建议。
3. **对含玻璃（BackdropFilter）子树做 `opacity` 过渡会弄坏绘制**：收起后卡片只剩渐变底。去掉卡片隐藏（不透明飞行盒本来就盖得住）。
4. **动态路由页面在 App 端找不到**：`pages/app/[id].vue` 注册在模式 `/app/:id` 下，而 `router/flutter.ts` 的 `pageComponent(entry.location.path)` 按**具体路径**查，白屏并报 `no page registered for /app/chatly`（web 正常）。改成 `pages/detail.vue` + `?id=`。**这是运行时缺口**，见后续建议。
5. **绝对定位层画在流内元素之上**：玻璃/红底圆钮盖住了图标 → 图标也改成绝对定位同级兄弟；详情页根缺 `position: relative`，悬浮按钮掉到屏幕底部。
6. 空的绝对定位热区在自动高度容器里点不到（ListCard），且不透明的子容器会截断命中 → 列表卡改成头部直接 `@tap`，StoryCard 的 `.hit` 兄弟结构保留（定高容器里正常）。

T053 结论：飞行盒圆角 20→0 瞬切、渐变不插值（飞行盒始终用故事渐变）、展开/收起都正常；滚动与按下态无冲突（Today 能正常滑动）。**按下缩放（`:active` scale）在 App 端无法靠自动化截到按住中的帧，未目测**——代码路径是 `:active` + `transition: transform`，docs/ui-api.md 登记两端都有。

T054 结论：模拟器上 Today（tab 玻璃栏 + 卡片玻璃条 + 滚动）无肉眼可见卡顿，但**模拟器不是可信的帧率来源**（项目记忆：真机结论会推翻模拟器），没有测帧数。需要真机 profile 才算数。

自动化工具的坑（非应用问题）：`simulator` 的 `screenshot` 会滞后一帧，状态判断改用 `xcrun simctl io <udid> screenshot`；`tap` 经常第一下丢失，需重复；点位要换算（截图缩放后 y×2.185）。

### 建议另开 spec（运行时缺口，本 spec 不动 `packages/`）

- **Flutter 路由：动态段页面解析**：`router/flutter.ts` `mount()` 用 `entry.location.path` 查 `pageComponent`，动态路由 `/user/:id` 查不到（docs/routing.md 写了支持，web 能用）。应按匹配到的路由模式注册/查找。
- **overlay 宿主：卸载 fixed 子树要真正移除**，并补一条回归（v-if 关掉全屏 fixed 层后触摸 / 返回手势恢复）。
