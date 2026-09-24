# Tasks: 把 path_provider_foundation 限制在 FFI 版之前，修复 iOS 网络图崩溃

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [ ] T001 核对确实不涉及三张契约表（`ops.ts`/`ui_ops.dart`、`native-global.d.ts`/`natives.cpp`、`element.ts`/`fjs.h`），不改动

## 实现

- [ ] T010 在 `packages/flutter_fjs/pubspec.yaml` 的 `dependencies` 下加 `path_provider_foundation: ">=2.3.2 <2.6.0"`，并写英文注释：为什么锁、为什么是 2.5.1、上游 issue 链接、放开条件
- [ ] T011 在 scratchpad 准备 Flutter SDK（>=3.38）；装不上就记录下来，T012/T013/T030 转给用户在本机做
- [ ] T012 `cd packages/flutter_fjs && flutter pub get`，确认解析到 `path_provider_foundation 2.5.1`，依赖图里没有 `objective_c`
- [ ] T013 分别在 `examples/fjs-go` 和 `packages/flutter_fjs/example` 执行 `flutter pub get`，重新生成 `pubspec.lock`（不手改）

## 两端对齐

- [ ] T020 Web 侧：确认 `packages/fjs-runtime/src/web/` 里 `<image>` 走浏览器 `<img>`、不经过 path_provider，不需要改（记录结论）
- [ ] T021 两端行为对拍：hello-fjs 的 fetch 页在 `fjs dev --web` 和 `fjs run ios` 上都显示狗图（iOS 部分由用户在本机验证）

## 测试

- [ ] T030 `cd packages/flutter_fjs && flutter test` 通过（没编 native 时如果输出 `No tests ran`，要单独注明）

## 文档

- [ ] T040 `docs/web.md`「图片缓存」一条补上 iOS 依赖约束的说明
- [ ] T041 `docs/roadmap.md`「image mode 与加载事件」一节补一条 ✅，写明约束和放开条件
- [ ] T042 `packages/flutter_fjs/CHANGELOG.md` 顶部新增未发布节，记这条 fix（spec 117）

## 验收

- [ ] T050 `pnpm run typecheck`
- [ ] T051 `pnpm test`
- [ ] T052 spec.md 第 6 节逐条核对，把 spec 状态改成 done（用户本机验收的条目标注出来）
