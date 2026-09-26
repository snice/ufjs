# Spec: web 端「display:flex 不写方向」默认横排，与引擎一致

- **ID**: 140-web-flex-default-row
- **状态**: done
- **日期**: 2026-09-26

## 1. 要解决什么

同一条 CSS `display: flex`（不写 `flex-direction`）作用在 fjs 标签（`view` 等）上，两端方向相反：

- **App 端**：CSS 引擎在层叠结果上补 CSS 初始值——`merged.flexDirection` 为空且
  `display` 是 `flex` / `inline-flex` / `-webkit-flex` 时，补 `flexDirection: row`、
  `alignItems: stretch`（未写时），`inline-flex` 另补 `flexWrap: wrap`
  （`packages/fjs-runtime/src/css/style.ts` ~1788）。**判定是层叠级的**：只要任何一条
  作者规则（或 inline style）给了方向，就不补。
- **Web 端**：`packages/fjs-runtime/src/web/base-css.ts` 给
  `view, scroll-view, list-view, safe-area, refresh, swiper-item, fjs-modal-sheet, switch,
  checkbox, progress-bar` 钉了 `display:flex; flex-direction: column; align-items: stretch`。
  作者规则只写 `display:flex` 时沿用 column。

现象（specs/139 §8.3）：

- NutUI 4 为兼容 Taro 渲染 `<view>`，CSS 靠默认 `row`（`.nut-cell`、`.nut-button__wrap`…）。
  web 上 `/#/nutui-basic` Cell 标题/描述竖排，`/#/nutui-button` 图标+文字按钮里 svg 高度
  被压成 0；iOS 正确。
- 库的 `.css` 导入（`@nutui/nutui/dist/packages/*/index.css`）在 web 上完全不经过
  fjs 的 CSS 改写，只有 SFC `<style>` 块（`packages/fjs/src/vite.ts` `VUE_STYLE_BLOCK_RE`）
  与 `injectStyle()` 注入的 CSS 经过 `rewriteFjsCss`。
- 自家示例也中招：`examples/hello-fjs/src/pages/example/style/responsive.vue`
  的 `.marks`（`@media` 内 `display: flex`）、`.side`（`@media` 内 `display: flex`），
  App 端是横排、web 端是竖排。

Vant 没碰到：它渲染真 `div`，浏览器初始值本来就是 row。

## 2. 不做什么（Non-goals）

- 不改 App 端引擎规则（它是对的：对齐 CSS 初始值）。
- 不改「没有任何规则写 display」的 `view` 的默认方向——web 仍是 column（base-css），
  App 端 peer 默认也是 column。这是 fjs 的移动端约定，不动。
- 不把 `rewriteFjsCss` 的其它 fjs 专有改写（无单位长度、`flex-grow`、`direction`）扩到
  库 `.css`——那些是 fjs 方言，套到标准 CSS 上会改语义。库 CSS 只做本条。
- 不处理 `inline-flex` 的 `flex-wrap: wrap` 补齐（引擎为模拟行内流的近似，web 上
  `inline-flex` 是真行内盒，不需要）；`inline-block` / `inline` 映射同理。
- 不处理小程序端（Skyline 的 `view` 默认值另议，见 docs/miniprogram.md）。
- 不修 specs/139 §9.5 列的 App 端小缺口（纯图标按钮垂直居中、Cell desc 右对齐）。

## 3. 用户可见的行为

```vue
<template>
  <view class="row"><text>标题</text><text>描述</text></view>
</template>
<style>
.row { display: flex; }                 /* 两端都横排、交叉轴 stretch */
.col { display: flex; flex-direction: column; } /* 两端都竖排 */
</style>
```

- 规则只写 `display:flex`（或 `inline-flex`）而**没有任何规则**给该元素写方向 → 两端 row，
  `align-items` 未写时为 stretch。
- 另一条规则（无论优先级高低、先后顺序）给了 `flex-direction` / `flex-flow` → 用那条，
  两端一致（引擎是层叠级判定，web 也要做到「补的值输给任何作者声明」）。
- 库 `.css`（node_modules 与项目自己的 `.css` 文件）同样生效：`/#/nutui-basic` Cell
  标题与描述同一行，`/#/nutui-button` 图标按钮的 svg 可见。

### 3.1 方案（推荐，待澄清 1 确认）：`@layer` 让补的值输给所有作者声明

逐条规则改写：凡声明块里写了 `display: flex | inline-flex | -webkit-flex` 且**同块**没写
`flex-direction` / `flex-flow` 的规则，追加一条同选择器、放进级联层的规则：

```css
@layer fjs-base, fjs-flex;          /* 每份改写产物开头都声明一次顺序 */
.nut-cell { display: flex; ... }    /* 原规则不动 */
@layer fjs-flex { .nut-cell { flex-direction: row; align-items: stretch; } }
```

base-css 里 fjs 标签的 `flex-direction: column; align-items: stretch` 挪进
`@layer fjs-base`。于是优先级 = fjs-base(column) < fjs-flex(row) < 任何未分层作者规则，
与引擎「作者给了方向就不补、否则 display:flex 补 row」同构，与选择器优先级、源顺序无关。
`@media` / `@supports` 内的规则照样改写（包在同一个条件里）。

