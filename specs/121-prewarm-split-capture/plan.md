# Plan: 分包构建的样式快照按分包产物抓取

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 纯性能；web 走浏览器 CSS |
| II 边界即契约 | 否 | 快照格式不变 |
| V 静默失效是 bug | 是 | 被拒告警带路径，每页一行 |
| VI 注释记录权衡 | 是 | build.ts 注释写明为什么不用临时单包、为什么每页一个 VM |
| VIII 变更落到文档 | 是 | `docs/vant-mount-perf.md`、`docs/toolchain.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · router | `packages/fjs-runtime/src/router/flutter.ts` | `captureStyles({ routes, loadChunk })`；导入快照时传路径 |
| JS runtime · app | `packages/fjs-runtime/src/app/flutter.ts` | 从 hook 读 `routes` / `loadChunk` 传给 router |
| JS runtime · CSS | `packages/fjs-runtime/src/css/style.ts` | `importSnapshot(input, label)`：告警带路径 |
| CLI | `packages/fjs/src/bundler/style-snapshot.ts` | 多文件、`routes`、`chunks` |
| CLI | `packages/fjs/src/bundler/build.ts` | 分包：每页一个 VM 跑 shared + bundle + chunk；去掉临时单包 |

## 3. 方案

分包：`for page of pages: captureStyleSnapshots([shared.js, bundle.js], { routes: [page.path], chunks })`，
合并结果后照旧 prepend 到各页 chunk（在字节码编译之前）。

否掉的备选：放宽顺序校验为「每个匹配结果内的表相对顺序」——单包与分包的层叠顺序本来
就不同，放宽只会导入错误答案。

## 4. 验证路径

```bash
pnpm run typecheck && pnpm test
pnpm --filter demo run build:pages   # 再按真机顺序在 Node 回放，看 match miss 与告警
```
