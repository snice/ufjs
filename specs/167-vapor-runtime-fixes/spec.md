# Spec: 自研 vapor 运行时正确性修复 + enableVapor 下 pinia / 路由可用

- **ID**: 167-vapor-runtime-fixes
- **状态**: done
- **日期**: 2026-10-01
- **分支**: 167-vapor-runtime-fixes（从 161-own-vapor-runtime 切出）

## 1. 要解决什么

2026-10-01 对 specs/161–166 的 review + 探针测试（happy-dom，自研 SFC 编译器编真实 vapor SFC）
实锤了以下问题。全部是**静默出错**（宪法 V），不报错、只表现为状态丢失/多跑/不更新。

| # | 现象（实测） | 位置 |
|---|---|---|
| 1 | `v-if="n > 5"`：`n` 从 6→7，条件仍为真，分支被**销毁重建**，分支内组件状态丢失、白付一次挂载 | `vapor/host.ts` `createIf`（effect 里无条件 `teardown()`） |
| 2 | 一个 handler 里 `rows.value.push()` 5 次，v-for 协调**跑 5 遍**；同一个 effect 在一次 flush 前被触发几次就跑几次 | `vapor/host.ts` `enqueue` / `renderEffect`（队列不去重） |
| 3 | 同批 flush 中一个 effect 抛错，**后续 effect 全部丢失**（探针：`n` 改成 42，界面停在 7），且此后不会自愈 | `vapor/host.ts` `enqueue` 的 flush 循环 |
| 4 | vapor 组件里的 `onMounted` / `onBeforeUnmount` / `onUnmounted` **从不触发**，只有一条 `[Vue warn] ... no active component instance`。定时器、监听器泄漏；web 壳 LRU 逐出页面时用户清理代码也不跑 | 这些名字来自 runtime-core（`vapor/index.ts` 的 `export * from vue-shim`、`web-dom.ts` 的 `export * from '@vue/runtime-core'`），无组件实例即 no-op |
| 5 | web 端 vapor 页的 `useRoute()` 返回调用时刻**全局** `currentRoute.value` 的非响应式快照，与 Flutter（本页 `reactive` 副本）不同形；两端 vapor 页也都不经注入拿本页路由（Flutter 靠挂载期全局变量 `activeNativeRoute`，web 靠「setup 恰好在导航后执行」的巧合），`onPageSettled` 在 vapor 页里同理拿不到本页 entry | `router/web.ts` / `router/flutter.ts` `useRoute` 无实例回退 |
| 6 | `usesEnableVapor` 用正则 `/enableVapor\s*:\s*true/` 扫入口源码，**注释里的这串也命中**。`examples/vapor-app/src/main.ts` 顶部注释就含这串——复制该工程去掉选项仍按 enableVapor 构建（实测构建报 `No matching export ... "useCssVars"`）；注释掉选项也关不掉 | `fjs/src/bundler/vue-plugin.ts` `usesEnableVapor` |

外加一个能力缺口：

| # | 现象（实测） | 根因 |
|---|---|---|
| 7 | enableVapor 应用里 pinia 的 `useStore()` 抛 `getActivePinia() was called but there was no active Pinia` | `setup(app)` / `plugins` 在 enableVapor 下被静默忽略（没有 Vue app），`app.use(pinia)` 从未执行 |
| 8 | vapor 页里 vue-router 自己的 `useRouter()` / `useRoute()` 返回 `undefined` + `inject()` 告警 | 它们是 runtime-core 的 `inject(routerKey)`，无实例拿不到 |
| 9 | vapor 组件之间没有 `provide` / `inject`（父 provide、子 inject 拿不到） | 同上，vapor 运行时没有 provides 链 |

## 2. 不做什么（Non-goals）

- 不让三方库**内部**直接从 `'vue'` 调的 `inject` 在 vapor 下生效（runtime-core 的
  `currentApp` / `currentInstance` 是其私有状态，不去 hack）。vue-router 的
  `useRouter`/`useRoute` 属于这类：**引导改用 `fjs/router`**，不做兼容 shim。
