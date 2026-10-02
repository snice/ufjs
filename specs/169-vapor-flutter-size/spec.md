# Spec: enableVapor 的 Flutter 包体——渲染器移出包

- **ID**: 169-vapor-flutter-size
- **状态**: done
- **日期**: 2026-10-01
- **分支**: 169-vapor-flutter-size（从 168-vapor-web-size 切出）

## 1. 要解决什么

enableVapor 在 Flutter 端**不省包体，反而更大**。`examples/vapor-app` 与同内容 VDOM 版
（2026-10-01，`fjs build --pages --analyze`）：

| | VDOM | enableVapor |
|---|---|---|
| `shared.js` | 313.7 KB / gz 113.6 KB | **336.4 KB / gz 120.7 KB**（+7%） |

拆账：`@vue/runtime-core` 68.4 KB（整包，web 端摇树后只剩 8.3 KB）、`css/style.ts` 41.9 KB、
`vue/renderer.ts` 19.8 KB、reactivity 19.0 KB、vapor host 15.7 KB、@vue/shared 15.2 KB。

runtime-core 摇不掉的原因：`vue/renderer.ts`（2100 行）**九成是渲染器无关的宿主原语**
（nodeOps / patchProp / 原生克隆 / 样式引擎实例 / 页面根 / overlay 提升 / registerStyles），
只有模块顶层一次 `createRenderer(...)` 调用——顶层调用打包器视为副作用，runtime-core 的整个
VDOM 渲染引擎因此被钉进任何导入 renderer 的包。enableVapor 下导入它的路径有四条：

1. `vapor/backend-flutter.ts` 的宿主原语（nodeOps、克隆、styleEngine）——**本可不经渲染器**；
2. 同文件的 VDOM 互操作（`mountVdomComponent` 用 `render` / `h`）；
3. Flutter 的 `'vue'`（`vue/vue-shim.ts`）为 `<Transition>` 取 `styleEngine`——任何 `'vue'` 导入都连带渲染器；
4. `router/flutter.ts` 静态导入 `createApp` 挂 VDOM 页；`app/flutter.ts` 把 7 个内置组件
   （canvas / list-view / form / picker / rich-text / textarea / defer，**全是 VDOM 组件**）注册进
   vapor 组件表，vapor 页里经互操作渲染它们。

### 1.1 更底层的一层：分包 shared.js 是整命名空间导出

`--pages` 构建的 shared.js 由 `sharedEntrySource`（`bundler/build.ts`）生成：
`import * as runtimeCore from '@vue/runtime-core'`、`import * as vue from 'vue'`、
`import * as fjsVue from 'fjs/vue'`……再整个挂上 `globalThis.__FJS_SHARED` 给页面 chunk 取用。
命名空间对象被引用 = 模块的**每一个**导出都可达——所以即使拆掉 `createRenderer`，runtime-core
仍会整包留下。这一层对 VDOM 应用同样成立（Suspense / KeepAlive / hydration 等页面从不用的
导出也全在）。

release（含字节码）构建没有热更新（docs/code-splitting.md），页面 chunk 与 shared.js 同次产出；
dev 有页面级热更新，新页可能用到新名字，必须保留整命名空间。

## 2. 不做什么（Non-goals）

- 不动 VDOM 应用的运行行为（拆文件只是搬家，导出面不变）。**包体会变**：L1 对所有
  release 分包构建生效，VDOM 应用的 shared.js 也会变小——这是有意的。
- 不改 op 协议 / natives / 事件类型。
- TS 样式引擎（41.9 KB）出包：见待澄清 Q2，默认另立 spec。
- web 端（specs/168 已做；vue-router 瘦身另立）。

## 2.1 方案分两层

- **L1（所有应用，release `--pages`）**：shared.js 只导出页面 chunk（及其懒加载依赖）实际
  import 的名字。做法：先以 ESM + shared 说明符 external 预构建页面 chunk，从产物的 import
  语句收集每个共享说明符被用到的名字；生成 shared 入口时用具名导入代替 `import * as`。
  任一页面对某说明符用了命名空间导入（`import * as`）/ 默认导入以外无法静态确定的形态 →
  该说明符回退整命名空间。dev 不变。
- **L2（enableVapor）**：
  1. `vue/renderer.ts` 拆出渲染器无关的 `vue/host-ops.ts`（原 1–1979 行原样搬家），
     renderer.ts 只剩 `createRenderer` / `createApp` / `render` 并 re-export host-ops；
  2. `vue/vue-shim.ts`、`vapor/backend-flutter.ts`、`vapor/interop.ts`、路由的页面根改从 host-ops 取；
  3. `backend-flutter.ts` 的 VDOM 互操作拆到 `backend-flutter-interop.ts`；新增纯面
     `vapor/flutter-pure.ts`（无互操作、无 adopt）；
  4. 路由的 VDOM 页挂载移到 `router/flutter-vdom.ts`，由 `app/flutter.ts` 注入；新增
     `app/flutter-vapor.ts`（enableVapor 的 createFjsApp：无内置 VDOM 组件、无 VDOM 挂载器）；
  5. 生成代码的 `registerStyles` 改从叶子 `fjs/vue-style`（host-ops）导入；enableVapor 下
     `fjs/vue` 别名到 `vue/index-vapor.ts`（host-ops 面，无 createApp / render）；
  6. CLI：enableVapor 的 Flutter 构建给 `fjs/app` / `fjs/vapor` / `fjs/vue` 加别名，与 web 对称。

