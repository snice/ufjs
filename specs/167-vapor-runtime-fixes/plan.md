# Plan: 自研 vapor 运行时正确性修复 + enableVapor 下 pinia / 路由可用

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 运行时修正、生命周期、provide/inject 全在两端共用的 `vapor/host.ts` / `vapor/runtime.ts` / 新 `vapor/instance.ts`。两端各自的入口只做导出：Flutter `vapor/index.ts` + `vue/vue-shim.ts`，web `vapor/web-dom.ts` + 新 `vapor/vue-pure.ts`。App 外壳 `app/vapor-app.ts` 两端共用，接入点 Flutter `app/flutter.ts` / web `app/web-vapor.ts`。路由注入 Flutter `router/flutter.ts`、web `app/web-vapor.ts` + `router/web.ts` |
| II 边界即契约 | 否 | 不动 op 协议 / natives / 事件类型 |
| III 同步单线程零序列化 | 是（守住） | onMounted 同步触发（Q1=a），不引入新的异步边界；effect 队列仍是同一个微任务 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是（本 spec 的主题） | 不支持的钩子（onUpdated / onActivated…）与外壳的 mixin / directive / mount 一律 warnOnce；enableVapor 值非字面量时 CLI 警告；vapor SFC 从 vue-router 导 useRouter / useRoute 时 CLI 警告；effect 错误走 errorHandler，否则 console.error |
| VI 注释记录权衡 | 是 | 注释写清三件事：读 EffectScope 内部 `scopes` 字段的理由与降级；双模 `'vue'` 为什么先判 vapor 上下文；web 壳为什么改成「先进树再挂页」 |
| VII JS 能包就不要下 Dart | 是（全在 JS） | 无 Dart / C++ 改动 |
| VIII 变更落到文档 | 是 | `docs/vue3.md`（enableVapor：pinia 写法、生命周期、provide/inject、vue-router 引导、setup 只跑一次、非 enableVapor web 的 composable 例外）；`docs/vapor-contract.md`（HostReactivity 新的可选 `beforeStopScope`、job 钩子）；`docs/toolchain.md`（enableVapor 静态判定规则） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI | `packages/fjs/src/bundler/vue-plugin.ts` | `usesEnableVapor`：先去注释（字符串感知），只认字面量；非字面量警告。`compileVaporSfcModule` 与 esbuild vapor 分支：enableVapor 下检测 `from 'vue-router'` 导入 useRouter / useRoute，每个文件警告一次。`webPureVaporPinPlugin`：`vue` → `vapor/vue-pure.ts` |
| CLI | `packages/fjs/src/vite.ts` | enableVapor 的 `vue` 别名 → `vapor/vue-pure.ts`；vue-router 警告走共享函数 |
| JS runtime · 核心 | `packages/fjs-runtime/src/vapor/host.ts` | #1 createIf 按真假记忆；#2 renderEffect 入队去重；#3 flush 逐条 try/catch + `reportVaporError`；job 完成钩子（刷新待触发的 mounted）；`removeBlock` / createIf teardown / `disposeBlock` 在移除节点前调 `beforeStopScope` |
| JS runtime · 实例层（新） | `packages/fjs-runtime/src/vapor/instance.ts` | 实例记录（parent / appContext / provides / 钩子 / 状态）；`currentVaporInstance`；双模 `onBeforeMount / onMounted / onBeforeUnmount / onUnmounted / provide / inject / hasInjectionContext`，外加不支持钩子的 warnOnce 版；runWithContext 上下文；错误上报。只依赖 `@vue/runtime-core` + `@vue/reactivity`，不碰 host 与渲染器，vue-shim 引它不带进 vapor 运行时 |
| JS runtime · 绑定 | `packages/fjs-runtime/src/vapor/runtime.ts` | `mountVaporComponent` / `createVaporApp` / `mountVaporComponentForAdopt` 建实例、收集 pending mounted；scope → 实例映射（`createScope` 登记）；`stopScope` 的卸载顺序（beforeUnmount 父先、unmounted 子先）；`VaporAppContext` 加 `provides`；VDOM interop 调用期间清空 vapor 当前实例；`resolveComponent` 改从实例链取 appContext |
| JS runtime · 入口 | `vapor/index.ts`、`vapor/web-dom.ts`、`vue/vue-shim.ts`、新 `vapor/vue-pure.ts` | 显式导出双模函数，遮住 runtime-core 同名 |
| JS runtime · interop | `vapor/interop.ts`、`vapor/web-interop.ts` | `mountAdoptNodes` 末尾触发收养块的 mounted；release 走 beforeStop |
| JS runtime · App 外壳（新） | `packages/fjs-runtime/src/app/vapor-app.ts` | `createVaporAppShell(ctx)` → `FjsVaporApp`（use / provide / component / runWithContext / config / 不支持项 warnOnce），注册 errorHandler 来源 |
| JS runtime · app | `app/flutter.ts`、`app/web-vapor.ts` | enableVapor：建 ctx + 外壳，跑 `plugins` 与 `setup(app)` 一次；web 壳改成「container 先进宿主，再挂页」 |
| JS runtime · 路由 | `router/flutter.ts`、`router/web.ts` | 路由改收 `vaporContext` 替代 `vaporComponents`；挂 vapor 页时用 per-page 上下文 provide ROUTE_KEY / PAGE_KEY / ROUTER_KEY；`useRoute` / `useRouter` / `onPageSettled` 在 vapor 上下文走 vapor inject；web `useRoute` 同 |
| Web 适配层 | — | 不涉及（DOM 后端不变） |
| C++ / Dart | — | 不涉及 |
| 测试 | `fjs-runtime/test/vapor-lifecycle.test.ts`（新）、`vapor-own.test.ts`、`web-vapor-shell.test.ts`、`router-vapor-mount.test.ts`、`fjs/test/vue-plugin-vapor.test.ts` | 逐条对应 spec §6 |
| 示例 | `examples/vapor-app` | pinia store、onMounted 定时器、onUnmounted 清理日志；`check/main.ts` 断言 |
| 文档 | `docs/vue3.md`、`docs/vapor-contract.md`、`docs/toolchain.md` | 见 VIII |

