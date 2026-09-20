# Spec: fjs build --ipa / --aab

- **ID**: 083-fjs-build-ipa-aab
- **状态**: done(--aab 实跑一项挂账 T021)
- **日期**: 2026-09-20

## 1. 要解决什么

roadmap 近期计划:`fjs build` 目前只有 `--apk`(和 OpenHarmony fork 的
`--hap`);上架 Play 需要 .aab、分发 iOS 需要 .ipa,用户得自己进宿主目录
跑 `flutter build appbundle` / `flutter build ipa`,资产同步、模式参数
这些 `releaseBuild` 已经做对的事全部重做一遍。

## 2. 不做什么(Non-goals)

- 不做签名配置管理:`--ipa` 的导出需要证书;导出失败时报 .xcarchive
  路径 + `-- --export-options-plist <file>` 透传提示(既有 flutterArgs
  通道,零新参数)。
- 不做一次多目标:apk / hap / ipa / aab 互斥,一次只打一种(每次都是
  独立的 flutter 子命令)。
- `--ipa` 仅 darwin(需要 Xcode)。

## 3. 用户可见的行为

```
fjs build --release --aab          # build/app/outputs/bundle/release/app-release.aab
fjs build --release --ipa          # build/ios/ipa/*.ipa(或 .xcarchive + 提示)
fjs build --release --apk --aab    # 报错:一次一种
fjs build --release --ipa -- --export-options-plist ios/export.plist
```

## 4. 两端约定(宪法 I)

不涉及;纯构建分发。

## 5. 契约变更(宪法 II)

- [x] 都不涉及。

## 6. 验收标准

1. 组合校验 vitest 用例:互斥、缺 --release、非 darwin 的 --ipa,各自
   报错且不触发构建。
2. `pnpm --filter @ufjs/cli test` 全绿。
3. `--aab` 实跑(可选,时长原因登记为手工验证项):产物路径打印正确。

## 7. 待澄清

- 无。
