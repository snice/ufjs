# Tasks: 182-vapor-vdom-interop

- [x] CLI：`bundler/vdom-libs.ts` 检测三方 VDOM 组件库，`fjs.vapor.interop` 强制开关；`test/vdom-libs.test.ts`
- [x] 别名：web `fjs/vapor` → `web.ts`、`vue` → `vapor/vue-interop.ts`；Flutter `fjs/vapor` / `fjs/vue` → 完整面（vite.ts / build.ts / vue-plugin.ts）
- [x] web interop 换 runtime-dom `render`，插槽桥接改占位元素 + vnode 钩子（作用域插槽参数）
- [x] VDOM 根拿 vapor 父的 provides / app 组件（`vapor/vdom-context.ts`），跨 vapor 插槽的 VDOM 父子 inject
- [x] 嵌套组件根的宿主范围（`rootsOf` 下钻），活节点通知
- [x] keep-alive：interop 子树的 activated / deactivated 挂到 vapor 父实例
- [x] Dart：`display: contents`（renderer 展开 + mirror_tree 脏标记），`test/display_contents_test.dart`
- [x] 单测 `test/vapor-interop-web.test.ts`、`test/vapor-page-transition.test.ts`（页面缓存钩子）
- [x] demo web 17 路由探针、iOS 16 路由遍历 + 抽查
