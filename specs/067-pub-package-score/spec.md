# Spec: flutter_fjs 的 pub.dev 体检修复（0.1.4 → 0.1.5）

- **ID**: 067-pub-package-score
- **状态**: done（2026-09-18，pana 本地 150/160，四项红灯三项清零、平台恢复 3 平台 tag）
- **日期**: 2026-09-18

## 1. 要解决什么

pub.dev 对 flutter_fjs 0.1.4 的分析报告四个红灯（合计 50/130）：

1. **Pass static analysis 0/50**：`lib/src/transitions.dart:28` 引用
   `CupertinoPageTransitionsBuilder` 报 ERROR（undefined function +
   invalid constant value）。根因：官方 Flutter 3.44 把这个类从
   material 挪进了 cupertino
   ([breaking change](https://docs.flutter.dev/release/breaking-changes/decouple-page-transition-builders))，
   pub.dev 用最新 stable 分析；本机装的是 3.41 的 ohos fork（类还在
   material），所以本地 `flutter analyze` 从来不复现，只剩 14 个 info。
   pub 报 17 issues，本地能看到的 14 个全是 info（withOpacity/opacity/
   value/alpha/red/blue 等弃用 + 3 个 unnecessary_import）。
2. **Platform support 0/20**：pana 的 platform tag 不是读 pubspec 声明，
   而是逐平台跑静态分析、代码干净才发 tag —— transitions.dart 的
   ERROR 让全部 6 个平台拿不到 tag（读 pana 源码
   `lib/src/tag/tagger.dart` + `report/multi_platform.dart` 确认的机制，
   本地跑 pana 复验）。另外注意：iOS/macOS 插件没有 Swift Package
   Manager 支持时该项封顶 10/20（partial），这是后续 spec 的事。
3. **Provide documentation 10/20**：dartdoc 已过 20% 线（10/10），差的
   是 "Package has an example" 0/10 —— 包里没有 `example/` 目录。
4. **Support up-to-date dependencies 20/40**：依赖上限没问题（10/10 +
   10/10），挂的是 "Compatible with dependency constraint lower
   bounds"：downgrade 分析同样死在 transitions.dart 那两个 ERROR 上。

## 2. 不做什么（Non-goals）

- **Swift Package Manager 支持**（iOS/macOS `Package.swift`）：要动
  native 构建并在真机/模拟器上验证 SPM 链路，单独开 spec。本 spec 接受
  平台分止步 10/20（5/6 平台 + darwin legacy 的 partial 封顶）。
- **Web 平台**：dart:ffi 决定了 flutter_fjs 永远不可能支持 Flutter
  Web，不去凑第 6 个平台。
- **ohos 插件键**：读 pana 源码确认它用 `pubspec_parse(lenient: true)`，
  未知平台键 `ohos` 会被忽略而不是炸解析 —— 保留（specs/066 的成果，
  fork 靠它注册插件）。
- **dartdoc 覆盖率冲高**：10/10 已经拿满，只补报告点名的
  `flutter_fjs` 库和 `CanvasChunkReader` 系列缺口，不全量补注释。
- **依赖版本变更**：`cached_network_image >=3.4.1 <5.0.0`、`ffi`、
  `vector_math` 约束保持不动。

## 3. 用户可见的行为

```bash
cd packages/flutter_fjs
flutter analyze                 # No issues found!（fork SDK 上）
dart format --output=none .     # 无 diff
flutter pub downgrade && flutter analyze && flutter pub upgrade
                                # downgrade 后同样 0 issue
pana .                          # static analysis 50/50，platform 至少
                                # 恢复多平台 tag（10/20），docs 20/20
```

发布 0.1.5 后 pub.dev 四项全绿（platform 除外，注明 SPM 待补）。

`example/`：一个最小 Flutter 宿主（`example/lib/main.dart`），展示
`FjsEngine` + `FjsApp` 的标准接入（dev 走 `FJS_DEV`，release 走
assets 的 bundle），README 指向 `fjs build` 产 JS。它要过 analyze 和
format，但不要求在本包内可构建出真机产物 —— 端到端可跑的样例是
`examples/hello-fjs` 的职责。

## 4. 两端同源（宪法 IV）

- [ ] 不涉及。纯 Dart 侧打包/注释/示例，op 协议、JS API、web 侧零改动。
      `decoration.dart` 删掉的 `vector_math` import 只影响 Dart 文件，
      `vector_math` 依赖本身保留（`style_parse.dart` 的 CSS transform
      解析还在用）。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 关键技术判断（已核实的事实）

- `CupertinoPageTransitionsBuilder`：官方 3.38–3.43 stable 在
  material；3.44 起只在 cupertino。`transitions.dart` 同时 import
  material + cupertino 即两端都编过（fork 3.41 的 cupertino 不含该类，
  名字从 material 解析；官方 3.44 相反，无歧义窗口——官方迁移文档只让
  "加一个 import"，没有警告双 import 歧义）。`fjs_app.dart` 依赖的
  `CupertinoRouteTransitionMixin` / `CupertinoPageTransition.
  delegatedTransition` 在 master 上确认还在。
- 修复用的 API 全部在声明的 floor（Flutter 3.38 / Dart 3.10）之上已
  存在：`withValues`/`.a/.r`/`toARGB32`（3.27+）、`activeThumbColor`
  （3.31+）、`onPopWithResult`（3.24+）。
- pana 平台 tag 机制：`Tagger.platformTags` 对每个 recognized platform
  用对应 runtime 跑库图检查；包自身 pubspec 声明了 platforms 时自己的
  库当叶子节点（信任声明），所以 ERROR 清掉后 android/ios/macos/
  windows/linux 都应拿到 tag（web 因 dart:ffi 拿不到，符合预期）。
- pana example 判定：`exampleFileCandidates(name)`，`example/lib/
  main.dart` 命中。

## 7. 验收标准

1. `cd packages/flutter_fjs && flutter analyze` → `No issues found!`
2. `dart format --output=none --set-exit-code lib test example` → exit 0
3. `flutter pub downgrade && flutter analyze` 0 issue，
   `flutter pub upgrade` 恢复 lock
4. `example/` 存在且 `example/lib/main.dart` 过 analyze；pana 报
   "Package has an example"
5. pana 报告 static analysis 满分；platform ≥ 5/6 平台 tag；
   documentation 20/20
6. `flutter test`（native 已编时）不回归：`fjs-test` 引擎自测通过
7. 版本 0.1.5 + CHANGELOG 条目；`flutter pub publish --dry-run` 无 error

## 8. 待澄清

- [ ] 无（SPM 归入后续 spec，已列入 Non-goals）
