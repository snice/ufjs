# Spec: 纯 vapor 应用的开发构建 shared.js 不再带 VDOM 渲染引擎

- **ID**: 184-vapor-dev-shared-narrow
- **状态**: done
- **日期**: 2026-10-02

## 1. 要解决什么

vapor-app（纯 vapor）在 Flutter 开发构建（`fjs build --pages` / `fjs dev`）里 shared.js 342.7 KB，比同内容 VDOM 版的
316.6 KB 还大，载入（源码求值）28.6 ms vs 25.9 ms。原因：开发构建的 shared 入口对 `vue`、`@vue/runtime-core`、
`fjs/vapor` 做 `import * as` 整模块导出（页面热重载后可能用到任何名字），runtime-core 的全部导出因此可达——
包括 VDOM 渲染引擎（`createRenderer` / `createHydrationRenderer`）、`Suspense`、`KeepAlive`、`ssrUtils` 等纯 vapor
永远用不上的部分；vapor 运行时又在其上叠加。release 构建按页面实际导入收窄（specs/169），不受影响。

## 2. 不做什么

- 不改 release 的收窄（已按实际导入）。
- 不改带 interop 的 enableVapor 应用（specs/182，三方 VDOM 组件库需要完整 runtime-core）和 VDOM 应用。

## 3. 行为

纯 vapor（`enableVapor: true` 且未开 interop）的非 release 构建：shared 入口对 `vue`、`@vue/runtime-core`、`fjs/vapor`
导出「模块的全部导出名 − 只属于 VDOM 渲染器 / 不支持的名字」：`createRenderer`、`createHydrationRenderer`、`ssrUtils`、
`Suspense`、`KeepAlive`、`registerRuntimeCompiler`、`defineAsyncComponent`。导出名在构建时从模块本身读出（esbuild 的
metafile），vue / runtime-core 升级不用改清单。其余共享模块照旧整模块导出。热重载的页面用到普通 API 仍然拿得到。

## 4. 两端约定

只涉及 Flutter 分页构建（web 的 enableVapor 本来就没有整模块导出 runtime-core）。

## 5. 契约变更

- [x] 都不涉及

## 6. 验收标准

1. vapor-app `fjs build --pages`：shared.js 小于同内容 VDOM 版，fjsrun 求值耗时不高于 VDOM 版。
2. vapor-app `pnpm run check`（fjsrun 断言 harness）通过；iOS 上 vapor-app 各页可用。
3. CLI 单测：纯 vapor 开发构建的 shared 入口不导出上述名字、仍导出 `ref` / `watch` / `nextTick` 等；VDOM / interop 应用不变。
4. `pnpm test`、`pnpm run typecheck` 通过。

## 7. 待澄清

- 无

## 8. 实现记录

- `bundler/build.ts`：`PURE_VAPOR_UNSHARED` 与 `pureVaporSharedNames()`——对 `vue` / `@vue/runtime-core` / `fjs/vapor` 用一次
  esm 预构建的 metafile 读出全部导出名再去掉这 7 个，其余共享模块 `'*'`；`buildPages` 在纯 vapor 的非 release 构建里使用。
- 结果（vapor-app 开发构建）：shared.js 342.7 → 309.6 KB（叠加 specs/185 后 294.5 KB），runtime-core 70 → 27.7 KB；
  求值 28.6 → 24.5 ms（VDOM 26.3 ms）。
- 验证：`test/pure-vapor-shared.test.ts`；vapor-app `pnpm run check`；iOS 上 vapor-app 四页可用，`vue.createRenderer` 不在共享导出里。
