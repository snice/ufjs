# Tasks: 用 autoimport 调用 sn_progress_dialog

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 `packages/flutter_fjs/lib/src/fjs_app.dart`：`FjsApp.currentContext`
      静态 getter（`_FjsAppState` 在 initState/dispose 登记/清除当前实例）
- [x] T002 `packages/flutter_fjs/test/fjs_app_context_test.dart`（新）：挂载后
      非 null，卸载后 null（找不到 native dylib 时按既有测试的方式显式跳过）

## 实现

- [x] T010 `demo/dart/progress/pubspec.yaml` + `lib/progress.dart`（新）：
      `Progress` 门面（show/update/close/isOpen/onStatus）+ 顶层 `progressContext`
      provider；无 provider 时抛带说明的 StateError；头注释写权衡
- [x] T011 `demo/package.json` autoimport 加 progress 条目；
      `demo/src/main.dart` 接线 `progressContext`
- [x] T012 `cd demo && pnpm exec fjs autoimport --force`：核对 d.ts
      （`ProgressModule`/`Progress`）与 `dart analyze lib/fjs_objects.dart` 无
      error/warning；提交生成物

## 两端对齐

- [x] T020 `demo/src/pages/basic/dart-progress.vue`（新）：按钮 + 一键脚本；
      `hasDartObjectSupport()` 守卫（web 显示说明）
- [x] T021 web：`fjs dev --web` 打开该页只显示说明、控制台无异常
- [x] T022 iOS 模拟器：一键脚本弹出真实进度框，日志序列符合 spec §6.3；
      其余按钮（不定进度/自动推进/手动 +20/关闭）逐个点一遍（弹窗模态：改为 JS 自收尾的场景，见 spec §8）

## 测试

- [x] T030 `flutter test`（含 T002）；本组无新增 vitest（生成器行为已由 specs/201
      覆盖，本页是对真实 Widget 包的端到端调用）

## 文档

- [x] T040 `docs/modules.md`：autoimport 章补「Widget 包用本地 facade 包一层 +
      宿主接线 context」小节
- [x] T041 `docs/web.md` 已知差异补一行（进度弹窗页 web 只显示说明）

## 验收

- [x] T050 `pnpm run typecheck` 与 `pnpm test`
- [x] T051 `cd packages/flutter_fjs && flutter test`
- [x] T052 spec.md §6 逐条核对；状态改 done
