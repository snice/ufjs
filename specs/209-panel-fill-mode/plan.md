# Plan: 209-panel-fill-mode

对照宪法自查：I 两端同源（Panel 是三端共用的同一份 SFC，fill 走组件自有
样式，三端天然一致）；V 静默失效（本次正是修一处静默失效，并把差异登记
文档）；VI 注释记录权衡（Panel 的 fill 注释说明为什么样式必须长在组件里）。

## 改动清单（按顺序）

1. **`examples/hello-fjs/src/components/Panel.vue`**
   - `defineProps` 增加 `fill?: boolean`。
   - 模板：`.section` 与 `.card` 各加一个由 `fill` 驱动的 class 绑定
     （`section--fill` / `card--fill`）。
   - scoped 样式新增两条规则：`.section--fill`（flex-grow: 1;
     flex-basis: 0%; min-height: 0）、`.card--fill`（flex-grow: 1;
     flex-basis: 0%）。注释写明为什么撑满样式必须长在组件内部
     （skyline 三个限制，见 spec §1）。
   - 不设默认样式变化：`fill` 缺省时行为与现在完全一致（其余 48 页不受影响）。

2. **`examples/hello-fjs/src/pages/comp/container/list-view.vue`**
   - `<Panel class="fill" ...>` → `<Panel :fill="true" ...>`。
   - 样式：删除 `.fill` 规则与 `:deep(.card)` 规则；`.page` 增加
     `flex-grow: 1`（mp 接 shell .body 链；web/App 与 height:100% 并存）。
   - `.list` 保持 `height: 0px; flex-grow: 1`（height:0 仍是过 mp 编译期
     scroll-view 高度检查的钥匙）。
   - 重写两条长注释：旧注释描述的 class/:deep 链在 mp 上是 no-op，新注释
     记录三端各自靠哪一环撑满。

3. **`docs/miniprogram.md`** 已知差异表补一条：页面全屏填充链在 mp 的
   正确姿势（组件 fill 属性 / 组件内部样式），以及三个失效构造的索引
   （spec §1 的 1/2/3）。

4. **构建与验证**
   - `pnpm run typecheck`、`pnpm test`。
   - `pnpm --filter hello-fjs run build:mp`，核对产物（panel wxml/wxss、
     页面 wxss）。
   - DevTools skyline 目验 list-view 页（干净启动、单次导航）。
   - `pnpm --filter hello-fjs run build:web`（或 dev:web）确认 web 构建
     与行为不变。

## 风险

- `:fill="true"` 在 mp 发射为 `fill="{{ true }}"`（genAttrs bind 分支），
  Panel 的 property `fill` 收到布尔 true——已核对 wxml.ts。
- Panel 模板加 `:class` 后，mp 编译走 stringifyClass 运行时绑定，与
  hello-fjs 其它页面已有的 `:class` 用法同款，无新机制。
