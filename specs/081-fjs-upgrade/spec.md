# Spec: fjs upgrade——三包咬合升级

- **ID**: 081-fjs-upgrade
- **状态**: done
- **日期**: 2026-09-20

## 1. 要解决什么

roadmap 近期计划:`@ufjs/cli`、`@ufjs/runtime`、pubspec 里的 `flutter_fjs`
三者版本必须咬合(同一 minor 才是同一套协议)。手动升是踩坑重灾区——
`fjs doctor` 只能发现不匹配(且只查 cli↔runtime,不看 flutter_fjs),
不能修。

## 2. 不做什么(Non-goals)

- 不做版本回退 / 锁定特定版本(`fjs upgrade <version>` 顺延,先到 latest)。
- 不动 ufjs 仓库 checkout 本身(pnpm-workspace.yaml 存在时只打印计划,
  不跑安装器——workspace 由源码 path 咬合,装 npm 包反而破坏)。
- 不升级 `--patch`/`--minor` 策略选择:target 恒为 npm latest 的
  @ufjs/cli,runtime/flutter_fjs 取同 minor 的最高版。
- 不改 eject 后宿主之外的任何 pubspec。

## 3. 用户可见的行为

```
fjs upgrade            # 三包一起升到咬合的最新版
fjs upgrade --check    # 只打印 from → to,不动任何文件
```

输出形如:

```
@ufjs/cli      0.1.4 → 0.2.0
@ufjs/runtime  0.1.4 → 0.2.0
flutter_fjs    ^0.1.4 → ^0.2.0 (.fjs/flutter)
```

宿主是 path 依赖(repo checkout)时 flutter_fjs 一行标注 skipped。

## 4. 两端约定(宪法 I)

不涉及两端渲染;这是纯工具链命令。

## 5. 契约变更(宪法 II)

- [x] 都不涉及。

## 6. 验收标准

1. 版本配对纯函数(`sameMinor`)vitest 用例全过。
2. doctor 的宿主检查补第三项:flutter_fjs(宿主 pubspec 的托管版本)与
   cli 不同 minor 时 warn,hint 指向 `fjs upgrade`。
3. `pnpm run typecheck` + `pnpm test` 全绿。
4. 网络相关的 npm view / pub.dev 拉取不进单测(环境依赖),由纯函数边界
   隔离;实跑验证在 demo(有网络时)手工做一次 `--check`。

## 7. 待澄清

- 无。
