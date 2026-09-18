# Plan: 067-pub-package-score

只动 `packages/flutter_fjs`（Dart 侧 + 包元数据），native/JS 侧零改动，
预编译产物不需要重建。

## 改动层与文件

1. **transitions.dart（编译错误）**
   - 加 `import 'package:flutter/cupertino.dart';`，顶部注释记录
     3.44 挪库这件事（fork 3.41 在 material、官方 3.44 在 cupertino，
     双 import 两头都编过）。
2. **弃用与多余 import（14 个 info）**
   - `lib/src/canvas/replay.dart`：`withOpacity`→`withValues(alpha:)`、
     `.opacity`→`.a`、`.value`→`toARGB32()`（按现场语义选）。
   - `lib/src/fjs_app.dart`：`NavigatorPopHandler.onPop`→`onPopWithResult`。
   - `lib/src/render/decoration.dart`：删多余 `vector_math` import。
   - `lib/src/widgets/switch.dart`：`activeColor`→`activeThumbColor`。
   - `test/canvas_replay_test.dart`、`test/transition_background_test.dart`：
     `.alpha/.red/.blue` 弃用 getter 换组件访问器；`test/dev_client_test.dart`
     删多余 `dart:async`；`test/sticky_test.dart` 删多余
     `flutter/rendering.dart`。
3. **format**：`dart format lib test example` 对齐（pana 计格式分）。
4. **dartdoc 缺口**：`lib/flutter_fjs.dart` 库级 doc comment；
   `CanvasChunkReader`（类、构造、`bytes`、`done`、`f32`——报告点名）。
5. **example/**：`example/pubspec.yaml`（path 依赖 `../`）+
   `example/lib/main.dart`（FjsEngine + FjsApp 最小宿主，`FJS_DEV`/
   release 双路径，仿 hello-fjs 真实宿主但去掉 autolink 粘合）+
   `example/README.md`。
6. **版本与元数据**：`pubspec.yaml` version 0.1.5；CHANGELOG.md 加条目。

## 顺序

1 → 2 → 3（analyze 清零后再 format，避免来回）→ 4 → 5 → 6 → 验证
（analyze / format / downgrade / pana 本地跑分 / fjs-test）。

## 风险

- 双 import 在某个 3.43 beta 上可能歧义——评估过：官方文档迁移指引无
  警告，stable 范围内无重叠窗口；接受。
- `withValues(alpha: x)` 与 `withOpacity(x)` 数值语义有精度差异
  （线性 vs sRGB 分量）——替换处都是绘制用的透明度，视觉差可忽略；
  若 pana 复跑仍有 info 按现场消息再调。
