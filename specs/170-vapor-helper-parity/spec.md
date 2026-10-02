# Spec: vapor 运行时补齐 compiler-vapor 的 helper 与组件层能力

- **ID**: 170-vapor-helper-parity
- **状态**: done
- **日期**: 2026-10-01
- **分支**: 170-vapor-helper-parity（从 169-vapor-flutter-size 切出）

## 1. 要解决什么

为把内置 7 组件改写成 vapor 组件（原定 spec 170，现顺延为 172）做调研时发现：自研 vapor 运行时
**缺 33 个 compiler-vapor 会生成的 helper**（对照 `@vue/compiler-vapor@3.6.0-rc.9` 的全部
`helper(...)` 调用与 `@vue/runtime-vapor@3.6.0-rc.9` 的导出，2026-10-01）。页面一用到对应写法，
模块加载即 `TypeError: _xxx is not a function`——**两端都是**：

| 写法 | 缺的 helper |
|---|---|
| 模板 ref `ref="el"` / `:ref` / v-for 里的 ref | `createTemplateRefSetter` `setTemplateRefBinding` `setStaticTemplateRef` |
| `v-show` | `applyVShow` |
| `v-model`（原生 input/textarea/select/checkbox/radio、动态 type） | `applyTextModel` `applyCheckboxModel` `applyRadioModel` `applySelectModel` `applyDynamicModel` |
| `:value` 绑在 input/textarea 上 | `setValue` |
| `v-bind="obj"` / `v-on="obj"` | `setDynamicProps` `setDynamicEvents` `onBinding` |
| 事件修饰符 `.stop/.prevent/.enter…` | `withVaporModifiers` `withVaporKeys`（web 端还缺 `withModifiers` `withKeys`） |
| 带 key 的块 / 动态 `:key` 的元素 | `createKeyedFragment` `setBlockKey` |
| `v-html` / `textContent` / DOM 属性 | `setHtml` `setElementText` `setDOMProp` |
| props 解构默认值 / 剩余 | `getDefaultValue` `getRestElement` |
| `v-once` / 自定义指令 / 动态标签 | `withOnce` `withVaporDirectives` `createPlainElement` |
| v-for 选择器优化 / 事件包装 | `createSelector` `createInvoker` `insert` `extend` |
| `<Transition>` `<TransitionGroup>` `<KeepAlive>` `<Teleport>` | `VaporTransition` `VaporTransitionGroup` `VaporKeepAlive` `VaporTeleport` |

组件层另有三处静默缺失（7 组件的 vapor 壳都依赖）：

1. **attrs 透传**：`mountVaporComponent` 的 `attrs` 恒为 `{}`，未声明为 prop 的 class / style / `on*`
   全进了 props、也不落到根元素——`<my-comp class="x" @tap="f">` 两样都丢。
2. **作用域插槽参数**：`createSlot(name, rawProps)` 丢掉 rawProps，`<slot :item="x">` /
   `#default="{ item }"` 拿不到参数。
3. **expose**：`expose()` 是空操作，父组件 `ref` 到子组件拿不到任何东西（canvas 的
   `getContext` 就靠它）。

## 2. 不做什么（Non-goals）

- 纯 vapor web 的基础标签行为（input 事件、image、scroll-view 载荷、swiper…）：spec 171。
- 内置 7 组件 vapor 化：spec 172。
- SSR / hydration 相关分支（runtime-vapor 里 `isHydrating` 的路径）。
- VDOM 路径不动（VDOM 原生元素 v-model 仍按 docs/vue3.md 不支持）。

## 3. 用户可见的行为与决策

- **守护规则**：compiler-vapor 可能生成的每个 helper，两端 vapor 入口（`vapor/index.ts`、
  `vapor/flutter-pure.ts`、`vapor/web.ts`、`vapor/web-pure.ts`）都必须导出——实现了的按 Vue 语义，
  做不到的导出一个**首次调用 warnOnce 并降级**的版本，不再 ReferenceError（宪法 V）。单测从
  compiler-vapor 的 dist 里抽 helper 全集对照，编译器升级多出新 helper 时测试直接红。
- **ref**：元素 ref 拿到宿主节点（Flutter 是 fjs Element，web 是 DOM 节点）；组件 ref 拿到其
  `expose()` 的对象（未调用 expose 时为空对象，与 Vue 的 `<script setup>` 默认一致）；`ref_for`
  数组语义、函数 ref、`ref_key` 都按 Vue。卸载时置 null。
- **v-show**：两端都写 `display: none` / 还原（Flutter 经样式引擎，与 VDOM 的 vShow 同语义）；
  `<Transition>` 联动按下条降级。
- **v-model**（决策）：`applyTextModel` 两端实现——web 是原生 `input` 事件 + `value`；Flutter 是
  `textChanged` 事件 + `value` prop（fjs 的 input 元素契约），`.trim/.number/.lazy` 照 Vue。
  checkbox / radio / select / 动态 model：web 按 Vue 实现；Flutter 没有对应原生元素（fjs 的
  `<switch>` `<checkbox>` 是自己的标签，模板里 v-model 不会编译到它们上），调用即 warnOnce 并
  不绑定。文档写明「vapor 的原生 v-model 两端支持 text，VDOM 仍不支持」。
