# Tasks: 163-host-contract

- [x] T1 host.ts：HostReactivity 接口 + setHostReactivity + 中立核心迁入（缝替换：
      createScope/runInScope/stopScope/effect/stopEffect/box；withScope 两参版 +
      currentScope 留核心；takeInsertionState/emptyBlock/be 改导出供绑定用）
- [x] T2 runtime.ts：Vue 反应式注入（@vue/reactivity 六方法）+ 组件层 +
      `export * from './host'`；slots 版 withScope 包核心两参版
- [x] T3 Block.scopes 放宽 unknown[]（下游无人直接读写 scopes，interop 只过 disposeBlock）
- [x] T4 docs/vapor-contract.md + docs/README.md 索引（4.5 位）
- [x] T5 solid-js devDep（仅 devDependencies）+ test/vapor-solid-host.test.ts：
      Solid signals 驱动 host.ts（自建记录型 backend）——挂载文本 / signal 全量更新 /
      disposeBlock 后信号不再触发，三段全过。实现要点：Solid 嵌套 createRoot 不随父
      root 销毁，scope 内 effect 必须经 runWithOwner 直接挂 owner（无自持 root）；
      vitest 需 alias `solid-js` → client 构建（node 条件解析到 server 构建，
      createEffect 是空操作）
- [x] T6 行为零变化：typecheck 干净、vitest 878 全绿、bench 一致
      （静态 10.2 / Live 27.1 ms，基线 10.2 / 26.4，噪声内）
- [x] T7（外来遗留，用户指示一并修）：css-support.test.ts 适配 specs/164 的
      FjsGlobalComponents 结构（274b430 在注释里写了 declare 字面量，测试 indexOf 锚空）
