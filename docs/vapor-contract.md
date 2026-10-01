# Vapor host contract：框架中立核心与绑定接缝

> specs/163。`src/vapor/host.ts` 是 contract 本体；`src/vapor/runtime.ts` 是 Vue 绑定。
> 本文是接缝的接口文档——接第二个框架时读这一篇就够。

## 三层结构

```
框架编译产物（compiler-vapor / 未来的 solid-babel 等）
        │  发 contract 调用：template / child / txt / setText / createFor / renderEffect …
        ▼
host contract（src/vapor/host.ts，框架中立）
        │  HostReactivity 接缝（effect/scope/box 由绑定注入）
        │  VaporBackend 接缝（instantiate / cloneList / attach… 由渲染端实现）
        ▼
element API + op 协议（src/ui/*，specs/161 之前就有）
        ▼
libfjs（C++）+ libfjs-style → Dart mirror tree → Flutter widgets
```

- **element API 层**不知道任何框架（宪法规则：框架假设不得写进 element API 与 op 协议）。
- **host contract 层**不知道任何框架的组件模型；它唯一的外部依赖是字符串工具
  （`@vue/shared` 的 `normalizeClass`/`camelize` 等，纯函数——绑定方也可以在上游归一化，
  不经过这层）。
- **绑定层**（今天的 `runtime.ts`）做两件事：注入一个 `HostReactivity` 实现；提供该框架的
  组件模型（Vue 的 createComponent/props/slots）。

## contract 函数面

模板：`template(html, flags?, ns?) → CompiledTemplate`（`.def` 供批量克隆、`.html` 供 web
cloneNode）；walker `child / nthChild / next / txt`；writer
`setText / setClass / setClassName / setStyle / setAttr(=setProp) / show / on / off / once /
delegateEvents`。

结构与控制流：`setInsertionState`（编译器在 createIf/createFor/createComponent 前设置落点）、
`createIf / createFor / repeatTemplate / repeatTemplateLive / createForSlots`、
`renderEffect`、块记账 `blockOf / insertBlock / removeBlock / disposeBlock / blockRoot`。

批量执行（specs/162）：`repeatTemplate`（静态文本，texts 随 CLONE_MANY op）与
`repeatTemplateLive`（读 prop/ref 的格子，每格 effect），都走 `VaporBackend.cloneList`。

## HostReactivity：反应式接缝

```ts
export interface HostReactivity<S = unknown, R = unknown> {
  createScope(): S;                        // 新 scope：拥有其内创建的效果
  runInScope<T>(scope: S, fn: () => T): T; // 在 scope 下执行（效果归它）
  stopScope(scope: S): void;               // 停 scope 及其全部效果
  effect(fn: () => unknown, opts: { scheduler: () => void; onStop: () => void }): R;
  stopEffect(runner: R): void;
  box<T>(value: T): { value: T };          // 可写盒子：读追踪、写触发
  beforeStopScope?(scope: S): void;        // specs/167：scope 将停、宿主尚未移除（beforeUnmount 点）
}
```

语义约定（绑定必须遵守，核心依赖它们）：

1. **调度归核心**：`effect` 的 `scheduler` 是核心微任务队列的入队回调——引擎在依赖变化时
   只调它，绝不自行写宿主。`onStop` 在效果被停止时置活性行（队列 flush 前检查，防止写已删
   宿主）。Solid 这类自带批量的引擎可以忽略 scheduler 语义差异（首次运行仍是同步的，
   这一点是硬约定：挂载路径依赖首跑即写）。
2. **scope 所有权**：`runInScope` 期间创建的效果必须被该 scope 收集；`stopScope` 后这些
   效果永不重跑。核心用它做 v-if 分支销毁、v-for 逐项销毁与整表销毁。
3. **box 是最小追踪单元**：v-for 的 item/key 惰性盒子经它创建；效果读 `box.value` 必须建立
   依赖。
4. **去重与隔离归核心（specs/167）**：同一效果在一次 flush 前多次触发只入队一次（运行前清
   标记，运行中的新触发可再入队）；flush 中单个 job 抛错交给 `setVaporErrorReporter` 注入的
   上报函数，同批其余 job 照跑。
5. **`beforeStopScope` 可选**：核心在移除宿主**之前**对将停的 scope 调它（removeBlock、v-if
   切分支、disposeBlock），绑定据此跑 beforeUnmount。没有组件层的绑定（Solid 验证）不实现。
   `setVaporJobHook` 是每个 job 跑完后的回调——Vue 绑定用它触发「更新中新建组件」的
   onMounted。

Vue 绑定（`runtime.ts`）的实现即 `@vue/reactivity`：
`createScope = () => new EffectScope()`、`runInScope = scope.run`、`effect = effect(fn, opts)`、
`box = shallowRef`；组件实例、生命周期与 provide/inject 在 `vapor/instance.ts`（无 host /
渲染器依赖，vue-shim 与 `vapor/vue-pure.ts` 也导出它的双模函数）。Solid 绑定的参考实现见 `test/vapor-solid-host.test.ts`
（`createRoot` + `runWithOwner` + `createSignal`）。

## VaporBackend：渲染接缝

由渲染端实现（Flutter：`vapor/index.ts` + `backend-flutter.ts`；web：`vapor/web.ts`），
与框架无关，见 `VaporBackend` 接口注释（`host.ts`）。静态形状列表的批量克隆
（`cloneList`，specs/162）两端各有等价实现。

## 接第二个框架的步骤

1. **绑定反应式**：实现 `HostReactivity`（≤40 行，参照 Solid 测试），模块 init 时
   `setHostReactivity(impl)`。
2. **组件模型**：按该框架的组件语义实现组件层（Vue 的在 runtime.ts；Solid 对应
   createComponent/props 的自有实现），消费 contract 的块与 insertion state。
3. **编译器**：让该框架的编译器发 contract 调用（Vue 由 compiler-vapor 产出 + CLI 的
   `vue → fjs/vapor` 改写 + `once-inline` 静态收编；其它框架各自等价物）。
4. **两端同源**：宿主能力（标签/样式/事件）仍按宪法在 Flutter 与 web 两侧同时落地。

纪律：contract 与 element API 两层不得出现框架名；绑定层不得绕过 backend seam 直接摸
op 编码。
