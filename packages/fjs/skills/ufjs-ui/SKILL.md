---
name: ufjs-ui
description: 写 ufjs 页面的标签、样式、事件实操约束与常见坑。写 <template>、写样式、接事件，或页面"看起来不对/点了没反应/不滚动"时读这篇。事实查询用 MCP 工具 get_tag / query_css / list_events，不要凭 Web 经验假设。
---

# ufjs UI 实操：标签 / 样式 / 事件

## 标签

38 个白名单标签（`list_tags` 可列全）：

- **31 个内置元素标签**：`view` `text` `image` `inner-canvas` `button` `input`
  `scroll-view` `list-view` `swiper` `swiper-item` `stack` `safe-area` `divider`
  `progress` `switch` `checkbox` `radio` `radio-group` `checkbox-group` `slider`
  `picker-view` `picker-view-column` `label` `form` `modal` `page-container`
  `refresh` `sticky-header` `sticky-section` `nested-scroll-header`
  `nested-scroll-body`；
- **7 个 JS 组件标签**（不是原生元素，宪法 VII 的"JS 能包就不下 Dart"）：
  `canvas` `defer` `form` `list-view` `picker` `rich-text` `textarea`。
  `form` / `list-view` 同时出现在两份名单里，按组件处理。

每个标签的 props / 事件**先查 `get_tag`**，不要猜。

## 高频坑（每一例都静默失效，不报错）

1. **页面不滚动**：页面根不会自动滚，滚动区域必须显式 `scroll-view`
   （`scroll-x` / `scroll-y` 选轴）。
2. **`position: fixed`**：能写，但元素会进 overlay 宿主——不随页面滚动、随页面
   转场、参与系统返回拦截。弹层/浮层的完整契约见 `get_doc overlay-host`。
3. **默认 flex 方向是纵向**：和 CSS 的 `row` 默认相反。
4. **文本截断**：没有 `word-break` / `text-overflow`，用 `max-lines` +
   `overflow: ellipsis`（`text` 标签属性）。
5. **不支持**：`display: grid`、`vw/vh/vmin/vmax`、`filter` / `backdrop-filter`、
   `min-content` / `max-content`。`query_css` 会逐条回答。
6. **`text` 嵌套**：`text` 里的 `text` 是同段落行内片段（各带颜色/字重），但片段上
   的 margin/padding/border/宽高无效。
7. **选择器子集**：伪类只有 `active` `hover` `first-child` `last-child` `disabled`；
   伪元素只有 `::before` `::after` `::placeholder`；不支持的选择器会**丢掉整条规则**。

## 事件

- props 形式：模板 `@tap` → `onTap`，`@scrolltolower` → `onScrolltolower`
  （边缘/行高事件用全小写拼写，camelCase 是 h() 调用的别名）；
- **载荷一律字符串**；结构化载荷（如 scroll 六字段、form 的 `{name: value}`）是
  JSON 字符串，处理时 `JSON.parse`；
- 完整事件表 `list_events`；载荷形状在 `get_doc ui-api` 的「事件」一节。

## 样式

三种写法：`style` 属性（对象或字符串）、`class` + `<style scoped>`。
`<style scoped>` 是默认且推荐的隔离方式。App 端没有浏览器级层叠——同属性
后者覆盖、特异性近似 Web 但不完全等价，拿不准就 `query_css` + 真机看效果。

## 交互自查清单

写完一个页面后，按序验证：

1. `query_css` 过一遍用到的非常规样式（fixed / sticky / 动画 / 单位）；
2. 滚动容器是否显式 `scroll-view`；
3. 事件载荷是否按字符串处理；
4. 跑起来后用 `dump_tree` 看真实元素树是否符合预期（见 ufjs-debug）。
