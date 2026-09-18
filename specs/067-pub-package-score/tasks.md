# Tasks: 067-pub-package-score

- [x] T1 transitions.dart 补 cupertino import + 注释（修 pub 3.44 ERROR）
- [x] T2 replay.dart 弃用 API 清零（withOpacity/opacity/value）
- [x] T3 fjs_app.dart onPop → onPopWithResult
- [x] T4 decoration.dart 删多余 vector_math import
- [x] T5 switch.dart activeColor → activeThumbColor
- [x] T6 test/ 四个文件的弃用与多余 import 清零
- [x] T7 flutter analyze → No issues found!
- [x] T8 dart format lib test 对齐（94 文件重排）
- [x] T9 flutter_fjs.dart 库级 dartdoc + CanvasChunkReader 系列注释
- [x] T10 example/（pubspec + lib/main.dart + README）
- [x] T11 pubspec version 0.1.5 + CHANGELOG
- [x] T12 验证：flutter pub downgrade 分析 + 恢复（0 issue）；pana 本地
      150/160（analysis 50/50、example 10/10、deps 40/40、platform 10/20
      = iOS/Android/macOS tag 恢复，darwin 无 SPM 的 partial 封顶）；
      fjs-test ALL PASS；flutter test 352 全过；publish --dry-run 仅
      git-脏状态 1 个 warning（提交后消失，ohos 键无警告）。
      SPM 补齐另立 spec。
