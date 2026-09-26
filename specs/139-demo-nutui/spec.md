# Spec: demo 接入 NutUI，首页改为分类手风琴

- **ID**: 139-demo-nutui
- **状态**: done
- **日期**: 2026-09-26

## 1. 要解决什么

1. **第三方组件库只验证过 Vant 一家。** `demo` 是 create→run→build 的回归场，
   specs/068 起用 Vant 4 量化了 fjs 渲染管线对真实组件库的兼容度。京东的
   NutUI 4（`@nutui/nutui`，Vue 3 版，文档
   https://nutui.jd.com/h5/vue/4x/#/zh-CN/component/button）是另一套主流移动端
   组件库，写法与 Vant 不同，能暴露 Vant 没踩到的缺口：
   - 每个组件的样式是**单独的 `index.css`**，另带一份全局 `styles/reset.css`
     （`packages/button/style/css.mjs` 里 `import '../../../styles/reset.css'`）；
   - 主题变量写成 `var(--nut-xxx, 回退值)` 内联回退，而不是 Vant 那样全挂在
     `:root` 上；
   - 按钮主色是 `linear-gradient(135deg, …)` 背景，按压态用
     `.nut-button:active::before { opacity: .1 }`（状态 + 伪元素组合，
     `docs/css-compat.md` 标注为不支持）；
   - 图标来自独立包 `@nutui/icons-vue`（Button 的 loading 图标即从这里 import）。
   目前 demo 里没有任何 NutUI 页面，这些差异在 App 端表现如何无人知道。

2. **demo 首页是一列平铺按钮。** `demo/src/pages/index.vue` 手写了 14 个
   `router.push` 按钮，新增页面要同时改首页，页面一多就找不到。
   `examples/hello-fjs` 已经有成熟做法：页面在自己的 `<route>` 块里声明
   `group` / `title` / `desc`，`src/catalog.ts` 从 `fjs/pages` 的路由表按分组
   顺序收集，首页渲染成分类手风琴，新增页面零改首页。

## 2. 不做什么（Non-goals）

- 不一次性适配 NutUI 全部 ~80 个组件。首批只做 Button + 基础组件
  Cell / CellGroup / Tag / Divider / Icon，其余按 Vant 的节奏后续分批开 spec。
- 不改 `packages/` 下的运行时 / 引擎 / Dart 代码，**除非**接入 Button 时暴露出
  引擎缺口（届时在本 spec 的「过程发现」里补记，并遵守宪法 I/II/VIII）。
- 不接 `unplugin-vue-components` / NutUI resolver（理由同 specs/068：Vite
  插件帮不到 app 构建，全局注册是两端一致的按需方案）。
- 不移除 Vant，不动现有 vant-* 页面的内容（只给它们的 `<route>` 补分组元信息）。
- 不做 NutUI 主题定制（ConfigProvider 等），只用默认主题。
- 不做小程序端（`fjs build --mp`）验证。

## 3. 用户可见的行为

### 3.1 NutUI 接入

- `demo/package.json` 加依赖 `@nutui/nutui@^4.3.14`（最新稳定版；npm `latest`
  tag 当前指向 beta，不用）及其图标包 `@nutui/icons-vue`，
  写进 `fjs.shared`（与 vant 同）。
- `demo/src/plugins/nutui.ts`（无平台后缀，两端都加载）逐个 `app.use` 全局注册，
  同文件按组件引入样式（`@nutui/nutui/dist/packages/<comp>/style/css.mjs`），
  结构照抄 `plugins/vant.ts`。
- 若 NutUI 在 app 端碰到 `window` / `document`，适配补丁放
  `demo/vite/nutui.ts`，与 `vite/vant.ts` 同构（锚点字面替换，锚点缺失时构建
  告警并跳过、不破坏 bundle）。
- 两个新页面：`nutui-button.vue`（Button 全部变体，对照 NutUI 文档 Button 页）
  与 `nutui-basic.vue`（Cell / CellGroup / Tag / Divider / Icon，各取文档
  基础用法）。Button 示例：

```vue
<route>
{"title": "Button 按钮", "group": "NutUI", "desc": "类型 / 朴素 / 禁用 / 形状 / 加载 / 尺寸 / 块级 / 自定义颜色"}
</route>

<template>
  <scroll-view class="page">
    <nut-button type="primary">主要按钮</nut-button>
    <nut-button type="info">信息按钮</nut-button>
    <nut-button type="default">默认按钮</nut-button>
    <nut-button type="danger">危险按钮</nut-button>
    <nut-button type="warning">警告按钮</nut-button>
    <nut-button type="success">成功按钮</nut-button>
    <nut-button plain type="primary">朴素按钮</nut-button>
    <nut-button disabled type="primary">禁用状态</nut-button>
    <nut-button shape="square" type="primary">方形按钮</nut-button>
    <nut-button loading type="info" />
    <nut-button size="large" type="primary">大号按钮</nut-button>
    <nut-button block type="primary">块级元素</nut-button>
    <nut-button color="#7232dd">单色按钮</nut-button>
    <nut-button color="linear-gradient(to right, #ff6034, #ee0a24)">渐变色按钮</nut-button>
  </scroll-view>
</template>
```

### 3.2 首页分类手风琴

- 新增 `demo/src/catalog.ts`：照 `examples/hello-fjs/src/catalog.ts`，从
  `fjs/pages` 的 `routes` 按固定分组顺序收集 `meta.group`，惰性求值 + 缓存。
- 每个页面在自己的 `<route>` 里声明 `group`（及可选 `desc`），例如：

```vue
<route>
{"title": "块拖拽", "group": "交互演示", "desc": "多指同时拖"}
</route>
```

