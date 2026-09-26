# Plan: demo 接入 NutUI，首页改为分类手风琴

对应 spec：`./spec.md`

## 0. 调研结论（@nutui/nutui@4.3.14 包结构，决定了方案）

- `package.json` 无 `exports`，`module` 是 `dist/nutui.es.js` 这个 barrel —— 它
  静态 import **全部** ~80 个组件（含 vue-router 依赖、Uploader 等）。
  逐组件入口是 `dist/packages/<comp>/index.mjs`，样式入口是
  `dist/packages/<comp>/style/css.mjs`（= `styles/reset.css` + 组件 `index.css`）。
- 首批 5 个组件（button / cell / cellgroup / tag / divider）源码里**没有**
  `window` / `document` / `getComputedStyle`；Cell 的 `useRouter()` 只读
  `proxy.$router`（demo 用 fjs/router，拿到 `null`，只在 `to` 属性时用）。
  预计不需要 Vite 源码补丁。
- `styles/reset.css` 只有一条 `html { -webkit-tap-highlight-color }`：app 端
  无 `html` 元素，规则不命中，无副作用。
- 主题变量全部是 `var(--nut-x, 回退值)` 内联回退，不依赖 `:root`。
- 图标 `@nutui/icons-vue@0.1.1` 是**内联 SVG 组件**（`<svg viewBox><path d fill="currentColor">`），
  fjs 已支持内联 svg/path（`docs/css-compat.md` §SVG，`widgets/svg.dart`）。
  `style_icon.css` 定义 `.nut-icon` 尺寸与 `rotation` 动画（loading 转圈）。
- 类型：`dist/types` 只有 3 个组件声明了 `GlobalComponents`，Button/Cell 等都
  没有 → demo 开了 `strictTemplates`，需要手写 GlobalComponents 声明。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（demo 页面层） | 页面、插件、catalog 全是无平台后缀的共享源码：`plugins/nutui.ts` 两端都加载，`pages/*.vue` 两端同源。不改 `lib/src/` / `fjs-runtime/src/web/`。两端差异（`:active::before` 遮罩、伪元素动画）已在 css-compat 登记，沿用 |
| II 边界即契约 | 否 | 三张表都不动 |
| III 同步单线程零序列化 | 否 | 纯页面层 |
| IV 外观照 WeUI | 否 | 第三方组件库外观以 NutUI 自身为准（同 vant）；首页手风琴沿用 hello-fjs 已有取值 |
| V 静默失效是 bug | 是 | 若 NutUI CSS 里有引擎不支持的选择器，引擎已 warnOnce；对照时把新出现的告警记入 spec「过程发现」而非忽略。如最终需要 Vite 补丁，沿用 vant.ts 的「锚点缺失即告警」机制 |
| VI 注释记录权衡 | 是 | `plugins/nutui.ts` 顶部注释写明为何走逐组件入口而不走 barrel；`catalog.ts` 注明分组顺序与环依赖惰性求值 |
| VII JS 能包就不要下 Dart | 是 | 全部在 JS 侧完成，不下 Dart |
| VIII 变更落到文档 | 轻 | 不改协议/样式范围/CLI。若接入中修了引擎缺口，同 PR 更新 `docs/css-compat.md`；否则只更新 `demo/README.md`（页面清单/NutUI 说明） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动（CSS → registerStyles 已由 `vueSfcPlugin` 处理，specs/068） |
| JS runtime | `packages/fjs-runtime/src/vue/vue-shim.ts` | **实现中发现**：补 `withModifiers` 导出（NutUI Tag 预编译代码从 `vue` 导入，app 构建失败）。回归 `packages/fjs-runtime/test/vue-shim-modifiers.test.ts` |
| Web 适配层 | — | 不动 |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | — | 不动（预期） |
| demo 依赖 | `demo/package.json` | `@nutui/nutui: ^4.3.14`、`@nutui/icons-vue`；**不**登记 `fjs.shared`（见 §3.1） |
| demo 插件 | `demo/src/plugins/nutui.ts`（新） | 逐组件 import + `app.use`；样式 `style/css.mjs`；`@nutui/icons-vue/dist/style_icon.css` |
| demo 类型 | `demo/src/nutui-components.d.ts`（新） | `GlobalComponents` 声明 NutButton / NutCell / NutCellGroup / NutTag / NutDivider（及用到的图标组件，若全局注册） |
| demo 目录 | `demo/src/catalog.ts`（新） | 照 `examples/hello-fjs/src/catalog.ts`：`routes` → 分组，顺序 `['基础能力','交互演示','Vant','NutUI']` |
| demo 首页 | `demo/src/pages/index.vue` | hero（计数器）+ 分类手风琴 |
| demo 页面 | `demo/src/pages/{about,fetch,icons,drag,dnd,vant-*}.vue` | 只改 `<route>`：补 `group`、`desc` |
| demo 页面 | `demo/src/pages/nutui-button.vue`（新） | Button 全部变体 |
| demo 页面 | `demo/src/pages/nutui-basic.vue`（新） | Cell/CellGroup、Tag、Divider、Icon |
| 文档 | `demo/README.md`；`docs/vue3.md`、`docs/third-party-components.md` 的 vue-shim 补齐表 | 补 NutUI 与首页分组说明；shim 表加 `withModifiers` 一行 |

## 3. 方案