- 不支持 `<router-link>` / `<router-view>`（VDOM 组件，纯 vapor web 包没有 VDOM 渲染器）。
- 不实现 `onBeforeUpdate` / `onUpdated` / `onActivated` / `onDeactivated` /
  `onErrorCaptured` / `onRenderTracked` 等——调用时 `warnOnce` 说明不支持（宪法 V），
  不静默。（`onActivated/onDeactivated` 见待澄清 Q2。）
- 不做 `app.mixin` / `app.directive`（vapor 无对应物），调用 `warnOnce`。
- 不动 VDOM 路径的任何行为；不动 op 协议 / natives / 事件类型。
- 不做 review 里的包体 / 性能优化项（injectStyle 拆叶子模块、vue-router 瘦身、
  Flutter 摇掉渲染器、Live 列表单 effect），另立 spec。
- `createDynamicComponent` 的响应式 `:is`、组件 `attrs` 透传不在本 spec。

## 3. 用户可见的行为

### 3.1 pinia（enableVapor，两端同形）

```ts
// src/main.ts —— 与 VDOM 应用写法一致，不再被静默忽略
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import { createPinia } from 'pinia';

createFjsApp({
  enableVapor: true,
  routes,
  setup(app) { app.use(createPinia()); },   // 或 plugins: [...] / src/plugins/*.ts
}).mount();
```

```vue
<script setup vapor lang="ts">
import { onMounted, onUnmounted, provide, inject } from 'vue'
import { useRouter, useRoute } from 'fjs/router'
import { useCounter } from '../stores/counter'

const store = useCounter()          // 可用，响应式驱动 vapor renderEffect
const route = useRoute()            // 本页路由，响应式
let t = 0
onMounted(() => { t = setInterval(() => store.inc(), 1000) })   // 节点进树后触发
onUnmounted(() => clearInterval(t))                            // 页面/分支/组件卸载时触发
</script>
```

- `setup(app)` 与 `plugins` 在 enableVapor 下拿到的是 **App 形状外壳**（`FjsVaporApp`）：
  `use` / `provide` / `component` / `runWithContext` / `config.globalProperties` /
  `config.errorHandler` 可用；`mixin` / `directive` / `mount` 调用 `warnOnce`。
  - `provide` → 进 app 级 provides，vapor 组件的 `inject` 可取到；
  - `component` → 进全局组件表（与 `options.components` 合并）；
  - `runWithContext(fn)` → fn 执行期间 vapor `inject` 可取 app 级 provides（pinia 的
    store setup 走这里）。
- **执行次数**：enableVapor 下 `setup` / `plugins` 在 `createFjsApp` 时**只跑一次**
  （VDOM 的 Flutter 路径是每页一个 Vue app、每页跑一次）。文档写明。

### 3.2 生命周期（所有 vapor 组件，含非 enableVapor 应用里的 vapor 组件）

- `onBeforeMount`：setup 返回后、块插入宿主之前。
- `onMounted`：组件块**进入宿主树之后**（含 VDOM 页里经 wrapper 收养的路径：收养完成
  之后），子先于父（与 Vue 一致）。
- `onBeforeUnmount` / `onUnmounted`：组件所在 scope 被停止时（页面卸载、v-if 分支切走、
  v-for 项删除、web 壳 LRU 逐出）——before 在宿主节点移除前，un 在移除后。
- setup 之外调用：与 Vue 语义一致（runtime-core 的告警）。
- 不止 SFC：vapor setup **同步调用的 composable**（`.ts` 里 `import { onMounted, inject } from 'vue'`，
  pinia、vueuse 这类）同样生效——`'vue'` 在 Flutter 端（vue-shim）与 enableVapor web 端
  （runtime-core 钉扎处）导出「双模」版本：有 VDOM 实例走 runtime-core，vapor 上下文走
  vapor，都没有则 runtime-core 原样告警。**例外**：非 enableVapor 的 web 应用里 `'vue'` 是
  真 vue 包（VDOM 为主），那里的 `.ts` composable 在 vapor 组件里调用生命周期不生效，文档写明。