- `index.vue` 改为：顶部 hero（保留 pinia 计数器的 `count` / `+1`，它是
  pinia 在 app 端的回归点）+ 分类手风琴（点标题展开/收起，一次只开一组，
  点条目 `router.push`）。外观与 hello-fjs 首页一致（白卡片、圆角 10、
  发丝线、`›` 箭头、`:active` 按下态）。
- 分组（顺序即显示顺序，最终命名见待澄清 3）：

| 分组 | 页面 |
|------|------|
| 基础能力 | about、fetch、icons |
| 交互演示 | drag、dnd |
| Vant | vant-basic、vant-form、vant-feedback、vant-nav、vant-float、vant-more、vant-watermark |
| NutUI | nutui-button、nutui-basic |

- 没写 `group` 的页面不出现在首页（与 hello-fjs 一致）；首页本身不写 group。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 首页手风琴 | 纯原生标签（view/text/scroll-view）+ scoped CSS，两端同源 | 同左 |
| NutUI Button 结构/文字/颜色 | 与 web 一致（按钮 label 已沿全部后代收集，specs/068） | NutUI 原生 |
| 渐变背景 | `linear-gradient` 已支持（css-compat §background） | 原生 |
| 按下态 `:active::before` | 状态 + 伪元素组合不支持 → 无 10% 遮罩（与 vant 按钮现状一致，css-compat L313） | 有遮罩 |
| loading 图标 | 依赖 `@nutui/icons-vue` 的渲染方式（SVG 或 iconfont），实现时核对，不能渲染的记入「过程发现」 | 原生 |
| 事件载荷 | Button `@click` 无载荷依赖 | 同左 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（预期；如接入中发现引擎缺口需下沉，另行在本 spec 补记）

## 6. 验收标准

1. `pnpm install` 后 `pnpm --filter demo run typecheck` 通过。
2. `pnpm --filter demo run build` 与 `pnpm --filter demo run build:web` 均成功，
   app 构建无新增 `[fjs]` 补丁锚点告警以外的错误。
3. `pnpm test` 通过（本 spec 不应让现有测试回退）。
4. `fjs dev --web` 打开首页：看到 4 个分组，点「NutUI」展开出现「Button 按钮」，
   点进去看到 3.1 中全部按钮；「基础组件」页 Cell / Tag / Divider / Icon 正常显示；逐组点开，所有原首页入口都能在某一组里找到、
   点击能跳转。
5. iOS 模拟器（`fjs run ios` 或 fjs-go 连 `fjs dev`）上同一流程：首页手风琴
   外观与 web 一致；`nutui-button` 页各按钮的背景色 / 渐变 / 圆角 / 朴素描边 /
   禁用半透明 / 块级宽度 / 文字与 web 截图对齐；`nutui-basic` 页同样两端对齐；已知差异只允许第 4 节表中列出的。
6. 首页计数器 `+1` 在两端都能累加。

## 7. 待澄清

- [x] 1. 首批组件范围 → Button + 基础组件（Cell / CellGroup / Tag / Divider / Icon）。
- [x] 2. 版本 → `^4.3.14` 稳定版。
- [x] 3. 首页 → 分组「基础能力 / 交互演示 / Vant / NutUI」，pinia 计数器留在 hero。

## 8. 过程发现

1. **vue-shim 缺 `withModifiers`**（plan §3.x）：NutUI `tag/Tag.js` 预编译代码
   `withModifiers(onClose, ["stop"])` 从 `vue` 导入，app 构建失败。照 runtime-dom
   如实实现（不是像 `withKeys` 那样直通——app 端 tap 事件有能用的
   `stopPropagation()`），回归 `packages/fjs-runtime/test/vue-shim-modifiers.test.ts`，
   文档 `docs/vue3.md` / `docs/third-party-components.md`。
2. **`fjs.shared` 不登记 NutUI**（plan §3.1）：shared 按包名整包 import，会把
   barrel 全量拉进 `shared.js`。
3. **NutUI 渲染的是 `<view>` 而不是 `div`**（为兼容 Taro）。它的 CSS 只写
   `display:flex`，靠 CSS 默认 `row`：
   - App 端引擎给「display:flex 无方向」补 `row + stretch`（`css/style.ts`），
     布局正确；
   - Web 端 `base-css.ts` 给 `view` 钉了 `flex-direction: column`，作者规则不写方向
     就沿用 column → Cell 标题/描述竖排、带文字的图标按钮里 svg 高度被压成 0。
   这是 fjs 自身既有的两端分歧（任何页面给 view 写 display:flex 不写方向都中招），
   按用户决定**另开 spec 修 web 端**，本 spec 不处理——已在 specs/140-web-flex-default-row 修复。

## 9. 验收结果

1. ✅ `pnpm --filter demo run typecheck`、`pnpm run typecheck` 全部 Done。
2. ✅ `pnpm --filter demo run build`、`build:web` 成功（app 构建的 perf 告警是既有
   `height: 0` 页面告警，vant 页同样有）。
3. ✅ `pnpm test`：fjs-runtime 782、fjs 393、fjs-webview 36、fjs-webgl 30 全过。
4. ⚠️ Web：首页分组、NutUI 两页可达，按钮颜色/渐变/朴素/禁用/形状正确；**布局
   受第 8 节 3 影响**（Cell 竖排、图标按钮图标不显示），待后续 spec。
5. ⚠️ iOS 模拟器：首页手风琴与 web 一致；`nutui-button` 颜色/渐变/圆角/朴素/禁用/
   图标+文字横排正确；`nutui-basic` Cell 行布局正确。已知小缺口：纯图标按钮里
   图标未垂直居中；Cell `desc` 未右对齐（`text-align: right` 在 flex:1 值盒上）。
6. ✅ 首页计数器保留在 hero，两端显示一致。
