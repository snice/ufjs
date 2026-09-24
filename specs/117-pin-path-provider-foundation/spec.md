# Spec: 把 path_provider_foundation 限制在 FFI 版之前，修复 iOS 网络图崩溃

- **ID**: 117-pin-path-provider-foundation
- **状态**: draft
- **日期**: 2026-09-24

## 1. 要解决什么

在 iOS 模拟器（iOS 26.5）上用 `fjs run ios` 跑 hello-fjs，打开「网络请求 / fetch」页
（`examples/hello-fjs/src/pages/api/fetch.vue`）。页面挂载成功，但 dog.ceo 返回图片地址、
`<image :src="dogUrl">` 开始加载网络图时，Dart VM 抛出未捕获异常：

```
Unhandled Exception: Invalid argument(s): Couldn't resolve native function
'DOBJC_initializeApi' in 'package:objective_c/objective_c.dylib' :
Failed to load dynamic library 'objective_c.framework/objective_c' ... (no such file)
```

调用链：

```
<image src="https://…">
  → flutter_fjs 的 image widget → cached_network_image
    → flutter_cache_manager → path_provider（取缓存目录）
      → path_provider_foundation 2.6.0（iOS/macOS 实现）
        → objective_c（FFI，native assets 产出 objective_c.framework）
```

`path_provider_foundation` 从 **2.5.0** 起从 Pigeon/MethodChannel 改成 FFI 实现，
依赖 `objective_c` 包的 native assets。Flutter 的构建缓存有时会漏掉
`objective_c.framework` 的嵌入，于是 Runner.app 里找不到这个 framework。上游报告里
这个问题时有时无（模拟器和真机、debug 和 release 都出现过），`flutter clean` 后重建
只能暂时解决：

- flutter/flutter#178915
- flutter/flutter#181382（add-to-app 场景）
- dart-lang/native#3281

对 ufjs 用户来说：**任何页面只要用了 http(s) 的 `<image>`，iOS/macOS 上都可能随机崩溃**，
和页面代码无关。ufjs 自己不直接用 `path_provider`，是 `cached_network_image`
带进来的间接依赖。

## 2. 不做什么（Non-goals）

- 不替换 `cached_network_image`，也不自己实现磁盘缓存。
- 不去修 Flutter / native assets 的上游 bug，也不改 Xcode 构建脚本去手动嵌入 framework。
- 不处理 Android 侧的 `path_provider_android`（2.3.x 走 jni，目前没有同类报告）。
- 不改 Web 端（`<img>` 交给浏览器，不涉及 path_provider）。
- 不永久锁定：上游修好后再放开，本 spec 只负责记录放开的条件。

## 3. 用户可见的行为

页面代码不用改：

```vue
<image src="https://images.dog.ceo/breeds/xxx.jpg" />
```

改完后，依赖 `flutter_fjs` 的宿主（`fjs run/build` 托管的宿主、fjs-go、
`packages/flutter_fjs/example`）在 `flutter pub get` 时，`path_provider_foundation`
会解析到 `<2.5.0`（MethodChannel 实现），依赖图里不再有 `objective_c`（前提是没有别的
依赖单独把它拉进来）。在 iOS 上加载网络图不再出现 `DOBJC_initializeApi` 异常，
磁盘缓存照常工作。

副作用：如果用户宿主里另有依赖要求 `path_provider_foundation >=2.5.0`，
`pub get` 会报版本冲突，而不是等到运行时崩溃。这时报错信息要能让用户看懂为什么
（见 §7）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 网络图照常经 `cached_network_image` 加载，带内存和磁盘缓存 | 不变，`<img>` |
| 事件载荷 | `@load` / `@error` 不变 | 不变 |
| 已知差异 | 无新增 | 无 |

只改依赖解析结果，不改面向用户的能力，两端契约不变。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `packages/flutter_fjs/pubspec.yaml` 里有 `path_provider_foundation` 的上界约束（`<2.5.0`），
   旁边的注释写明原因、上游 issue 链接和放开条件（宪法 VI）。
2. `cd packages/flutter_fjs && flutter pub get` 成功；`flutter pub deps` 里
   `path_provider_foundation` 版本 `<2.5.0`，并且没有 `objective_c`。
3. `examples/fjs-go` 和 `packages/flutter_fjs/example` 执行 `flutter pub get` 后，
   `pubspec.lock` 里 `path_provider_foundation` `<2.5.0`、没有 `objective_c`，更新后的锁文件一起提交。
4. `cd packages/flutter_fjs && flutter test` 通过（没编 native 时 `No tests ran` 要单独注明，宪法 V）。
5. 手动：macOS 上 `flutter clean` 后 `fjs run ios` 跑 hello-fjs，打开 fetch 页，
   「GET binary」用例通过、狗图显示出来、控制台没有 `DOBJC_initializeApi`；
   再从另一页返回、重新进入 fetch 页，图片命中缓存，依然没有这条异常。
   （本仓库的 CI/云端环境没有 Xcode，这一条由用户在本机验收。）
6. `docs/roadmap.md`（或 `docs/web.md` 图片缓存那一条）登记这个版本约束和放开条件（宪法 VIII）。
7. `packages/flutter_fjs/CHANGELOG.md` 记一条 fix。

## 7. 待澄清

- [ ] **约束放在哪一层**：推荐作为 `flutter_fjs` 的直接依赖约束写进 `pubspec.yaml`，
      这样所有下游宿主自动生效，因为下游宿主不会继承依赖包里的 `dependency_overrides`。
      另一个做法是只在 CLI 生成托管宿主时写 `dependency_overrides`，但覆盖不到 fjs-go 和自建宿主。
      请确认用直接依赖约束。
- [ ] **下限取多少**：暂定 `>=2.3.0 <2.5.0`，需要在 plan 阶段对照 `path_provider 2.1.x` 的
      约束和本仓库的 Dart 3.10 下限核实，确认能解析到 2.4.x。
