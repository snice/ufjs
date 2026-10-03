# Spec: QuickJS ↔ Dart Object ABI（对象句柄、双向调用、Promise/回调、生命周期）

- **ID**: 159-dart-object-abi
- **状态**: done（T042 经 §11 的 playground 页完成两端对拍）
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

Dart 侧注册一个对象模块（以 demo 的 `playground` 为例，见 §11）：

```dart
// flutter/lib/... — 宿主启动时
engine.objects.registerModule('playground', _PlaygroundModule());
```

JS 侧（业务代码，两端同源）：

```ts
import { dartModule } from '@ufjs/runtime';

const m = dartModule('playground');

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
// 释放：不释放时 JS GC 终究回收（finalizer → 句柄释放）；框架没有 JS 侧
// 公开 release API，演示里的 release 是模块自己的方法（见 §11.3 注）
c.release();

// web 端同一份业务代码跑 TS 替身实现（模块包注册）：
// registerDartModuleStub('playground', createPlaygroundStub());
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

## 11. 追加（2026-10-03）：demo 六能力覆盖补齐（承接 T042）

> 沿用 159 不新开 spec：T042「六能力两端对拍」未完成，且这次要补的正是
> 它缺的演示面。

### 11.1 要解决什么

§10 把 demo 换成 mmkv 之后，唯一的对象 ABI 演示页
（`demo/src/pages/basic/dart-objects.vue`）只碰到六能力里的构造、方法、
属性读写。以下能力现在**没有任何真实宿主上的演示或对拍**（只在 `fjs-test`
与 `object_bridge_test.dart` 的 fake 上跑过）：

- Future→Promise（含 reject）
- 回调双向（JS fn→Dart、Dart closure→JS）
- 句柄作参数 / 返回新对象引用
- 显式释放后 Dart 侧确实 dispose

另有三处现状与文档不符或会在 web 上出问题：

1. mmkv 页 setup 顶层同步 `dartModule('mmkv').MMKV('demo')`；web 构建没有
   替身，进入该页直接 throw。demo 的 web 站点（`build:pages`）会列出全部
   页面，所以这是一个可点进去的崩溃页。
2. 该页 `<route>` 的 desc 仍写「Web 走替身」，与页内注释（deliberately NO
   web stand-in）矛盾。
3. 159 `spec.md` §3 示例仍用已移除的 `exerciser`；159 `tasks.md` T040/T041/
   T042 与 160 `tasks.md` T020 仍描述 exerciser 与 `/basic/dart-objects` 的
   旧形态，接手的人会被误导。

### 11.2 不做什么

- 不把演示模块放回 engine 内置（§10 用户决定：engine 不内置任何对象模块）。
  模块是 demo 自己的宿主代码。
- 不改 ABI、ObjectBridge、dart-bridge.ts 的任何行为（契约零变更）。
- 不给 mmkv 页补 web 替身（用户已拍板：真实 mmkv 无浏览器实现，保持响亮
  throw）；本次只让它在 web 上**不崩**。
- 不在页面里调 `gc()`（项目约定：gc 仅限调试）。GC→finalizer→释放这一条
  继续由 `fjs-test` 的对象 ABI 用例承担，页面只演示**显式释放**。
- 不补 Uint8List / Stream / 泛型（159/160 review 里记下的缺口，另议）。

### 11.3 用户可见的行为

新增一页 `demo/src/pages/basic/dart-playground.vue`（名字待定，见 §11.7），
驱动 demo 手写的对象模块 `playground`。页面代码两端同源：

```ts
import { dartModule } from '@ufjs/runtime';

const pg = dartModule<PlaygroundModule>('playground');

