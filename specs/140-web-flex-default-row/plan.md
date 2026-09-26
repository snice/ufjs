# Plan: web 端「display:flex 不写方向」默认横排，与引擎一致

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | App 端规则已在 `packages/fjs-runtime/src/css/style.ts`（~1788）且不改；本 spec 只把 Web 端（`packages/fjs-runtime/src/web/css-compat.ts`、`web/base-css.ts`，以及把 CSS 送进去的 `packages/fjs/src/vite.ts`、`packages/fjs/src/bundler/vue-plugin.ts`）改到同一语义。剩余差异登记 `docs/web.md` |
| II 边界即契约 | 否 | 不动 op 协议 / natives 表 / 事件类型 |
| III 同步单线程零序列化 | 否 | 纯构建期/样式表字符串改写 |
| IV 外观照 WeUI | 否 | 不改组件默认外观 |
| V 静默失效是 bug | 是 | 改写器不认识的写法（scss 嵌套）不硬改：SFC 块只对 `lang.css` 做 flex 改写，scss 登记差异；不静默产出错误 CSS |
| VI 注释记录权衡 | 是 | `css-compat.ts` 新函数上写清「为什么 @layer 而不是往原规则追加」；`base-css.ts` 写清为什么方向挪进 `fjs-base` 层、inline 兜底靠属性选择器 |
| VII JS 能包就不要下 Dart | 否 | 不下 Dart，纯 web 侧 |
| VIII 变更落到文档 | 是 | `docs/css-compat.md`（`flex-direction` / `align-items` 行）、`docs/web.md`（已知差异） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建（Vite） | `packages/fjs/src/vite.ts` | `transform`：SFC 块照旧 `rewriteFjsCss`；新增 `.css` 文件（含 node_modules，排除 `?raw`/`?url`/`.vue?`）只过 `expandFlexDefault` |
| CLI / 构建（esbuild web） | `packages/fjs/src/bundler/vue-plugin.ts` | `web` 为真时加 `.css` onLoad：读文件 → `expandFlexDefault` → `loader: 'css'`（SFC 块走 `injectStyle` → `rewriteFjsCss`，已覆盖） |
| Web 适配层 | `packages/fjs-runtime/src/web/css-compat.ts` | 新增导出 `expandFlexDefault(css)`；`rewriteFjsCss` 末尾调用它 |
| Web 适配层 | `packages/fjs-runtime/src/web/base-css.ts` | 开头 `@layer fjs-base, fjs-flex;`；fjs 标签规则里的 `flex-direction: column; align-items: stretch` 挪进 `@layer fjs-base`；`@layer fjs-flex` 加 inline style 兜底属性选择器 |
| Web 适配层导出 | `packages/fjs-runtime/src/web/index.ts` | 导出 `expandFlexDefault`（CLI 从 `@ufjs/runtime` 的 web 入口取，与 `rewriteFjsCss` 同路径——实现时核对 CLI 现在怎么 import `rewriteFjsCss`） |
| 示例 | `examples/hello-fjs/src/pages/example/style/responsive.vue` | `.marks` / `.side` 补 `flex-direction: column` |
| C++ 引擎 / Dart 宿主 | — | 不动 |
| 测试 | `packages/fjs-runtime/test/web-css-compat.test.ts`、`packages/fjs/test/`（新 `vite-flex-default.test.ts`） | 见 §5 |
| 文档 | `docs/css-compat.md`、`docs/web.md` | 见 VIII |

## 3. 方案

### 3.1 `expandFlexDefault(css)`（css-compat.ts）

一个小的块扫描器（不是正则整段替换）：逐字符走，跳过注释 `/* */` 与字符串，维护花括号栈。
遇到「选择器 `{` 声明 `}`」且声明里无嵌套 `{` 的普通规则：

- 声明（去注释后）含 `display: flex | inline-flex | -webkit-flex`（可带 `!important`），
  且同块无 `flex-direction` / `flex-flow` / `-webkit-flex-direction` →
  紧跟在该规则后插入 `@layer fjs-flex{<选择器>{flex-direction:row;align-items:stretch}}`。
- 所在上下文是 `@keyframes` / `@font-face` / `@page` 等非样式规则容器 → 跳过；
  `@media` / `@supports` / `@container` / `@layer X` 内的规则照常处理（插入的层块嵌在同一条件里，
  CSS 允许 `@layer` 块嵌套在条件组规则内）。
- 有任何插入时，在文件头（`@charset` 之后）插入 `@layer fjs-base, fjs-flex;`
  ——层的先后由**首次出现**决定，base-css 在运行时注入、可能晚于 Vite 注入的页面样式，
  所以每份产物都声明同一顺序。
- 幂等：输入里已有 `@layer fjs-base, fjs-flex;` 就原样返回（`injectStyle` 与 Vite 两条路
  不会叠加，但测试要求幂等）。

