# Plan: enableVapor 的 Flutter 包体——渲染器移出包

对应 spec：`./spec.md`（§2.1 两层方案）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | enableVapor 能力边界两端对齐（Flutter 去掉互操作，web 早已没有）；web 不改代码 |
| II 边界即契约 | 否 | op / natives / 事件类型不动 |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | enableVapor 页引用 VDOM 组件 → 两端同一句报错；L1 缺名字 → fjsrun 全 chunk eval 验收兜底；命名空间导入自动回退 |
| VI 注释记录权衡 | 是 | host-ops 拆分理由（顶层 createRenderer 不可摇）、L1 只在 release 生效的理由、回退规则 |
| VII JS 能包就不要下 Dart | 否 | 无 Dart 改动 |
| VIII 文档 | 是 | `docs/vue3.md`（enableVapor 能力边界）、`docs/code-splitting.md`（release shared 按需导出）、`docs/performance.md`（数字） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| runtime · 宿主原语 | `fjs-runtime/src/vue/host-ops.ts`（新） | renderer.ts 1–1979 行原样搬入 |
| runtime · 渲染器 | `fjs-runtime/src/vue/renderer.ts` | 只剩 createRenderer / createApp / render / onEveryApp / rendererInternals + `export * from './host-ops'` |
| runtime · vue 面 | `vue/vue-shim.ts`、`vue/index-vapor.ts`（新） | shim 改从 host-ops 取 styleEngine；index-vapor = enableVapor 的 `fjs/vue` |
| runtime · 样式 | （不新增说明符） | 生成代码仍导 `fjs/vue`；enableVapor 下 `fjs/vue` → `vue/index-vapor.ts`。叶子说明符被否：页面 chunk 导入非共享说明符会各打一份宿主原语、状态分裂 |
| runtime · vapor | `vapor/backend-flutter.ts`、`vapor/backend-flutter-interop.ts`（新）、`vapor/interop.ts`、`vapor/index.ts`、`vapor/flutter-pure.ts`（新） | 互操作拆出；纯面 |
| runtime · 路由 | `router/flutter.ts`、`router/flutter-vdom.ts`（新） | VDOM 挂载器注入；页面根从 host-ops |
| runtime · app | `app/flutter.ts`、`app/flutter-vapor.ts`（新） | flutter.ts 注入 VDOM 挂载器；vapor 版 createFjsApp |
| CLI | `fjs/src/bundler/vue-plugin.ts` | `flutterAliases(enableVapor)`：fjs/app / fjs/vapor / fjs/vue 指向纯 vapor 面 |
| CLI | `fjs/src/bundler/build.ts` | L1：release 分包预构建页面收集名字，`sharedEntrySource` 具名导入；enableVapor 别名 |
| CLI · dev | `fjs/src/dev/*`（如生成 shared） | 确认 dev 走整命名空间（不传名字集合） |
| 测试 | runtime：`vapor-flutter-pure.test.ts`（新）；CLI：`shared-narrow.test.ts`（新） | 见 spec §6 |
| 文档 | 见上 | |

## 3. 方案要点

- **拆文件不改逻辑**：host-ops 是逐字搬家，renderer.ts re-export，所有现有 `from '../vue/renderer'`
  导入不变；只有「不该碰渲染器」的模块改指 host-ops。
- **路由 VDOM 挂载器**：`router/flutter.ts` 暴露 `setVdomPageMounter(fn)`；`fn(entry, page, root,
  ctx) → { unmount }`。`router/flutter-vdom.ts` 实现原逻辑（createVueApp + provides + shell + onCreateApp），
  `app/flutter.ts` 顶层注册。未注册而遇到 VDOM 页 → 抛清晰错误。
- **L1 名字收集**：预构建 = 同一组页面入口、`format: 'esm'`、`bundle: true`、shared 说明符
  全部 `external`、`write: false`、不 minify；从输出用正则取 `import {…} from "<spec>"` /
  `import * as` / `import x from`，按说明符合并名字集合。esbuild 的 ESM 输出形态规整，正则可靠；
  遇到 `import * as` 或 `export * from "<spec>"` → 该说明符回退整命名空间。
  bundle.js（入口）本身在 shared 里？入口 `bundle.js` 也经 stub 读 shared——一并纳入预构建入口。
- **只 release**：dev server 生成 shared 的路径不传名字集合；`fjs build --pages`（非 release）
  是否收窄？按「同次产出」的事实，`fjs build --pages` 也可收窄——但 `fjs dev` 之外有无用户
  把 build 产物当 dev 用无从知道，保守：**仅 `--release`（及 `--bytecode` release）收窄**。

## 被否掉的备选

- **只做 L2 不做 L1**：命名空间导出使 runtime-core 整包留存，L2 单独做几乎不省（实测前推断，
  实施时用 analyze 对比验证）。
- **页面 chunk 不经 shared、各自打包**：多实例 Vue / 渲染器，状态分裂（`docs/code-splitting.md`
  的立论）。否掉。
- **运行时按需取名（Proxy）**：解决不了打包期摇树。否掉。

## 4. 风险

- L1 收窄后某页面运行期动态访问共享模块的名字（`vue[name]`）→ undefined。预构建以静态 import 为准，
  文档写明；fjsrun 全 chunk eval 只能抓到模块顶层的缺失，交互路径靠 demo / hello-fjs 回归。
- host-ops 搬家时模块顶层副作用顺序（viewport pull、style bridge）不能变：renderer.ts 先 import host-ops，
  顺序与原文件一致。
- 互操作拆出后，非 enableVapor 的 Flutter 应用必须仍注册互操作（`vapor/index.ts` 导入它）。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
cd examples/vapor-app && pnpm exec fjs build --pages --release --analyze   # 对比 VDOM 版
# fjsrun 分包 eval：shared.js + pages/*.js + bundle.js（vapor-app / hello-fjs / demo release）
pnpm --filter fjs-bench run vapor
cd demo && vapor-check / nav-vapor
cd examples/vapor-app && pnpm run check && fjs run ios
```
