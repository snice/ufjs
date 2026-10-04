# Spec: demo 第二批扩展 NutUI 与 Vant 组件页（含 Vapor 覆盖）

- **ID**: 203-demo-vant-nutui-batch2
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

specs/068 起用 Vant、specs/139 起用 NutUI 量化 fjs 渲染管线对真实组件库的
兼容度，但两家的覆盖严重不均：

- **Vant** 已注册 ~44 个组件、8 个页面（basic / feedback / float / form /
  more / nav / watermark / vapor），常用组件基本扫过；
- **NutUI** 只注册了 5 个（Button / Cell / CellGroup / Divider / Tag）、
  2 个页面。表单、反馈、导航、浮层类（Input / Switch / Checkbox / Radio /
  Rate / Progress / Badge / Empty / Noticebar / Skeleton / Grid / Tabs /
  Popup / Toast / Swiper …）一个都没碰，NutUI 特有的写法
  （`var(--nut-x, 回退)` 内联回退、per-component css.mjs、rAF 驱动的
  Noticebar 跑马灯、SVG CircleProgress / icons）对这些类目的适配情况
  无人知道。

Vant 侧也还有一批常用组件没进 demo：Calendar / DatetimePicker（长列表 +
级联列）、TreeSelect / Cascader（层级选择）、DropdownMenu（菜单浮层）、
List / PullRefresh（滚动加载与下拉手势）、ImagePreview（命令式全屏浮层）、
Uploader（文件选择）。

另外 Vapor 覆盖只有 vant/vapor.vue 一页（Button / Cell / Switch /
Stepper）。specs/148/161/182 的 VDOM ⇄ Vapor 互操作对两家的覆盖都太薄：
NutUI 一个 Vapor 页都没有，vant 的 Vapor 页也没碰过浮层（Popup）和
Tabs 这类「内部用 Teleport / 状态驱动的复杂子树」。

目标：把两家的常用类目补齐到可对照的程度，**把暴露出来的适配问题记进
docs/css-compat.md 与本 spec 的「过程发现」**，该修引擎的在会话里修。

## 2. 不做什么（Non-goals）

- 不覆盖两家的全部组件。NutUI 的 Form/FormItem、Calendar、Uploader、
  Cascader、Signature、Video、Audio、Sku 等重型或低频组件不做；
  Vant 的 Contact* / Area / GoodsAction / Signature 等不做。
- 不做 NutUI 主题定制（ConfigProvider / CSS 变量覆盖），只用默认主题。
- 不动现有页面的既有内容；vant/vapor.vue 只**追加**区块，其他页面不碰。
- 不做小程序端验证（同 139）。
- 不为某个组件「包一层」绕过引擎缺口——缺了就记录，能小修引擎的按
  宪法流程修，修不动的写进已知差异。
- 不引入 unplugin 自动按需（理由同 specs/068）。

## 3. 用户可见的行为

### 3.1 注册（`demo/src/plugins/nutui.ts` + `nutui-components.d.ts` 同步）

NutUI 新增全局注册（沿用 per-component 入口 + `style/css.mjs`）：

Input、Textarea、Switch、Checkbox、CheckboxGroup、Radio、RadioGroup、
Rate、InputNumber、SearchBar、Badge、Progress、CircleProgress、Skeleton、
Empty、Noticebar、Image、Grid、GridItem、Tabs、TabPane、Steps、Step、
Pagination、Swiper、SwiperItem、Popup、Overlay、Toast、Dialog。

Vant 新增注册（`plugins/vant.ts`）：Calendar、DatePicker、TimePicker
（Vant 4 已把 DatetimePicker 拆成这两个）、TreeSelect、Cascader、
DropdownMenu、DropdownItem、List、PullRefresh、ImagePreview、Uploader。

### 3.2 新页面

