# Plan: app-store-clone —— iOS App Store 交互与样式复刻示例

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 全部页面源码一份（`examples/app-store-clone/src`），Flutter 走 `fjs dev` / `fjs run`，Web 走 `vite`。示例**不新增**任何运行时能力：Flutter 侧用既有 `lib/src/` 渲染 + `packages/fjs-liquidglass/flutter` 的玻璃 widget，Web 侧用既有 `fjs-runtime/src/web/` + `GlassSurfaceWeb.vue`。两端不一致处（玻璃折射仅"有无"、`transition-delay` 对尺寸类 App 端不生效）已在 `docs/css-compat.md` 登记，落地时对拍后补新发现的差异 |
| II 边界即契约 | 否 | 三张表（ops / natives / 事件）都不动：示例只用既有标签与事件。若实现期发现必须改，**停下来另开 spec**，不在本 spec 内动协议 |
| III 同步单线程零序列化 | 否 | 纯页面代码；下载进度用 `setInterval`/`requestAnimationFrame` 驱动本地 state，不引入桥或 Worker |
| IV 外观照 WeUI | 破例（有理由） | 本示例的目标是**对标 iOS App Store**，不是 WeUI 内置组件的默认样式。示例的样式只写在示例自己的 CSS 里，不改任何内置组件的默认值；`pressed` 缩放、胶囊按钮等不进 `fjs-runtime/src/components/`，所以不与宪法 IV 冲突 |
| V 静默失效是 bug | 是 | 示例里用到的样式（`linear-gradient`、`box-shadow`、`transform`、`transition`）都在 css-compat 的 ✅/⚠️ 内；`backdrop-filter` 只经 `<glass-surface>` 使用，不直接写。用到 ❌ 项就换写法，不依赖告警被吞 |
| VI 注释记录权衡 | 是 | 示例里非显然的取舍（为什么展开卡片是同页面 overlay、为什么飞行盒飞渐变盒子而不是 `<image>`、为什么「每 3 行一组」用 `swiper` 而不是 `scroll-view`）都写英文注释，格式照 `hero.ts` 顶部 |
| VII JS 能包就不要下 Dart | 否 | 零 Dart 改动。玻璃面是既有模块，卡片/胶囊/列表行/分页全是 Vue 组件 + 既有标签（`view` / `text` / `image` / `scroll-view` / `swiper` / `safe-area` / `glass-surface`） |
| VIII 变更落到文档 | 是 | 见 §2「文档」行：`AGENTS.md` 仓库地图加一行；`docs/css-compat.md`、`docs/web.md` 仅在对拍发现新差异时追加；`docs/roadmap.md` 无对应条目则不动 |

## 2. 涉及的层

不改任何 `packages/`。全部改动在新示例与文档里。

