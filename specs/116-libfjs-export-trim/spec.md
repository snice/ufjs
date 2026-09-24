# Spec: libfjs.so 收窄导出符号并开启 gc-sections

- **ID**: 116-libfjs-export-trim
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

默认引擎换成 PrimJS 后，Android arm64 的 `libfjs.so` 是 1.94 MB（quickjs 版 1.41 MB），
比预期大。拆开看（`llvm-size -A`，已 strip）：

| 段 | primjs | quickjs |
|---|---|---|
| `.text` | 1.22 MB | 0.98 MB |
| `.dynstr` + `.dynsym`（动态符号表） | **201 KB** | 55 KB |
| `.eh_frame` | 152 KB | 111 KB |
| `.rela.dyn` | 104 KB | 77 KB |

原因有两个：

1. **导出太多**。spec 090 把调试器拆成可插拔模块 `libfjs_debugger.so`，它要调用引擎
   内部函数，于是 `native/CMakeLists.txt` 加了 `FJS_EXPORT_ENGINE_INTERNALS`，
   `primjs/.../base_export.h` 据此把 PrimJS 的 `QJS_HIDE` 全部改成默认可见。结果
   primjs 版导出 **2824** 个符号（鸿蒙 2858），而 Dart FFI 只用 `fjs_*` 的十几个，
   调试器模块实际只用到其中 **190** 个。导出的函数都算「被外部引用」，链接器也不能当
   死代码删掉。quickjs 版同样导出了 1002 个。
2. **最终链接没开 `--gc-sections`**。PrimJS 自己的 CMakeLists 写了
   `-Wl,--gc-sections -flto -Wl,--icf=all`，但只作用在它的子目录，没带到我们链接
   `libfjs.so` 的那一步。

2026-09-24 用 NDK 实测（arm64，strip 后）：

| 做法 | primjs `libfjs.so` | 导出 | 调试器 |
|---|---|---|---|
| 现状 | 1,936,144 | 2824 | 可用 |
| 只加 `--gc-sections --icf=all` | 1,904,720 | 2824 | 可用 |
| **再加版本脚本：只导出 `fjs_*` + 调试器用到的 190 个** | **1,338,648（−31%）** | 208 | 可用 |
| 同上 + LTO | 1,317,640 | 208 | 可用 |
| quickjs：gc-sections + 只导出 `fjs_*` | 1,186,664（原 1,412,792） | — | 不适用 |

## 2. 不做什么（Non-goals）

- **不开 LTO**：只多省 21 KB，却要改所有编译单元的编译参数、拉长构建时间。
- 不动 iOS / macOS：它们发布的是静态 xcframework，App 链接时已经按引用裁剪。
- 不动桌面 `libfjs.dylib`：不随包发布，只给 `fjsrun` / `fjs-test` 用。
- 不改引擎源码和 PrimJS 补丁（`base_export.h` 的 `FJS_EXPORT_ENGINE_INTERNALS`
  保留——编译期仍然要可见，调试器模块才能链接；收窄发生在最终链接这一步）。
- 不改 `.eh_frame`（关掉 unwind 表有 C++ 异常风险），不改优化级别。
- 不改 Dart FFI、调试器模块的接口和文件名。

## 3. 用户可见的行为

对使用者没有行为变化，只有包体变小：

| 产物 | 现状 | 目标（约） |
|---|---|---|
| Android primjs arm64 `libfjs.so` | 1.94 MB | ≤ 1.40 MB |
| Android quickjs arm64 `libfjs.so` | 1.41 MB | ≤ 1.25 MB |
| 鸿蒙 primjs / quickjs `libfjs.so` | 1.90 / 1.33 MB | 同比例缩小 |
| armeabi-v7a、x86_64 | — | 同比例缩小 |

- debug 构建里 `fjs debug` 照常可用（Android、鸿蒙）。
- 导出清单变成**显式的契约**：`libfjs.so` 只导出 `fjs_*` 入口，primjs 版另外导出
  调试器模块需要的那批符号。以后调试器用到新的引擎内部函数而清单没跟上时，必须在
  **构建时**报错，而不是等到 debug 包 dlopen 调试器时才失败。

## 4. 两端约定（宪法 I）

只涉及原生产物的链接方式，不涉及 Flutter 渲染与 Web。

| 平台 | 本 spec |
|---|---|
| Android（arm64-v8a / armeabi-v7a / x86_64） | 收窄 + gc-sections，重建产物 |
| 鸿蒙（arm64-v8a） | 同上（同为 ELF），重建产物，`ohos/libs` 同步 |
| iOS / macOS | 不改；因为 native 源码没变，产物不需要重建（spec 115 之后 native 只改了 Windows 分支） |
| 桌面 | 不改 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

新增一条内部契约：「`libfjs.so` 的导出清单」与「调试器模块从 `libfjs` 导入的符号」
必须一致，由构建期检查保证。

## 6. 验收标准

1. `tool/build-android.sh`、`tool/build-ohos.sh` 重建后，`abi/` 下各 `libfjs.so`：
   - 大小达到第 3 节的目标；
   - 导出符号（`llvm-nm -D --defined-only`）：quickjs 版只有 `fjs_*`；primjs 版是
     `fjs_*` 加上调试器所需的清单，没有别的。
2. 调试器模块导入的每一个引擎符号都在 `libfjs.so` 的导出里（脚本断言，三个 ABI + 鸿蒙）。
3. 构建期守卫：故意从清单里删掉一个调试器用到的符号，`build-android.sh`（或 cmake 构建
   `fjs_debugger`）**失败**并指出缺的符号。
4. `native/build-native` 的 `fjs-test` 全部通过；`flutter test` 通过（先编好 native）。
5. Android 模拟器：hello-fjs release APK 正常启动渲染；debug 构建 `fjs debug` 附加成功，
   CDP `Runtime.evaluate` 返回正确结果。
6. 鸿蒙模拟器：hello-fjs release HAP 正常启动；debug 构建 `fjs debug` 附加成功。
7. `node tool/check-publish.mjs` 通过（`ohos/libs` 与 `abi/primjs/ohos` 逐字节一致）；
   `tool/test/android_debugger_strip_check.mjs` 仍通过。
8. 文档：`docs/toolchain.md` 产物表里的大小、`docs/engine-perf.md` 的 `libfjs.so` 大小、
   `docs/debugger.md`（导出清单与守卫）、`primjs/VENDORED.md`（`base_export.h` 补丁
   的代价说明更新）、`CHANGELOG.md` 0.1.7 一节。

## 7. 待澄清

无。发布节奏已定：与 spec 115 一起作为 0.1.7 发布。
