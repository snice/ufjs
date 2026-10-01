# Spec: vapor web 包体——样式注入拆成叶子模块

- **ID**: 168-vapor-web-size
- **状态**: done
- **日期**: 2026-10-01
- **分支**: 168-vapor-web-size（从 167-vapor-runtime-fixes 切出）

## 1. 要解决什么

enableVapor 的 web 包体只比同内容 VDOM 应用小约 19%（vapor-app：214.2 KB / gz 76.5 KB vs
257.0 KB / gz 94.3 KB，2026-10-01 实测）。`fjs build --web --analyze` 拆账：页面 chunk 依赖的
一个 ~100 KB chunk 里装着 canvas 2d、form、rich-text、picker、swiper、list-view、
page-container、textarea…… **全部 VDOM web 组件**，而示例页面只用 view / text。

根因：每个带 `<style>` 的 SFC，编译器在 web 构建里注入
`import { injectStyle } from 'fjs/web'`（`vue-plugin.ts` 两处，vite 经
`compileVaporSfcModule` 共用其一），而 `fjs/web` 入口（`web/index.ts`）静态导入
`./components`（整张 VDOM 组件表）。纯 vapor 应用里这些组件**永远不会被实例化**——vapor
模板把 fjs 标签编成原生元素，组件表是空的——它们只是被一个样式函数拖进包里。

VDOM web 应用同样为每个 SFC 付这条边，但它们本来就经 `installFjsWeb` 注册全部组件，不受影响。

## 2. 不做什么（Non-goals）

- 不做 VDOM web 应用的按需组件注册（`installFjsWeb` 仍注册全表；按模板用到的标签导入是另一件事）。
- 不动 base-css（26 KB）、vue-router（25 KB）、Flutter 端包体（renderer 原语层另立 spec）。
- 不改样式注入的行为（去重 key、`rewriteFjsCss` 改写、插入 `document.head`）。

## 3. 用户可见的行为

页面源码不变。`fjs build --web` / vite 产物里，SFC 的样式注入改从叶子模块导入；
enableVapor 应用的包体不再含 VDOM web 组件。`import { injectStyle } from 'fjs/web'`
仍可用（re-export），用户代码不受影响。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 不涉及（Flutter 走 registerStyles，不经 injectStyle） | 样式注入同一实现，只换导入位置 |
| 已知差异 | 无 | 无 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及。新增内部 specifier `fjs/web-style`（只出现在编译器生成的代码里）。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 全绿；CLI 单测断言 web 构建的 vapor / VDOM SFC 产物
   从 `fjs/web-style` 导入 `injectStyle`。
2. `examples/vapor-app`：`fjs build --web --analyze` 不再出现 `web/components/`、
   `canvas/context-2d`、`rich-text/layout` 等模块；总量与 gz 较 214.2 KB / 76.5 KB 下降并记录数字；
   仍无 runtime-dom / createRenderer。
3. vapor-app 生产包与 vite dev 在浏览器中：样式生效（标题粗体、计数色随 v-bind 变化）、
   点击 / 导航 / 返回正常，控制台无报错。
4. VDOM 回归：`hello-fjs` `build:web`（vite）与 `fjs build --web` 构建成功，浏览器打开组件页样式正常。

## 7. 待澄清

无。

## 8. 结果（2026-10-01）

vapor-app enableVapor web：214.2 KB / gz 76.5 KB → **116.3 KB / gz 43.7 KB**（−46% / −43%；
同内容 VDOM 257.0 / 94.3 KB），analyze 里 `web/components/*`、canvas、rich-text 全部消失，
runtime-dom / createRenderer / fjs-vapor-root 仍为 0。浏览器：vapor-app 生产包与 vite dev
样式（scoped、`v-bind()` 变色）、点击、导航、返回正常；hello-fjs 的 vite 与 `fjs build --web`
两种产物 flat-4050 vapor 网格样式正常，无控制台错误。typecheck 全绿，runtime 895 / cli 452。
