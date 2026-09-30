# Plan: 165-vapor-wrapper-entry-sites

## 改动层

只有 CLI 打包层（`packages/fjs`），runtime 不动、协议不动。

| 文件 | 改什么 |
|---|---|
| `packages/fjs/src/bundler/vue-plugin.ts` | `vaporWrapperPlugin.onResolve`：相对导入在 importer 为空时退回 `args.resolveDir`（generatedEntry 的 stdin 模块）；新增绝对路径分支（路由表 require/import 的绝对 page.file）；wrapper 虚拟模块自身的 `import __vapor` guard 防递归 |
| `packages/fjs/src/vite.ts` | `resolveId` 同步放宽（绝对路径分支 + 防递归 guard）；新增 `enforce: 'post'` 的 `fjs-vapor-vue-rewrite` 插件：vapor SFC 模块 `from 'vue'` → `from 'fjs/vapor'`（与 esbuild 同一正则），`fjs()` 返回 `[主插件, rewrite]` 数组（vite 会展平） |

## 顺序

1. T1 esbuild onResolve 放宽 → 非 split 与 --pages 产物各验一次 wrapper 在位
2. T2 vite resolveId 放宽 + post rewrite 插件
3. T3 验证矩阵（见 tasks）

## 风险与边界

- esbuild 对 namespace 模块（`fjs-vapor-wrapper:<file>`）的 import，其
  `args.importer` 是虚拟路径本身，`startsWith(VAPOR_WRAPPER_NS)` 可判。
- vite 的 `?vue&type=...` 子请求不以 `.vue` 结尾，天然不进 wrapper 分支；
  rewrite 插件对子请求同样生效（template 子请求的 helpers import 也要改写），
  以「路径去 query 后是 vapor SFC + 代码含 `from 'vue'`」为准，幂等。
- `isAutoVapor` 的 SFC 缓存（vaporSfcCache）跨两个插件共享同一入口函数，无新开销。
