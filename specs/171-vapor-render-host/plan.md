# Plan: render 函数组件在纯 vapor 下运行

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | render-host 一份实现两端共用；标签注册模块分 `vapor/tags/web` 与 `vapor/tags/flutter` |
| II | 否 | 不改 op / natives / 事件类型 |
| V 静默失效是 bug | 是 | 不支持的 vnode 类型、字符串 ref、Teleport 无目标、swiper circular 都告警；没加载 render-host 时报明确错误 |
| VI | 是 | render-host 顶部注释写清「为什么是适配器而不是逐个重写」与它不是通用渲染器 |
| VII | 是（全在 JS） | — |
| VIII | 是 | `docs/vue3.md`、`docs/vapor-contract.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 执行器 | `vapor/render-host.ts`（新） | mount / patch / keyed 子节点 / 组件 / Teleport / 插槽 Block 标记与缓存 / attrs 并入根 / update 钩子 |
| 组件层 | `vapor/runtime.ts`、`vapor/instance.ts` | props 归一化（Boolean / 默认值工厂）、`setRenderHost`、`exposedRefOf`、标签表 `registerTagComponent`、父 scope 落子根、`onBeforeUpdate/onUpdated`（render-host 实例）、双模 `resolveDynamicComponent` |
| 标签注册 | `vapor/tags/{web,flutter}/*.ts`（新） | 每个组件型标签一个注册模块 |
| 编译 | `vapor/sfc-tags.ts`、`vapor/sfc-compiler.ts` | web vapor 的组件型标签判定；注入 `import "fjs/tag/<tag>"` |
| 后端 | `vapor/web-dom.ts`、`vapor/backend-flutter.ts`、`vapor/host.ts` | web：样式名连字符化 + 数值规范化、touch 事件；Flutter：静态属性补写；`parentNode` |
| 组件小修 | `components/{defer,form,picker,rich-text}.ts`、`web/components/{swiper}.ts` | 双模生命周期 / resolveDynamicComponent；swiper 认标记页 |
| CLI | `bundler/vue-plugin.ts`、`bundler/build.ts`、`vite.ts` | `tagModulePlugin`、Flutter 分包把用到的 `fjs/tag/*` 放进共享清单、vite 解析 |

## 3. 被否掉的备选

- 逐个组件写 vapor 渲染壳（B）：用户选了适配器路线（工作量 5–10 倍、两份渲染代码长期同步）。
- 应用级静态注册全部标签：会把 web 组件全表（~100 KB）带回 enableVapor 包，抵消 specs/168。
- render-host 由纯入口静态加载：只用 view / text 的应用平白多 ~10 KB——改由标签模块引入。
- 标签模块打进 Flutter 页面 chunk：相对导入会复制有状态模块（host-ops 元素表、路由）——放共享清单。

## 4. 风险

- render-host 的 keyed 重排对 vapor 片段（节点表顺序 ≠ DOM 顺序）只在重排时移动；位置式比对不移动。
- `vue` 在测试里不是 vue-pure：web 组件依赖双模生命周期，测试用 `vi.mock('vue')` 与构建对齐。
