# Plan: hello-fjs 画布示例「鹈鹕骑行」

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | 页面只用 `docs/canvas-compat.md` 标 ✅ 的 2d API 与两端都派的 `@resize` / `@tap`；同一份 `.vue` 跑 `fjs dev --web` 和 `fjs run android`，不写任何平台分支 |
| II 边界即契约 | 不涉及 | 三张表（op 协议 / natives / 事件类型）零改动 |
| III 同步单线程零序列化 | 不涉及 | 纯 JS 绘制 + rAF，无宿主调用 |
| IV 外观照 WeUI | 不涉及 | 不改内置组件默认样式；示例画面配色是内容不是组件外观 |
| V 静默失效是 bug | 涉及 | 不用标 ❌ 的 API（`roundRect`/`getImageData`/`filter`），写了会 `warnOnce` 或直接类型报错 |
| VI 注释记录权衡 | 涉及 | 页面注释记录「为什么在 @resize 画」「为什么用 now 差值累积」「为什么每帧全量重画」这类权衡，密度对齐 `webgl.vue` |
| VII JS 能包就不要下 Dart | 不涉及 | 零新能力，全部现成 |
| VIII 变更落到文档 | 不涉及 | 不改能力面；`docs/canvas-compat.md` 已覆盖本页用到的每条 API |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 示例页面（唯一改动） | `examples/hello-fjs/src/pages/example/canvas/pelican.vue` | 新建：`<route>` 块 + 2d 绘制 + rAF 循环 + 点按切速 |
| CLI / 构建 | — | 不改。`<route>` 块由现有路由表生成机制收集，`canvas` 分包按目录前缀自动包含 |
| JS runtime | — | 不改 |
| Web 适配层 | — | 不改 |
| C++ 引擎 | — | 不改 |
| Dart 宿主 | — | 不改 |
| 文档 | — | 不改（VIII 不触发） |

## 3. 方案

**选定**：单文件页面，结构照 `webgl.vue`（Panel + canvas + `@resize` 首绘），
绘制分层为 背景（视差云/地面）→ 自行车（车架 + 转动的脚踏/轮辐）→ 鹈鹕
（身体/翅膀/蹬腿/叼鱼），全部 `arc`/`bezierCurveTo`/`fill`/`stroke` 手绘。
动画时钟：rAF 的 `now` 差值乘速度系数累积进 `t`，差值封顶 100ms 防切页
回来暴走；每帧 `reset()` + 全量重画——场景就十几个 path，脏矩形的复杂度
不值得。交互：`@tap` 切换 `speed`（1 ↔ 2.5），reactive，每帧读取即时生效。
`onBeforeUnmount` 里 `cancelAnimationFrame`，防止页面销毁后循环空转。

**被否掉的备选**：
- *用 animejs / pixi*：本页的存在意义就是「零依赖」，引库即失去示范价值
  （且 spec Non-goals 明令）。
- *只画静态一帧（像 `/comp/canvas` 组件页）*：组件页已经演示了静态图块；
  示例页要演示的是「会动的东西怎么组织循环」，静态版不解决问题。
- *脏矩形 / 离屏缓存*：画布逻辑尺寸下全量重画成本可忽略，先写正确再谈快；
  缓存会让「每帧画什么」的示范代码被拆散。
- *新建 `fjs-runtime` 里的动画工具*：组织性能力但没有任何复用方，属于
  为示例造框架，违 VII 精神。

## 4. 风险

- **rAF 泄漏**：页面被路由转场卸载后循环还在跑 → 访问已卸载 context 报错。
  以 `onBeforeUnmount` 取消 + 验收里「离开页面控制台无报错」覆盖。
- **onMounted 拿不到尺寸**（App 侧 0 尺寸首绘会留下保留式残影）→ 首绘只
  挂 `@resize`，和 `webgl.vue` 同款守卫（`shown` 标志防重复起循环）。
- **两端构图不一致**：只用 ✅ API、不画文字（measureText 两端亚像素差）、
  不用 shadow/`globalCompositeOperation`，从源头避开已知差异表。
- **`@tap` 在外层 `scroll-view` 里被抢**：画布给 `touch-action: none`
  （canvas-compat §9 的现成处方），本页画布固定高度、页面本身可滚动，
  只需按处方写样式。

## 5. 验证路径

```bash
pnpm --filter hello-fjs run typecheck
pnpm --filter hello-fjs run build
pnpm --filter hello-fjs run build:mp        # 确认落进 canvas 分包
# 人工：pnpm --filter hello-fjs run dev:web → 示例 → 画布演示 → 鹈鹕骑行
#       动画流畅、点画布切速、离开页面无 rAF 泄漏
# 人工：fjs dev + fjs run android 同路由对拍
```