## 3. 方案

### 3.1 运行时三修（host.ts）

- **#1 createIf**：effect 先求 `const next = !!condition()`；与上次相同且已建过就 return。
  条件表达式在 branch scope 之外求值（依赖本来就挂在 if 的 effect 上，行为不变）。
- **#2 去重**：每个 renderEffect 带一个 `queued` 标记，scheduler 已入队就忽略。job 运行
  **前**清标记，这样运行中产生的新触发能再入队；runtime-core 的 ReactiveEffect 在 RUNNING
  时本来就忽略自触发，不会死循环。
- **#3 隔离**：flush 循环对每个 job 做 try/catch → `reportVaporError(e, 'vapor effect')`
  （binding 注入，默认 console.error）。
- **job 钩子**：host 暴露 `setVaporJobHook(fn)`，每个 job 跑完调一次。binding 用它刷新
  「调度重跑中新建组件」的 mounted。

### 3.2 实例与生命周期（instance.ts + runtime.ts）

- **实例**：`{ parent, appContext, provides, bm/m/bum/um: fn[], state }`。
  - 创建时的 parent = `currentVaporInstance ?? scopeOwner.get(getCurrentScope())`。
    `scopeOwner` 是 WeakMap：binding 的 `createScope` 把新 scope 登记给当前所属实例，组件自己的 scope 登记为该实例。
  - 这也修掉 review 漏记的一个同类 bug：v-if 翻转后新建的组件，`currentAppContext` 是 null，
    `resolveComponent` 会抛错。现在 appContext 从实例链继承。
- **onBeforeMount**：setup 返回、块建好之后立即调用。
- **onMounted（Q1=a）**：
  - 实例 setup 完成后进 `pendingMounted` 队列（子组件的 setup 在父 setup 里先完成，所以天然子先于父）。
  - 刷新点：
    - `createVaporApp().mount()` 插入之后：createVaporApp 构造期把 pending 截成自己的列表；
    - 收养路径 `mountAdoptNodes` 之后：`mountVaporComponentForAdopt` 同样截列表，返回 `mounted()`；
    - 调度 job 结束（job 钩子）；
  - 已卸载的实例跳过。
