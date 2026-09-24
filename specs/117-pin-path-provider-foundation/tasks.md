# Tasks: 把 path_provider_foundation 限制在 FFI 版之前，修复 iOS 网络图崩溃

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 核对确实不涉及三张契约表（`ops.ts`/`ui_ops.dart`、`native-global.d.ts`/`natives.cpp`、`element.ts`/`fjs.h`），不改动

## 实现

- [x] T010 在 `packages/flutter_fjs/pubspec.yaml` 的 `dependencies` 下加 `path_provider_foundation: ">=2.3.2 <2.6.0"`，并写英文注释：为什么锁、为什么是 2.5.1、上游 issue 链接、放开条件
- [x] T011 在 scratchpad 准备 Flutter SDK（>=3.38）；装不上就记录下来，T012/T013/T030 转给用户在本机做（用的是 3.41.9：原锁文件里 SDK 锁定的包 meta 1.17.0、test_api 0.7.10、matcher 0.12.19 对应这一版。先试过 3.47.5，但会顺带改掉这些包和 `analysis_options.yaml`，所以换了版本）
- [x] T012 `cd packages/flutter_fjs && flutter pub get`，确认解析到 `path_provider_foundation 2.5.1`，依赖图里没有 `objective_c`
- [x] T013 分别在 `examples/fjs-go` 和 `packages/flutter_fjs/example` 执行 `flutter pub get`，重新生成 `pubspec.lock`（不手改）（移除了 objective_c、hooks、code_assets、record_use、logging、pub_semver、yaml；fjs-go 的 macOS `GeneratedPluginRegistrant.swift` 多注册了 `PathProviderPlugin`，因为 2.5.1 是原生插件，这是预期的生成结果）

## 两端对齐

- [x] T020 Web 侧：确认 `packages/fjs-runtime/src/web/` 里 `<image>` 走浏览器 `<img>`、不经过 path_provider，不需要改（结论：`web/components/basic.ts` 渲染原生 `<img>`，缓存交给浏览器，不需要改）
- [x] T021 两端行为对拍：hello-fjs 的 fetch 页在 `fjs dev --web` 和 `fjs run ios` 上都显示狗图（iOS 部分由用户在本机验证）（web 代码没动，`fjs build` 通过；**iOS 部分待用户本机验收**）

## 测试

- [x] T030 `cd packages/flutter_fjs && flutter test` 通过（没编 native 时如果输出 `No tests ran`，要单独注明）（450 条通过、跳过 3 条；`nav_router_test.dart` 因为没编 native 输出 `No tests ran`，**不算通过**，但它和依赖解析无关）

## 文档

- [x] T040 `docs/web.md`「图片缓存」一条补上 iOS 依赖约束的说明
- [x] T041 `docs/roadmap.md`「image mode 与加载事件」一节补一条 ✅，写明约束和放开条件
- [x] T042 `packages/flutter_fjs/CHANGELOG.md` 顶部新增未发布节，记这条 fix（spec 117）

## 验收

- [x] T050 `pnpm run typecheck`（全 workspace 通过；新 clone 要先执行 `fjs build` 生成被 gitignore 的 `src/fjs-*.d.ts`，否则 demo/hello-fjs 会报 `icon-mind` 类型缺失。这个问题改动前就有，和本 spec 无关）
- [x] T051 `pnpm test`（webview 36、cli 378、runtime 685、webgl 30，全部通过）
- [x] T052 spec.md 第 6 节逐条核对，把 spec 状态改成 done（用户本机验收的条目标注出来）（第 1–4、6、7 条已核对；第 5 条 iOS 实机验收待用户完成）