- `getCurrentInstance()` 在 vapor 上下文仍返回 null（伪造实例会让读 `instance.proxy` 的库崩），
  依赖它判断的库（如 vueuse `tryOnMounted`）走其无实例分支。

### 3.3 provide / inject

- vapor 组件 `provide(key, v)` → 后代 vapor 组件 `inject(key)` 可取；链终点是 app 级
  provides（§3.1）。`hasInjectionContext()` 在 vapor setup 内为真。
- `inject(key, default)` 找不到时返回 default，与 Vue 一致。

### 3.4 fjs/router

- `useRouter()`：行为不变（两端已有模块级回退）。
- `useRoute()`（vapor 页）：返回**本页**的路由对象——由壳/路由在挂页时经 vapor provide
  注入（ROUTE_KEY / PAGE_KEY），两端同形：`reactive` 对象、导航到别页后本页持有的对象
  仍是本页的。（两端页面缓存都按 fullPath/entry 区分，同一页实例的路由不会原地改变——
  这与 VDOM 路径一致。）`onPageSettled` 在 vapor 页里同样经注入拿到本页 entry。
- CLI：enableVapor 下 vapor SFC 若 `import { useRouter | useRoute } from 'vue-router'`，
  构建期警告一次：「enableVapor 下请从 'fjs/router' 导入」。

### 3.5 运行时修正

- v-if：只在条件**真假翻转**时切分支；真假不变的依赖变化不重建。
- renderEffect：同一 effect 在一次 flush 前多次触发只跑一次，保持首次入队顺序。
- flush：单个 effect 抛错不影响同批其他 effect；错误交给 `app.config.errorHandler`
  （有则调），否则 `console.error`，并保持 vapor 队列可继续工作。

### 3.6 CLI enableVapor 判定

- 判定前去掉 `//` 与 `/* */` 注释；仅当 `enableVapor: true` 字面量出现在代码里才开启。
- 出现 `enableVapor:` 但值不是字面量 `true`/`false`（例如 `enableVapor: flag`）时，
  构建期警告「enableVapor 必须是字面量，构建期静态读取」，按关闭处理。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 生命周期 / provide / inject | `fjs/vapor`（`vapor/runtime.ts` 公共层）实现，两端同一份代码 | 同左（`web-dom.ts` 显式 re-export 覆盖 runtime-core 同名） |
| App 外壳 | `app/flutter.ts` enableVapor 分支创建，`setup`/`plugins` 跑一次 | `app/web-vapor.ts` 创建，同左 |
| 页面 route 注入 | 路由 `mount()` vapor 分支 provide `entry.route`（已是响应式副本） | 壳 `buildPage` provide 本页响应式 route，导航时更新 |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无新增 | web 壳仍是 LRU 缓存（specs/166），被逐出时才触发 `onUnmounted`；pop 只隐藏不卸载（见待澄清 Q2） |

## 5. 契约变更（宪法 II）

