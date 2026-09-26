# Plan: demo 页面按文件夹分组

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 同一份路由表 |
| II 边界即契约 | 否 | — |
| III–VII | 否 | — |
| VIII 文档 | 是 | `demo/README.md` 路由名 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| demo 页面 | `demo/src/pages/*.vue` | `git mv` 进 `basic/`、`interaction/`、`vant/`、`nutui/`，去掉文件名前缀 |
| demo 页面 | `demo/src/pages/vant/watermark.vue` | `router.push('/about')` → `/basic/about` |
| bench | `demo/bench/mount-core.ts`、`demo/bench/wm-smoke.ts` | import 路径 |
| 生成类型 | `demo/src/fjs-routes.d.ts` | typecheck/构建时重新生成 |
| 文档 | `demo/README.md` | `/icons`、`/drag`、`/dnd` 等路由名 |

## 3. 方案

页面内 import 全部走 `@/` 别名与包名，搬迁不影响。备选「用目录名推导 group、删掉
`<route>` 的 group」否掉：分组中文名与顺序仍要在某处声明，改动面更大，超出本次需求。

## 4. 风险

路由路径变化会让旧书签 / 文档里的 `/#/vant-basic` 失效；specs 里的历史记录不改。

## 5. 验证路径

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run build && pnpm --filter demo run build:web
# demo web 预览点首页各组
```
