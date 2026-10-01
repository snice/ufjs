# Tasks: 空 `<script setup vapor>` 的 SFC 能正常按 vapor 编译

对应 plan：`./plan.md`。

- [x] T001 `sfc-tags.ts`：`sfcParseOptions` 加 `ignoreEmpty: false`
- [x] T010 `fjs-runtime/test/vapor-sfc-compiler.test.ts`：空 script setup vapor 回归
- [x] T011 `fjs/test/vue-plugin-vapor.test.ts`：CLI 判定 + 编译回归
- [x] T020 `pnpm --filter @ufjs/runtime test`、`pnpm --filter @ufjs/cli test`、`pnpm run typecheck`