- **卸载**：
  - host 在移除节点前对要停的 scope 调 `rx.beforeStopScope?.(s)`（HostReactivity 新增的可选成员，保持框架中立）。
  - binding 先序遍历 scope 子树找实例，跑 beforeUnmount（父先）。
  - `stopScope` 里先收集实例、再 `scope.stop()`，之后逆序跑 unmounted（子先）。
  - 兜底：实例 scope 上挂 `onScopeDispose`，走到非 stopScope 路径（外部直接 stop）时也补跑 bum + um。每个钩子最多跑一次。
- **遍历 scope 子树**：读 EffectScope 的内部字段 `scopes`。3.5 的 d.ts 没声明它，但它从 3.2
  起一直存在，reactivity 又钉死在 3.5.x。取不到时降级到 `onScopeDispose` 兜底（顺序变成父先、
  时机变成移除后），并用单测锁住字段存在。
  - **零开销守卫**：全局计数「带卸载钩子的存活实例」，为 0 时 beforeStop 不遍历。bench 页没有钩子，不付遍历成本。
- **错误**：钩子与 effect 抛错统一走 `reportVaporError`：外壳设了 `config.errorHandler` 就调
  `errorHandler(err, null, info)`（Q3），否则 console.error。

### 3.3 provide / inject / 双模 `'vue'`

- vapor 语义同 Vue：
  - `provide` 写进本实例 provides（首次写时 `Object.create(父 provides)`）；
  - `inject` 从 parent 的 provides 读，链尾是 appContext.provides；
  - `runWithContext` 期间读 appContext.provides。
- 双模函数的判定顺序是 **先 vapor 当前实例 → 再 runtime-core 实例 → 都没有就交给 runtime-core**
  （保持原生告警）。先判 vapor，是因为收养路径的 vapor setup 就跑在 wrapper 的 VDOM setup 里面，
  那时 runtime-core 也有实例。反方向（vapor 里挂 VDOM interop）由 createComponent 在调 interop 时
  把 vapor 当前实例置空来隔离。
- 覆盖到的入口：
  - vapor SFC：`fjs/vapor`，经编译期 `'vue'` → `fjs/vapor` 改写；
  - Flutter 全部 `'vue'` 导入：vue-shim；
  - enableVapor web 全部 `'vue'` 导入：pin 到 `vue-pure.ts`（runtime-core + 双模）。
- pinia 的实际通路：
  - 外壳 `use()` 执行 install → `app.provide(piniaSymbol)` + `setActivePinia` + `pinia._a = app`；
  - store setup 走 `pinia._a.runWithContext` → 外壳实现；
  - `useStore` 里的 `hasInjectionContext` / `inject` 走双模 → vapor 链或 activePinia。两条路都通。

### 3.4 App 外壳（app/vapor-app.ts）

- `createVaporAppShell(ctx)` 的成员：
  - `use(plugin, ...opts)`：对象调 install、函数直接调，同一插件只装一次；
  - `provide`、`component(name, c?)`（读写 ctx.components）；
  - `runWithContext`、`config: { globalProperties, errorHandler, warnHandler }`；
  - `version`；
  - `mixin` / `directive` / `mount` / `unmount`：warnOnce，返回 app。
- Flutter / web 两边的 createFjsApp（enableVapor）都这样做：建 ctx（components = 内置组件表 +
  `options.components`，provides = {}）→ 建外壳 → `applyPlugins` + `setup` 各跑一次 → ctx 交给路由 / 壳。
- `FjsAppOptions.setup` 的类型仍是 `(app: App) => void`，外壳以 `App` 形状传入。
  文档说明它只实现了上面这些成员，其余调用 warnOnce。

### 3.5 路由注入

- **Flutter**：
  - 路由选项 `vaporComponents` → `vaporContext: VaporAppContext`（内部选项，只有 app/flutter.ts 传）。
  - 挂 vapor 页时，per-page 上下文 = `{ components: 共享, provides: Object.create(app provides) }`，
    再写入 ROUTE_KEY = entry.route、PAGE_KEY = entry、ROUTER_KEY = router。
  - `useRoute` / `useRouter` / `onPageSettled` 先看 `hasVaporInjectionContext()` → vapor inject。
  - `activeNativeRoute` 删除。
