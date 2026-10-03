# Plan: demo 第二批扩展 NutUI 与 Vant 组件页

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 所有插件注册与页面 `.ts` 无平台后缀；两端差异逐条登记 docs/css-compat.md（或 spec §8），预期差异（Uploader 文件选择、命令式 Toast/Dialog 的 App 表现）在 spec §4 预先声明。 |
| II 边界即契约 | 否 | 三张运行时表不动；纯 demo 层。若引擎缺口需要动 runtime/Dart，先在 spec §8 登记，改协议另开 spec。 |
| III 同步单线程零序列化 | 否 | 不涉及。 |
| IV 外观照 WeUI | 否 | 组件外观来自 NutUI/Vant 自带样式，非内置组件。 |
| V 静默失效是 bug | 是 | 页面状态条目（v-model 结果）显式显示，交互无效肉眼可见；插件注册两端必须同名（沿用 139 的 no-suffix 规则）。 |
| VI 注释记录权衡 | 是 | 插件注册处注释沿用既有风格（为什么 per-component 入口、为什么两端同注册）；页面注释记「本页在测什么」。 |
| VII JS 能包就不要下 Dart | 是 | 全部 JS 侧第三方库直接跑，不下 Dart。 |
| VIII 变更落到文档 | 是 | 引擎缺口→docs/css-compat.md 已知差异；新页面属于 demo 自身，无需更新文档地图。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| demo 注册 | `demo/src/plugins/nutui.ts` | 新增 ~30 个 per-component import + `app.use` |
| demo 类型 | `demo/src/nutui-components.d.ts` | 与上表同步 |
| demo 注册 | `demo/src/plugins/vant.ts` | 新增 10 个 import + style + `app.use` |
| demo 页面 | `demo/src/pages/nutui/{form,display,nav,float,vapor}.vue`（新） | NutUI 四类目 + Vapor |
| demo 页面 | `demo/src/pages/vant/{pickers,scroll}.vue`（新） | 长列表选择器 + 滚动/浮层 |
| demo 页面 | `demo/src/pages/vant/vapor.vue` | 追加 Tabs / Popup / Checkbox / Rate 区块 |
| 文档 | `docs/css-compat.md` | 新发现的已知差异 |

不涉及：`packages/fjs-runtime`、`packages/flutter_fjs`、`@ufjs/cli`。若接入过程
暴露引擎缺口，先小修（宪法 II 只增不改），并在 spec §8 记录。

## 3. 方案

- **注册方式**照抄现状：NutUI 走 `dist/packages/<comp>/index.mjs` +
  `<comp>/style/css.mjs`（barrel 会静态引入全部 ~80 组件，139 已否决）；
  Vant 走 `vant` 命名导出 + `vant/es/<comp>/style/index.mjs`。
  命令式 Toast/Dialog 不进 `app.use`（它们是函数），页面从
  `dist/packages/toast/index.mjs` 具名导入函数调用；类型补进
  `nutui-modules.d.ts` 或页面内 `typeof import(...)`。
- **页面结构**照抄现有页：`<route>` 块声明 title/group/desc →
  scroll-view 包 `.page`，每个组件一个 `.block`，操作结果用 `ref` 显示
  （`{{ taps }}` 次、`{{ value }}`），保证「静默失效」可见。
- **Vapor 页**沿用 vant/vapor.vue 的口径：`<script setup vapor lang="ts">`，
  注释说明 NutUI 是编译后的 VDOM 组件、靠互操作挂载；加一个 Popup
  show/hide 探针（测 Vapor 树里 Teleport/overlay 类子树的挂载与卸载）。
- **vant/scroll.vue** 的 List 用滚动到顶/底生成假数据；PullRefresh
  `v-model` loading 2s 后收起；ImagePreview 用 `showImagePreview([...])`
  命令式打开（App 端表现即探针）。
- **vant/pickers.vue** 的 Calendar 用 popup 内嵌形态；DatetimePicker
  v-model 到 Date；TreeSelect/Cascader 各取文档最小数据集。

**被否掉的备选**
1. *unplugin-vue-components 按需*：Vite 插件帮不到 app 构建（specs/068 已否）。
2. *一次吃下两家全部组件*：发现问题后没有余量逐个定位，保持分批节奏。
3. *NutUI 单独再开 spec*：本次诉求就是两家一起补，开销一致。

## 4. 风险

1. **NutUI Swiper / Noticebar / CircleProgress 的 rAF 与触摸手势**在 App 端
   （同步 JS、手势走 fjs 事件）可能不转圈或不滑动——预期是最可能出问题的三个，
   逐个记录、小修优先。
2. **命令式 Toast/Dialog 在 App 端的 createApp/teleport 路径**：139 只验证过
   组件式挂载； specs/137 处理过 vant 的同类问题，方案可复用但不能假设直接可用。
3. **TreeSelect/Cascader/DatetimePicker 的滚动定位**（`scrollIntoView` 类 API）
   在 App 端 scroll-view 上可能无对应物。
4. 页面数 +7 会让 demo 首页变长——目录是手风琴，可接受，不另做导航改动。
