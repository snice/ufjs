# Spec: web 端组件根元素不被 flex 压缩（对齐 Flutter）

- **ID**: 180-web-shrink-parity
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

vapor-app 动画页在 web 上不断添加行后，下面的 swiper 被压到 0 高（Flutter 上正常）。原因：Flutter 的
Column / Row 子元素保持自然尺寸、超出就溢出（或由 scroll-view 滚动）；web 的 flex 默认 `flex-shrink: 1`，
先压缩子元素再溢出。base CSS（`web/base-css.ts`）已给 `view` / `text` / `scroll-view` 等标签设了
`flex-shrink: 0`，但组件渲染出的根元素漏了。实测（高度 100px 的列里放全部 fjs 标签）会被压缩的：
`image`、`button`、`input`、`textarea`、`swiper`（0 高）、`divider`（0 高）、`radio-group`、`checkbox-group`、
`slider`、`picker-view`（0 高）、`label`、`form`、`stack`。

### 附带发现：插槽里的组件拿不到页面的 scoped 样式（两端 vapor）

排查时发现动画页 swiper 在 web 上是 200px（组件默认），而页面写的是 `.sw { height: 120px }`（scoped），
iOS 上是 120。原因：web 上页面根 `<scroll-view>`、`<form>`、`<checkbox-group>` 本身是组件，写在它们里面的
组件（swiper、input、switch、button、checkbox……）是在**插槽**里创建的；vapor 运行时把父组件（渲染插槽的那个）
的 scope id 给子组件根，而 Vue 的规则是给**写这段模板的组件**（slotScopeIds）。于是页面给这些组件写的 scoped
class 全部失效。Flutter 上 scroll-view / form 是原生标签不是组件，所以多数场景没暴露，但 Flutter 的组件型标签
（list-view、picker、form…）里同样会中招。

修复（`vapor/runtime.ts`）：`createComponent` 给传入的每个插槽记下作者（写模板的实例）；插槽运行时在一个带作者
标记的 effect scope 里执行，期间创建的组件（以及之后 v-if 等在其中重跑时创建的组件）从作者取 scope id；
组件自己的模板里清掉作者。实例树上的父子关系（provide / inject、生命周期）不变。

## 2. 不做什么（Non-goals）

- Flutter 不动；不改各组件自己的尺寸。
- 页面 / 用户样式里显式写的 `flex` / `flex-shrink` 不受影响。

## 3. 用户可见的行为

上述组件在 web 的 flex 容器里保持自然尺寸，内容超出时由 scroll-view 滚动（或溢出），与 Flutter 一致。
页面写 `flex: 1` / `flex-shrink: 1` 仍然生效（新规则用 `:where()`，优先级为 0）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 组件根元素在主轴上 | 自然尺寸，不压缩 | 同（本 spec） |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm test` 通过；新增单测断言 base CSS 覆盖上述组件根元素且优先级为 0；插槽内组件根带页面 scope id（含之后 v-if 翻转时创建的）。
2. 浏览器：同一探测页里上述组件 `flex-shrink` 均为 0、高度为自然高度；vapor-app 动画页连续添加行后
   swiper 高度不变（120px），外层 scroll-view 可滚动；VDOM（`enableVapor: false`）同样。

## 7. 待澄清

无。
