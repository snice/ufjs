# Plan: QuickJS ↔ Dart Object ABI

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 演示模块两端各一份实现（Dart 模块 / TS 替身），业务页面不改一行跑两端；web 替身机制 = iconmind 的既有模式。缺失替身时 warnOnce + throw，差异登记在 spec §4。 |
| II 边界即契约 | 是（核心） | 动了两张契约：natives 表（`natives.cpp`↔`native-global.d.ts`，新增 `objectCall`）与 FJSValue C ABI（`fjs.h`↔`ffi.dart`，v2→v3 + 3 个新入口）。**新开 C ABI 的论证**：(a) roadmap 既有条目，`value.cpp:48` 注释自证；(b) 是一切后续 Dart 能力模块的通用地基，非单功能通道；(c) 先例 specs/150 libfjs-style。被否备选见 §3。事件表不动。 |
| III 同步单线程零序列化 | 是 | 全程 UI isolate 同线程同步调用，无新线程、无锁；对象调用零 JSON（富 FJSValue 直传）；异步结算（settle）在 Dart 事件循环上发生，不算跨界——与 fetch 范式同一性质。 |
| IV 外观照 WeUI | 否 | 无 UI 外观变更。 |
| V 静默失效是 bug | 是 | 三处落实：Dart 错误消息进 JS 异常（修掉现 `rc!=0` 只抛 "host module call failed" 的洞）；stale handle/callback 抛错（沿 spec 038 纪律）；web 端缺替身 warnOnce + throw。 |
| VI 注释记录权衡 | 是 | 关键权衡写进代码注释：finalizer 为何只入队不回 Dart、回调表为何 dup 强持有、invokeHost 为何冻结、40 字节布局的对齐约束。 |
| VII JS 能包就不要下 Dart | 是（反向合规） | 能力本体就是 Dart 对象，JS 无法伪造；下沉的是"通用传输机制"而非某个具体功能。 |
| VIII 变更落到文档 | 是 | `docs/jsi-and-native-modules.md`（ABI v3 章）、`docs/modules.md`（对象模块 SPI + web 替身）、`docs/threading-model.md`（callback/settle 路径）、`docs/roadmap.md` 勾掉 structured handles，同 PR 更新。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | （不动） | `dartModule` 薄封装不涉及模块解析 |
| JS runtime | `packages/fjs-runtime/src/native-global.d.ts` | `objectCall` 类型 + `FjsDartObject`/`FjsCallbackFn` 值类型 |
| JS runtime | `packages/fjs-runtime/src/dart-bridge.ts`（新） | `dartModule<T>()`、`registerDartModuleStub()`、能力探测 |
| JS runtime | `packages/fjs-runtime/src/index.ts` | 导出 dart-bridge API |
| JS runtime | `packages/fjs-runtime/test/…`（新） | vitest：能力探测、替身路由、缺失报错 |
| C++ 引擎 | `packages/flutter_fjs/native/include/fjs.h` | ABI v3：新 tag、结构体 40 字节、3 个新入口声明 |
| C++ 引擎 | `packages/flutter_fjs/native/src/engine.h` | 门面补两 flavor 的 class API（new_class/set_opaque/get_opaque 等） |
| C++ 引擎 | `packages/flutter_fjs/native/src/value.cpp` | `to/from_fjs_value` 富值分支 |
| C++ 引擎 | `packages/flutter_fjs/native/src/vm.cpp` + `fjs_internal.h` | proxy 类、回调表、pending 表、pending_releases 队列、3 个新入口实现、错误消息路径 |
| C++ 引擎 | `packages/flutter_fjs/native/src/natives.cpp` | `__fjs.fns.objectCall` 注册（富转换版 host 调用） |
| C++ 引擎 | `packages/flutter_fjs/native/test/main.cpp` | 新增对象 ABI 用例组 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ffi.dart` | FJSValue 40 字节镜像 + 3 入口绑定 + tag 常量 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/registry/host.dart` | `_fromNative`/`_writeOut` 认新 tag |
| Dart 宿主 | `packages/flutter_fjs/lib/src/registry/object_bridge.dart`（新） | ObjectBridge：注册表、模块路由、Future→PENDING、settle 调度 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | 挂载 `engine.objects`，VM 重建时重置 |
| Dart 宿主 | `packages/flutter_fjs/test/…`（新） | flutter test：桥路由 / settle / stale |
| 文档 | `docs/jsi-and-native-modules.md`、`docs/modules.md`、`docs/threading-model.md`、`docs/roadmap.md` | 宪法 VIII |
| demo | `demo/…`（或 hello-fjs） | 演示页（业务代码两端同源）+ demo 的 Dart 侧注册 + web 替身 |

