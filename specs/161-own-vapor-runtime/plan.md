# Plan: 自研 Vapor 运行时

对应 spec：`./spec.md`。澄清结论：Q1 TS 实现、native 不动；Q2 运行时回 `vue@^3.5`、CLI 构建期用
`@vue/compiler-sfc@3.6.0-rc.9` 只编 Vapor SFC；Q3 VDOM 页嵌 Vapor 组件走编译期包装 + 渲染器元素收养；
Q4 门槛为真机 JS 不劣于现 Vapor 路径（≤ 122.7 ms）。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（收紧） | 自研运行时是同一份代码：Flutter 落 element API → op 帧，web 落 element API → DOM 适配层。现路径的 web 特例（`vapor/web.ts`，官方 runtime-vapor on DOM）删除 |
| II 边界即契约 | 否 | op 协议 / natives / 事件表不动；不新开 C ABI |
| III 同步单线程零序列化 | 是（维持） | helpers 同步调 element API；effect 队列在微任务 flush（与 runtime-vapor 语义一致） |
| IV 外观照 WeUI | 否 | 不涉及样式值 |
| V 静默失效是 bug | 是 | 未实现的 helper（元素 v-model、Transition…）显式 throw；对拍 verify 0 不一致；帧字节与现路径相同 |
| VI 注释记录权衡 | 是 | 每个 helper 注释写清对应哪个 element API；«为什么不用 runtime-vapor» 记在运行时文件头 |
| VII JS 能包就不要下 Dart | 是（本 spec 的立论） | 响应式/闭包跨不过 FFI，native 化无实测收益（spec §2） |
| VIII 变更落到文档 | 是 | vue3.md / toolchain.md / performance.md |

