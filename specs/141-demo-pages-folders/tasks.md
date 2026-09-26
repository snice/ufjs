# Tasks: demo 页面按文件夹分组

对应 plan：`./plan.md`。

## 契约层

- [x] T001 不涉及

## 实现

- [x] T010 `git mv` 页面进四个目录 —— `demo/src/pages/`
- [x] T011 watermark 页跨页跳转路径 —— `demo/src/pages/vant/watermark.vue`
- [x] T012 bench import 路径 —— `demo/bench/mount-core.ts`、`demo/bench/wm-smoke.ts`

## 两端对齐

- [x] T020 两端共用路由表，web 预览点通首页各组（App 端同表，不单独跑）

## 测试

- [x] T030 `pnpm --filter demo run build` 与 `build:web`

## 文档

- [x] T040 `demo/README.md` 路由名

## 验收

- [x] T050 `pnpm --filter demo run typecheck`
- [x] T051 spec.md 第 6 节逐条核对
