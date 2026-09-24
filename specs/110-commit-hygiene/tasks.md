# Tasks: 提交善后与提交信息校验

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表零变更；不改写 git 历史

## 实现

- [x] T010 `.githooks/check-commit-msg.mjs` + `.githooks/commit-msg`
- [x] T011 根 `package.json` 的 `test` 追加 `node --test .githooks/`
- [x] T012 `packages/flutter_fjs/pubspec.lock` 停止跟踪并加入 `.gitignore`
- [x] T013 `examples/fjs-go/ohos/build-profile.json5` 移除签名配置

## 两端对齐

- [x] T020 不涉及运行时；确认 `packages/fjs-runtime/src/web/`、`packages/flutter_fjs/lib/src/` 零改动
- [x] T021 规则与 AGENTS.md §7 描述一致（type 列表、格式）

## 测试

- [x] T030 `.githooks/check-commit-msg.test.mjs`（含历史回放）
- [x] T031 临时仓库实测钩子拦截 / 放行
- [x] T032 校验修改后的 `build-profile.json5` 为合法 JSON5 且无 `/Users/` 路径

## 文档

- [x] T040 `AGENTS.md` §7、`examples/fjs-go/README.md`
- [x] T041 `docs/roadmap.md` 登记 specs/110

## 验收

- [x] T050 `pnpm run typecheck`（demo / hello-fjs 既有 TS2339 除外）——6 个包 Done
- [x] T051 `pnpm test`——各包全过，末尾 test:hooks 6/6
- [x] T052 spec.md 第 6 节逐条核对
