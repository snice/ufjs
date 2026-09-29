# Spec: QuickJS ↔ Dart Object ABI（对象句柄、双向调用、Promise/回调、生命周期）

- **ID**: 159-dart-object-abi
- **状态**: in-progress（T042 真机对拍待做，见 tasks.md）
- **日期**: 2026-09-29

## 1. 要解决什么

今天 JS 与 Dart 之间只有两条通道：同步的 `invokeHost(name, ...标量)` 和异步的
fetch 范式（`invokeHostAsync` + 事件 32 回 JSON）。v1 ABI 只过标量——对象和数组
降级成字符串（`value.cpp:48`），Dart 侧返回的一切非标量也只能 `toString()`。

结果是想给 JS 暴露任何"有身份的 Dart 能力"（controller、service、状态机、
平台对象）都只能：要么拍平成 JSON 字符串桥（正是 Lucent 方案文档批评的形态：
参数序列化、引用没法维护、回调管理混乱），要么每个能力手写一套专用 host
模块。`value.cpp:48` 的注释自己写着 "structured object handles are on the
roadmap (docs/roadmap.md)"——这就是 roadmap 那一项。

目标（对齐 Lucent 文档的阶段 1–6）：JS 能持有 Dart 对象的引用、构造它、调它的
方法、读写属性、把 JS 函数作为回调传进去、Dart 的 Future 自动变成 Promise、
生命周期两端各自可回收。

## 2. 不做什么（Non-goals）

- **不直调 Flutter Widget**：UI 层继续走 element API + 镜像树，`flutter:widgets`
  那条线（Lucent 阶段 7–9）不做。本 ABI 只服务非 Widget 的 Dart 对象。
- **不做 Dart API 自动生成**（阶段 10）：Analyzer → metadata → binding 的
  codegen 是后续 spec；本 spec 只定手写 adapter 的 SPI。
- **不做 `dart:xxx` 虚拟 ES 模块**：JS 侧入口是 `@ufjs/runtime` 的薄封装
  `dartModule()`，不动 `@ufjs/cli` 的模块解析。
- **Worker 不注册对象模块**：worker 是独立 runtime + 独立 host 桥，对象模块
  只在主 VM 可用，缺失时按宪法 V 报错不静默。
- **不改 invokeHost 的既有行为**：v1/v2 语义冻结，既有 host 模块零感知。

## 3. 用户可见的行为

Dart 侧注册一个对象模块（以演示模块为例）：

```dart
// flutter/lib/... — 宿主启动时
engine.objects.registerModule('exerciser', _ExerciserModule());
```

JS 侧（业务代码，两端同源）：

```ts
import { dartModule } from '@ufjs/runtime';

const m = dartModule('exerciser');

// 构造 → 拿到 Dart 对象的代理
const c = m.Counter(10);
// 方法调用（同步，零序列化）
c.add(5);
// 属性读写
c.step = 2;
// Future 自动变 Promise
await m.waitFor(30);          // Dart 返回 Future，JS 侧拿到 Promise
// 回调：JS 函数传进 Dart，Dart 之后触发
c.onTick((n: number) => console.log('tick', n));
// 显式释放；不释放时 JS GC 终究回收（finalizer → 句柄释放）
c.release?.();

// web 端同一份业务代码跑 TS 替身实现（模块包注册）：
// registerDartModuleStub('exerciser', createExerciserStub());
```

能力矩阵（验收按这条对）：构造 / 方法（参数含对象引用与回调）/ 属性读写 /
Future→Promise / 回调双向（JS fn→Dart，Dart closure→JS）/ 释放与 GC。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `dartModule(name)` 返回 Dart 对象模块的代理，六能力如 §3 | 同名 TS 替身实现：`registerDartModuleStub(name, impl)` 注册后行为一致 |
| 事件载荷 | 无新事件号——异步结果走新 C 入口 `fjs_vm_settle_promise`，不经 dispatchEvent | 不适用（无引擎） |
| 已知差异 | 无 host 或 abiVersion<3：`dartModule` warnOnce 后 throw | web 上 `dartModule` 未注册替身：warnOnce 后 throw（宪法 V） |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [x] natives 表（`native-global.d.ts` + `natives.cpp`）：新增 `__fjs.fns.objectCall`
- [ ] 事件类型（`element.ts` + `fjs.h`）：事件号一个不加
- [x] FJSValue C ABI（`fjs.h` ↔ `ffi.dart`）：ABI v2→v3，新 tag
      `FJS_T_HANDLE` / `FJS_T_CALLBACK` / `FJS_T_PENDING`，结构体加 int64
      字段（32→40 字节）；新增 C 入口 `fjs_vm_call_callback` /
      `fjs_vm_settle_promise` / `fjs_vm_release_callback`

