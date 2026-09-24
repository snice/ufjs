# Plan: iOS/macOS 引擎切换后仍运行旧引擎

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 构建链问题。 |
| II 边界即契约 | 否 | 不动三张表与 C ABI。 |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 修的就是切换静默不生效。 |
| VI 注释记录权衡 | 是 | 写清为何需要固定同步目录、为何清理要递归、各自的 Flutter 目录布局。 |
| VII JS 能包就不要下 Dart | 不适用 | — |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`、`docs/roadmap.md`。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart runner | `packages/flutter_fjs/bin/engine.dart` | `_markHostFlavor` 的缓存清理改为递归（有深度上限）查找 `XCFrameworkIntermediates/flutter_fjs` 与 `flutter_fjs/flutter_fjs.framework`；戳记改名 `engine_flavor.v2`，无戳记时失效一次 |
| 测试 | `packages/flutter_fjs/tool/test/xcode_cache_paths_check.mjs`（新增） | 在模拟目录上验证清理规则（与 Dart 实现同一套规则） |
| 文档 | `docs/toolchain.md`、`docs/roadmap.md` | — |

## 3. 方案

- **iOS / macOS**：保留「flavor 变化时由 runner 清宿主构建缓存」的做法，只把查找改对：从宿主 `build/` 起递归，
  深度上限 6，只删名字精确匹配的两类目录。

**被否掉的备选**：
- iOS 给两个 flavor 的 xcframework 起不同的库名：会让 podspec、`FlutterFjsPlugin.m` 链接假设与构建脚本都跟着改，
  而 Xcode 的中间目录仍可能按 pod 名复用，收益不确定。
- Android「固定目录 + Gradle Sync」加固：曾实现并通过脚本验证，但用户确认 Android 没有问题，撤回。
- 触碰（touch）所选 flavor 文件的时间戳：会写插件目录（pub-cache），违反 spec 105。

## 4. 风险

- runner 的 Dart 改动本环境无法运行，规则用 Node 镜像实现对照测试，两份实现需保持一致（测试文件注明）。

## 5. 验证路径

```bash
node packages/flutter_fjs/tool/test/xcode_cache_paths_check.mjs
pnpm test
```
