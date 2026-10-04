# Spec: nested-scroll-header / nested-scroll-body 三端支持

- **ID**: 208-nested-scroll-header-body
- **状态**: in-progress（web / App / mp-webview 已验证；skyline offset-top 待查，见 §7 末条）
- **日期**: 2026-10-04

## 1. 要解决什么

微信小程序 Skyline 的嵌套滚动组件（基础库 3.2.0+）：

- `<scroll-view type="nested">`：嵌套滚动宿主；
- `<nested-scroll-header>`：头部，随上滑先收起，只渲染第一个子节点；
- `<nested-scroll-body>`：滚动体，头部收起后里层滚动接管，只渲染第一个子节点；
  属性 `offset-top`（px，默认 0）：收起终点距顶部的距离，到达后里层才开始滚动
  （3.6.2+）。

两者只能作为 `type="nested"` scroll-view 的**直接子节点**。目前 fjs 三端都不认识
这两个标签（Vue 会当成未知组件，mp 透传给 wx 后 skyline 原生可用但
`INJECTED_ATTRS` 会注入 `type="list"` 冲掉 nested、并包 `.fjs-scroll-inner`
破坏直接子级约束）。本 spec 让同一份页面源码在 web、App、mp（skyline +
webview 两种渲染方式）上都有可用的嵌套滚动。

## 2. 不做什么（Non-goals）

- 不做 nested scroll-view 的 `refresher-*` 下拉刷新族（skyline 专属属性，
  specs/206 的 `refresh` 标签已覆盖该场景）。
- 不做横向嵌套滚动（wx 嵌套滚动只有纵向；App 端检出横向告警）。
- 不做 `scrollend` 事件（wx nested 有，但三端对齐是新事件号，另立 spec）。
- 不改 sticky / refresh 既有行为。

## 3. 用户可见的行为

页面代码不变（与 wx 官方示例同形）：

```vue
<scroll-view type="nested" scroll-y class="page">
  <nested-scroll-header>
    <view class="hero">头部</view>
  </nested-scroll-header>
  <nested-scroll-body :offset-top="88">
    <scroll-view scroll-y class="list">
      <view v-for="i in 30" :key="i" class="row">条目 {{ i }}</view>
    </scroll-view>
  </nested-scroll-body>
</scroll-view>
```

- 上滑：header 随手势收起，收起完成后列表行继续滚动，一气呵成；
  `offset-top=88` 时收起终点是 header 底部 88px 保持可见（相当于钉住一条
  尾巴），列表在其下方继续滚。
- 反向下拉：列表先回到顶，header 随之展开。
- header / body 里第二个及之后的子节点不渲染（与 wx 一致）。
- 多个 `nested-scroll-header` 依次排布、一起收起，尾部 `offset-top` 归属于
  最后一个 header。
- 外层 scroll-view 的 `@scroll` / `@scrolltolower` / `@scrolltoupper` 照常。

## 4. 两端约定（宪法 I）

| | App (Flutter) | Web | mp skyline | mp webview |
|---|---|---|---|---|
| 滚动模型 | 单一 CustomScrollView，sliver 路由（照 specs/052 sticky 先例按直接子级分流）；body 内**纵向滚动容器被吸收**进外层滚动 | 单一滚动容器（scroll-view 原生 overflow）；body 直接子级 scroll-view/list-view 用 CSS 吸收进外层 | 原生 nested，原样透传（不注入 type/enable-flex、不包 fjs-scroll-inner、页面根不降级） | 编译期降级：header/body → view（只留第一个子节点），body 直接子级 scroll-view/list-view → view（单一滚动，视觉等价） |
| offset-top | 实现（自定义收起 sliver：钉住尾巴） | 实现（header 负 top sticky 钉尾） | 原生透传 | 实现（runtime 组件负 top sticky，见 §7） |
| 已知差异 | body 内被吸收的 scroll-view 不再有独立滚动位置：`scroll-top`/`scroll-into-view`/内部 `@scroll` 无效 | 同左；body 内透明尾巴处列表行会"透过"绘制（App 用钉住绘制压住，wx 是裁剪） | — | offset-top、独立内层滚动位置无效 |

