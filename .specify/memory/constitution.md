# ufjs 工程宪法

不可协商的约束。每份 spec 的 plan 阶段都要对照这张表自查，`/plan` 会强制检查。

## I. 两端同源

任何面向用户的能力（标签、样式、事件、API）必须同时在 Flutter 侧
（`packages/flutter_fjs/lib/src/`）和 Web 侧
（`packages/fjs-runtime/src/web/`）成立，页面源码一行不改就能跑两端。

只做一端是**未完成**，不是"分阶段交付"。做不了的那一端要在 spec 里写明
原因，并在 `docs/css-compat.md` 或 `docs/web.md` 的差异表里登记。

## II. 边界即契约

跨越 JSI / FFI 的三张表任何一张变了，另外两处必须同步：

| 契约 | JS 侧 | Dart / C++ 侧 |
|------|-------|---------------|
| UI op 协议 | `fjs-runtime/src/ui/ops.ts` | `flutter_fjs/lib/src/ui_ops.dart` |
| natives 表 | `fjs-runtime/src/native-global.d.ts` | `native/src/natives.cpp` |
| 事件类型 | `fjs-runtime/src/ui/element.ts` `EventType` | `native/include/fjs.h` `FJS_EVENT_*` |

v1 ABI 只过标量（`string | number | boolean | null`）。对象走 JSON 字符串，
二进制走 base64。**不要为一个功能新开 C ABI**，先看 `fetch` 那个范式
（invokeHost 发起 + 自分配 id + dispatchEvent 回结果）能不能用。

## III. 同步、单线程、零序列化

JS 跑在 Flutter UI isolate 上，宿主调用同步返回。任何改动不得引入
JS↔Dart 的 JSON 桥或跨线程等待。需要异步就用 II 里的 fetch 范式；
需要真并行就用 Worker（独立 QuickJS runtime）。

## IV. 外观照 WeUI

内置组件的默认配色、内边距、圆角、按下态以
[WeUI](https://wechat.design/tool/weui-mobile) 为准，Flutter 与 Web 取
**同一组数值**。Material / 浏览器的默认值（点击区、水波纹、
OutlineInputBorder）该关就关。

## V. 静默失效是 bug

CSS 引擎遇到不支持的选择器/属性要 `warnOnce` 并跳过，不能悄悄丢。
测试跳过要显式说明（Flutter 的 `No tests ran` 是坑，不是通过）。

## VI. 注释记录权衡

新增的非显然实现要在代码里留下"为什么这样而不是那样"。参照
`css-compat.ts` 顶部注释、`web.md` 的「已知差异」章节的写法。

## VII. JS 能包就不要下 Dart

新增标签或组件能力时，先问一句：**能不能在 JS 侧用一个组件包出来？**能就包，
只有真的需要原生 widget 才下到 Dart —— 需要平台控件（输入法、滚动、原生手势
识别）、需要 Flutter 的渲染/布局能力、或者有实测的性能理由。

「能包」的判据是：这个能力要的信息 JS 已经有，或者可以在**框架无关的那一层**
（`ui/element.ts` 的 prop 写入与事件回派）记下来。纯粹的组织性能力——收集、
分发、转发、编排——基本都属于这一类。

包的方式有讲究，不是在页面里写个 Vue 组件就算：

- 组件放 `fjs-runtime/src/components/`，由运行时注册（`app/flutter.ts`），
  并在 `fjs/src/bundler/vue-plugin.ts` 的 `FLUTTER_COMPONENT_TAGS` 里排除，
  这样 Flutter 路径上它才是组件而不是元素。**注意顺序**：这个排除必须在
  `isHTMLTag` 之前判，否则 `form` 这种同名 HTML 标签会被判回元素。
- 状态与「子树里有哪些控件」这类账，记在 element 层，不要依赖 Vue 的
  provide/inject 或 slot 遍历 —— 那两样在 Flutter 路径上够不着元素，也把能力
  绑死在了一个框架上（宪法 I 与 docs/custom-renderer.md）。
- web 侧可以另有实现（substrate 不同），但契约一致：同样的 props、同样的事件
  载荷。`list-view` 和 `form` 都是这个形状。

好处不只是代码少：改一行不用重编 Flutter；两端行为天然一致；躲开只在真机上
才暴露的 Dart 侧坑（`form` 最初的 Dart 实现就栽在手势竞技场上——widget 测试
全过，设备上按钮死活不响应，见 specs/007-form-components/plan.md §3.8）。

## VIII. 变更要落到文档

改了协议、样式支持范围、CLI 命令或模块契约，同一个 PR 里更新对应文档：
`docs/css-compat.md`（样式支持矩阵）、`docs/ui-api.md`（标签/事件）、
`docs/toolchain.md`（命令）、`docs/modules.md`（模块清单字段）、
`docs/roadmap.md`（完成项打勾）。

## IX. 三方依赖不进内核

内置 host API（`fjs-runtime` + `flutter_fjs`）只准依赖 Flutter SDK 与既有的
核心依赖；**需要三方 pub/npm 包的能力一律做成模块包**，连它的 JS 入口、Dart
host 模块和依赖一起搬出去（`@ufjs/audio` 是先例，specs/215：audio 需要
audioplayers → 整体成包；vibrate 只要 SDK 的 `HapticFeedback` → 留在内置）。
内核装一个三方包，是替所有 fjs 应用装的——这个成本只有用到该能力的应用才该付。