| 层 | 文件 | 改什么 |
|----|------|--------|
| 工程骨架（新增） | `examples/app-store-clone/package.json` | 包名 `app-store-clone`；scripts 照 `examples/racing/package.json`（`dev` / `dev:web` / `build` / `build:web` / `build:release` / `run:ios` / `run:android` / `typecheck`）；依赖 `vue 3.5.43`、`@ufjs/liquidglass`（`workspace:*`，已在 `pnpm-workspace.yaml` 的 `examples/*` 覆盖内）；**不依赖 `@ufjs/iconmind`**（实现期发现：它是 AI 主题图标集，没有报纸/火箭/层叠/手柄/放大镜，改用内联 SVG） |
| 工程骨架（新增） | `examples/app-store-clone/{index.html,vite.config.ts,tsconfig.json,app.config.ts}` | 照 `examples/racing` 同名文件；`app.config.ts` 竖屏、仅 `INTERNET` 权限；`tsconfig` 带 `@ufjs/runtime/volar` 插件与 `strictTemplates` |
| 入口（新增） | `examples/app-store-clone/src/main.ts` | `createFjsApp({ routes, plugins, shell, tabBar, transition: 'fjs-slide' })`；照 `examples/hello-fjs/src/main.ts` 注册 `@ufjs/liquidglass` 的 `liquid-glass` tabBar 风格（模块自注册，示例只引用） |
| 外壳（新增） | `examples/app-store-clone/src/Shell.vue` | 白底（`#FFFFFF` / 分组灰 `#F2F2F7`）铺满；tab 页给滚动内容补底部留白（照 `hello-fjs/src/Shell.vue` 的 `withBar` 判定）；无导航栏（App Store 是大标题，不用 NavBar） |
| tabBar（新增） | `examples/app-store-clone/src/components/TabBar.vue` | 照 `hello-fjs/src/components/TabBar.vue`，只留 `liquid-glass` 一档；`safe-area edges="bottom" :scale="0.5"`；图标全部用 `src/components/Icon.vue` 内联 SVG 路径（Today / 火箭=游戏 / 层叠=App / 手柄=Arcade / 放大镜=搜索，另含云下载、分享、星、返回、✕） |
| 页面（新增） | `examples/app-store-clone/src/pages/index.vue`（Today，`"tab": 0`）、`games.vue`（`"tab": 1`）、`apps.vue`（`"tab": 2`）、`arcade.vue`（`"tab": 3`）、`search.vue`（`"tab": 4`） | 5 个 tab 页；`<route>` 块写 `{"title":"…","tab":N}`（路径约定见 `hello-fjs/src/pages/about.vue:1-3`）；`games` / `apps` 共用 `FeaturedPage.vue` 骨架，数据不同 |
| 页面（新增） | `examples/app-store-clone/src/pages/detail.vue`（原 `app/[id].vue`，改 query 传 id：Flutter 路由按具体路径查页面，动态段解析不了，见 tasks.md） | 应用详情，`"tabBar": false`；动态段 `params.id`（`docs/routing.md` §「取参」），非法 id `router.replace('/')` |
| 组件（新增） | `src/components/`：`LargeTitle.vue`（大标题 + 头像）、`Avatar.vue`、`StoryCard.vue`、`AdCard.vue`、`ListCard.vue`、`CardExpand.vue`（同页面展开 overlay）、`ChipRow.vue`（分类胶囊横滑）、`FeaturedSwiper.vue`（精选大图 `swiper`）、`AppRow.vue`、`AppRowPager.vue`（每 3 行一组横向分页）、`GetButton.vue`（获取/打开/云/下载中）、`SectionTitle.vue`、`GlassCircleButton.vue`（返回/分享/✕）、`BrowseCard.vue`、`SearchBox.vue`、`InfoStrip.vue`（详情信息栏）、`StarRating.vue`（内联 SVG） | 每个组件自带 scoped 样式；按下态统一用 `:active` + `transform: scale(.96)` + `transition: transform .2s`（`docs/ui-api.md:632` 的 `:active` 两端都有） |
| 数据（新增） | `src/data/apps.ts`、`src/data/stories.ts` | 虚构应用名/开发者/文案、渐变色对、emoji 占位；`apps.ts` 导出 `{ id, name, subtitle, developer, rating, age, rank, gradient, emoji }[]`；**不含任何 Apple 真实素材与真实商标** |
| 状态（新增） | `src/store.ts` | `installState: Record<id, 'none'\|'cloud'\|'downloading'\|'installed'>`（`reactive`）；`download(id)` 用 `setInterval` 推进进度到 100% 后置 `installed`；页面销毁时清定时器 |
| 展开动画（新增） | `src/hero.ts` | **拷贝** `examples/hello-fjs/src/hero.ts` 的 `Rect` / `FLY_MS` / `CLOSE_MS` / `rectOf`，去掉跨页登记表（本示例的展开是同页面 overlay，不需要）；顶部注释说明来源是 spec 101 |
| 展开动画（新增） | `src/components/HeroBox.vue` | 参照 `hello-fjs/src/components/HeroFly.vue` 的起飞时序（rAF 测距 → 隔一个 `setTimeout` 再切终点、`left/top/width/height` 几何 `transition`、`cubic-bezier(.32,.72,0,1)`），但飞的是**渐变 `view`**（圆角同步从 20px 过渡到 0），不是 `<image>` |
| 文档 | `AGENTS.md` §2 仓库地图 | 加一行 `examples/app-store-clone`（Vue，iOS App Store 复刻示例，同源跑 Flutter 与 Web；改动前必读：`specs/217-app-store-clone`） |
| 文档 | `docs/css-compat.md` / `docs/web.md` | 仅当两端对拍发现新差异时追加到各自差异表；没有则不动 |

