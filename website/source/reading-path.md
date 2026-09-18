# 沿一次点击读源码

读框架源码最有效的方式是跟着一条真实的调用链走。这一篇以「点击按钮让计数 +1」为例，从 Vue 模板一路追到 Flutter 重建，每一步都给出文件和函数名。

```vue
<script setup lang="ts">
import { ref } from 'vue';
const n = ref(0);
</script>

<template>
  <view @tap="n++"><text>{{ n }}</text></view>
</template>
```

## 阶段一：首次渲染

### 1. Vue 创建节点

Vue 执行 render 函数，调用渲染器的 nodeOps。

- `packages/fjs-runtime/src/vue/renderer.ts` —— `nodeOps.createElement` → `create('view')`
- `patchProp(el, 'onTap', null, fn)`：把 `fn` 存进事件注册表，给元素设 prop `onTap: true`（`aliasEvent` 把 `onClick` 等 HTML 事件名映射成 fjs 事件）

### 2. element API 写 op

- `packages/fjs-runtime/src/ui/element.ts` —— `create` / `insert` / `setText` / `setProps` 往当前帧写 op，第一次写入时 `queueMicrotask(flush)`
- `packages/fjs-runtime/src/ui/ops.ts` —— `OpWriter`：把 op 编码进 `Uint8Array`

### 3. 样式

- `packages/fjs-runtime/src/css/style.ts` —— `StyleEngine`：用渲染器的影子树匹配选择器，算出 computed style（和 `:active` 样式），通过 `setStyle` 写 `DEFINE_STYLE` / `SET_STYLE` op

### 4. flush 跨界

- `element.ts` 的 `flush()` —— 调 `__fjs.fns.uiOps(frame)`
- `packages/flutter_fjs/native/src/natives.cpp` —— `js_ui_ops`：拿到 ArrayBuffer 指针，调用 Dart 安装的回调
- `packages/flutter_fjs/lib/src/engine.dart` —— `_onUiOpsTrampoline` → `engine.tree.applyFrame(frame)`

### 5. 镜像树与 Widget

- `packages/flutter_fjs/lib/src/ui_ops.dart` —— 解码 op
- `packages/flutter_fjs/lib/src/mirror_tree.dart` —— `applyFrame`：创建 / 插入 `MirrorNode`，收集脏节点；`flushDirty` 统一通知
- `packages/flutter_fjs/lib/src/render/renderer.dart` —— `_FjsNodeView`：监听单个节点，按 tag 分发构建
- `packages/flutter_fjs/lib/src/render/flex.dart` —— `view` 的 Flex 布局
- `packages/flutter_fjs/lib/src/render/gesture.dart` —— 节点的 props 里有 `onTap` 标记，就包一层 `GestureDetector`

## 阶段二：点击

### 6. 手势 → Dart → C++

- `render/gesture.dart` —— `onTap: () => dispatch(node.id, FjsEvent.tap)`
- `engine.dart` —— `dispatchEvent(nodeId, eventType, {text})`，通过 FFI 调用 C
- `packages/flutter_fjs/native/src/vm.cpp` —— `fjs_vm_dispatch_event`：`JS_Call(__fjsDispatchEvent, ...)`

### 7. JS 查表执行

- `element.ts` —— `globalThis.__fjsDispatchEvent`：按 `节点id:事件类型` 查注册表，调用 `n++`

### 8. Vue 更新

- `n++` 触发响应式 → Vue 调度更新（微任务）→ `nodeOps.setElementText` / `setText` → element API 写 `SET_TEXT` op → 又一个 `queueMicrotask(flush)`

### 9. 同帧提交

- `vm.cpp` —— `fjs_vm_dispatch_event` 在返回前**泵空微任务队列**，于是 Vue 的更新和 flush 都在这次调用内完成，`uiOps` 同步回调 Dart
- `mirror_tree.dart` —— 只有那个 text 节点被标脏
- `renderer.dart` —— 只有那个节点的 `_FjsNodeView` 重建

整条链路没有跨线程、没有 JSON 解析（`SET_TEXT` 是纯 utf8），在一次手势回调内完成。

## 用 fjsrun 离线观察

不启动 Flutter 也能看到上面的数据流。`fjsrun` 是一个命令行宿主：执行 bundle，打印 console 输出和**每一帧的 op 解码结果**，还能模拟点击。

```bash
cd packages/flutter_fjs/native
cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j

cd ../../../examples/hello-js
pnpm exec fjs build
../../packages/flutter_fjs/native/build-native/fjsrun dist/app/bundle.js
../../packages/flutter_fjs/native/build-native/fjsrun --tap 3 dist/app/bundle.js   # 模拟点击节点 #3
```

你会看到 `CREATE`、`INSERT`、`SET_PROPS`……一条条打印出来，点击后多出一帧 `SET_TEXT`。这是理解协议最直观的方式。

## 其它值得跟的链路

| 想弄清 | 从这里开始 |
|---|---|
| 路由 push 与分包加载 | `fjs-runtime/src/router/flutter.ts` → `invokeHost('fjs.nav.push')` → `flutter_fjs/lib/src/fjs_app.dart` |
| fetch | `fjs-runtime/src/net/fetch.ts` → `flutter_fjs/lib/src/http.dart` |
| invokeHostAsync | `fjs-runtime/src/host-async.ts` ↔ `engine.dart` 的 `_sendAsyncResult` |
| 热更新 | `fjs/src/dev/server.ts`（判断推什么） → `flutter_fjs/lib/src/dev_client.dart`（设备上怎么执行） |
| SFC 编译 | `fjs/src/bundler/vue-plugin.ts` |
| 路由表生成 | `fjs/src/project/pages.ts` |
| 模块 autolink | `fjs/src/project/modules.ts` → `fjs/src/commands/run.ts` 的 `writeHostPubspec` / `writeHostAutolink` |
| 小程序编译 | `fjs/src/mp/build.ts` → `wxml.ts` / `script.ts` / `css.ts` |
| Web 端的内置标签 | `fjs-runtime/src/web/components/` |
