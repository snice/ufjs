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

---

# 追加 plan（2026-10-03）：对应 spec §11，demo 六能力覆盖补齐

纯 demo + 文档改动：运行时、ABI、ObjectBridge、dart-bridge.ts 一行不动。

## 6. 宪法自查（§11 范围）

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 页面一份 `dart-playground.vue`。Flutter 端模块在 `demo/src/main.dart`（手写 `FjsObjectModule`），web 端 `registerDartModuleStub('playground', …)` 在 `demo/src/main.ts`。mmkv 页的 web 差异不变（无替身），只把 throw 变成说明文案。 |
| II 边界即契约 | 否 | 三张表、FJSValue ABI、事件号都不动。 |
| III 同步单线程零序列化 | 是（沿用） | 全走 159 既有通道；页面 Timer 触发的回调在 Dart 事件循环上回 JS，与 fetch 同性质。 |
| IV 外观照 WeUI | 否 | demo 页用现有 `<button>`/`<view>`，样式沿用 dart-objects 页，不新造默认外观。 |
| V 静默失效是 bug | 是 | reject 与 stale 错误必须落进日志；mmkv 页的 web 分支是**可见说明**而非吞掉。stub 缺失仍 warnOnce+throw（不改）。 |
| VI 注释记录权衡 | 是 | 页面/模块头注释写清：为何 release 是模块自己的方法（见 §8 风险 1）、为何 fire 同步为主、为何日志不带时间戳。 |
| VII JS 能包就不要下 Dart | 是（反向合规） | 对象模块的本体就是 Dart 对象，JS 无法伪造；且 Dart 代码只在 demo 里，不进 flutter_fjs 包。 |
| VIII 变更落到文档 | 是 | `docs/modules.md`（dart-objects 段落补 playground 页、修正「同名注册优先」的描述）、`docs/web.md` 差异表加一行（mmkv 页 web 说明）；`specs/159`、`specs/160` 的 tasks/spec 去 exerciser 残留。`docs/roadmap.md` 不涉及。 |

## 7. 涉及的层（§11）

| 层 | 文件 | 改什么 |
|----|------|--------|
| demo 页面 | `demo/src/pages/basic/dart-playground.vue`（新） | 六能力按钮 + 「一键跑全部」；日志不带时间戳；失败路径按钮 |
| demo 页面 | `demo/src/pages/basic/dart-objects.vue`（已存在） | 顶层 `dartModule('mmkv')` 改成 `hasDartObjectSupport()` 守卫后再构造；web 分支模板显示说明；`<route>` desc 改成「Flutter 真 mmkv；web 无实现，显示说明」 |
| demo Dart 宿主 | `demo/src/main.dart`（已存在，**单文件**） | 内联 `_PlaygroundModule`；`fjsAttachHost` 里 `engine.objects.registerModule('playground', …)`。确认过：`packages/fjs/src/commands/run.ts:886` 的 `writeHostAttach` 只拷贝 `src/main.dart` 这一个文件，所以不能拆文件 |
| demo web 替身 | `demo/src/main.ts`（已存在） | 在 `createFjsApp` 之前 `registerDartModuleStub('playground', createPlaygroundStub())`；stub 实现放 `demo/src/playground-stub.ts`（新），避免 main.ts 膨胀 |
| demo 类型 | `demo/src/fjs-playground.d.ts`（新，手写） | `declare module '@ufjs/runtime' { interface FjsObjectModules { playground: PlaygroundModule } }` + 接口；**不碰** 生成物 `demo/src/fjs-objects.d.ts` |
| demo 页面清单 | `demo/src/pages/basic/` | 新页靠文件路由自动进入列表（`<route>` 的 group 为「基础能力」），无需改 catalog；已确认 `demo/src/catalog.ts` 无平台过滤字段 |
| 文档 | `docs/modules.md`、`docs/web.md` | 见宪法 VIII |
| spec 文档 | `specs/159-dart-object-abi/spec.md` §3 与 `tasks.md`；`specs/160-object-codegen/tasks.md` | 去 exerciser 残留：§3 示例改指向 playground；T040/T041/T042 改写成现状；160 T020 同 |

## 8. 方案

**playground 模块的成员（Dart 与 TS 替身逐一对应）**

| 能力 | JS 写法 | Dart 实现 | 页面日志 |
|---|---|---|---|
| 构造 | `pg.Counter(10)` | `construct('Counter', [10])` → `_Counter(value)` | `Counter(10)` |
| 方法 | `c.add(5)` | `invoke` | `add(5) → 15` |
| 属性读写 | `c.step = 2; c.step` | `get`/`set` 返回/写 `step`（`value`、`step` 为字段，其余 `FjsMethod`） | `step=2` |
| Future→Promise | `await pg.waitFor(30)` | 返回 `Future.delayed` | `waitFor → 30` |
| Future reject | `pg.failAfter(30)` | `Future.error(StateError('boom'))` | `failAfter → rejected: …boom` |
| 回调 JS→Dart | `c.onTick(fn)`、`c.fire()` | 存 `FjsCallback`；`fire` 同步调用它；`startTimer(n)` 另用 `Timer` 触发 n 次 | `tick 15` |
| 回调 Dart→JS | `pg.makeAdder(3)(4)` | 返回 Dart 闭包（`Function`） | `makeAdder(3)(4) → 7` |
| 句柄传参 / 返回 | `c.clone()`、`c.merge(d)` | 返回新 `_Counter`（自动注册句柄）；参数里的句柄解析回原对象 | `merge → 26` |
| 释放 | `c.release()` | **模块自己的方法**：`liveCount--` 并标记已释放，之后调用抛错；`pg.liveCount()` 可见 | `liveCount 3 → 2`，`released → add: …` |
| stale | release 后 `c.add(1)` | 模块抛 `StateError` | 错误落日志 |

