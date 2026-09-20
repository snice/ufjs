# Tasks: 081-fjs-upgrade

对应 spec:`./spec.md`。按顺序做,做完一条勾一条。

## 实现

- [x] T001 `commands/upgrade.ts`:npm view / pub.dev 拉取 + sameMinor 配对 +
  包管理器探测(lockfile/packageManager 字段/monorepo 守卫)+ 宿主
  pubspec 改写 + flutter pub get
- [x] T002 `commands/doctor.ts`:installedVersion / minor / readPackage 导出;
  hostCheck 补第三项(托管 flutter_fjs 与 cli 不同 minor → warn,hint
  指向 fjs upgrade;path 依赖不查)
- [x] T003 cli.ts:import + case + usage + 头部注释

## 测试

- [x] T010 `upgrade-versions.test.ts`:sameMinor 4 条(最新同 minor、无
  匹配 null、数字序比较、release 压 prerelease)+ compareVersions 2 条

## 验证

- [x] T020 demo 实跑 `fjs upgrade --check`:cli/runtime 各 0.1.4 → 0.1.4,
  flutter_fjs 识别 path 依赖并标注不触碰;修复 versions 列表漏 JSON.parse
- [x] T021 `pnpm --filter @ufjs/cli run build` + `pnpm --filter @ufjs/cli
  test`(293 过,含新增 6 条)

## 文档

- [x] T030 docs/roadmap.md 打勾(收尾统一)
