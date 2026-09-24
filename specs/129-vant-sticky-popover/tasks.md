# Tasks: 129-vant-sticky-popover

- [x] T1 demo：vant-float 页、注册 Sticky / Popover、首页入口
- [x] T2 element.ts：parent resolver + parentNode/parentElement/nodeType/tagName/nodeName
- [x] T3 element.ts：tap 冒泡 + currentTapDispatch；renderer asDomEvent 用它
- [x] T4 renderer：注入 parent resolver、attribute sink；querySelector('body') → overlay 宿主
- [x] T5 runtime 测试（冒泡、stopPropagation、parentNode；unmount 测试按冒泡改写）
- [x] T6 dom-env：scroll-view 的 overflowY；Element / HTMLElement；document 盒子
- [x] T7 element：scrollTop/scrollLeft/clientTop/clientLeft（popper 坐标 NaN）
- [x] T8 Dart：overlay 宿主按 z-index 叠放
- [x] T9 Dart：overflow 裁剪外画阴影 + 测试；css parser 展开 overflow 简写 + 测试
- [x] T10 属性选择器（data-* 等）+ 引擎属性状态 + 测试
- [x] T11 元素 currentColor、calc 乘除折叠（修百分比 ×100）+ 测试
- [x] T12 Dart：border-box 尺寸下限、单边颜色沿用 border-width + css_triangle_test
- [x] T13 模拟器验证 Popover（浅色/深色/水平/自定义/选中回显/阴影/箭头）、Sticky；web 回归
- [x] T14 docs：ui-api.md、css-compat.md、vue3.md
- [x] T15 typecheck / runtime test / flutter test 全量
- [x] T16 伪元素盒的按下 target 映射回宿主元素（Popover 再点关闭）
- [x] T17 fixed 取消时挪回原父节点 + 测试（Sticky 回滚解除）