| 页面 | 内容 |
|---|---|
| `nutui/form.vue` | Input / Textarea / Switch / Checkbox(Group) / Radio(Group) / Rate / InputNumber / SearchBar |
| `nutui/display.vue` | Badge / Progress / CircleProgress / Skeleton / Empty / Noticebar / Image / CountDown |
| `nutui/nav.vue` | Grid(GridItem) / Tabs(TabPane) / Steps(Step) / Pagination / Swiper(SwiperItem) |
| `nutui/float.vue` | Popup / Overlay / Toast（命令式）/ Dialog（命令式） |
| `nutui/vapor.vue` | `<script setup vapor>`：Button / Cell / Switch / Rate / InputNumber + Popup 探针 |
| `vant/pickers.vue` | Calendar / DatePicker / TimePicker / TreeSelect / Cascader / Uploader |
| `vant/scroll.vue` | List / PullRefresh / DropdownMenu(DropdownItem) / ImagePreview（命令式） |

`vant/vapor.vue` 追加：Tabs（tab 切换）、Popup（show/hide）、
Checkbox / Rate（v-model）区块。

### 3.3 页面写法（沿用 139 的约定）

```vue
<route>
{"title": "nutui: 表单", "group": "NutUI", "desc": "Input / Switch / Checkbox / Rate …"}
</route>
```

每个组件取 NutUI / Vant 文档的基础用法 + 1~2 个常用变体，配
`ref` 状态显示双向绑定结果，保证交互可验证（点击、滑动、切换）。

## 4. 两端约定（宪法 I）

全部组件两端同源注册（`.ts` 无平台后缀）；页面行为以 NutUI / Vant 官方
文档为准。两端做不到一致的地方逐条记入 `docs/css-compat.md` 的
「已知差异」并在本 spec「过程发现」列出。预期差异（提前声明，不是发现）：

| | Flutter | Web |
|---|---|---|
| Uploader 文件选择 | App 无文件选择器，只渲染触发区（点击无后续） | 完整可用 |
| NutUI Toast/Dialog 命令式 | 走 createApp/teleport 挂载路径，表现待验证 | 完整可用 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及——demo 层接入；若过程中暴露引擎缺口，另记于此并在
      tasks 里单列任务（预期候选：手势、rAF 循环、伪元素）。

## 6. 验收标准

1. `pnpm --filter demo run typecheck` 通过。
2. `pnpm test` 通过。
3. `pnpm --filter demo run build:release` 成功（app bundle 全量构建）。
4. 新增 7 个页面 + 扩展的 vapor 页在 `fjs dev`（Flutter App）与
   `fjs dev:web` 上都能打开、渲染、交互（v-model 状态条目随操作变化）。
5. 两端表现差异逐条记录（docs/css-compat.md「已知差异」或 spec 过程发现）。

## 7. 待澄清

- [ ] 无

## 8. 过程发现

**两端差异与适配（demo/vite/nutui.ts，与 vant.ts 同构的锚点补丁）**

1. **NutUI 命令式 Toast/Dialog 整条挂载线要重接**（对照 specs/137 的 vant）：
   `CreateComponent`（`dist/packages/mountComponent-*.js`）用 'vue' 的
   `createApp` + `document.createElement('view')` + `body.appendChild`；
   Toast 的更新路径用 'vue' 的 `render`。适配：`createApp`/`render` 从
   `fjs/vue` 拿，容器换 detached root，Dialog 的 `teleport="#id"` 改指
   `body`（runtime querySelector 只认 body/html，specs/129）。
2. **Toast 自动关闭依赖 `document.getElementById` + `body.removeChild`**，
   dom-env 没有这两个面。补丁在 mountComponent 模块里装了一个
   `id → detached root` 注册表：`getElementById` 查它，`removeChild` 命中
   detached root 时 `releaseDetachedRoot`——否则 toast 隐藏后容器永远留在
   屏幕上（泄漏）。
3. **`fjs/plugins` 桶按文件名字母序求值**：NutUI 的 raf 模块顶层
   `const _window = window`（raf-c01wDYCo.js），而 dom-env 原本由
   `vant.ts` 第一行 import——`nutui.ts` < `vant.ts`，NutUI 模块先于 shim
   求值，启动即 ReferenceError。解法：`src/plugins/00-dom-env.ts`（空插件
   体，import 即装 shim），`00-` 前缀保证先于一切库插件。
