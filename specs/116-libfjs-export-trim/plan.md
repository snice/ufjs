# Plan: libfjs.so 收窄导出符号并开启 gc-sections

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否 | 只改 ELF 产物（Android、鸿蒙）的链接方式；渲染、Web、iOS/macOS 都不动 |
| II 边界即契约 | 否（新增内部契约） | op 协议、natives 表、事件类型不动；Dart FFI 查的 `fjs_*` 全部保留导出。新增「libfjs 导出 ⊇ 调试器导入」这条内部约束，由构建自动生成 + 检查脚本保证 |
| III 同步单线程零序列化 | 否 | 与运行时无关 |
| IV 外观照 WeUI | 否 | 无 UI |
| V 静默失效是 bug | **是** | ①导出清单在构建时从调试器的目标文件生成，调试器多用一个引擎符号会自动导出，不会漏；②`fjs_debugger` 链接加 `--no-undefined`，引擎符号缺失直接链接失败；③新增检查脚本断言导出集合与调试器导入的关系，重建产物后跑 |
| VI 注释记录权衡 | 是 | CMake 与生成脚本注释写清：为什么不提交固定清单（修饰名随 ABI 变，armv7 的 `size_t` 是 `j`、arm64 是 `m`）；为什么 libc++ 符号也要导出（调试器与引擎共用 libfjs 里那一份 libc++，隐藏后调试器会静默链进第二份）；为什么不开 LTO |
| VII JS 能包就不要下 Dart | 否 | 纯原生构建 |
| VIII 变更落到文档 | 是 | `docs/toolchain.md`、`docs/engine-perf.md`、`docs/debugger.md`、`primjs/VENDORED.md`、`CHANGELOG.md`、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| C++ 构建 | `packages/flutter_fjs/native/CMakeLists.txt` | ELF（`UNIX AND NOT APPLE`）下：`fjs` 加 `-ffunction-sections -fdata-sections`，链接加 `--gc-sections`、版本脚本，链接器支持时加 `--icf=all` 与 `--undefined-version`；把 `debugger-plugin.cpp` 拆成 OBJECT 库供生成器读取；`fjs_debugger` 链接加 `--no-undefined` |
| C++ 构建 | `packages/flutter_fjs/native/cmake/libfjs-exports.cmake`（新增） | `cmake -P` 脚本：用 `CMAKE_NM` 读调试器目标文件的未定义符号，写出版本脚本 `{ global: fjs_*; <这些符号>; local: *; };`；没有调试器时只导出 `fjs_*` |
| 预编译产物 | `packages/flutter_fjs/abi/{primjs,quickjs}/{android,ohos}/…/libfjs.so`、`ohos/libs/arm64-v8a/` | `tool/build-android.sh`、`tool/build-ohos.sh` 重建（调试器 .so 也随之重建） |
| 检查脚本 | `packages/flutter_fjs/tool/test/libfjs_exports_check.mjs`（新增） | 对 `abi/` 下每个 ELF `libfjs.so`：quickjs 只导出 `fjs_*`；primjs 的导出 ⊆ `fjs_*` ∪ 调试器导入；调试器导入的非系统符号 ⊆ libfjs 导出 |
| Dart / JS | — | 不动 |

## 3. 方案

### 3.1 版本脚本在构建时生成

```
debugger-plugin.cpp.o + quickjs_inspector/*.o
        │  ${CMAKE_NM} --undefined-only
        ▼
libfjs-exports.map   { global: fjs_*; "<sym>"; …; local: *; };
        │  -Wl,--version-script=…  (+ LINK_DEPENDS)
        ▼
libfjs.so            只导出 fjs_* 与调试器实际引用、且 libfjs 定义了的符号
```

未定义符号里也有 `malloc`、`__android_log_print` 这类 libfjs 不定义的系统符号，
放进 `global:` 不会让它们被「导出」，只会让 lld 报「版本脚本里的符号没定义」——所以
链接时加 `--undefined-version`（链接器支持时）。结果就是实测的「交集」：primjs arm64
导出 208 个。

没有调试器（quickjs，或 `FJS_DEBUGGER=OFF`）时脚本只写 `fjs_*`。

### 3.2 为什么连 libc++ 符号一起导出

调试器模块现在引用 libfjs 里的 `std::__ndk1::basic_string` 等 libc++ 符号——两个
.so 共用一份 libc++。如果隐藏它们，链接器会从 `libc++_static.a` 给调试器再链一份，
不报错但出现两份 libc++（跨 .so 传递 C++ 对象时有 ODR 风险）。版本脚本按调试器实际
引用生成，天然包含这些符号，行为与现在一致。

### 3.3 守卫

- `fjs_debugger` 加 `-Wl,--no-undefined`：引擎内部符号缺失时链接失败（libc++ 符号
  会从静态库补上，不会触发——这一类由 3.1 的自动生成保证不缺）。
- `libfjs_exports_check.mjs`：重建产物后对实际文件断言（验收 1、2），也可以接进
  `build-android.sh` / `build-ohos.sh` 的末尾。

### 3.4 被否掉的备选

| 备选 | 否掉的原因 |
|------|-----------|
| 提交一份固定的导出清单 | C++ 修饰名随 ABI 变化（armv7 与 arm64 的 `size_t` 不同），每个 ABI 一份又会和代码漂移 |
| 去掉 `FJS_EXPORT_ENGINE_INTERNALS`、逐个标注可见性 | 要改 PrimJS 源码里大量声明，每次升级都得重打，VENDORED.md 当初就是为避免这点才整体放开 |
| 调试器改为静态链进 libfjs | 违背 spec 090「release 物理上没有调试器」 |
| 开 LTO | 只多省 21 KB，要改全部编译单元参数、拉长构建 |
| 只开 gc-sections 不收窄导出 | 只省 31 KB（导出的函数都是根，删不掉） |

## 4. 风险

- **链接器差异**：Android、鸿蒙都是 lld；Linux 桌面可能是 GNU ld。`--icf=all`、
  `--undefined-version` 用 `check_linker_flag` 探测，不支持就不加（GNU ld 对版本脚本里
  未定义的符号本来就不报错）。
- **`CMAKE_NM` 不可用**：NDK 与 DevEco 的工具链都提供 llvm-nm；找不到时退回导出
  全部（等同现状）并在 configure 时打警告，不静默（宪法 V）。
- **调试器行为**：导出集合是调试器实际引用的超集，动态链接结果不变；验收在 Android、
  鸿蒙模拟器上实跑 `fjs debug`。

## 5. 验证路径

```bash
cd packages/flutter_fjs
ANDROID_NDK_HOME=… tool/build-android.sh
tool/build-ohos.sh
node tool/test/libfjs_exports_check.mjs
ls -l abi/*/android/*/libfjs.so abi/*/ohos/*/libfjs.so
cmake --build native/build-native -j && ./native/build-native/fjs-test && flutter test
node tool/check-publish.mjs
node tool/test/android_debugger_strip_check.mjs ../../examples/hello-fjs/.fjs/flutter/android
# 守卫：临时让生成脚本漏掉一个引擎符号 → fjs_debugger 链接失败
# 模拟器：Android / 鸿蒙 release 启动；debug 下 fjs debug + CDP evaluate
```