对比的「直接往原规则里追加 `flex-direction: row`」更简单，但会按优先级/源顺序压过
**别的**规则写的方向（例如 `.a{flex-direction:column}` + `.a.b{display:flex}`，引擎是
column，追加法变 row），所以不选。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 层叠结果无方向且 display 为 flex 系 → row + stretch | 同：`@layer fjs-flex` 补值，输给任何作者声明 |
| 覆盖范围 | 所有进引擎的 CSS（SFC、库 .css、inline style） | SFC `<style>`、`injectStyle`、所有 `.css` 导入；inline style 由 fjs 标签属性选择器兜底 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | — | ① 补值规则之间（两条都只写 display:flex）按 CSS 正常层叠，结果相同无影响；② `inline-flex` 不补 wrap（见 Non-goals）；③ 需要支持 `@layer` 的浏览器（Chrome 99 / Safari 15.4 / Firefox 97）；④ inline style 兜底靠 `style` 属性字符串匹配，只认 Vue 序列化出的 `display: flex` 写法 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm test` 通过；新增用例：
   - `packages/fjs-runtime/test`：flex 默认改写——只写 display:flex 的规则得到 fjs-flex 层规则；
     同块写了 `flex-direction`/`flex-flow` 的不改写；`inline-flex`、`@media` 内规则改写；
     幂等（改写两次结果不变）；base-css 的 column 在 `@layer fjs-base` 里。
   - `packages/fjs/test`：Vite 插件对 `.css` 导入（含 node_modules 路径）只做 flex 默认改写，
     不做无单位长度等 fjs 方言改写；SFC style 块仍做全量改写。
2. `pnpm run typecheck` 通过。
3. demo-web 预览（`.claude/launch.json` "demo-web"，5175）：`/#/nutui-basic` Cell 标题与
   描述同一行；`/#/nutui-button` 图标+文字按钮 svg 可见、与文字横排。浏览器里取
   `.nut-cell` 的 computed `flex-direction` 为 `row`。
4. hello-fjs web 预览：`style/responsive` 页与 App 端一致（`.marks`/`.side` 补显式 `flex-direction: column` 后两端都竖排）；
   抽查 vant 页（demo `/#/vant-basic` 等）无回归。
5. 文档：`docs/web.md` 已知差异、`docs/css-compat.md` `flex-direction` 行更新。

## 7. 待澄清

- [x] 1. 机制：按 §3.1 用 `@layer`（层叠级，与引擎同构）？还是直接往原规则追加（简单但会
  压过别的规则写的方向）？→ **@layer**。
- [x] 2. 库 `.css` 覆盖范围：Vite 插件对**所有** `.css` 导入（node_modules + 项目自己的
  .css）做 flex 默认改写（只做这一条）？→ **所有 .css**——App 端引擎本来就处理所有 CSS；
  对 `div` 等标准元素补的是初始值且输给任何作者声明，无副作用。
  （`lang="scss"` 的 SFC 块：现有 `rewriteFjsCss` 在 'pre' 阶段对原始块改写，嵌套语法下
  追加层规则不可靠——仓库内示例没有用 scss，plan 里只对 css 块做，scss 登记为差异。）
- [x] 3. inline `style="display:flex"`（不写方向）在 fjs 标签上：App 端引擎也补 row。web 端
  → **属性选择器兜底**：在 fjs-flex 层加属性选择器兜底
  `:is(view,…)[style*="display: flex"]:not([style*="flex-direction"]):not([style*="flex-flow"])`
  （Vue 写 style 后属性序列化为 `display: flex;`）；还是只登记为差异？
- [x] 4. `responsive.vue` 的 `.marks` / `.side` 目前 App 端横排，与页面意图（三行说明竖排）
  不符：给它们补显式 `flex-direction: column`（两端一致且符合意图）？→ **补显式 column**。

## 8. 验收结果

1. ✅ `pnpm test`：fjs-runtime 790、fjs 397、fjs-webview 36、fjs-webgl 30 全过（新增
   `web-css-compat.test.ts` 8 条、`vite-flex-default.test.ts` 4 条，含 scoped 下层规则带
   `[data-v-*]`）。
2. ✅ `pnpm run typecheck` 全部 Done。
3. ✅ demo web（vite dev）：`/#/nutui-basic` `.nut-cell`（`<view>`）computed
   `flex-direction: row`、`align-items: stretch`，标题/描述同行；`/#/nutui-button`
   图标 svg 22×22 / 16×16 可见、与文字横排。首页、`/#/vant-basic`、`/#/vant-form` 无回归。
4. ✅ hello-fjs web：`style/responsive` `.marks` 为 column（补显式方向后两端一致）；
   浏览器里新建 `<view style="display:flex">` → row，裸 `<view>` → column。
5. ✅ 构建产物：`fjs build --web`（esbuild）的 `main.css` 里顺序声明先于首个
   `@layer fjs-flex` 块；`vite build` 压缩后变成 `@layer fjs-base;` 紧接 `@layer fjs-flex{`，
   层序仍是 base < flex。
6. ✅ 文档：`docs/css-compat.md` `flex-direction` 行、`docs/web.md` 已知差异。