新开 C ABI 的正当性（宪法 II 要求写明）：这不是"为一个功能"——它是 roadmap
既有条目（structured object handles）、一切后续 Dart 能力模块（controller /
service / 平台对象）共用的地基，fetch 范式被否（§plan 被否备选）。先例：
specs/150 的 libfjs-style。

## 6. 验收标准

1. `pnpm run typecheck` 与 `pnpm test` 全绿（runtime 侧 vitest 覆盖
   `dart-bridge.ts` 与 web 替身注册）。
2. `./build-native/fjs-test` 全绿，且**既有用例一条不减**（invokeHost 冻结的
   回归线）；新增用例覆盖：proxy 构造与方法、finalizer→pending_releases
   flush、回调表 dup/release、settle promise、重入上限、stale handle 抛错、
   40 字节布局。
3. `cd packages/flutter_fjs && flutter test` 全绿；新增 Dart 侧用例覆盖
   ObjectBridge 路由、Future→PENDING→settle（含错误路径）、handle 归属模块
   路由、stale handle。
4. demo 的演示页在 `fjs dev`（Flutter 端）与 `fjs dev --web` 上同一份页面
   代码六能力表现一致。
5. `fjs_abi_version()` 返回 3；旧 abiVersion 的宿主行为不回归。

## 7. 待澄清

- [x] 传输层方案（用户已拍板：FJSValue 扩标签，ABI v3）
- [x] 首个里程碑范围（用户已拍板：ABI + 合成演示模块 + 三层测试）
- [x] Web 对齐策略（用户已拍板：模块带 web 替身，缺失 warnOnce+throw）
- [x] JS API 形态（用户已拍板：`@ufjs/runtime` 薄封装，不动 CLI）


## 8. 结果（2026-09-29）

- **native**：`object_abi.cpp`（三个 JSClass、隐藏全局根、富值转换、
  dispatch_op 漏斗）+ `fjs.h` ABI v3（40 字节 FJSValue、4 个新 tag、3 个
  Dart→JS 入口）+ natives.cpp `objectCall`（op 白名单）+ 错误消息进 JS
  异常（invokeHost 与 objectCall 双路径）。两个引擎 flavor 的
  `fjs-test` 全量 ALL PASS（既有用例全数保留 + 新增 15 条对象 ABI 用例：
  构造/方法/字段读写/保留成员/句柄传参/回调双方向/身份保持/promise
  settle+reject/双 settle 报错/重入上限/同步 throw/GC 释放/stale 抛错/op
  白名单/FJSValue 40 字节断言）。
- **Dart**：`ObjectBridge` + `FjsObjectModule` SPI + `FjsCallback`/
  `FjsMethod` + host.dart 富值编解码 + engine 挂 `engine.objects`；内置
  demo 模块 `exerciser`（fibonacci 先例）。`flutter test` 562 全过
  （新增 object_bridge_test 10 条端到端）。
- **TS**：`native-global.d.ts` objectCall 类型 + `dart-bridge.ts`
  （dartModule / registerDartModuleStub / hasDartObjectSupport）+ vitest
  6 条。`pnpm run typecheck` 8 包全过、`pnpm test` 全过、demo web 构建过。
- **文档**：jsi-and-native-modules（对象 ABI 章）、modules（SPI 章）、
  threading-model（两条异步边）、roadmap（勾掉 structured handles）。
- **设计落地时的两处偏差**（都记进了对应文档）：富值转换里比计划多一个
  tag——`FJS_T_METHOD`（get 的"该成员是方法"回答，让字段与方法在
  adapter 侧可区分）；JS 代理包装按次交叉不缓存（缓存会让 GC 永不回收），
  保持的是 Dart 对象身份而非 JS 包装身份。
- **未竟**：T042 两端人工对拍（构建/单测已全绿，真机走查留给下次会话）。

## 10. 追加（2026-09-29）

- 演示用 exerciser 模块已按用户决定移除（engine 不再内置任何对象模块）；
  测试与 demo 全部改用 mmkv 形状的模块（测试：`object_bridge_test.dart`
  内的手写适配器；demo：`demo/src/main.dart` 经 fjsAttachHost 注册 + web
  stub）。手写适配器的 SPI 本身就是本 spec 的正式交付面，不受影响。
- 实施中敲定的两条 v3 语义（写入 docs/jsi-and-native-modules.md）：
  富路径 Dart null → JS `null`（invokeHost 保持 null→undefined 冻结）；
  List/Map 回答以 `FJS_T_JSON` 过界、引擎 JSON.parse 物化成真值。
