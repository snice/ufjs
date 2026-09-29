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

- [x] T040 演示模块 exerciser：Dart 实现（六能力：Counter 构造/add 方法/
      step 属性/waitFor Future/onTick 回调/release）注册进 engine
- [x] T041 演示模块 web 替身 TS 实现，demo 页用 `registerDartModuleStub`
      注册；demo 演示页挂载（同一份页面代码）
- [ ] T042 两端对拍（待真机/浏览器走查：`fjs dev` 连 fjs-go 与 `fjs dev --web` 各跑 `/basic/dart-objects`；构建与单测已过，人工对拍留给下次会话）：`fjs dev`（fjs-go）与 `fjs dev --web` 各跑演示页，
      六能力表现一致

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