- **修饰符**：`.stop/.prevent/.self` 与按键修饰符按 Vue。Flutter 端沿用 vue-shim 的
  withModifiers：tap 以 renderer 的事件对象到达，`stopPropagation` 是真的（tap 会冒泡），`.stop`
  生效（vapor-own.test.ts 已覆盖）；按键修饰符直通（fjs 事件无键码，与 VDOM 路径一致）。
  （初稿写的「Flutter 端 .stop 告警忽略」是错的，实施时据既有测试更正。）
- **v-html**：web 设 innerHTML；Flutter 没有 HTML 解析——warnOnce，按纯文本写入（提示用 `<rich-text>`）。
- **Transition / TransitionGroup / KeepAlive / Teleport**（决策）：本 spec 降级——Transition /
  TransitionGroup 直接渲染子内容不做动画、KeepAlive 直接渲染当前组件不缓存、Teleport 原地渲染；
  各自首次使用 warnOnce。完整实现另立 spec。
- **attrs**：未声明为 prop 的键进 `attrs`；组件块只有一个根元素且未设 `inheritAttrs: false` 时，
  attrs 透传到根：class 与根自身的 class 合并、style 合并（父覆盖子）、`on*` 叠加、其余作 prop/attr。
  多根或 `inheritAttrs: false` 不透传（组件自己用 `attrs` / `useAttrs()`）。
- **作用域插槽**：`createSlot(name, rawProps)` 把 rawProps 包成 getter 对象传给插槽函数，插槽内读
  参数可被追踪；`createForSlots`（动态插槽列表）一并实现。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| helper 面 | 同一份 `vapor/host.ts` / `runtime.ts` 实现，后端差异走 VaporBackend 新增可选成员 | 同左 |
| v-model text | `textChanged` + `value` | `input`/`change` + `value` |
| v-model 其余类型 | warnOnce | 按 Vue |
| v-html | warnOnce + 文本 | innerHTML |
| `.stop/.prevent` | 生效（tap 事件对象） | 按 Vue |
| 事件载荷 | 不变（字符串） | 不变 |

## 5. 契约变更（宪法 II）

- [x] UI op / natives / 事件类型都不涉及。VaporBackend（JS 内部 seam）新增可选成员，文档
  `docs/vapor-contract.md` 同步。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 全绿。
2. 守护单测：compiler-vapor helper 全集 ⊆ 四个 vapor 入口的导出。
3. 两端单测（Flutter 后端 + happy-dom web 后端，真实编译的 vapor SFC）：元素 ref / 组件 ref +
   expose / v-for ref 数组；v-show 切换；v-model text（含 .trim/.number/.lazy）；`v-bind="obj"` /
   `v-on="obj"`；`.stop`（web）/ 按键修饰符；动态 key 重建；attrs 透传（class 合并、style 合并、
   事件叠加、inheritAttrs:false、多根不透传）；作用域插槽参数随源更新；Transition/KeepAlive/
   Teleport 降级渲染 + 告警各一次。
4. 回归：bench `vapor` 同量级；demo vapor-check / nav-vapor 输出不变；vapor-app check 通过；
   vapor-app web 生产包浏览器冒烟。
5. 文档：`docs/vue3.md`（vapor 支持矩阵：上表）、`docs/vapor-contract.md`。

## 7. 待澄清

无（v-model / 修饰符 / v-html / 四个内置组件的取舍已按上面「决策」定，依据：两端一致、
不静默、与 VDOM 现状不冲突；用户授权按此推进）。

## 8. 结果（2026-10-01）

- compiler-vapor 的 helper 全集在四个 vapor 入口全部可解析（守护测试读编译器 dist 对照）。
- 行为测试：web 11 条（ref / expose / v-for ref、v-show、v-model 各类型与修饰符、v-bind/v-on 对象、
  事件与按键修饰符、v-html / v-once / :key 重建 / 动态原生标签、selector、attrs 透传、inheritAttrs:false /
  多根 / useAttrs、作用域插槽、内置组件降级告警）；Flutter 3 条（ref、v-show、textChanged↔value 的
  v-model、透传 class 合并与 tap 叠加、作用域插槽更新）。
- 顺带修：同一元素多个监听在 Flutter 端被后注册者覆盖（host 层多路分发）；空 `<script setup vapor>`
  在不设 descriptor.vapor 的 compiler-sfc 上被重注 `vapor` 导致 Duplicate attribute。
- 回归：runtime 932 / cli 455 全绿，typecheck 全绿；demo vapor-check / nav-vapor 输出不变；vapor-app
  check 通过；bench 同时段 A/B 在噪声内；vapor-app web 生产包浏览器冒烟正常。
- 更正：初稿「Flutter 端 .stop 告警忽略」有误（tap 事件对象的 stopPropagation 是真的），已按实情改。