1. **依赖**：`pnpm --filter demo add @nutui/nutui@^4.3.14 @nutui/icons-vue`。
   **实现中修正**：原计划照 vant 登记 `fjs.shared`，但 `sharedEntrySource` 按包名
   整包 import 进 `shared.js`——登记 `@nutui/nutui` 等于把 barrel 全量拉进来，抵消
   逐组件入口；两者也都没有模块级状态（toolchain.md「共享 chunk」判据），页面
   chunk 各带一份用到的图标即可。故不登记。
2. **注册**：`plugins/nutui.ts` 从 `@nutui/nutui/dist/packages/<comp>/index.mjs`
   逐个 import，`app.use(...)`；样式 `import '@nutui/nutui/dist/packages/<comp>/style/css.mjs'`
   一并写在同文件（一处清单）。Icon 不全局注册，页面里直接 `import { Loading, Star… } from '@nutui/icons-vue'`
   ——这是 NutUI 文档本身的用法。插件文件名排序在 `vant.ts` 前，fjs/plugins 按
   什么顺序加载无所谓（两者无依赖）。
3. **类型**：`nutui-components.d.ts` 从 `@nutui/nutui` 的类型取组件类型
   （`typeof import('@nutui/nutui')['Button']` 等）声明进 `GlobalComponents`。
4. **目录/首页**：复制 hello-fjs 的 catalog 形状（只保留一个分组序列），首页模板/
   样式照 hello-fjs `index.vue`，条目显示 `title` + `desc`（demo 页面无 tag），
   hero 放计数器。默认展开第一个分组。
5. **页面**：每页用 `scroll-view` + 分节小标题，示例取 NutUI 文档基础用法。
6. **两端对拍**：web（`fjs dev --web` / vite）与 iOS 模拟器逐页截图对比；出现
   差异先判定是 NutUI 用了引擎不支持的 CSS 还是 DOM API，再决定补 Vite 补丁
   （`demo/vite/nutui.ts`）还是下沉引擎（届时补记 spec「过程发现」）。

### 被否掉的备选

- **`import { Button } from '@nutui/nutui'`（barrel）**：会把 ~80 个组件整棵拉进
  app bundle 并在启动时求值，任何一个组件顶层碰 DOM 都会让整个 app 起不来
  （specs/068 vant 的 barrel 就逼出了 vue-shim 的 4 个补丁）；包体也大。逐组件入口
  只求值用到的。
- **引 `@nutui/nutui/dist/style.css` 全量样式**：全部组件样式 + `:root` 变量，
  app 端要全量解析、告警噪音大，且多数组件没用到。
- **`unplugin-vue-components` + NutUIResolver**：只作用于 Vite，app 构建走 esbuild
  管不到（同 specs/068 结论）。
- **首页继续手写按钮列表 / 在 index.vue 里硬编码分组**：新增页面要改两处；
  `<route>` 元信息 + catalog 是 hello-fjs 已验证的做法，平台缺页时自动少一条。
- **Icon 全局注册全部 129 个图标**：无必要，页面按需 import。

### 3.x 实现中发现：vue-shim 缺 `withModifiers`

`pnpm --filter demo run build` 报 `No matching export in vue-shim.ts for import
"withModifiers"`：NutUI `tag/Tag.js` 关闭图标写 `withModifiers(onClose, ["stop"])`。
它和 vant 逼出的 `withKeys` 同类（runtime-dom 专有 helper），但**不能**照
`withKeys` 直通：app 端的 tap 事件（`renderer.ts` `asDomEvent`）有能用的
`stopPropagation()`（tap 会冒泡，specs/129）和 `target` / `currentTarget`，
直通会让 `.stop` 失效、父级 click 被误触发。故照 runtime-dom 的 modifierGuards
如实实现，并按 runtime-dom 的做法把包装函数缓存在 handler 上（避免重渲染时
prop 抖动）。宪法 I：web 端用真 runtime-dom，语义一致；VII：纯 JS。

## 4. 风险

- **`:active::before` 按压遮罩**：app 端不支持状态+伪元素组合，按钮按下无反馈
  （与 vant 现状一致，已登记）。可接受，写入页面对照结论。
- **Loading 转圈**：`nut-icon-loading` 的 `animation: rotation` 在 svg 元素本身上
  （不是伪元素），应能转；需真机确认。
- **`display: inline-block` / `vertical-align`**：NutUI 按钮是 inline-block，
  多个按钮并排依赖行内布局；fjs 的行内盒支持程度需两端对比，差异大时页面上
  用 flex 容器排布（页面层规避，不改库）。
- **`fill-opacity="0.9"`** 等 svg 属性 app 端是否识别：对比时核对。
- **Cell `is-link` 箭头**是 `@nutui/icons-vue` 的 svg，同上。
- **strictTemplates**：GlobalComponents 声明写错会让 typecheck 挂，第一时间跑。
- **tags.json 内联**：不涉及新标签，但若 `@ufjs/cli` dist 旧于源码，先 rebuild
  （AGENTS.md 约束 6）。

## 5. 验证路径

```bash
pnpm install
pnpm --filter @ufjs/cli run build
pnpm --filter demo run typecheck
pnpm --filter demo run build          # app bundle，看告警
pnpm --filter demo run build:web
pnpm test
# 两端对拍：web 起 vite / fjs dev --web，iOS 模拟器 fjs run ios（或 fjs-go 连 fjs dev）
# 首页手风琴 → NutUI → Button 按钮 / 基础组件，逐页截图对比
```
