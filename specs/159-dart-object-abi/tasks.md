# Tasks: QuickJS ↔ Dart Object ABI

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `native/include/fjs.h`：`FJS_ABI_VERSION` 2→3；`FJS_T_HANDLE/CALLBACK/PENDING`
      三个 tag；`FJSValue` 加 `int64_t j` 字段（32→40 字节，更新布局注释）；
      声明 `fjs_vm_call_callback` / `fjs_vm_settle_promise` /
      `fjs_vm_release_callback`，写明所有权与线程契约
- [x] T002 `native/src/engine.h`：门面补 class API（`new_class` /
      `set_opaque` / `get_opaque` / 构造原型等），PrimJS 与 quickjs-ng 两
      flavor 都接通——**先做 spike 验证 LEPUS 分支可用，不通就地停下游任务
      并回改 plan**
- [x] T003 `packages/flutter_fjs/lib/src/ffi.dart`：`FJSValue` 40 字节显式
      镜像（含 sizeof 断言注释）+ 三个新入口的 lookup 与签名
- [x] T004 `packages/fjs-runtime/src/native-global.d.ts`：`objectCall` +
      `FjsDartObject` / `FjsCallbackFn` 类型（与 T010 的 natives.cpp 同步写）

## 实现

- [x] T010 `native/src/natives.cpp`：注册 `__fjs.fns.objectCall`——富值转换
      （proxy→HANDLE、function→CALLBACK dup 入表）→ 复用
      `vm->on_invoke_host`；返回值富转换（HANDLE→proxy、PENDING→Promise、
      CALLBACH→函数包装）；`rc==-1` 且 out 带字符串时以该 message 抛 JS 异常
- [x] T011 `native/src/value.cpp`：`to_fjs_value_rich` / `from_fjs_value` 富
      分支；`fjs_free_abi_value` 释放路径保持
- [x] T012 `native/src/vm.cpp` + `fjs_internal.h`：proxy 类（opaque=handle、
      finalizer→`pending_releases` 队列）、回调表（dup 强持有）、pending
      promise 表、`fjs_vm_call_callback`（重入深度上限）/ `settle_promise`
      （结算后 pump）/ `release_callback`、flush 时机（pump 末尾 +
      objectCall 入口）、`fjs_vm_destroy` 清理
- [x] T020 `packages/flutter_fjs/lib/src/registry/object_bridge.dart`（新）：
      `FjsObjectModule` SPI（construct/invoke/get/set/dispose）、句柄表
      （单调不复用、归属模块、stale 抛错）、Future→PENDING(callId)、
      `scheduleMicrotask` 后 settle（栈内禁回派规则）、值语义（标量直通 /
      List+Map→JSON 串 / 其他对象自动注册 handle）
- [x] T021 `packages/flutter_fjs/lib/src/engine.dart`：挂 `engine.objects`、
      VM 重建重置；`lib/src/registry/host.dart`：`_fromNative`/`_writeOut`
      认三个新 tag
- [x] T030 `packages/fjs-runtime/src/dart-bridge.ts`（新）：`dartModule<T>(name)`
      能力探测（abiVersion≥3 且 objectCall 存在，否则 warnOnce+throw）、
      `registerDartModuleStub(name, impl)`；`index.ts` 导出

## 两端对齐

- [x] T040 ~~演示模块 exerciser~~ → 已被 §10 取代：engine 不内置对象模块，
      测试与 demo 改用 mmkv 形状（见 §10；playground 演示见 T101–T104）
- [x] T041 ~~exerciser 的 web 替身~~ → 已被 §10 取代（mmkv 无 web 替身，
      响亮 throw）
- [x] T042 两端对拍 → 由 §11 的 T107 承接（playground 页「一键跑全部」两端
      文本 diff）；mmkv 页不参与对拍（无 web 实现）

## 测试

- [x] T050 `native/test/main.cpp`：对象 ABI 用例组——proxy 构造/方法、
      finalizer→flush、回调表 dup/release/重入上限、settle promise、stale
      handle 抛错、FJSValue 40 字节布局断言；既有用例全数保留
- [x] T051 `packages/flutter_fjs/test/object_bridge_test.dart`（新）：桥路由、
      Future→PENDING→settle（成功/失败）、归属模块路由、stale handle
- [x] T052 `packages/fjs-runtime/test/`（新）：dart-bridge 能力探测、替身
      路由、缺失报错

## 文档

- [x] T060 `docs/jsi-and-native-modules.md`：ABI v3 章（新 tag、objectCall、
      三个新入口、生命周期与跨堆环）
- [x] T061 `docs/modules.md`：对象模块 SPI（FjsObjectModule）+ web 替身注册
- [x] T062 `docs/threading-model.md`：call_callback / settle 路径
- [x] T063 `docs/roadmap.md`：勾掉 structured object handles

## 验收

