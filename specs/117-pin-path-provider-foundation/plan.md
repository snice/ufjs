# Plan: 把 path_provider_foundation 限制在 FFI 版之前，修复 iOS 网络图崩溃

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 不改标签、事件或样式，只影响 Flutter 端的依赖解析。Web 端 `<img>` 不涉及 path_provider，不用改 |
| II 边界即契约 | 否 | `ops.ts`/`ui_ops.dart`、`native-global.d.ts`/`natives.cpp`、`element.ts`/`fjs.h` 都不动 |
| III 同步单线程零序列化 | 否 | 2.5.1 是 Pigeon/MethodChannel 实现，由 `flutter_cache_manager` 在 Dart 侧异步调用，不经过 JS↔Dart 边界，和 JS 线程模型无关 |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 约束放在 `flutter_fjs` 的直接依赖里：以后有依赖要求 `>=2.6.0` 时，`pub get` 会直接报版本冲突，而不是悄悄选中 FFI 版、等到运行时崩溃。`flutter test` 输出 `No tests ran` 时要在验证记录里单独注明 |
| VI 注释记录权衡 | 是 | `pubspec.yaml` 约束旁边写英文注释，说明为什么锁这一版（FFI 版的 native assets 漏打包）、为什么是 2.5.1（上游回滚出来的插件实现）、上游 issue 链接，以及放开条件 |
| VII JS 能包就不要下 Dart | 否 | 不是新能力。崩溃出在 Dart 侧依赖的原生加载上，JS 侧没法绕开 |
| VIII 变更落到文档 | 是 | `docs/roadmap.md` 的「image mode 与加载事件」一节补一条；`docs/web.md` 的「图片缓存」一条补上这个 iOS 依赖约束；`packages/flutter_fjs/CHANGELOG.md` 记 fix |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | **不改**。托管宿主是 path 依赖（monorepo）或 `flutter_fjs: ^0.1.7`，约束会跟着 flutter_fjs 传递过去 |
| JS runtime | — | 不改 |
| Web 适配层 | — | 不改 |
| C++ 引擎 | — | 不改 |
| Dart 宿主 | `packages/flutter_fjs/pubspec.yaml` | `dependencies` 下加 `path_provider_foundation: ">=2.3.2 <2.6.0"` 和注释 |
| 锁文件 | `examples/fjs-go/pubspec.lock`、`packages/flutter_fjs/example/pubspec.lock` | 用 `flutter pub get` 重新生成：`path_provider_foundation` 从 2.6.0 变成 2.5.1，`objective_c` 这一项消失（`ffi` 仍是 flutter_fjs 的直接依赖，保留） |
| 文档 | `docs/roadmap.md`、`docs/web.md`、`packages/flutter_fjs/CHANGELOG.md` | 见宪法 VIII |

## 3. 方案

**选定**：在 `packages/flutter_fjs/pubspec.yaml` 加直接依赖

```yaml
  path_provider_foundation: ">=2.3.2 <2.6.0"
```

- 下限 2.3.2：跟 `path_provider 2.1.6` 对它的约束 `^2.3.2` 对齐，不会额外收窄。
- 上界 2.6.0：pub.dev 上 2.5.0 已撤回（retracted），pub 不会选；2.5.1 的 changelog 写着
  "Reverts to plugin-based implementation while FFI issues are investigated"，依赖里
  没有 `objective_c`/`ffi`；2.6.0 又重新发布了 FFI 实现。所以实际解析到 2.5.1，
  它要求 Dart `^3.9.0`，满足仓库 3.10 的下限。
- 用户在 spec 里确认约束放在 flutter_fjs 的依赖里（§7）。

**否掉的备选**：

1. **CLI 给托管宿主写 `dependency_overrides`**：fjs-go、用户自建的宿主、`flutter_fjs/example`
   都覆盖不到。另外 overrides 会绕过版本求解，以后真有冲突也会被悄悄盖掉，违反宪法 V。
2. **在 `flutter_fjs` 里写 `dependency_overrides`**：下游不会继承依赖包的 overrides，等于没写。
3. **绕开 `cached_network_image`，自己实现磁盘缓存**：spec 里已经列为 Non-goal，工作量大、风险高，
   只为躲一个上游 bug 不值得。
4. **改 Xcode 构建脚本，手动把 `objective_c.framework` 拷进 Frameworks**：会侵入宿主工程，
   上游修好后还会变成重复嵌入，spec 里也已经列为 Non-goal。
5. **只写文档让用户自己 `flutter clean`**：上游报告说清理后问题还会再出现，而且会发到 release 包里。

## 4. 风险

- **已发布的 0.1.7 不受影响**：`flutter_fjs: ^0.1.7` 的外部用户要等下一次发版（0.1.8）才会拿到
  这条约束。仓库内的 hello-fjs/demo 走 path 依赖，立即生效。CHANGELOG 记在新版本节下。
- **下游冲突**：用户宿主里如果有依赖要求 `path_provider_foundation >=2.6.0`，`pub get`
  会失败。这是故意的（宪法 V），注释里要写清楚怎么应对：确认上游已修好后，可以在宿主里
  用 `dependency_overrides` 自担风险放开。
- **Flutter 版本上移**：以后 Flutter 如果要求 path_provider_foundation ≥2.6，比如 `path_provider`
  自己把下限提高，这条约束会让解析失败。到那时（或者上游修好 native assets 嵌入时）去掉这条约束。
  放开条件写在注释和 roadmap 里。
- **本环境没有 Flutter SDK**：锁文件必须用 `flutter pub get` 生成，不能手改（AGENTS.md）。
  实现时先尝试在 scratchpad 装一个 Flutter SDK 来跑 `pub get`/`flutter test`；装不上的话，锁文件
  和 `flutter test` 这两步交给用户在本机做，并如实报告。
- **iOS 实机验收只能用户做**：云端没有 Xcode。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter pub get && flutter pub deps --style=compact | grep -E "path_provider_foundation|objective_c"
#   期望：path_provider_foundation 2.5.1，没有 objective_c
cd ../../examples/fjs-go && flutter pub get && grep -A6 "path_provider_foundation:" pubspec.lock && ! grep -q "objective_c:" pubspec.lock
cd ../../packages/flutter_fjs/example && flutter pub get && ! grep -q "objective_c:" pubspec.lock
cd .. && flutter test          # 没编 native 时 nav_router_test 输出 "No tests ran"，要单独注明
pnpm run typecheck && pnpm test   # JS 侧不受影响，跑一遍作为回归
# 用户本机（macOS）：flutter clean 后执行 fjs run ios，打开 hello-fjs 的 fetch 页，
# 狗图正常显示，没有 DOBJC_initializeApi；再次进入走缓存也不崩
```
