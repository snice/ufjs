---
name: ufjs-app-dev
description: ufjs 应用开发的核心心智与工作方式。当你在 ufjs 项目（含 fjs.config / src/pages / @ufjs/runtime 依赖的仓库）里写或改任何页面、组件、模块代码之前先读这篇；尤其是当你发现自己想用 window、document、localStorage、完整 CSS 或任意 HTML 标签时。
---

# ufjs App 开发核心心智

## ufjs 是什么

用 **Vue 3 + TS 写业务，Flutter 做渲染**。一份源码，三个目标端：

- **App**（iOS / Android / 鸿蒙）：JS 引擎嵌在 Flutter 应用里，节点操作编码成二进制帧交给 Flutter Widget 树；
- **Web**：真 Vue + DOM 适配层，浏览器直接跑；
- **微信小程序**：编译期直译 WXML（Skyline + glass-easel），不引入 Vue 运行时。

## 最重要的心智：这不是浏览器

ufjs **不是 WebView，也不是完整浏览器**。按 Web 习惯写会静默失效而不是报错：

- **没有** `window` / `document` / `localStorage` / `history` —— 需要 DOM 形状 API 时用元素上的方法（`getComputedStyle` 等，见 ui-api「元素上的 DOM 形状 API」节）；
- **标签是白名单**：31 个内置元素标签 + 7 个 JS 组件标签，共 38 个。写别的标签不会报错，会被当成 Vue 组件然后回落成 `view`；
- **事件是 props**：模板里 `@tap` / `@scrolltolower`，编译成 `onTap` 这样的 prop；**事件载荷一律是字符串**（结构化数据是 JSON 字符串，自己 parse）；
- **CSS 是子集**：没有 `display: grid`、没有 `vw/vh`、`filter` 不支持、滚动相关表现不同。**写任何不寻常的样式前先 `query_css`**。

## 写码前的固定动作

MCP 工具回答的是**你当前安装的 runtime 版本**的真实支持范围，比记忆和网上文章可靠：

1. 不确定某个标签的 props / 事件 → `get_tag {name}`；
2. 不确定某条 CSS 支持与否 → `query_css {property, value?}`；
3. 想系统了解某块行为（弹层、路由、分包）→ `search_docs` / `get_doc`；
4. 列出全部可用标签 → `list_tags`。

## 三端一份代码

App 和 Web 由同一份 Vue 源码生成；小程序是第三条产物路径（`fjs build --mp`）。
两端/三端的差异都有明确清单（`get_doc css-compat` 的「已知差异」节）。原则：
**面向用户的能力要么三端都成立，要么明确只对某端写并知道后果**——只在一端
验证过的代码等于没验证。

## 页面结构惯例

- 页面放 `src/pages/`，`fjs create page <name>` 生成（支持 `user/[id]` 动态路由）；
- 页面级滚动要显式用 `scroll-view`（见 ufjs-ui 技能）；
- 路由：`fjs routes` 查看；`fjs/router` 导入跳转（App 端映射 Flutter Navigator）。

## 深入资料

`get_doc` 可读的内置文档：`ui-api`（标签/事件/样式全集）、`css-compat`（CSS
支持矩阵）、`vue3`、`routing`、`modules`、`miniprogram`、`overlay-host`、
`third-party-components`、`canvas-compat`、`fjs-go`、`toolchain`。
