# Tasks: 180-web-shrink-parity

- [x] T1 base-css：组件根元素 `:where(...) { flex-shrink: 0 }`
- [x] T2 单测（规则文本；happy-dom 不支持 :where，computed 行为在真实浏览器验证）
- [x] T3 附带：插槽内组件的 scoped id 取模板作者（runtime.ts slot authorship）+ 单测（无修复时失败）
- [x] T4 浏览器：探测页全部组件根 flex-shrink 0、页面规则仍可覆盖；动画页加 8 行后 swiper 保持 120px、scroll-view 可滚；true / false 一致
- [x] T5 vapor-app Flutter check；全量 runtime 959 / CLI 446

## 备注
- 会话中出现过一次 `insertBefore … not of type 'Node'`（vapor 页挂载时），发生在临时探测页刚创建、dev server 路由表尚未更新时；
  之后干净重载与「打开页面时重启 dev server」均未复现，未追查
