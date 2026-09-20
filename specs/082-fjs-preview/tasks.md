# Tasks: 082-fjs-preview

对应 spec:`./spec.md`。按顺序做,做完一条勾一条。

## 实现

- [x] T001 `dev/static.ts`:MIME 表 + resolveStaticFile(解码、join 而非
  resolve——绝对路径 URL 会丢根、穿越防护、扩展名判定、SPA 兜底)
- [x] T002 `dev/server.ts`:webServer 改用共享模块(行为不变,注释迁移)
- [x] T003 `commands/preview.ts`:只读静态服务;缺产物明确报错;
  `--out/--port/--host`,缺值显式报错
- [x] T004 cli.ts:import + case + usage + 头部注释

## 测试

- [x] T010 `static-serve.test.ts` 6 条

## 验证

- [x] T020 demo 实跑 preview:index 200 / SPA 路由 200 / 缺失资源 404
- [x] T021 `pnpm --filter @ufjs/cli test` 299 条全过

## 文档

- [ ] T030 docs/roadmap.md 打勾(收尾统一)