## 3. 用户可见的行为

- enableVapor 的 Flutter 构建：`shared.js` 不含 runtime-core 的渲染引擎（`baseCreateRenderer`
  / `createRenderer` / `KeepAlive` / `Suspense` 等），目标 **小于同内容 VDOM 版**。
- enableVapor 的 Flutter vapor 页里引用 VDOM 组件（vant、内置 7 组件——取决于 Q1）：构建期
  不可用 → 与 web 同样给出明确报错（`a VDOM component reached a pure-vapor app`），不静默。
- 非 enableVapor 应用（含 VDOM 页嵌 vapor 组件）完全不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| enableVapor 下 VDOM 互操作 | 改为不可用（Q1） | 已不可用（specs/166） |
| 内置 7 组件 | 取决于 Q1 | 取决于 Q1（现在不可用） |
| 包体 | 渲染器出包 | 已出包 |

改完后两端对 enableVapor 的能力边界**一致**（现在 Flutter 多一个互操作）。

## 5. 契约变更（宪法 II）

- [x] 都不涉及。CLI 在 enableVapor 下给 Flutter 构建加别名（`fjs/vapor`、`fjs/app` 指向纯 vapor
  面），与 web 的 `web-pure.ts` / `web-vapor.ts` 对称。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 全绿；`flutter test` 无回归。
1b. L1：CLI 单测——release 分包的 shared 入口对页面用到的名字具名导入、命名空间导入回退、
   dev 构建保持整命名空间；hello-fjs / demo release 分包产物在 fjsrun 上 eval shared + 全部页面
   chunk + bundle 无错误（缺名字会在 eval 时 ReferenceError / undefined 调用）。
2. vapor-app `fjs build --pages --analyze`：`shared.js` 小于同内容 VDOM 版，记录数字；产物中
   `baseCreateRenderer` / `createRenderer(` 0 次。
3. VDOM 回归：demo `vapor-check` / `nav-vapor`（VDOM 页嵌 vapor + vant）输出与改前一致；
   hello-fjs Flutter 构建大小不增；bench `vapor` 数字同量级。
4. vapor-app：`pnpm run check`（fjsrun 断言）通过；iOS 模拟器 push / 返回 / pinia / 生命周期正常。
5. enableVapor Flutter 页引用 VDOM 组件时报错文案与 web 一致（单测）。
6. 文档：`docs/vue3.md` enableVapor 章节（能力边界两端一致）、`docs/performance.md`（数字）。

## 7. 待澄清（2026-10-01 已答）

- [x] **Q1 内置 7 组件**：(a) 本 spec 先放弃，enableVapor 两端都不可用、报错明确；另立 spec 改写成 vapor 组件。
- [x] **Q2 TS 样式引擎**：另立 spec。

## 8. 结果（2026-10-01）

| `fjs build --pages` 的 `shared.js` | 改前 | 改后（`--release`） |
|---|---|---|
| vapor-app（enableVapor） | 336.4 KB / gz 120.7 KB | **207.3 KB / gz 71.6 KB**（同内容 VDOM 版 313.7 KB） |
| hello-fjs（VDOM） | 436.3 KB / gz 155.2 KB | 375.9 KB / gz 131.0 KB |
| demo（VDOM + vant） | 809.4 KB / gz 276.7 KB | 652.9 KB / gz 218.8 KB |

L2 单独（非 release，不收窄）vapor-app 为 304.4 KB。runtime-core 在 vapor-app 里 68.4 → 11.3 KB。

验证：typecheck 全绿；runtime 898 / cli 454；release 分包产物（shared + 全部页面 chunk + 入口）
在 fjsrun（原生引擎）上 eval：vapor-app 首页挂载、hello-fjs 66 个 chunk 无错误、demo 与不收窄
构建同样建出 68 个元素；demo vapor-check / nav-vapor 输出与改前一致；bench 在噪声内；
vapor-app `check` 通过；iOS 模拟器 vapor-app push / 返回 / 卸载、hello-fjs 4050 页 vapor 网格
（收养路径）正常。`flutter test` 未跑——本 spec 未改 Dart。

剩余大头：TS 样式引擎 `css/style.ts` 41.9 KB（另立 spec）；内置 7 组件 vapor 化（另立 spec）。