已用 Glob/Read 确认真实存在的参照物：`examples/racing/{package.json,vite.config.ts,tsconfig.json,index.html,app.config.ts,src/main.ts}`、`examples/hello-fjs/src/{main.ts,hero.ts,Shell.vue,components/TabBar.vue,components/HeroFly.vue,pages/about.vue}`、`packages/fjs-liquidglass/{index.ts,components/GlassTabBar.vue,components/GlassSurfaceWeb.vue}`、`pnpm-workspace.yaml`（`examples/*` 已覆盖新目录）。

## 3. 方案

**整体**：新建独立示例工程，页面/组件/数据全在示例内；`packages/` 零改动。玻璃面（tab 栏、卡片底条、✕/返回/分享圆钮）统一走 `<glass-surface>`，其余视觉全是既有 CSS（渐变、阴影、圆角、`transform`/`transition`）。

**路由与 tab**：5 个 tab 页 `meta.tab` 0–4，由全局 tabBar（specs/210）显示，切页 `router.replace`，tab 页保活（`docs/routing.md` §「tab 页会被保活」）。应用详情是 `/app/:id` 的 push 页，`"tabBar": false`，默认转场 `fjs-slide`（iOS 右滑，手势返回由平台给）。

**Today 卡片展开（选定：同页面 overlay + 共享元素飞行盒；实现期修订：展开层常驻挂载 + `v-show`，飞行盒用 `absolute` 而非 `fixed`，卡片不做 opacity 隐藏，原因见 tasks.md「iOS 模拟器验收」）**：
1. 点卡片 → 页面里 `rectOf(cardRef)` 取视口矩形；
2. 挂一个 `position: fixed` 的 `HeroBox`，初始几何 = 卡片矩形、渐变与圆角同卡片；
3. 隔帧切到终点（全屏、圆角 0），完成后淡入详情内容（标题/正文/列表），右上角 `GlassCircleButton`「✕」；
4. 收起：内容先淡出，`HeroBox` 回飞到**重新测距**的卡片矩形（同页面，卡片就在原位，测距可靠），落地后卸载、卡片真身恢复。
选同页面而不是 push 一个新路由，是因为 spec 101 的跨页登记表要处理"压栈页 offstage 后测距不可靠"，这里的展开不需要它。

**分页（实现期修订）**：核对 `docs/ui-api.md` 的 `swiper` 属性表，没有露边/页间距，做不出「下一张露出一截」。精选大图卡与「每 3 行一组」都改用 `scroll-view scroll-x` + 固定卡宽（屏宽 − 约 40px），下一张天然露边；**不做吸附**（scroll-view 无 snap 属性），登记为与 iOS 的已知差异。

**按下态**：不写 JS 手势，只用 `:active` 选择器（两端都有），`transform: scale(.96)` + `transition: transform .2s`。

**素材**：全部本地占位——`linear-gradient` 渐变块 + emoji 文本 + 内联 SVG（云下载、分享、星、放大镜）。不放任何位图文件。

### 被否掉的备选

| 备选 | 否掉的原因 |
|---|---|
| 在 `hello-fjs` 里加一页 | hello-fjs 是组件画廊，tab 栏/路由已被占用；App Store 需要自己的 5 tab 与大标题外壳，混进去会污染画廊且无法单独 `run` |
| 展开用 push 新路由 + 跨页 `hero.ts` 登记表 | 需要处理 offstage 测距与飞行开关；同页面 overlay 同样满足"展开/收起"观感且少一层状态（见 §3） |
| 展开只做路由淡入（`fjs-fade`） | 用户已选共享元素；且淡入不能检验"几何 transition + 玻璃 + 圆角同时动画"这个组合场景 |
| 示例里自搭 tab 栏（不复用 `GlassTabBar`） | 用户已选复用；重搭会复制 specs/212 的滑块动画与 safe-area 处理 |
| 玻璃效果用 `backdrop-filter` 直接写 | css-compat 登记 ❌（App 端不支持），会静默失效（宪法 V）；必须经 `<glass-surface>` |
| 下 Dart 做原生 `PageView` 吸附 / 弹性按下 | 违反宪法 VII；`swiper`、`:active`、`transition` 已覆盖需求 |
| 同时做小程序端 | spec §2 已划出；mp 端 tabBar/玻璃/共享元素各有一套不同路径（`docs/miniprogram.md`），另开 spec |
| 抓取 Apple 真实图标/截图 | 版权与商标问题；改用占位 |