4. **Vapor 组件名严格匹配（本轮最大的坑）**：demo 页面默认 Vapor 编译
   （specs/177），vapor 的 `resolveComponent` 只试 `camelize(tag)` /
   `capitalize(camelize(tag))`，与注册名必须一字不差。NutUI 注册
   `NutSearchbar` / `NutCountdown` / `NutInputNumber`——模板必须写
   `<nut-searchbar>` / `<nut-countdown>` / `<nut-input-number>`；写
   `nut-search-bar`（直觉 kebab）在 VDOM 下只是 warning、页面其余照常渲染，
   在 Vapor 下是 throw、整页空白。这意味着 VDOM 时代的"页面能打开=通过"
   不再成立，对拍要看 DOM 内容量。
5. **Vant 4 没有 `DatetimePicker`**（v3 的组件，4.x 拆成 DatePicker +
   TimePicker），demo 注册与页面按 4.x 口径。
6. **Uploader 在 App 端没有文件选择器**：只渲染触发区，点击无后续（宪法 I
   登记的预期差异；web 端完整可用）。

**工程过程**

7. 改 `plugins/nutui.ts` 时一度把 139 批次的 Cell / CellGroup / Divider /
   Tag 的注册替换掉了（imports/样式/use 三处一起丢）——被探针
   （打印 `appContext.components` 的键）当场抓到。教训进了 bench：
   `bench/pages-203.ts` 把 139 的两页也纳入冒烟。
8. 无头冒烟（`bench/pages-203.ts`，fjsrun）抓不住第 4 条：bench 经 VDOM
   渲染器挂页面，解析失败是 warning；真实 app 壳是 Vapor。Vapor 相关回归
   必须到模拟器 / 浏览器（web 也是 Vapor 壳）上验。
9. nutui.ts 适配器第一版漏了把 `createApp` 本身从 'vue' 挪到 'fjs/vue'
   （只挪了 detached root 两个函数），Toast 点击时抛 shim 的
   createApp 报错——vant 的同位置补丁是整条 import 换掉，照抄不完整。

**iOS 模拟器逐页结果（iPhone 17 / iOS 26.5，release 构建）**

通过：vant/pickers（Calendar、DatePicker 定位到当天、TimePicker、
Cascader、Uploader 触发区）、vant/scroll 的 DropdownMenu（下拉 + 遮罩 +
勾选）与 ImagePreview（命令式全屏、网络图、点击关闭）、nutui/display
（Badge、Progress 2s 自增、**SVG CircleProgress**、Skeleton、Empty 插画）、
nutui/nav 的 Grid 与 Pagination、nutui/float（Popup 中部 + 遮罩点击关闭、
命令式 Toast、命令式 Dialog + onOk 再弹 Toast 的完整回调链）、
nutui/vapor（互操作挂载、点击 0→20、v-model、v-if）。web 端 10 页全部
通过（含 hash 直载与 SPA 导航两条路径）。

App 端遗留的适配缺口（本轮只记录不修，属组件库 CSS/布局与 fjs 的对接
问题， candidate for 后续 spec）：

| # | 现象 | 备注 |
|---|---|---|
| 1 | vant List 首次 `@load` 不触发，列表永远空 | 滚动父级探测不到（getScrollParent 在 App 返回 undefined），滚动监听也没挂上 |
| 2 | nut-switch 塌成整行宽长条 | **两端一致**（web 同样塌），NutUI 样式与 fjs 布局语义冲突 |
| 3 | nut-checkbox / nut-radio 图标渲染成巨大圆 | App 独有（web 正常），SVG 尺寸未约束 |
| 4 | nut-inputnumber 竖排塌（− / 输入框 / + 从上到下） | App 独有（web 正常横排） |
| 5 | nut-noticebar 跑马灯条目文字丢失（静态条目正常） | rAF 驱动的滚动文案 |
| 6 | nut-tabs 标题条整条灰、文字不显示（内容面板正常） | 与 5 同为"横向文字条"类问题 |
| 7 | nut-steps 溢出 2px，Flutter 画了 overflow 告警横幅 | 固定高度 vs 行高 |
| 8 | nut-swiper 主体高度塌 0，页面无法滚出内容 | Swiper mount 读 `window.innerWidth`（dom-env 故意 ~0） |
| 9 | nut-image 网络图加载失败（显示占位图；同页 vant 图片正常） | NutUI 自己的加载路径 |

命令式 Toast 自动关闭（clearToast 释放 detached root）未在模拟器专项
验证（toast 2s 后消失、无残留现象，间接符合预期）。
