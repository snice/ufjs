# Spec: iOS/macOS 上 `--js-engine` 切换后仍运行旧引擎（Xcode 缓存未失效）

- **ID**: 112-engine-switch-stale-build
- **状态**: done（iOS / macOS 真机切换待用户验证）
- **日期**: 2026-09-24
- **来源**: 用户本机验证 spec 105：上次 `fjs run` 用 primjs，这次 `fjs run --js-engine quickjs`，
  App 里仍是 primjs。runner 输出了 `host pods invalidated (primjs → quickjs)`。最初报告 iOS / macOS 与 Android
  均复现；用户随后重测 Android，**确认没有问题**，本 spec 只处理 iOS / macOS。

## 1. 要解决什么

spec 105 让各平台按路径直接引用 `abi/<flavor>/…`，两个 flavor 的库**同名**（`libfjs.so` / `libfjs.a`）、
位于**不同目录**。切换时构建系统的增量判断没有察觉：

### iOS / macOS（代码确认）

- CocoaPods 的「复制 xcframework」脚本把所选切片拷到
  `<宿主>/build/ios/<Debug-iphonesimulator 等>/XCFrameworkIntermediates/flutter_fjs/`（macOS 在
  `build/macos/Build/Products/<配置>/…`），Xcode 按「输入是否比输出新」决定是否重拷。quickjs 那份来自 git 检出，
  时间戳可能早于上次拷进来的 primjs 副本 → 判定为最新 → 继续链接 primjs。
- runner（`packages/flutter_fjs/bin/engine.dart`）本有一步清这个缓存，但只查
  `build/<一级目录>/XCFrameworkIntermediates`，比 Flutter 的实际布局浅一到三层，**从未删到任何东西**。
  该逻辑继承自 spec 091：那时每次切换都把文件原地复制一份、时间戳是新的，所以没暴露。

### Android

用户重测后确认正常（Gradle 以内容判断输入变化）。排查中一度怀疑 AGP 的增量 jniLibs 合并、并实现了
「固定目录 + Sync」的加固，已撤回：不为没有复现的问题改构建脚本。

## 2. 不做什么（Non-goals）

- 不回到「复制进插件目录」（spec 105 的原则不变：插件源码目录只读）。
- 不在本环境做 iOS / macOS 构建（无 Xcode）。
- 纯 Flutter 宿主不经过 runner 直接改 dart-define 的 iOS 场景：仍依赖运行期告警提示（spec 105 已有）。

## 3. 用户可见的行为

```bash
fjs run ios                          # primjs
fjs run ios --js-engine quickjs      # 这次就是 quickjs，无需 flutter clean
fjs run macos --js-engine quickjs    # 同上
```

- flavor 变化时 runner 递归清掉宿主 `build/` 下所有 `XCFrameworkIntermediates/flutter_fjs`
  与 `flutter_fjs/flutter_fjs.framework`，下次构建必然重拷、重链。

## 4. 两端约定（宪法 I）

不涉及。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. runner 的清理：本环境无 Dart，把清理逻辑的目录匹配规则用 Node 在模拟的 Flutter iOS / macOS 构建目录上
   对照验证（`build/ios/Debug-iphonesimulator/XCFrameworkIntermediates/flutter_fjs`、
   `build/macos/Build/Products/Debug/XCFrameworkIntermediates/flutter_fjs`、各自的 `flutter_fjs.framework`
   被删除，其它目录不动）。Dart 实现需用户本机跑。
2. `pnpm test`、typecheck 不回退。
3. **需用户验证**：iOS / macOS 上 primjs → quickjs → primjs 来回切换，不 `flutter clean`，每次引擎 id 正确。
4. `docs/toolchain.md`、`docs/roadmap.md` 更新。

## 7. 待澄清

无。

## 8. 验收记录（2026-09-24）

1. `node packages/flutter_fjs/tool/test/xcode_cache_paths_check.mjs`：11/11——Flutter iOS（模拟器 / 真机）与
   macOS 布局下的 `XCFrameworkIntermediates/flutter_fjs`、`flutter_fjs/flutter_fjs.framework` 被删除；其它插件、
   `Runner.app` 内嵌副本、Android 构建目录不动；并证明 spec 105 的一层查找在同一布局上一条都匹配不到。
   Dart 实现本环境无法运行，与该对照实现同规则（文件互相注明）。
2. `pnpm test`、typecheck 全绿；spec 105 的 podspec / 发布校验 / Gradle flavor 解析脚本仍全过。
3. **待用户验证**：iOS / macOS 上 primjs → quickjs → primjs 来回 `fjs run`，不 `flutter clean`，每次引擎 id 正确。
   首次运行时 runner 会输出 `host pods invalidated (unknown → …)`（v1 戳记不再被信任），属预期。
4. 文档已更新。Android 部分见 §1：用户确认无问题，排查中写的加固已撤回。