不新增运行时依赖；移除 `@vue/runtime-vapor`（runtime）与 `@vue/runtime-dom`（dev）；`vue` 3.6.0-rc.9 → ^3.5.42；
CLI 加构建期 devDependency `@vue/compiler-sfc@3.6.0-rc.9`（已间接存在，显式化）。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/vapor/runtime.ts`（新） | 26 个 helper：block 树、effect 队列、模板解析+原生克隆、组件挂载 |
| JS runtime | `packages/fjs-runtime/src/vapor/interop.ts`（新） | vapor→VDOM 组件挂载（vant）、VDOM 渲染器收养入口 |
| JS runtime | `packages/fjs-runtime/src/vapor/index.ts` | 改导出：helpers + app API；`enableVapor` 变 no-op（保留给 CLI 注入兼容） |
| JS runtime | `packages/fjs-runtime/src/vapor/dom.ts`、`web.ts`、`web-apps.ts` | 删除（外壳与 web 特例） |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | 加 `adoptVaporRoot`（元素收养：`fjs:vapor-root` 占位 tag 的 create / patchProp 特判） |
| JS runtime | `packages/fjs-runtime/package.json` | 去 `@vue/runtime-vapor`；vue → ^3.5.42；去 devDep `@vue/runtime-dom` |
| JS runtime | `packages/fjs-runtime/src/mp/**`（watch 相关） | 3.6 的 `WatcherEffect.notify` 覆写改回 3.5 的 `scheduler` 选项（specs/148 的适配回退） |
| CLI | `packages/fjs/src/bundler/vue-plugin.ts` | 删 runtime-vapor 钉扎 / DOM 注入（vaporDomInjectPlugin）；`fjs/vapor` 的 external 化改到自研运行时；新增 vapor 包装组件生成（非 vapor 文件 import 了 vapor SFC 时）；`enableVapor` 注入移除 |
| CLI | `packages/fjs/src/vite.ts` | dev 侧同步（`prepareVaporSfcSource` 里的 enableVapor 注入移除；Vapor SFC 编译走 3.6 compiler） |
| CLI | `packages/fjs/package.json` | 显式 devDependency `@vue/compiler-sfc@3.6.0-rc.9` |
| CLI | `packages/fjs/src/project/create*`（create 模板） | 模板 `vue` 钉版回 ^3.5 |
| Bench | `examples/bench/vapor/own.ts`（新）+ `main.ts` | 第三方对照：VDOM / 官方 runtime-vapor（`vue36` devDep + 旧 build.mjs 路径）/ 自研运行时三方同口径 |
| 测试 | `packages/fjs-runtime/test/vapor-own.test.ts`（新，替代 `vapor-dom.test.ts` / `vapor-mount.test.ts` 的对拍用例） | 挂载、v-if、keyed v-for 增删移、绑定、事件、slot、vapor 嵌 VDOM、VDOM 嵌 vapor（收养） |
| 测试 | `packages/fjs/test/vue-plugin-vapor.test.ts` | 更新：3.6 编译、包装生成、无 runtime-vapor 注入 |
| 文档 | `docs/vue3.md`、`docs/toolchain.md`、`docs/performance.md` | 自研运行时用法与限制、CLI 依赖、数字 |
| Spec | `specs/161-own-vapor-runtime/spec.md` §8 | 结果与数字 |

## 3. 方案

### 3.1 helpers 的实现模型

编译产物把组件渲染成「块」（Block）——一组宿主元素 + 嵌套块。我们的块比 runtime-vapor 的薄：
`{ nodes: HostNode[] }`，节点是 element API 的宿主元素或锚（`nodeOps.createComment` 的隐形 view）。

- **template(html, flags, ns)**：模块级调用 → 解析一次（HTML 子集解析器照搬 dom.ts 的
  `parseTemplate`，产出 `CloneNode[]` → `prepareClone`）→ 返回实例函数；实例调用 →
  `cloneReady()` 时 `cloneTemplate(plan)`（libfjs-style 原生克隆，specs/152 机制），回落逐节点
  `nodeOps.createElement`。**ns 参数必须忽略**：compiler-dom 的 SVG 标签表里有 `<view>`（SVG 本来
  就有 view 元素），fjs 的 `<view>` 被误标 SVG 命名空间——现外壳没用过 ns 参数，自研运行时同样忽略。
- **child / next / nthChild / txt**：编译器按模板形状给下标。模板实例记录每个节点的 kind 与
  父子关系（预计算一次），walker 沿克隆返回的宿主数组走。`txt(el)` 对「元素即文本」的 fjs 模型
  返回元素本身，`setText` 落 `nodeOps.setElementText`；独立文本节点落 `nodeOps.setText`。
- **renderEffect(fn)**：`@vue/reactivity` 的 `ReactiveEffect`（3.5/3.6 公开 API 同形），立即首跑，
  变更进微任务队列批处理（runtime-vapor 同语义）。当前 effect scope 由块创建时建立，卸载时 stop。
- **createFor(source, getItem, getKey, flags)**：每项 scope + item/key 记账；维护渲染序数组，
  keyed diff（Map key→block）后统一 insert/move/remove；`FAST_REMOVE` 用逆序 splice。
  flags 位：FAST_REMOVE=1、IS_COMPONENT=2、ONCE=4、IS_SINGLE_NODE=8、IS_FRAGMENT=16、
  SLOT_ROOT=32、keyed = flags>>8（compiler-vapor genForFlags 实测）。
- **createIf(cond, b1, b2, flags)**：DynamicFragment 的最小版——当前分支块 + 锚，effect 里切
  分支：旧块卸载（stop + remove）、新块挂到锚前。
- **setInsertionState(el)**：栈式保存「下一个块/模板实例的挂载点」，createFor/createIf/
  createComponent/动态 template 实例消费；runtime-vapor 同为单槽 + 消费即清。
- **on / once / setAttr / setProp / setClass / setClassName / show / delegateEvents**：全部落
  `patchProp` / 元素事件路径（与 VDOM 渲染器同一份、事件载荷字符串契约不变）。`delegateEvents`
  是 no-op（我们逐元素注册，没有 document 委托这回事）。
- **createComponent(comp, props, slots)**：vapor 组件 → 建 instance（props 为 getter 代理对象，
  读时求值即依赖收集）+ effect scope，setup 返回块；VDOM 组件（vant）→ interop（§3.2）。
  `resolveComponent` / `createAssetComponent` 查当前 appContext 的组件注册表（demo 的 vant 全局注册走这里）。
- **createSlot / useSlots**：slot 名 → 函数（返回块），供子组件在 insertionState 下调用；
  fallback 支持。
- 元素 v-model（`vModelText` 等）：本仓库无 vapor 页用到（vant 的 v-model 是组件 props/事件），
  首版显式 throw；createSlot 复杂场景（动态名）同此。

### 3.2 interop 双向

- **vapor 页嵌 VDOM 组件**（demo vant/vapor）：`createComponent` 判定非 vapor 组件 → 在当前
  insertionState 的宿主下建一个容器元素，用**我们自己的渲染器**直接 `render(vnode, container)`
  （renderer.ts 保存渲染器句柄并导出——runtime-vapor 做不到这步，它必须渲染器无关；我们耦合自己的
  渲染器是本设计的优势）。props 用 getter + `render` 的 props patch；卸载随 vapor 块销毁。
- **VDOM 页嵌 vapor 组件**（hello-fjs flat-4050）：编译期包装。CLI 编译非 vapor 文件时预扫其
  `.vue` 相对导入（正则探 `<script setup vapor`，同 isAutoVapor 的手法），命中则把导入改写到
  生成的包装模块：`defineComponent({ props, setup(props) { 挂 vapor 块 → 根宿主登记到注册表;
  return () => h('fjs:vapor-root', { 'data-fjs-vapor': id }) } , 卸载时 stop + 注销 })`。
  渲染器侧：`nodeOps.createElement('fjs:vapor-root')` 查注册表返回已有宿主（不新建），
  `patchProp` 对该 tag no-op（防止 VDOM patch 覆写 vapor 管的属性）。3.5 runtime-core 无需任何改动。

### 3.3 Vue 版本

- `fjs-runtime`：`vue` → `^3.5.42`；删 `@vue/runtime-vapor`；删 devDep `@vue/runtime-dom`
  （只有 runtime-vapor 用）；CLI 的 `@vue/*` 钉扎表保留（reactivity / runtime-core / shared 已有），
  删 runtime-vapor / runtime-dom 两行。
- helpers 的 reactivity 从 `'@vue/reactivity'` import——CLI 已把 `@vue/reactivity` 钉到与应用
  `vue` 同一份 dist，实例同一性有保证。
- specs/148 为 3.6 做的适配（mp watch 的 `WatcherEffect.notify` 覆写）按原路改回 `scheduler` 选项。

### 3.4 bench 三方对照

`examples/bench/vapor/`：VDOM 与自研走 CLI 构建（同一份 3.5）；官方 runtime-vapor 对照走
specs/148 阶段 0 的独立 `build.mjs`（bench 自己的 `vue36` devDep + 钉版 esbuild，不依赖 CLI 的
vapor 支持）。同口径输出挂载 / 卸载 / 更新。

## 4. 风险

- **语义覆盖面**：runtime-vapor 是完整实现，我们只覆盖编译产物实际产出的用法。未覆盖路径必须
  throw 而不是静默错树（宪法 V）。对拍（帧字节 + verify hash）是安全网。
- **收养机制的边界**：`fjs:vapor-root` 元素被 VDOM 复用 / 移动 / 卸载时，宿主与注册表的生命周期
  要一一对应；组件 keep-alive、双实例（v-if 两个分支各挂一份）用注册表计数处理，单测钉住。
- **`<view>` 的 SVG 误标**：自研运行时忽略 ns，但 `child()` 下标依赖模板形状——解析器必须与
  compiler 的 HTML 子集一致（omitted closing tag、`<!>` 锚、裸文本模板），照搬外壳的
  `parseTemplate` 已验证逻辑。
- **CLI 预扫的误判**：正则探 vapor SFC 可能漏动态路径；漏判的表现是运行时抛「not a vapor
  component」，可控。`fjs.vapor.libs` 的 node_modules 自动 vapor 继续工作。
- **web 端**：自研运行时经 web 适配层的 element API 落 DOM——样式引擎 / 事件路径与 Flutter
  同源，但 web 的 op 流程不经过 Dart；两端对拍靠 hello-fjs 66 页 verify 与 `fjs dev --web` 手测。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test            # runtime + cli（新 vapor-own.test.ts、更新后的 vue-plugin-vapor.test.ts）
cd packages/flutter_fjs && flutter test    # 不改 native，全量回归
cd examples/bench && pnpm run vapor        # 三方对照 + verify hash
pnpm --filter demo run bench:mount         # VDOM 路径不回退
cd examples/hello-fjs && fjs build         # 66 页 verify
fjs run ios --profile -d 00008101-000978E201FA001E   # flat-4050 Vapor 真机读数（用户手点）
```