## 4. 风险

1. **`swiper` 露边**：采集里下一张卡露出约 24px。需确认 `swiper` 是否有前后边距属性；没有就近似（缩窄页宽 + 整体左边距），并在 §6 对拍时记差异。**会静默表现为"看不到下一张"**，目测验收 #6 必须看。
2. **飞行盒带圆角过渡**：`border-radius` 不在 css-compat `transition` 支持列表里（`transform` / `opacity` / 颜色 / 尺寸 / padding / margin / inset）。圆角 20px → 0 的过渡**App 端可能不动**。预案：飞行期固定 20px 圆角，落地后瞬切 0（全屏时圆角被屏幕裁掉，肉眼几乎不可见）；web 用同一写法保持两端一致。
3. **渐变背景跳变不动画**（css-compat：gradient 背景跳变不动画）：飞行盒从卡片渐变到详情背景时，若详情背景换渐变会瞬切。预案：飞行盒始终保持卡片渐变，详情内容用 `opacity` 淡入叠在上面。
4. **`transition-delay` 在 App 端对尺寸类不生效**：飞行盒不使用 delay，错峰用 `setTimeout`（同 `HeroFly.vue`）。
5. **iconmind 图标名不全**：tab 图标需要的"火箭 / 层叠 / 手柄"可能没有。预案：缺的用内联 SVG（`svg` 标签两端都支持，但**不支持 `url(#…)` 渐变引用**，只用纯色填充）。
6. **`<glass-surface>` 叶子元素**：不排版子节点，内容必须是 `position: absolute` 玻璃层的兄弟节点（specs/212 §3.1）。卡片底条、圆钮都按这个结构写，别把文字放进 glass-surface 里。
7. **玻璃在 App 端的性能**：Today 上同时挂多个玻璃面（tab 栏 + 每张卡的底条）+ 滚动。需要在真机上看掉帧；退路是只在可视卡片上挂玻璃条，或降 `refraction=0`（standard 档）。
8. **滚动与按下态冲突**：卡片 `:active` 缩放在开始滚动时应回弹。Flutter 手势竞技场可能让 `:active` 卡住（见 `form` 先例）。验收 #5 要在真机上长按 + 拖动各试一次。
9. **iOS Safari / Web 安全区**：web 没有 Home 指示条 inset，tab 栏会贴底；照 `hello-fjs/TabBar.vue` 对 web 端显式 `paddingBottom: 20px`。
10. **多会话抢 `dist/app`**：同目录并行起 `fjs dev` 与 `fjs run` 会污染（项目记忆「一项目一个 dev server」）；并行验证走 worktree。

## 5. 验证路径

```bash
pnpm install                                   # 新示例入 workspace
pnpm --filter app-store-clone run typecheck    # 验收 #1
pnpm run typecheck && pnpm test                # 验收 #2：不因新增示例变红
pnpm --filter app-store-clone run dev:web      # 验收 #3：浏览器逐页对照 iPhone 镜像截图
pnpm --filter app-store-clone run build:web    # 验收 #10（Web 产物）
pnpm --filter app-store-clone run build:release # 验收 #10（Flutter 产物）
cd examples/app-store-clone && fjs run ios     # 验收 #4–#9：真机/模拟器逐项目测
# 产物里不含 Apple 素材
find examples/app-store-clone/src examples/app-store-clone/public -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.webp' \) 2>/dev/null
# 不含 gc() 调用
grep -rn '\bgc()' examples/app-store-clone/src
```

验收 #5（卡片按下/展开/收起）、#6（`swiper` 露边与分页）、#7（获取→下载中→打开）为交互项，**必须真机或模拟器上手点**，只看 web 不算数（风险 #2、#8 只在 App 端暴露）。
