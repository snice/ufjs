# Tasks: 083-fjs-build-ipa-aab

对应 spec:`./spec.md`。按顺序做,做完一条勾一条。

## 实现

- [x] T001 `bundler/build.ts`:BuildOptions 加 ipa/aab;parseBuildArgs 识别
  `--ipa`/`--aab`;buildCommand 组合校验(四者互斥、各自要求
  --release/--profile、--ipa 仅 darwin),校验先于任何构建副作用
- [x] T002 `releaseBuild()`:`flutter build appbundle`(.aab 产物路径打印)
  与 `flutter build ipa`(导出失败打印 .xcarchive 路径 +
  `-- --export-options-plist` 透传提示后抛错)
- [x] T003 cli.ts usage 文本

## 测试

- [x] T010 `build-targets.test.ts` 3 条:互斥、缺 --release、非 darwin

## 验证

- [x] T020 `pnpm --filter @ufjs/cli test` 302 条全过
- [ ] T021 `--aab` 实跑(手工项:签名环境无关、耗时长;产物路径按
  releaseBuild 的打印核对)

## 文档

- [x] T030 docs/roadmap.md 打勾(收尾统一)
