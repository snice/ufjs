# Spec: JS 引擎双份缓存与切换入口（quickjs-ng / PrimJS）

- **ID**: 091-js-engine-switch
- **状态**: in-progress
- **日期**: 2026-09-21

## 1. 要解决什么

spec 088 把引擎从 quickjs-ng 0.9.0 整体切到 PrimJS 4.1.1（为了自带 CDP
调试器），老引擎的 vendored 源码在 e6fb442 里被删了。现在：

- 想对比两个引擎的运行表现（性能、兼容性、渲染结果），没有入口；
- PrimJS 出问题（比如某段代码行为差异、字节码/调试器问题）时没有退路；
- 引擎选择是硬编码的，没有任何配置面。

期望：quickjs-ng 源码恢复并保持可编译，两个引擎**都编译好、缓存起来**，
运行（`fjs run` / `fjs build`）时用配置选一个。

## 2. 不做什么（Non-goals）

- **不做同进程双引擎热切换**。虽然 PrimJS（`LEPUS_*`）与 quickjs-ng
  （`JS_*`）符号不冲突、理论上可同时链入，但那意味着每个 release App
  都背两份引擎（~1-2MB/架构）、`fjs_*` C ABI 要拆两套符号、Dart FFI 要
  做双入口表。为对比实验付出这个永久成本不值。切换粒度是**每次构建/运行
  选一个 flavor**，产物已缓存所以切换不触发引擎重编。
- **不保证 quickjs flavor 有调试器**。`fjs debug` 依赖 PrimJS 自带的
  CDP inspector；quickjs flavor 明确无调试器（Dart 侧已有"missing means
  not supported"的优雅降级）。
- 不做字节码跨引擎兼容（本来就不兼容，engine id 锁在 .fjsbundle 头里，
  各 flavor 只认自己的 id，现状机制不变）。
- 不改 op 协议、element API、JS runtime 任何一层。
- npm 包 `@ufjs/fjsc-*` 暂不分发 quickjs 版二进制（走仓库自编 +
  `FJSC_PATH`，见 plan）。

## 3. 用户可见的行为

```bash
# 默认不变：PrimJS
fjs run android

# 对比：quickjs-ng flavor（两个引擎都已预编译缓存在 flutter_fjs/abi/，
# 插件的构建钩子把选中 flavor 从缓存 copy 到 jniLibs/xcframework 位置）
fjs run android --js-engine quickjs
fjs build --js-engine quickjs --release   # 字节码由 quickjs 版 fjsc 编出
fjs run android                           # 切回 PrimJS，同样无需重编引擎

# 纯 Flutter 宿主（不经过 fjs CLI，比如 fjs-go）同样可切：
flutter run --dart-define=FJS_JS_ENGINE=quickjs

# 引擎名随 App 自报（ffi 已有 engineId）：bundle 不匹配时明确报
# "bundle engine mismatch: bundle was built for 'quickjs-ng-0.9.0' but ..."
```

环境变量等价物（CLI 启动时读它，等价于 --js-engine）：
`FJS_JS_ENGINE=quickjs fjs run android`。

## 4. 两端约定（宪法 I）

不涉及。本 spec 只动引擎底座与构建链，任何 JS 可见行为、事件载荷、
样式映射都不变。web 端无引擎概念，不涉及。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

`fjs_engine_id()` 的**取值**按 flavor 分叉（`primjs-4.1.1` /
`quickjs-ng-0.9.0`），这是 088 之前就存在的锁步机制恢复成双值，不是新契约。

## 6. 验收标准

1. `cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j`
   （默认 primjs）→ `fjs-test` 全绿，与 088 现状一致。
2. `cmake -B build-native-quickjs -DFJS_JS_ENGINE=quickjs -DFJS_BUILD_TESTS=ON
   -DFJS_DEBUGGER=OFF && ...` → `fjs-test` 全绿（调试器段落自动跳过）。
3. 两个 flavor 各自 `fjsrun` 跑 demo 的 dist 产物成功；quickjs flavor 报的
   engine id 是 `quickjs-ng-0.9.0`，用它跑 primjs 的 bundle 得到明确的
   mismatch 报错（反向同理）。
4. `fjs run --js-engine quickjs`（iOS 模拟器或 Android 模拟器）起得来，
   DevTools attach 提示该 flavor 无调试器；不带 flag 行为与现在完全一致。
5. `pnpm run typecheck`、`pnpm test` 全绿。
6. `abi/` 双 flavor 产物齐全，且 primjs 份同时物化到常规位置
   （jniLibs / pod 根 / ohos/libs），全新 clone 直接 `flutter run` 可用。

## 7. 待澄清

无。
