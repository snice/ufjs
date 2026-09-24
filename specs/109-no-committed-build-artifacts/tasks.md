# Tasks: 清理仓库里提交的构建产物与死代码

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表零变更；引擎只删未编译目录

## 实现

- [x] T010 新增 `specs/093-devtools-tree-lazy-and-live/e2e/build.mjs`，能生成 `bundle.js` 与 `relay.cjs`
- [x] T011 `e2e/client.cjs` 去掉绝对路径；新增 `e2e/.gitignore`、`e2e/README.md`
- [x] T012 `git rm --cached` 两份产物
- [x] T013 删除 `packages/flutter_fjs/native/primjs/src/wasm/`，更新 `VENDORED.md`
- [x] T014 新增 `examples/fjs-go/tool/refresh-seed.sh`

## 两端对齐

- [x] T020 不涉及页面能力；确认 `packages/fjs-runtime/src/web/` 与 `lib/src/` 零改动
- [x] T021 e2e 构建参数与 CLI dev 构建（`packages/fjs/src/bundler/build.ts` 的 `fjsDefines`、target）一致

## 测试

- [x] T030 本机桌面构建 + `fjs-test`（删 wasm 后）
- [x] T031 用脚本生成的产物跑通 spec 093 e2e
- [x] T032 `bash -n` 校验刷新脚本；在本地伪造的 FJSB 文件上验证引擎 id 校验逻辑

## 文档

- [x] T040 `VENDORED.md`、`e2e/README.md`
- [x] T041 `docs/roadmap.md` 登记 specs/109

## 验收

- [x] T050 `pnpm run typecheck`（demo / hello-fjs 既有 TS2339 除外）——6 个包 Done
- [x] T051 `pnpm test`——cli 351、runtime 685、webview 36、webgl 30 全过
- [x] T052 spec.md 第 6 节逐条核对