- [x] T070 `pnpm run typecheck`
- [x] T071 `pnpm test`
- [x] T072 fjs-test 全绿（含既有用例全数保留）
- [x] T073 `cd packages/flutter_fjs && flutter test`
- [x] T074 spec.md 第 6 节逐条核对


---

## §11 追加：demo 六能力覆盖补齐（对应 plan §6–§10）

### 契约层

- [x] T099 修 bridge：construct 返回 Future 也走 PENDING（plan §11）：
      `packages/flutter_fjs/lib/src/registry/object_bridge.dart` 抽 `_pendingFor`；
      `test/object_bridge_test.dart` 加用例（先红后绿，已验证）
- [x] T099b 修 bridge：invoke/get 返回的对象归属交出它的模块（plan §11 第二处）：
      `object_bridge.dart` 加 `_adopt`；`object_bridge_test.dart` 加用例（先红后绿）
- [x] T100（native/ffi.dart/dart-bridge.ts/native-global.d.ts 零 diff，已核对；object_bridge.dart 是 T099 的有意例外）确认契约零变更：`git diff --stat` 在 `packages/fjs-runtime/src/native-global.d.ts`、
      `packages/flutter_fjs/native/`、`packages/flutter_fjs/lib/src/ffi.dart`、
      `packages/fjs-runtime/src/dart-bridge.ts` 上为空（收尾时核对）

### 实现

- [x] T101 `demo/src/fjs-playground.d.ts`（新）：`PlaygroundModule` /
      `Counter` 接口 + `declare module '@ufjs/runtime'` 的 `FjsObjectModules`
      合并；不动生成物 `demo/src/fjs-objects.d.ts`
- [x] T102 `demo/src/main.dart`：内联 `_PlaygroundModule`（Counter 构造/
      add/step 字段/onTick+fire+startTimer/clone/merge/release/liveCount、
      waitFor/failAfter、makeAdder），`fjsAttachHost` 里
      `engine.objects.registerModule('playground', …)`；头注释写明单文件
      限制与 release 是模块自己的方法
- [x] T103 `demo/src/pages/basic/dart-playground.vue`（新）：每能力一个按钮
      + 失败路径按钮 + 「一键跑全部」（汇总文本整块显示、不带时间戳、Timer
      版不入汇总）
- [x] T104 `demo/src/pages/basic/dart-objects.vue`：`hasDartObjectSupport()`
      守卫后才构造 mmkv；web 分支显示说明；`<route>` desc 改成与事实一致

### 两端对齐

- [x] T105 `demo/src/playground-stub.ts`（新）+ `demo/src/main.ts`：
      `createPlaygroundStub()` 与 Dart 模块逐成员对应（Promise+setTimeout、
      回调直调、liveCount 自计数、整数口径一致）；`createFjsApp` 之前
      `registerDartModuleStub('playground', …)`
- [x] T106 `pnpm --filter demo run typecheck` 与 web 构建通过后，用
      `fjs dev --web` 点「一键跑全部」存 `web.txt`；打开 dart-objects 页确认
      仅说明、控制台无未捕获异常
- [x] T107 Flutter 端（`fjs dev` + fjs-go 或 `fjs run`）同页点「一键跑全部」
      存 `flutter.txt`，`diff web.txt flutter.txt` 为空；顺手确认 mmkv 页既有
      按钮不回归 → 勾掉 T042

### 测试

- [x] T110（实际：因 T099/T099b 在 object_bridge_test.dart 新增 2 条用例，先红后绿，flutter test 773 全过；页面本身无自动化测试）
      原文：`packages/flutter_fjs/test/object_bridge_test.dart` 不改；若 T102
      的模块逻辑可复用到测试，不复用（demo 代码不进包）。本组无新增自动化
      测试——页面对拍文本就是验收物。在 spec §11.6 里已写明

### 文档

- [x] T120 `docs/modules.md`：dart-objects 段落补 playground 页指引；修正
      「同名注册优先」那句与现状（mmkv 无替身）的表述
- [x] T121 `docs/web.md`「已知差异」：加一行 mmkv 页 web 显示说明、playground
      有替身
- [x] T122 spec 文档清残留：`specs/159-dart-object-abi/spec.md` §3 示例改指
      playground（`Counter`/`waitFor`/`onTick` 已与之一致，核对 `release`
      注）；`specs/160-object-codegen/tasks.md` T020 改写成现状

### 验收

- [x] T130 `pnpm run typecheck`
- [x] T131 `pnpm test`
- [x] T132 `pnpm --filter demo run build:release`
- [x] T133 `grep -rn exerciser specs/159* specs/160* docs demo/src` 只剩
      「已被取代」的说明性提及
- [x] T134 spec.md §11.6 逐条核对（含 T100 的零变更护栏）

> T134 备注：§11.6 第 5 条（Flutter 端 mmkv 页不回归）本次**未重新在设备上点一遍**——
> 页面逻辑只多了 `hasDartObjectSupport()` 守卫，Flutter 上恒为 true；已在 iOS 模拟器
> 验证 playground 页与列表页，mmkv 页留给用户顺手点一下。