const c = pg.Counter(10);          // 构造
c.add(5);                          // 方法
c.step = 2;                        // 属性写，c.step 读
await pg.waitFor(300);             // Future → Promise
await pg.failAfter(100).catch(e => …); // Future reject → Promise reject
c.onTick((n) => …);                // JS fn → Dart，Dart 之后触发
const add3 = pg.makeAdder(3);      // Dart closure → JS 函数
add3(4);                           // 7
const d = c.clone();               // 返回新 Dart 对象 → 新代理
c.merge(d);                        // 句柄作参数
c.release();                       // 模块自己的 release 方法（见下注）
pg.liveCount();                    // 未释放实例数（release 后 -1）
```

> 注（plan 阶段读源码发现）：`dartModule` 与 native 代理**没有**框架级公开
> release API——`release` op 只由 GC finalizer 发出，`c.release()` 会被当成
> 普通方法派给 adapter。所以这里演示的是模块自己实现的 `release`；框架 dispose
> 路径继续由 `fjs-test`/`object_bridge_test` 覆盖。把它做成一等公民另开 spec。

页面每个能力一个按钮 + 一行结果日志，失败路径（reject、release 后再调用
的 stale 报错）也各有一个按钮。

mmkv 页：`hasDartObjectSupport()` 为 false（web，或旧 ABI 宿主）时页面显
示一条说明（「仅 Flutter：real mmkv 没有浏览器实现」），不再调用
`dartModule`。route desc 改成与事实一致的描述。

### 11.4 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| playground | demo `main.dart` 里手写 `FjsObjectModule`，`fjsAttachHost` 内 `engine.objects.registerModule('playground', …)` | demo `main.ts` 里 `registerDartModuleStub('playground', …)`，TS 实现同一组成员（Promise 用 setTimeout，回调直接调用，liveCount 自己计数） |
| mmkv 页 | 真包 | 说明文案，不调用 dartModule |
| 已知差异 | — | 定时触发的时序与 Dart Timer 可有毫秒级差异；页面日志不显示时间戳以免对拍噪声 |

### 11.5 契约变更（宪法 II）

- [x] 都不涉及（natives 表 / FJSValue ABI / 事件号一概不动）
- 工具链注意点：`main.dart` 会被原样拷成 `lib/fjs_attach.dart`，plan 阶段要
  确认是否只能是**单文件**；若是，playground 模块必须内联在 `main.dart`。
- `src/fjs-objects.d.ts` 是 `fjs autoimport` 生成物（会被覆盖），playground
  的类型声明要放在**另一个**手写 d.ts（`fjs-objects.d.ts` 的声明合并同款），
  不能写进生成文件。

### 11.6 验收标准

1. `pnpm --filter demo run typecheck` 通过（`dartModule('playground')` 无显式
   泛型即得类型；mmkv 页新增分支类型检查通过）。
2. `pnpm test` 与 `pnpm run typecheck` 全绿（runtime/dart-bridge 行为未改，
   应零变化）。
3. `pnpm --filter demo run build:release`（或 web 构建）通过，且 `fjs dev
   --web` 打开 playground 页：六能力按钮全部走通；打开 mmkv 页：显示说明、
   控制台无未捕获异常。
4. Flutter 端（`fjs dev` + `fjs run` 或 fjs-go）打开 playground 页，同一组
   按钮的日志文本与 web **逐行一致**（对拍脚本见 plan；时间戳不入日志）。
   这一条完成即勾掉 T042。
5. Flutter 端 mmkv 页行为不回归（既有按钮全可用）。
6. 文档一致性：159 spec §3 示例、159 tasks T040/T041/T042、160 tasks T020 与
   现状一致（无 exerciser 残留）；`docs/modules.md` 里提到 dart-objects 页
   的段落补上 playground 页的指引。
7. 失败路径可观察：`failAfter` 的 reject 与 `release` 后调用的 stale 错误
   在两端都落到日志里，而不是静默。

### 11.7 待澄清

- [x] 页面 `dart-playground`、模块 `playground`（用户 2026-10-03 确认）
- [x] mmkv 页在 web 上：显示说明，不隐藏（同上）
- [x] release 只演示显式 `release()`，GC 路径由 `fjs-test` 覆盖（同上）
- [x] 回调：按钮同步触发（`c.fire()`）为主，另加一个 `Timer` 定时版按钮（同上）
- [x] T042 对拍：页面加「一键跑全部并输出汇总文本」，两端各点一次比对（同上）