为什么 `align-items: stretch` 也补：引擎在 `alignItems` 未设时补 stretch；层里的值输给任何
作者声明，所以等价。对 `div` 等标准元素补的都是 CSS 初始值，无副作用。

### 3.2 base-css 分层

```css
@layer fjs-base, fjs-flex;
@layer fjs-base { view, scroll-view, … { flex-direction: column; align-items: stretch; } }
@layer fjs-flex {
  :is(view, scroll-view, …):is([style*="display: flex"], [style*="display: inline-flex"])
    :not([style*="flex-direction"]):not([style*="flex-flow"]) { flex-direction: row; align-items: stretch; }
}
view, scroll-view, … { display: flex; min-width: 0; … }   /* 其余仍不分层 */
```

优先级：fjs-base(column) < fjs-flex(row) < 所有未分层规则（base-css 其余规则、页面、库）。
base-css 里其它写了方向的规则（`scroll-view[direction="horizontal"]`、`.fjs-picker-bar` 等）
保持未分层，继续压过 fjs-flex——那是内置组件的固定方向，引擎侧对应的是组件自己的样式。

### 3.3 CSS 入口

- Vite：`transform(code, id)` 里 `VUE_STYLE_BLOCK_RE` 分支不变（`rewriteFjsCss` 内已含 flex 改写）
  但 flex 改写仅对 `lang.css` 的块做——实现上 `rewriteFjsCss` 保持全量，Vite 分支对
  非 css lang 的块改调一个不含 flex 的版本（或给 `rewriteFjsCss` 加 option）；
  新增 `/\.css(\?|$)/` 且非 `?raw|?url|?inline` 非 `.vue?` 的 id → `expandFlexDefault`。
  插件已是 `enforce: 'pre'`，看到的是原始 CSS。
- esbuild web（`fjs build --web`）：`vue-plugin.ts` 的 `.css` onLoad 目前只在 `!web` 注册，
  web 分支加一个返回 `{ contents: expandFlexDefault(css), loader: 'css' }` 的 onLoad。

### 3.4 被否掉的备选

1. **往原规则里直接追加 `flex-direction: row`**：会按优先级/源顺序压过其它规则写的方向
   （`.a{flex-direction:column}` + `.a.b{display:flex}`：引擎 column，追加法 row），
   与引擎的层叠级判定不同构。否。
2. **改 base-css 让 fjs 标签默认 row**：违背 fjs「未设置的 view 竖排」约定，App 端 peer 默认也是
   column，全站页面翻转。否。
3. **运行时读 computed style 修正**（MutationObserver 查 `display:flex` 无方向）：需要知道
   「方向是不是作者写的」，computed style 给不出来源；还有性能与闪烁。否。
4. **Vite `css.postcss.plugins` 注入 PostCSS 插件**：能拿到预处理后的 CSS（scss 也行），但
   内联 `css.postcss` 会让用户项目的 `postcss.config.*` 不再被加载，改变用户配置行为。否。
5. **把整个 base-css 放进 `fjs-base` 层**：影响面过大（base 里 `.fjs-image` 等规则会输给
   库里低优先级的通配规则），本 spec 只挪方向两条。否。

## 4. 风险

- **Vue scoped 与 @layer**：SFC 块在 Vite 'pre' 阶段改写后再交 compiler-sfc 加作用域；
  需确认 `@layer` 内嵌规则的选择器也被加上 `[data-v-xxx]`（pluginScoped 遍历全部 Rule，
  预期可以）。在 fjs 测试里用 `compileStyle` 断言；浏览器里再看一次。
- **层顺序**：若某份样式表先出现 `@layer fjs-flex`（而无顺序声明），fjs-flex 会排在
  fjs-base 前面，column 胜出——靠「每份产物开头都声明顺序」防住，测试断言。
- **inline 兜底误伤**：web 运行时组件若用 inline `display: flex` 且依赖 column 会被翻成 row。
  已 grep `web/components`、`src/components` 无此写法；新组件要注意（注释说明）。
- **静默的 scss**：`lang="scss"` 块不做 flex 改写，App 端仍 row——登记为差异。
- **库 CSS 体积**：每条 display:flex 规则多一条层规则，NutUI 全量可接受。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime exec vitest run test/web-css-compat.test.ts
pnpm --filter @ufjs/cli exec vitest run test/vite-flex-default.test.ts
pnpm test
pnpm run typecheck
pnpm --filter @ufjs/cli run build      # demo 走 dist 里的 vite 插件
# preview_start demo-web → /#/nutui-basic、/#/nutui-button：.nut-cell computed flex-direction = row，截图
# preview_start hello-fjs-web → style/responsive 页 .marks 竖排；demo /#/vant-basic 抽查
```
