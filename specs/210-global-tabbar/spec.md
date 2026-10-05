# Spec: 全局 tabbar + Vue 自定义（悬浮胶囊，仅 tab 页显示）

- **ID**: 210-global-tabbar
- **状态**: in-progress
- **日期**: 2026-10-05

## 1. 要解决什么

hello-fjs 的 tabbar（`src/components/TabBar.vue`）源码虽然只有一份，但框架
的页面模型是"一个路由页 = 一个独立 Vue app + 一份 shell"（`app/web.ts`
L243 注释、`router/flutter.ts` 的 vdomPageMounter），shell 里的 tabbar 随之
**运行时每页各挂一份**。后果：

1. push 二级页后 tabbar 整体消失——做不了 App Store 那种"push 详情页
   tabbar 仍在、高亮留在原 tab"的常驻形态（用户给的参考截图）。
2. tabbar 永远不是全局唯一实例：角标、动画等跨页状态没有落脚点。
3. 想换 tabbar 形态（如悬浮胶囊）只能改每页共享的 shell，没有框架级的
   "自定义 tabbar"概念。

## 2. 不做什么（Non-goals）

- **不做 mp 端 custom-tab-bar**（微信 `"custom": true` + `custom-tab-bar/`
  编译管线）。mp 端维持现状：`meta.tab` 生成原生文字 tabBar，Vue TabBar
  组件继续被 `fjs.mp.excludeComponents` 剔除。框架 tabBar 选项在 mp 构建
  下忽略，登记进文档。
- **不新增内置 `<tabbar>` 标签**——不动 tags.json / op 协议 / natives。
  tabbar 是应用层 Vue 组件，框架只提供挂载机制。
- **不做内置默认外观的 tabbar 组件**。外观始终由应用的 Vue 组件决定；
  hello-fjs 的 TabBar.vue 顺带改成 App Store 悬浮胶囊风作为示范。
- **不做自动内容 inset**。悬浮 bar 下方内容由页面自己留白（与 web 固定
  底栏惯例一致）。
- **不做 Flutter 毛玻璃**。`BackdropFilter` 需要原生渲染能力，web 端用
  `backdrop-filter`，App 端半透明纯色，差异登记 docs。

## 3. 用户可见的行为

```ts
// main.ts —— 不传 tabBar 时行为与现在完全一致
createFjsApp({
  routes,
  shell: Shell,
  tabBar: { component: TabBar },
});
```

```vue
<!-- TabBar.vue：props 由框架注入；切 tab 仍用 router.replace（基页原地换 + park 保活） -->
<script setup>
const props = defineProps<{
  tabs: { path: string; title: string; tab: number }[]; // 路由表派生，按 tab 序号排序
  active: number | null; // 当前 tab 页的 meta.tab；bar 只在该值非空（tab 页）时显示
}>();
</script>
```

- tabbar 全局唯一，**悬浮在 TabGroup 底部**（fixed 层，不占页面高度，内容
  从 bar 底下滚过）：web 是 `#app` 里 `fjs-page-host` 之后的
  `fjs-tabbar-host`（absolute），App 是基页 FjsView 的 Stack 里
  `Positioned(bottom)` 的 `fjs-tab-bar-host` 专用根。不走 app 级 overlay
  宿主——overlay 版目测有切换闪烁（浮层随 op 批次重绘 + 胶囊透出页面
  切换），用户先后改定 TabGroup 挂载与悬浮形态；Dart 侧只学一条布局规则。
- **只在 tab 页显示**（tab group，微信语义）：push 二级页整页盖住 TabGroup
  （Flutter 是真路由覆盖，web 是 surface display:none）、返回 tab 页恢复。
  目测阶段用户还把初版的"常驻（App Store 式）"改定为该语义——App Store 式
  最终只保留在了**外观**（悬浮胶囊）上。全屏 tab 页可再配
  `<route>` meta `"tabBar": false` 单独隐藏。
