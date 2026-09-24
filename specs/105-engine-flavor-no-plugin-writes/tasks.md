# Tasks: 引擎 flavor 由构建按配置直接选用，不再改写插件目录

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨边界表零变更；`FlutterFjsPlugin.m` 的 flavor 来源改为 `FJS_ENGINE_QUICKJS` 宏（`packages/flutter_fjs/{ios,macos}/Classes/FlutterFjsPlugin.m`），ABI 声明集合不变
- [x] T002 确定 flavor 优先级约定并写进各处注释：Android `fjs.jsEngine` → env → `dart-defines` → primjs；Darwin env → `Generated.xcconfig` `DART_DEFINES` → primjs

## 实现

- [x] T010 `git mv` Darwin 产物：`abi/<f>/ios` → `ios/abi/<f>`、`abi/<f>/macos` → `macos/abi/<f>`；删 `ios/.gitignore`、`macos/.gitignore`
- [x] T011 `packages/flutter_fjs/{ios,macos}/flutter_fjs.podspec`：flavor 解析 + `vendored_frameworks` 按 flavor + quickjs 宏注入
- [x] T012 `packages/flutter_fjs/android/build.gradle`：flavor 解析 + `jniLibs.srcDirs` 指向 `../abi/<f>/android`；删 `android/.gitignore`
- [x] T013 `packages/flutter_fjs/bin/engine.dart`：去掉对 android/ios/macos 的写入；鸿蒙按内容比对、仅 path 依赖复制；宿主 flavor 戳记 + Podfile/Xcode 缓存失效
- [x] T014 `packages/fjs/src/project/engine.ts`：设 `process.env.FJS_JS_ENGINE`；runner 缺失/失败按 spec 处理，不再静默
- [x] T015 `packages/fjs/src/cli.ts`、`packages/fjs/src/bundler/build.ts` 注释与帮助文本改成真实机制
- [x] T016 `packages/flutter_fjs/tool/build-{apple,android,ohos}.sh`：输出路径与默认物化步骤按新布局调整
- [x] T017 新增 `packages/flutter_fjs/ohos/.pubignore`；`packages/flutter_fjs/.gitignore` 去 `.materialized`；`pubspec.yaml` 注释、`NOTICE` 路径
- [x] T018 新增 `packages/flutter_fjs/tool/check-publish.mjs`

## 两端对齐

- [x] T020 Web 侧：不涉及（web 无引擎概念），确认 `packages/fjs-runtime/src/web/` 零改动
- [x] T021 平台间对齐：Android / iOS / macOS / 鸿蒙四处的 flavor 优先级、默认值、非法值行为一致（注释与校验脚本对照）

## 测试

- [x] T030 新增 `packages/fjs/test/engine.test.ts`：runner 缺失/失败/成功 × 默认/显式 flavor；env 被设置
- [x] T031 Gradle 脚本验证 Android flavor 解析（四种来源 + 非法值）
- [x] T032 Ruby 桩验证两个 podspec（三种来源 + 路径存在 + 宏注入）
- [x] T033 `check-publish.mjs` 正反两例

## 文档

- [x] T040 `docs/toolchain.md`「JS 引擎切换」一节按新机制重写；`docs/publishing.md` 发布步骤加校验
- [x] T041 `docs/roadmap.md` 登记 specs/105

## 验收

- [x] T050 `pnpm --filter @ufjs/cli run typecheck`、`pnpm run typecheck`（demo / hello-fjs 的既有 TS2339 除外）——其余 6 个包全部 Done
- [x] T051 `pnpm test`——cli 343（含新增 4）、runtime 678、webview 36、webgl 30 全过
- [x] T052 spec.md 第 6 节逐条核对；6–10 标为需用户本机验证