## 3. 方案

**传输层**（已拍板）：FJSValue 加三个 tag，payload 用新 `int64_t j` 字段；
结构体 32→40 字节，`FJS_ABI_VERSION` 2→3。JS→Dart 走新 native
`objectCall(op, ...args)`——它与 `invokeHost` 共用同一个
`fjs_invoke_host` C 回调（Dart 侧仍是单一 trampoline 漏斗，`fjs.object.*`
内部模块名由 ObjectBridge 接管），但参数转换用富值版：proxy 类→HANDLE、
function→CALLBACK（dup 入回调表）、其余同 v1。返回值富转换：HANDLE→proxy
JSObject、PENDING→`new Promise`+pending 表、CALLBACK→JS 函数包装。
Dart→JS 新增 `fjs_vm_call_callback` / `fjs_vm_settle_promise` /
`fjs_vm_release_callback` 三个入口。

**生命周期**：native 首次引入 JSClass。proxy finalizer 只把 handle 推入
`vm->pending_releases`，pump 末尾 / objectCall 入口处统一 flush——GC 期间
不执行跨界调用。Dart ObjectBridge 句柄单调不复用（沿 spec 038）；记录归属
模块，invoke 路由回创建者；adapter 返回 Future → PENDING(callId)，完成后
`scheduleMicrotask` 再 settle（engine.dart:159-163 的栈内禁回派规则）。

**被否掉的备选**：
1. *纯 fetch 范式（全 JSON 走 dispatchEvent）*——零新 ABI 最保守，但正是
   Lucent 文档批评的字符串 Bridge：handle 与 number 无法区分、回调参数类型
   有损、每次调用序列化开销；且宪法 III 的精神就是反 JSON 桥。
2. *独立二进制帧协议（仿 UI ops 为对象调用单独编解码）*——性能上限最高，
   但要新写 TS/Dart 两份手写编解码器；FJSValue 数组本身就是现成的 tagged
   传输，为它再发明一层是过度设计。
3. *TS Proxy 包装句柄（runtime 层做代理对象，WeakRef/FinalizationRegistry
   回收）*——不进 native 就拿不到真实 finalizer，FinalizationRegistry 回调
   依赖 job 调度时机，GC 语义弱；且每属性访问都过 JS 层。JSClass 一次到位。
4. *invokeHost 直接改造成富值转换*——会改变既有模块"对象降级字符串"的
   可观察行为，回归面大；新 native 让 v1/v2 语义完全冻结。

## 4. 风险

- **PrimJS class API 可用性**（最大技术风险）：`engine.h` 门面从未暴露
  JSClass 系；第一步先写门面 spike 验证 LEPUS 分支有 `LEPUS_NewClass` 等价
  API。不通则 objectCall 门控为仅 QuickJS flavor（显式报错，不静默）。
- **GC 期跨界**：finalizer 若直接回 Dart 可能在 mark-sweep 中段重入；
  pending_releases 队列把跨界挪到 pump 边界。
- **回调表泄漏**：JS 函数被 dup 强持有，Dart 忘 release 就泄漏；VM destroy
  兜底全清；文档写明回调要 release（跨堆环同理）。
- **重入风暴**：JS→Dart→JS 无限互调打穿原生栈；call_callback/objectCall
  共享深度计数，超限抛错（仿 style binding busy 先例）。
- **40 字节 FFI 对齐**：Dart `final class FJSValue extends ffi.Struct`
  显式镜像字段序，用 sizeof 断言测试钉住两侧布局。
- **两端对拍点**：六能力矩阵在 `fjs dev` 与 `fjs dev --web` 各跑一遍演示页。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test
cd packages/flutter_fjs/native \
  && cmake -B build-native -DFJS_BUILD_TESTS=ON \
  && cmake --build build-native -j && ./build-native/fjs-test
cd packages/flutter_fjs && flutter test
# 六能力对拍：
pnpm --filter demo run dev          # fjs-go 连上走查 Flutter 端
pnpm --filter demo run dev -- --web # 浏览器走查 web 端
```