- 页面级模态弹层画在页面内容之上，天然盖住 bar，两端一致，无特判。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| TabGroup | 基页 FjsView 的 Stack：页面区铺满 + `fjs-tab-bar-host` 根 `Positioned(bottom)` 悬浮 | `#app` 内：`fjs-page-host`（flex:1 铺满）+ `fjs-tabbar-host`（absolute 悬浮） |
| 页面高度 | bar 不占布局高度，内容从 bar 底下滚过（widget 测试钉住） | 同左（absolute） |
| push | 二级页是真 Navigator 路由，整页盖住 TabGroup（含 bar）；bar 不做隐藏/恢复动作，pop 揭开即在原位 | web 同构：bar 常驻，二级页入口 `data-covers-bar` 抬到 bar 之上 |
| 页面模态 | OverlayPortal 画在页面内容之上，盖住 bar | `z-index` 盖住 bar——两端结果一致 |
| 返回 | bar 在页面路由里，与返回守卫无涉 | 无系统返回概念 |
| 毛玻璃 | 无模糊 tag → 半透明纯色（已知差异，登记 docs） | `backdrop-filter` |
| mp | 原生 tabBar 照旧，tabBar 选项忽略 | — |

## 5. 契约变更（宪法 II）

- [x] 都不涉及——无新标签、无 op 协议 / natives / 事件表改动。新增的
      `fjs-tab-bar-host` 保留根与 `__tabBar` prop 走既有 setProps 通道
      （`__appOverlay` 同款）；Dart 侧唯一改动是 FjsView 的停靠布局规则。

## 6. 验收标准

1. `pnpm run typecheck` 全 workspace 通过。
2. `pnpm test` 通过；新增 runtime vitest：tabbar 单例挂载（#app 内、
   fjs-page-host 之后）、push 后隐藏 / 返回恢复、`meta.tabBar: false` 隐藏。
3. `cd packages/flutter_fjs && flutter test` 通过；新增 widget 测试：bar
   悬浮在底部且不占页面高度（页面内容位置不变）、push 整页盖住（offstage
   不可命中）、display:none 消失不占位。
4. `fjs dev`（web）+ `fjs run ios`：四个 tab 切换保活、切 tab bar 不闪烁
   （目测确认）、二级页无 bar、`meta.tabBar: false` 页全屏、深色模式正常。
5. 不传 tabBar 的应用（demo）行为与改前一致。

## 7. 待澄清

- 可见性与挂载形态各改向，均为用户目测后拍板：
  1. 可见性：计划阶段定"常驻（App Store 式）"→ web 目测后改定"**仅 tab 页
     显示**（tab group，微信语义）"。
  2. 挂载：初版走 app 级 overlay 宿主（游离根 fixed 提升）→ 用户指出切换
     闪烁，改定"**TabGroup，不用 overlay**"。
  3. 形态：TabGroup 第一版做成 in-flow 停靠（bar 占一行布局）→ 用户指出
     "fixed 底部的 bar 不该影响页面高度"，改定"**Stack 内悬浮**"。App
     Store 式最终保留：外观（悬浮胶囊）+ 不占页面高度；仅 tab 页显示维持
     微信语义。
  4. push 的收放：初版由 JS 按"当前路由非 tab"收起 → 用户指出 app 返回
     动画期间 bar 消失（navPop 两段式滞后，specs/003），改定"**被覆盖平台
     不收**"——Flutter 上 bar 常驻 group 内、由 push 的路由整页盖住，pop
     揭开即在原位；web 起初维持 push 期间自隐藏，用户指出两端逻辑须一致，
     改为"**web 也常驻 + 二级页盖住**"（页面入口 `data-covers-bar`，样式表 z-index 高于 bar）。
- 其余一项（mp 本轮不动）维持原拍板。

## 8. 增补：safe-area `scale` 与 padding 覆盖（用户目测后追加）

App Store 式浮动胶囊压进 Home 指示条区域，比"整条 inset 让出"更低（iPhone
34pt 的 inset 全让出 + 胶囊自带间距偏高）。给 `<safe-area>` 两个能力：

1. `scale`（0–1，缺省 1）：各被让出的边取 inset × scale。`scale="0.5"` =
   只让出一半。Flutter / web / mp 三端同义。
2. 显式 padding 覆盖：`<safe-area>` 的 style 声明了某边 padding（`padding`
   简写或 `padding-bottom` 等长手），该边不再取 inset，直接用声明值——与 CSS
   里"作者样式覆盖默认"一致。Flutter / web 实现；mp 的 wx 组件看不到宿主
   style，本轮不支持（登记 docs/miniprogram.md）。

验收：flutter test（scale、覆盖）；vitest（web scale 变量）；hello-fjs 的
TabBar 用 `scale` 后 iOS 截图胶囊更贴底。
