# Spec: 全屏填充链在 mp/skyline 失效——Panel 增加 fill 模式

- **ID**: 209-panel-fill-mode
- **状态**: in-progress
- **日期**: 2026-10-05

## 1. 要解决什么

hello-fjs 的 list-view 演示页（长列表）在 mp/skyline 下列表区零高：页面
渲染出 Panel 的标题、描述和一条约 32px 高的白卡（只剩上下 padding），
200 条列表项一行都不出现，控制台也无任何报错（DevTools 实测
`.page` h=0、`.list` h=0，`.fjs-page-host` h=844）。

根因：页面用一条「页面根 height:100% → `<panel class="fill">` class 穿透
→ 页面 `:deep(.card)` → `.list` flex-grow」的全屏链，其中三个环节恰好踩中
skyline 的三个已知限制，每个都已在本仓库目验过：

1. **百分比高度是 no-op**——百分比不在 skyline `<length>` 支持列表
   （specs/046 T047；本次实测复现：`.page` 改 50% 仍 0 高，改 844px 即生效）。
2. **class 穿透不到组件根**——skyline 自定义组件是虚拟宿主，组件标签上的
   class 落不进组件模板；`mergeVirtualHostAttributes` 曾因基础库报
   「无效」被删（specs/046 T041）。
3. **页面样式进不了组件模板**——页面 scoped 样式（含 `:deep` 生成的
   后代选择器）匹配不到组件模板内的节点（specs/050 rich-text 先例：
   页面 wxss 要 @import 进组件才生效）。页面自有节点（含 slot 内容）
   不受此限。

唯一活着的一环是 `.list` 自己的 `height: 0px`（spec 208 为过编译期高度
检查加的）——它精确生效，于是列表=0 高；skyline 对 0 视口的
`type="list"` scroll-view 不构建任何行。web / Flutter 端这三个构造都
成立，所以只有 mp 坏。

## 2. 不做什么（Non-goals）

- **不做通用的「class 穿透到自定义组件根」编译器机制**（把页面 class 里的
  布局声明内联进组件根 / 重试 mergeVirtualHostAttributes）。影响面大、
  语义有歧义（类冲突、优先级），另立 spec。
- **不改编译器对百分比高度的处理**。mp 页面用 flex 链定高是 specs/046
  定下的基线，本次遵守而不是扩协议。
- **不动 `list-view` 组件本身**（三端行为不变，问题不在它）。
- **不新增编译期告警**（检测 `:deep` 进组件 / 页面根百分比高度）。
  可作为后续改进，本次只把差异登记进 docs/miniprogram.md。

## 3. 用户可见的行为

`Panel`（hello-fjs 的演示小节组件）新增可选布尔属性 `fill`。为 true 时
小节的根与卡片撑满父容器剩余高度，供列表 / 画布这类全屏演示页使用。
撑满样式长在 **Panel 自己的模板与 scoped 样式里**（组件自有样式三端都
生效），页面只传属性、不再依赖 class 穿透与 `:deep`：

```vue
<!-- 期望能这样写：三端同一份源码 -->
<Panel :fill="true" title="200 条数据" desc="切页先完成，列表组件自动按需加载">
  <list-view class="list" :items="rows">...</list-view>
</Panel>
```

页面根补 `flex-grow: 1` 接上 shell `.body`（scroll:false 分支，普通 view，
height:0px + flex-grow，specs/046 T049 同款 0 基数 grow）的 flex 链——
web / App 上与原有 `height: 100%` 并存、结果不变。

## 4. 三端约定（宪法 I）

| | Flutter | Web | 小程序（skyline / webview） |
|---|---|---|---|
| `fill` 撑满 | `.section--fill` / `.card--fill` flex-grow，行为同现状 | 同左 | 组件 scoped 样式生效（此前整链 no-op，列表 0 高） |
| 页面根 | `height: 100%` 不变 | 同左 | 增加 `flex-grow: 1`（百分比 no-op 的替代接链） |
| 已知差异 | — | — | `:deep` 进组件模板、组件标签 class 穿透、百分比高度在 mp 均不生效（登记 docs/miniprogram.md） |

## 5. 契约变更（宪法 II）

- [x] 都不涉及——改动限于 hello-fjs 的演示组件与页面（`Panel.vue` 是
      demo 层组件，不在 runtime / op 协议 / natives 任何一条边界上）。

## 6. 验收标准

1. `pnpm run typecheck` 全 workspace 通过。
2. `pnpm test` 通过（@ufjs/runtime + @ufjs/cli）。
3. `pnpm --filter hello-fjs run build:mp` 编译无新增告警；产物
   `components/panel/panel.wxml` 的 section / card 带 fill class 绑定，
   `panel.wxss` 带 `.section--fill` / `.card--fill` 规则，页面 wxss 的
   `.page` 带 flex-grow。
4. DevTools（skyline）打开 `pages/comp-container-list-view`：标题/描述/
   白卡正常，列表出现行、可滚动、行数按视口按需构建。
5. 其余 48 个使用 `<Panel>` 的页面不受影响（`fill` 可选、默认 false）。
6. web（`pnpm --filter hello-fjs run dev:web`）list-view 页列表仍撑满
   卡片，行为与改前一致。

## 7. 待澄清

- 无