- [x] 都不涉及（UI op / natives / 事件类型不动）
- 公开 API 变化：`fjs/vapor` 新增导出 `onBeforeMount / onMounted / onBeforeUnmount /
  onUnmounted / provide / inject / hasInjectionContext`（覆盖 runtime-core 同名）；
  `FjsAppOptions.setup` / `plugins` 在 enableVapor 下生效（参数为 `FjsVaporApp`）。
  文档：`docs/vue3.md`（enableVapor 章节：pinia 写法、生命周期、vue-router 引导、
  setup 只跑一次）、`docs/vapor-contract.md`。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`（runtime + cli）全绿。
2. 新增 runtime 单测（happy-dom + 自研编译器编真实 vapor SFC），逐条对应 §1：
   - #1 `n` 6→7 时 v-if 分支不重建（分支 setup 计数不变），6→3 时切到 else；
   - #2 同一 handler 内 5 次 push，v-for 协调只跑 1 次，DOM 结果正确；
   - #3 同批一个 effect 抛错，另一个 effect 的文本仍更新为新值，下一批仍正常；
   - #4 `onMounted` 在节点已进 DOM 后触发、子先于父；v-if 切走 / v-for 删项 /
     `app.unmount()` 时 `onBeforeUnmount` → `onUnmounted` 顺序触发；VDOM 页收养的 vapor
     组件同样触发；
   - #5 两端：A 页 setup 里取的 `useRoute()` 是 reactive 对象，导航到 B 后它的
     `fullPath` 仍是 A；B 页取到的是 B；vapor 页 `onPageSettled` 回调触发（Flutter）；
   - #4b 从 `.ts` composable（经 `'vue'`）注册的 `onMounted`/`onUnmounted` 在 vapor 组件里触发；
   - #7/#9 `setup(app){ app.use(createPinia()) }` 后 store 可用、改 state 驱动文本；
     父 provide / 子 inject；app.provide → 页面 inject。
3. CLI 单测：入口里只有注释含 `enableVapor: true` → 判定为关；`enableVapor: flag`
   → 警告且为关；vapor SFC 从 'vue-router' 导入 `useRouter` → 警告一次。
4. `examples/vapor-app` 加一个 pinia store + `onMounted/onUnmounted` 用例：
   `pnpm --filter vapor-app run check`（fjsrun 断言）通过；`build:web` 后浏览器实测
   计数、导航、返回正常，控制台无 `[Vue warn]`。
5. iOS 模拟器 `fjs run ios`（vapor-app）：store 计数与 onMounted 定时器生效，
   push /about 再返回后被卸载页的定时器停止（日志可见）。
6. 回归：bench `pnpm --filter fjs-bench run vapor` 挂载/更新数字与本 spec 前同量级
   （去重不引入 >5% 回退）；demo `vapor-check`、`nav-vapor` 全通。
7. 文档按 §5 更新。

## 7. 待澄清（2026-10-01 已答）

- [x] **Q1 `onMounted` 时机**：(a) 挂载同步完成后立即调用（块进宿主树之后、mount 返回前）。
- [x] **Q2 onActivated / onDeactivated**：本 spec 不做，调用 warnOnce，另立 spec。
- [x] **Q3 errorHandler**：`app.config.errorHandler(err, null, 'vapor effect')`，可接受。

## 8. 追加：用户反馈「vapor 下 web 和 app 路由返回失效」（2026-10-01）

排查结论（不是 back() 本身坏了——JS 的 push/pop 与 web 的 history 监听实测正常）：

| # | 现象 | 根因 |
|---|---|---|
| 10 | enableVapor 的 Flutter 页面没有导航栏 / 返回键 | `router/flutter.ts` 的 vapor 挂载分支**静默丢弃 `options.shell`**（宪法 V）：返回键由 Shell 渲染，壳没了返回也就没了 |
| 11 | web 壳给 shell 传的 `route` 是全局当前路由，不是本页的 | `app/web-vapor.ts` `buildPage` 读 `vueRouter.currentRoute` |
| 12 | VDOM shell 配 enableVapor：Flutter 静默无壳、web 直接抛错 | 两端都没判 shell 是否 vapor |
| 13 | `examples/vapor-app` 没有任何返回入口：无 shell、`transition: false` 在 iOS 上关掉了右滑返回（Dart 对 `'none'` 建无手势的路由） | 示例配置 |

修复：
- 两端 vapor 页都用 vapor shell 包裹（props：`route` = **本页**的 reactive route；默认插槽 = 页面），与 VDOM 路径同形。
- shell 不是 vapor 组件时两端都 `warnOnce` 并不包壳（不抛错、不静默）。
- vapor-app 加 vapor `Shell.vue`（安全区 + 标题 + 非首页显示返回键 → `router.back()`），去掉 `transition: false`（恢复平台转场与 iOS 右滑返回），页面加 `<route>` 标题。

验收追加：
8. runtime 单测：两端 vapor shell 包裹、shell 读到本页 route、VDOM shell 警告；
9. 浏览器（vapor-app `build:web`）：返回键与浏览器后退都能回首页且状态保留；
10. iOS 模拟器：push /about 后点返回键、右滑返回都能回首页，日志出现 `about unmounted`。