「一键跑全部」按顺序执行上表全部步骤，把每行日志拼成一份纯文本，页面底部整块显示（两端各点一次，文本 diff 即对拍）。Timer 版按钮单独放，**不进**一键汇总（时序噪声）。

**web 替身**：同一接口的 TS 对象；Future 用 `Promise` + `setTimeout`，回调直接调，`liveCount` 自己计数。

**mmkv 页守卫**：`const supported = hasDartObjectSupport()`；`const kv = supported ? dartModule('mmkv').MMKV('demo') : null`；模板用 `v-if`。同时 `hasDartObjectSupport` 已从 `@ufjs/runtime` 导出，无需新 API。

**被否掉的备选**
1. *把 playground 模块放回 flutter_fjs 或 engine 内置*：§10 用户已否决 engine 内置；放进包里会让所有消费者背 demo 代码。
2. *给 mmkv 页补 web 替身*：用户已否；真包没有浏览器实现，假替身会掩盖差异。
3. *从 web 页面列表隐藏 mmkv 页*：要给路由元数据加平台字段，影响所有页面，改动面大于收益（spec §11.7 用户已选「显示说明」）。
4. *在 `dartModule` 里加公开的 `release(proxy)`*：能让「显式释放」走框架 dispose，但会动 `dart-bridge.ts` 与 natives 表，违背「契约零变更」；留作后续（见风险 1）。
5. *为 playground 再起一个 Dart 文件*：`writeHostAttach` 只拷 `main.dart`，做不到。
6. *把 mmkv 页的对象能力也塞进 playground 页*：mmkv 页的价值是证明 autoimport 链路对真包可用，两件事分开。

## 9. 风险

1. **「显式 release」没有 JS 公开 API**（本次 plan 阶段读源码发现）：spec 159 §3 的 `c.release?.()` 只是注释里的愿望；现实是 `dartModule` 与 native 代理都没有 release 入口，`release` op 只由 GC finalizer 内部发出，而 `release` 不在保留成员表（`object_abi.cpp:75`）里，所以 `c.release()` 会被当普通方法派给 Dart adapter。因此本次的「释放」演示的是**模块自己的 `release` 方法**，**不是**框架的 dispose 路径；框架 dispose 仍只由 GC 触发、由 `fjs-test` 与 `object_bridge_test` 覆盖。要把它做成一等公民是另一个 spec（涉及 natives 表，宪法 II）。已把这一点写进 spec §11.3 的修正与页面头注释，避免读者误会。
2. **日志对拍噪声**：数字格式（`15` vs `15.0`）两端不同。Dart `int`/`double` 在 JS 是 number；统一在 Dart 侧只返回 int，TS 替身也用整数，页面用 `String(n)`。
3. **Timer 版按钮的异常处理**：触发中页面已卸载时回调是否安全；用 `startTimer` 的次数上限（≤3）与 `dispose` 里取消 Timer 兜底。
4. **`main.dart` 变长**：内联模块约 80 行，仍在可读范围；头注释说明单文件限制。
5. **autoimport 生成物被覆盖**：playground 的 d.ts 单独成文件，`fjs autoimport` 重新生成不会冲掉。
6. **web 构建对 `main.dart` 零感知**，对 `playground-stub.ts` 则会进入包体；体量很小，可接受。

## 10. 验证路径

```bash
pnpm --filter demo run typecheck
pnpm run typecheck && pnpm test
pnpm --filter demo run build:release
# web：打开 dart-playground，点「一键跑全部」，复制汇总文本；打开 dart-objects，确认只显示说明
fjs dev --web           # 在 demo/ 下
# Flutter：同一页同一按钮，复制汇总文本，与 web diff
fjs dev                 # + fjs-go 或 fjs run <platform>
diff web.txt flutter.txt   # 期望空（T042）
```

## 11. 实施中的偏差（2026-10-03）

设计 playground 时发现 plan 未预料的真 bug：`ObjectBridge.handle('construct')`
对 `Future` 返回值**没有走 pending 路径**（只有 `invoke` 走），于是模块级
异步函数（160 里静态方法/顶层函数走 construct op，如 `MMKV.initialize`，d.ts
写的是 `Promise<string>`）在 JS 侧得到的是「Future 的句柄」而非 Promise。
`object_bridge_test` 新增用例先红（`q.then is not a function`）后绿。

处理：在 `object_bridge.dart` 把 Future→PENDING 抽成 `_pendingFor`，construct
与 invoke 共用（ABI/natives 不动，宪法 II 不涉及）。这是对「契约零变更」的
唯一例外——改的是 bridge 内部行为，不是契约表；T100 护栏相应收窄为
「native 与 ffi.dart、dart-bridge.ts、native-global.d.ts 零变更」。
同时 playground 的 `waitFor`/`failAfter` 因此可以如实做成模块级函数。

第二处（T042 在 Flutter 端真跑出来的）：`invoke`/`get` 返回的新对象（工厂方法、
返回子对象的 getter，如 `Counter.clone()`、160 里 `NameSpace.mmkv(...)`）以
「foreign」身份注册——没有归属模块，JS 之后对它任何成员访问都抛
`object has no owning module`。此前只有 construct 路径会登记归属，所以 fake
platform 测试与 mmkv 页（全走 construct）都没踩到。修：`ObjectBridge._adopt`
让 invoke/get 返回的未登记对象归属于「交出它的那个模块」。`object_bridge_test`
加用例先红后绿；`flutter test` 全量 773 过。这再次说明 T042 的两端对拍
有独立价值。
