# Tasks: libfjs.so 收窄导出符号并开启 gc-sections

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 不涉及 op 协议 / natives 表 / 事件类型；Dart FFI 查的 `fjs_*` 全部保留导出（spec §5）。确认后勾掉

## 实现

- [x] T010 新增 `native/cmake/libfjs-exports.cmake`：读目标文件列表，用 `CMAKE_NM` 取未定义符号，写版本脚本；无调试器时只导出 `fjs_*`
- [x] T011 `native/CMakeLists.txt`：`debugger-plugin.cpp` 拆成 OBJECT 库（`fjs_debugger`、`fjs_debugger_core` 复用）；ELF 下为 `fjs` 生成并挂上版本脚本、`--gc-sections`、`-ffunction-sections -fdata-sections`，探测后加 `--icf=all` / `--undefined-version`；`fjs_debugger` 加 `--no-undefined`；找不到 `CMAKE_NM` 时警告并退回全部导出
- [x] T012 新增 `tool/test/libfjs_exports_check.mjs`，并在 `build-android.sh`、`build-ohos.sh` 末尾调用
- [x] T013 重建产物：`tool/build-android.sh`、`tool/build-ohos.sh`（含 `ohos/libs` 同步）
  - 2026-09-24：调试器 .so 重建后逐字节不变；14:39–14:42 有一次来源不明的 `build-native-artifacts` 在仓库里跑过（跨过了 CMakeLists 修改的时刻，产物新旧混杂、Apple 产物仅条目顺序与归档时间戳变化），已由本任务完整重建覆盖，Apple 产物还原为已提交版本

## 两端对齐

- [x] T020 不涉及 Web / iOS / macOS（plan §1 的 I），确认后勾掉；确认本 spec 未改 native 源码，Apple 产物无需重建

## 测试

- [x] T030 `libfjs_exports_check.mjs` 对新产物通过；各 `libfjs.so` 大小达到 spec §3 目标
- [x] T031 守卫：临时让生成的版本脚本漏掉一个调试器用到的引擎符号，`fjs_debugger` 链接失败并指出该符号；恢复后通过
  - 2026-09-24：漏掉 `LEPUS_Eval` → `ld.lld: error: undefined symbol: LEPUS_Eval`，并列出 `debugger_callframe.cc:146`、`runtime.cc:507` 等引用处；恢复后导出 208 个、链接通过。注意：macOS 自带 make 3.81 的时间戳精度是秒，同一秒内改生成脚本不会触发重新生成——只影响手动增量构建，构建脚本每次清空目录不受影响
- [x] T032 `native/build-native` 重新构建，`fjs-test` 全部通过；`flutter test` 通过
- [x] T033 Android 模拟器：hello-fjs release APK 启动渲染；debug 构建 `fjs debug` 附加 + CDP evaluate
- [x] T034 鸿蒙模拟器：hello-fjs release HAP 启动；debug 构建 `fjs debug` 附加 + CDP evaluate

## 文档

- [x] T040 `docs/toolchain.md` 产物表大小、`docs/engine-perf.md` 的 `libfjs.so` 大小
- [x] T041 `docs/debugger.md`：导出清单自动生成与守卫；`primjs/VENDORED.md`：`base_export.h` 补丁的代价（「更大的动态符号表」）改为「最终链接时收窄」
- [x] T042 `CHANGELOG.md` 0.1.7 一节、`docs/roadmap.md`

## 验收

- [x] T050 `pnpm run typecheck`、`pnpm test`、`flutter analyze`、`flutter test`
- [x] T051 `node tool/check-publish.mjs`、`android_debugger_strip_check.mjs`、`dart pub publish --dry-run`
- [x] T052 逐条核对 spec.md 第 6 节
  - 2026-09-24：
    - 1：重建后 primjs arm64 1,338,648 B（导出 208）、armeabi-v7a 807,220 B（209）、x86_64 1,342,216 B（207）；quickjs arm64 1,186,664 B、armeabi-v7a 803,196 B、x86_64 1,252,872 B（均只导出 19 个 `fjs_*`）；鸿蒙 primjs 1,263,880 B（225）、quickjs 1,133,360 B（19）。均达到 §3 目标
    - 2：`libfjs_exports_check.mjs` 通过（Android 三个 ABI 另核对了调试器导入 ⊆ libfjs 导出）
    - 3：T031，漏掉 `LEPUS_Eval` 时 `fjs_debugger` 链接失败并指出引用处
    - 4：`fjs-test` ALL PASS，`flutter test` 482 通过
    - 5：Android 模拟器 release APK 渲染正常；debug 下 `fjs debug` 附加，CDP `6*7` → 42
    - 6：鸿蒙模拟器 release HAP 渲染正常；debug 下 `fjs debug`（VM 从局域网拨入）附加，CDP `6*7` → 42
    - 7：`check-publish`、`android_debugger_strip_check` 通过；`pub publish --dry-run` 仅剩「有未提交改动」
    - 8：文档、CHANGELOG、roadmap 已更新
  - 验收命令：`pnpm run typecheck` 通过；`pnpm test` 全部通过；`flutter analyze lib` 无问题
