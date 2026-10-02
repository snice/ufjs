# Tasks: render 函数组件在纯 vapor 下运行

## 实现

- [x] T010 vapor 组件层 props 归一化（Boolean 转换、默认值工厂按实例）
- [x] T011 `vapor/render-host.ts`
- [x] T012 runtime 接线：setRenderHost / exposedRefOf / 标签表 / update 钩子 / 后端 parentNode
- [x] T013 web-dom：样式名连字符化与数值规范化、原生元素 touch 事件
- [x] T014 标签注册模块（web 28 个、Flutter 7 个），render-host 由它们引入
- [x] T015 编译器：web 组件型标签判定、注入 `fjs/tag/*` 导入（下划线别名的正则修正）
- [x] T016 CLI：tagModulePlugin、Flutter 分包共享清单、vite 解析
- [x] T017 组件小修：双模生命周期 / resolveDynamicComponent；picker 带上 modal / picker-view；swiper 认标记页
- [x] T018 实施中发现并修：Flutter 端 vapor 模板静态属性丢失；父 scope id 落子组件根元素

## 测试

- [x] T030 `vapor-render-host-web.test.ts`（web 标签与内置组件、注入、scoped 根）
- [x] T031 `vapor-render-host-flutter.test.ts`（静态属性、7 个内置组件）
- [x] T032 更新 `vapor-flutter-pure.test.ts`

## 验收

- [x] T050 typecheck / test
- [x] T051 包体（vapor-app：web +4.3 KB / Flutter +1.3 KB 相对 spec 170；表单页 chunk 只在该页加载）
- [x] T052 vapor-app 表单页：web 生产包 + iOS 模拟器实测
- [x] T053 回归：demo vapor-check / nav-vapor、bench、hello-fjs 两种 web 构建
- [x] T054 文档