吸收语义是三端（App/web/webview）共同的有意取舍：单一滚动换来连续惯性和
正确的外层事件；skyline 保持原生独立内层滚动。登记在 `docs/ui-api.md`。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型（无新事件号；嵌套标签本身无事件）
- [x] 暂定都不涉及（`tags.json` 加两个标签名不属三张边界契约表）

## 6. 验收标准

1. hello-fjs 新增 `comp/container/nested-scroll.vue`（基准/对照项目，用户
   指定），`fjs dev --web`：上滑 header 收起 → 列表继续滚一气呵成；第二个
   子节点不可见；`@scroll` 正常。
2. `fjs run ios`（App）同页对照 web：同样的收起/续滚行为；`offset-top` 场景
   尾部钉住。
3. `pnpm test`：
   - `packages/fjs/test/mp-compiler.test.ts` 新增 skyline（透传 + 不注入 +
     不包装 + 根不降级）与 webview（降级 view + 只留首子 + 内层降 view +
     丢弃 offset-top）用例；
   - `packages/fjs-runtime/test/` 新增 web 组件测试（首子可见性、吸收、
     offset-top clamp）；
   - `packages/flutter_fjs/test/` 新增 widget 测试（静止布局、收起、钉尾、
     吸收、外层事件）。
4. `pnpm --filter hello-fjs run typecheck`、`pnpm test`、`pnpm --filter
   @ufjs/cli run build`（tags.json 内联，AGENTS.md §4.6）全过。
5. mp skyline 真机/工具验证透传产物不破坏直接子级（编译测试覆盖，真机由
   用户复核）。
6. docs 同步（宪法 VIII）：`docs/ui-api.md`（新标签 + `type="nested"` +
   已知差异）、`docs/miniprogram.md`（skyline/webview 分流表）。

## 7. 过程发现

- 自定义收起 sliver 第一版用 `SliverGeometry.paintOrigin` 平移钉尾，被
  viewport 的几何校验拒绝（`paintOffset + paintExtent` 超出
  `remainingPaintExtent`）。SDK pinned header 的真实机制是三件套：
  `layoutExtent` 归零（放行后续 sliver 上滑）+ 子项 `paintOffset` 钳制在
  `-(高-尾)` + `childMainAxisPosition` 同步钳制（命中测试跟随）。
  `scrollExtent` 保持全高，body 的静止位置不受钉尾影响。
- 被吸收的 scroll-view 若保留页面写的 `height` 样式，自然高的列会被压进
  该高度里溢出 1600px。为此给 `decorateNode` 加了 `ignoreHeight` 参数，
  `_ScrollViewNodeAdapter.decorate` 在吸收作用域下走它（web 侧对应的
  `height: auto !important`）。
- `tags.json` 加标签会连带三处类型/表：`event-emits.ts`（WEB_EMITS，
  钉子测试对比 web 组件 emits）、`vue-global.d.ts`（GlobalComponents 双拼
  写 + IntrinsicElements，css-support.test.ts 钉死）。
- hello-fjs 页面第一版给 `.nest` 写了 `overflow: hidden`（想配圆角），把
  base-css 的 `overflow-y: auto` 盖掉，容器不可滚、滚轮漏到页面——CSS 层
  通用坑，与实现无关，页面已去掉。
- web 实测（hello-fjs，滚轮驱动）：滚到收起终点后 `scrollTop` 钉在 212
  （= hero 300 − offset-top 88），body 顶部视口坐标 212 = 容器顶 124 + 88，
  `@scroll` 载荷 `{"scrollTop":212,...}` 照常上报。
- `hello-fjs` 的 `fjs build --mp` 发射 0 个产物文件是**既有状况**：构建实际
  exit 1（管道里 `tail` 吃掉了退出码才显得"正常"）——list-view.vue 等
  画廊页面用 flex-grow 链撑高度，过不了 skyline 的 scroll-view 显式高度
  检查。修复走页面侧（`.list` 补 `height: 0px`，编译器建议写法）+ 收敛：
  `mp.exclude` 排除非演示页（package.json `fjs.mp.exclude`，注意 readConfig
  读的是 package.json 的 fjs 字段而非 app.config），`preloadRule` 里指向
  `/example` 的规则随之移除。恢复全量构建 = 逐页补高度并还原这两处。
