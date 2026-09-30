# Tasks: 164-portable-vue-global

- [x] T1 `fjs-runtime/src/vue-global.d.ts`：`FjsGlobalComponents` 导出 + why 注释
- [x] T2 `demo/src/fjs-global.d.ts`：对本项目 vue 做 `GlobalComponents extends FjsGlobalComponents`
- [x] T3 `examples/hello-fjs/src/fjs-global.d.ts` 同步
- [x] T4 `fjs/src/commands/create.ts` 模板同步 + `pnpm --filter @ufjs/cli run build`
- [x] T5 验证：demo / hello-fjs typecheck 清零；全 workspace typecheck + `pnpm test` 绿
