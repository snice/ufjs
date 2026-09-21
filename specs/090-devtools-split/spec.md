# Spec: DevTools 分层——调试器作为可插拔模块

- **ID**: 090-devtools-split
- **状态**: done
- **日期**: 2026-09-21（2026-09-21 修订，见 §2.1）

## 1. 要解决什么

spec 088/089 后，调试器代码以两种形态全量进入所有构建：

1. **原生**：inspector（CDP 语义层）与传输（socket）一起编译进 libfjs；
2. **运行时**：`devtools.ts` 数据平面（元素树/fetch 记录）进每一个 bundle。

目标：**调试器成为可插拔模块**——`libfjs.so` 是干净的引擎，调试器是独立
模块 `libfjs_debugger.so`；release 构建自动剔除该模块，产物里自然没有
调试器代码，也没有可用的调试通道。

## 2. 方案

- **libfjs.so**（唯一引擎产物，所有构建同一份）：引擎 + 一张**空的
  inspector 钩子表**。引擎里 10 个调用点（`quickjs.cc` 8 处 /
  `quickjs_gc.cc` 2 处）原本直接调 inspector，现在改为经钩子表转发；
  表为空 = 调试器物理不可达。
  钩子表加解释器里已有的 `#ifdef ENABLE_QUICKJS_DEBUGGER` 结构字段共
  ~20 KB，其余 inspector 代码全部不在此产物内。
- **libfjs_debugger.so**（可插拔模块，release 自动剔除）：PrimJS inspector
  全套（debugger / cpuprofiler / heapprofiler / runtime）+ socket 传输 +
  attach/detach 编排 + QJSDebuggerCallbacks 实现。attach 时把 6 个钩子填进
  引擎的表，detach 时清空。
- **自动检测**：Dart 侧 debug 构建先开 `libfjs.so` 拿引擎，再尝试
  `DynamicLibrary.open('libfjs_debugger.so')` 并**只在插件句柄上**查
  attach/detach；打不开（模块被剔除/未随包）则降级为"本构建无调试器"。
- **release 自动剔除**：Android 走插件 `android/build.gradle` 的 jniLibs
  排除（已有，`-PfjsKeepDebugger=true` 保留）；Apple 走静态库按 configuration
  链接——`libfjs_debugger.a` 只在 Debug 配置 `-force_load`，Release 不引用
  即一个字节都不进二进制；ohos 走 `ohos/build-profile.json5` 的
  `buildModeBinder`，release/profile 绑到一份带
  `nativeLib.filter.excludes` 的构建配置，插件 HAR 打包时就不收这个文件
  （ohos flutter fork 组装插件 HAR 时透传 `-p buildMode=<mode>`）。
- **运行时数据平面**（089 的 `__fjsDevtools`）：esbuild define
  `__FJS_DEVTOOLS__` 门控——`fjs dev` / `fjs build --devtools` 注入，
  其余构建 DCE 掉整个模块。

### 2.1 修订记录：为什么推翻"inspector 留在引擎里"

初版方案判断"inspector 与解释器编译期耦合，拆分=引擎手术"，于是只把
socket 传输拆成模块，inspector 以"惰性"形态留在 libfjs。实测下来这个
判断站不住，且收益几乎为零：

| 产物 | 初版 | 本版 | 差 |
|---|---|---|---|
| macOS `libfjs.dylib` | 1 505 280 B | 1 106 880 B | −26.5% |
| macOS 可剔除模块 | 55 544 B（仅传输） | 485 800 B（inspector + 传输）| — |
| Android arm64 `libfjs.so` | 2 313 304 B | 1 935 032 B | −16.4% |
| Android arm64 可剔除模块 | 37 096 B | 493 600 B | — |

即初版 release 只减掉 2%，本版桌面减 26%、Android 减 16%（Android 的
基数里还有 STL 等固定开销，故比例低些）。

耦合的实际宽度（`nm` 实测，非估计）：

- **引擎 → inspector 只有 6 个符号、10 个调用点**，且 10 处**本来就全部**
  包在 `#ifdef ENABLE_QUICKJS_DEBUGGER` + 运行时开关
  （`is_debug_mode` / `ctx->debugger_mode` / `debugger_need_polling`）里，
  换成走钩子表不引入任何新的热路径分支。
- 开着 `ENABLE_QUICKJS_DEBUGGER` 的 `quickjs.cc.o` 只比关掉大 20 KB
  （1176 vs 1155 KB）——**结构字段和钩子是便宜的，语义层才是那 430 KB**。
- 反向（inspector → 引擎）101 个符号，其中 23 个是 `QJS_HIDE`
  的引擎内部函数，需要跨 .so 边界因而必须放开可见性；另有 7 个 GC 写屏障
  只有 inspector 在调，引擎不引用就不会把 `gc/collector.cc` 链进来，需要
  在引擎侧留一个取地址的锚点。落地后实测：Android 模块的 247 个未定义符号
  里，除 libc 外**全部**由 `libfjs.so` 导出。

## 3. 不做什么

- 不改 `ENABLE_QUICKJS_DEBUGGER` 的开启状态：libfjs 与插件都带这个宏编译，
  结构布局一致，`.fjsbundle` 字节码格式与今天完全相同。
- release 字节码调试、Worker、source map、样式编辑（延续 089 边界）。
- Windows 传输（延续 088）。
- 不发两套完整引擎产物：Apple 静态链接下两份引擎会撞 duplicate symbol，
  只能在 `pod install` 时选，粒度比"一份引擎 + 可选 inspector 归档"差。

## 4. 契约变更（宪法 II）

- [x] `fjs.h`：`fjs_vm_debugger_attach/detach` 的**导出位置**从 libfjs 移到
      libfjs_debugger.so（声明保留，注释注明导出库）；新增
      `FjsDebuggerTransport` + `fjs_debugger_set_transport`（引擎内槽位）。
      Dart 侧 OPTIONAL 查找对象变为插件库；三处同步照做。
- [x] vendored PrimJS 本地补丁（记入 `native/primjs/VENDORED.md`）：
      新增 `inspector_hooks.h/.cc` 钩子表；10 处调用点改走钩子；
      `base_export.h` 的 `QJS_HIDE` 在 `FJS_EXPORT_ENGINE_INTERNALS` 下放开
      为默认可见；`CMakeLists.txt` 把 inspector 源码拆成独立 target。
- [x] UI op / 事件类型 / natives 表：不涉及。

## 5. 验收标准

1. `pnpm run typecheck` / `pnpm test` 全绿；devtools 单测全绿。
2. 产物矩阵：
   - `fjs build` 无 `__fjsDevtools`；`fjs build --devtools` 有；
   - `libfjs.so` / `libfjs.a` 里 **`nm` 查不到任何 inspector 符号**
     （`QJSDebuggerInitialize` / `DoInspectorCheck` / heapprofiler 等）
     且不含 socket 代码；体积较修订前下降 ≥25%；
   - `libfjs_debugger.so` 含 inspector 全套，仅引用引擎导出符号；
   - ohos 插件 HAR：debug 模式两个 .so 都在，release / profile 只剩
     `libfjs.so`。
3. 桌面端到端：`fjsrun` 动态加载 libfjs_debugger ——
   断点/单步/locals/evaluateOnCallFrame + Elements/Network 面板全绿。
4. 模拟器端到端不回归（`fjs run ios` Debug 配置链接 inspector 归档）。
5. Release 反证：`fjs build --release` 出的 ipa/apk 里 attach 符号缺失，
   Dart 侧走"本构建无调试器"降级路径而非崩溃。

## 6. 待澄清

- 无。