- **用户在开发者工具复核 skyline 抓到两处页面形状问题**（产物透传本身
  正确，是页面没贴 skyline 正典形状）：① body 内层 scroll-view 被我写了
  固定 `height: 400px`——skyline 的 nested 布局负责把内层撑开/收缩，固定
  高让内层自己滚自己的，外层收起不接力（"头部和 body 分离滚动"）；②
  panel 2 的 body 里放的是普通 view——skyline 的 body 由里层滚动容器承载
  内容，普通 view 超出 body 高度直接被裁（"只能滚到 6"）。修法都是回归
  官方示例形状：内层不写高度 + body 里放 `type="list"` 的滚动容器；
  web/App 端这些写法被吸收语义消化，无感。连带给 mp 高度检查加了豁免：
  `nested-scroll-body` 直接子级的 scroll-view 免检（官方示例即无高度），
  mp-compiler 用例。webview 渲染器同样过（用户切 renderer 后复核）：标签
  全降级、外层 retype list、内层 flatten 成 view，编译测试双渲染器端到端
  各锁一条（mp-compiler 90 用例）。
- **开发者工具编译产物抓到 WXSS 生成 bug**：`expandFlexGrowBasis`（给
  `flex-grow` 规则补 `flex-basis: 0%` 的 skyline 兼容）把声明拼在规则最
  末尾；list-view 页的 `.fill` 以注释收尾，产物出现 `*/;` ——浏览器容忍的
  空语句，WXSS 直接报 unexpected token。修法：拼接前识别**末尾注释串**，
  basis 插到注释之前（注释保留）。这条 bug 一直存在，只是 hello-fjs 的
  mp 构建此前从未成功过、没有产物进过开发者工具。产物扫描 `*/;` 为 0。
- **用户复核 webview 抓到 offset-top 未生效**：第一版 webview 把 offset-top
  一并丢弃（登记为差异）。按 sticky 的 webview 先例（specs/053）补齐：
  header 降级为 runtime 组件 `fjs-nested-scroll-header`（virtualHost +
  CSS sticky 负 top），body 的 offset-top（静态/绑定）在 genSlotContent
  的兄弟数组层搬到 header 标签，组件挂载后 0/200ms 两次测量自身高度定钉线
  （之后不跟随高度变化——登记）。四件套进 RUNTIME_COMPONENTS、skyline 构造
  skip（原生直出）；编译测试 95 条（搬运静态/绑定、无 header 告警、双
  渲染器端到端）。
- **工具链陷阱**：`~/.nvm/.../bin/fjs` 全局命令是 8 月安装的独立 npm 旧包
  `fjs`（非 monorepo @ufjs/cli），对 hello-fjs 只会发射 0 pages。repo 内
  跑构建用 `pnpm build:mp` / `pnpm exec fjs`。
- **用户实测抓到 clamp bug**：web 端第一版 offset-top 用 scrollTop 钳制，
  收起点之后整个滚动被冻住（吸收语义下列表行也在同一个 scroller 里滚，
  钳制把它一起钳死了）。改为 **header 负 top sticky 钉尾**（body 组件持有
  offset-top，对紧邻的前一个 header 设
  `position: sticky; top: offset-top - headerHeight`，ResizeObserver 跟随
  高度），滚动全程原生、可逆；happy-dom 测试 + 浏览器实测双向验证
  （scrollTop 滚到 1436 = maxScroll，header 底边钉在 88px）。

## 8. 遗留（待查）

- **skyline 的 offset-top 未正确生效**（用户在开发者工具复核，基础库
  3.17.3，现象细节待补充）：产物侧 `nested-scroll-body offset-top="{{ 88 }}"`
  已透传、值与单位符合文档（px，3.6.2+）。待复现定位的方向：原生组件对
  绑定形式的 offset-top 是否需要数字类型（当前是 `{{ 88 }}` 数字字面量，
  应已满足）；页面给宿主 `.nest` 写的 `border-radius`/背景是否影响收起
  终点测量；以及与 `.fjs-scroll-inner` 包装（内层的 gap 载体）的相互作用。
  定位后在本文档补「根因与决议」。