- **web**：
  - `buildPage` 的 per-page 上下文 provide ROUTE_KEY = `reactive({...resolved})`（与 Flutter 同形）。
  - 这里的 ROUTE_KEY 是 fjs 自己的 symbol，不是 vue-router 的 key，从 `router/web.ts` 导出。
  - `useRoute` 在 vapor 上下文走 inject；否则保持现状（VDOM 用 vue-router，都没有时读当前路由）。
- **web 壳结构**：
  - 改掉「Shell 组件 setup 里建 container、首跑 effect 就挂页」：那时 container 还没进 document，
    onMounted 会在节点离线时触发。
  - 改为 `mount()` 里先把 container 挂进宿主，再在一个 app 级 scope 里起路由 effect；
    `buildPage` 先把 `fjs-page` 放进 container 再 mount。

### 3.6 CLI

- `stripJsComments(src)`：字符串 / 模板字面量感知，去掉 `//` 与块注释。
  - 在去注释的源码上匹配 `enableVapor\s*:\s*(true|false)\b`，true 才开。
  - 能匹配到 `\benableVapor\b` 但值不是字面量 → 警告一次，按关处理。
- vue-router 警告：在 vapor SFC 的 script 源码上匹配
  `import\s*\{[^}]*\b(useRouter|useRoute)\b[^}]*\}\s*from\s*['"]vue-router['"]`，enableVapor 下
  每文件警告一次。放进 `compileVaporSfcModule`（vite）和 esbuild 的 vapor 分支共用的一个小函数里。

### 被否掉的备选

- **给 vapor 伪造一个 runtime-core 实例 / app**（让三方库内部的 `inject` 直接可用）：要写
  runtime-core 私有的 `currentInstance` / `currentApp`，而且 `getCurrentInstance()` 返回伪实例会让读
  `proxy` / `vnode` 的库崩。否掉。
- **用 runtime-core 的 `createRenderer(...).createApp` 造一个真 App 当外壳**：会把 runtime-core
  的渲染引擎拉回 enableVapor web 包，正好违背 specs/166 的包体目标。否掉。
- **自己维护 scope 树**（每个 scope 登记父子，不读内部 `scopes` 字段）：每个 v-for 项多付一次
  Map/Set 维护，停止时还要解链。bench 的 Live 列表有 2000 个 scope，不值得。选读内部字段 + 降级兜底。
- **onMounted 走 post 队列**：Q1 已选同步。
- **在 vue-shim 里直接导出 runtime.ts 的实现**：会让每个非 vapor 应用都带上 vapor 运行时。
  所以拆出无依赖的 instance.ts。

## 4. 风险

- **读 EffectScope 内部 `scopes` 字段**：升级 reactivity 可能静默失效。用单测锁字段存在，并有降级兜底。
- **双模 `'vue'` 改了 Flutter 所有应用的 onMounted / inject 入口**：VDOM 路径多一次 null 判断。
  靠 demo / hello-fjs 的 VDOM 回归（`pnpm test` 覆盖渲染器）和 bench 数字把关。
- **去重改变 effect 执行次数**：原来依赖「多次触发多次跑」的写法（理论上不该有）会变化。
  靠 bench 与 vapor-check 回归。
- **pinia devtools 分支**（web dev 模式 `registerPiniaDevtools(app)`）对外壳的容忍度：
  在浏览器 dev 模式实测，控制台无报错才算过。
- **web 壳结构调整**会影响 specs/166 的 LRU / 滚动快照：web-vapor-shell 现有用例必须全绿。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
pnpm --filter fjs-bench run vapor          # 挂载 / 更新数字与本 spec 前同量级
cd demo && for b in vapor-check nav-vapor; do pnpm exec fjs build bench/$b.ts --out dist/$b && ../packages/flutter_fjs/native/build-native/fjsrun --pump 200 dist/$b/app/bundle.js; done
pnpm --filter vapor-app run check          # fjsrun 断言：pinia / 生命周期
pnpm --filter vapor-app run build:web      # + 浏览器 preview 实测，控制台无 [Vue warn]
cd examples/vapor-app && pnpm exec fjs run ios   # 模拟器：定时器、返回后清理日志
```
