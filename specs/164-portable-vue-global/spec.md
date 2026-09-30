# Spec: vue-global 增强改为随消费者解析（导出 FjsGlobalComponents）

- **ID**: 164-portable-vue-global
- **状态**: ready
- **日期**: 2026-09-30

## 1. 要解决什么

demo / hello-fjs 的编辑器与 `vue-tsc` 突然对所有 fjs 标签（`view` / `text` /
`button`…）报 `TS2339: Property 'view' does not exist on type '{}'`（strictTemplates）。

根因是 **vue 模块实例分裂**：specs/148 把 demo 与 hello-fjs 的 vue 钉到
`3.6.0-rc.9`（vapor 页需要），而 `@ufjs/runtime` 依赖 `^3.5.42`。TS 的
`declare module 'vue'` 增强（`vue-global.d.ts:527`）按**声明文件所在位置**解析目标模块，
所以这份增强只落在 runtime 自己那份 vue 3.5 上；应用这份 vue 3.6 的
`GlobalComponents` 是空的 → 每个标签都是 TS2339。之前没炸只是因为当时
node_modules 还没装出第二份 vue，最近一次 `pnpm install` 后显现。

把 runtime 的 vue 升到 3.6-rc 违背 specs/161「运行时回 vue 3.5 stable」的决策；
把 demo 降回 3.5 会打断 vapor 页。两条路都堵死，结论是：**增强必须不依赖
"两边解析到同一份 vue"**。

## 2. 方案

`vue-global.d.ts` 把 `FjsGlobalComponents`（已存在，453 行）导出；消费方在
**自己项目里**对自己解析到的 vue 做增强：

```ts
import type { FjsGlobalComponents } from '@ufjs/runtime/vue-global';
declare module 'vue' {
  interface GlobalComponents extends FjsGlobalComponents {}
}
```

`declare module 'vue'` 写在消费方文件里，解析目标是消费方的 vue —— 版本随便漂。

| 文件 | 改什么 |
|---|---|
| `fjs-runtime/src/vue-global.d.ts` | `FjsGlobalComponents` 加 `export` + 注释说明为什么（保留既有 `declare module 'vue'` 块，供 vue 版本恰好一致的消费方开箱即用） |
| `demo/src/fjs-global.d.ts` | 加上述增强 |
| `examples/hello-fjs/src/fjs-global.d.ts` | 同上 |
| `fjs/src/commands/create.ts` | 生成的 `src/fjs-global.d.ts` 模板同步（新项目不再踩坑） |

约束遵循：纯类型层改动，无 op 协议 / 无两端同源面。`fjs-global.d.ts` 由
`@ufjs/cli` 的 dist 内联（AGENTS #6 同类问题），create.ts 改完需
`pnpm --filter @ufjs/cli run build`。

## 3. 验收标准

1. `pnpm --filter demo run typecheck` 与 hello-fjs 的 typecheck 全绿
   （改前 demo 报约 90 个 TS2339）。
2. `pnpm run typecheck`（全 workspace）与 `pnpm test` 不回退。
3. IDE 侧重启 TS Server 后 `<view` 的属性补全恢复（用户验收）。

## 4. 不做什么

- 不动 vue 版本钉子（runtime 3.5 stable、demo/hello-fjs 3.6.0-rc.9 各有所需）。
- 不动 volar 插件（`volar.cjs` 只负责"非原生标签"判定，与本次失效无关）。
