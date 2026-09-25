# Plan: vant 命令式弹层 App 端可用

对应 spec：`./spec.md`

## 0. 现状核对（改变了 spec 里的一处假设）

demo 已经通过 `demo/src/plugins/vant/dom-env.ts`（specs/073）给 vant 装了
`window` / `document` 垫片，vant 的 `inBrowser` 在 demo 里是 **true**：

- `showToast` 等**不会**在 `if (!inBrowser)` 早退；
- `mountComponent` 里 `document.createElement("div")` 拿到的是 `MeasureBox`，
  `document.body.appendChild` 是 no-op；
- 真正的卡点是 `createApp` —— vue shim 指名抛错，探针 catch 住后显示 ❌。

所以 **不需要** spec §4 里"去掉四个 `inBrowser` 早退"的补丁，只补
`vant/es/utils/mount-component.mjs` 一个文件。spec 相应条目以本节为准。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Web：零改动，vant 原样用真 `document.body`；补丁挂在 `vant()` 的 `fjs.app` hook 上，只作用于 App 构建。Flutter：runtime 游离根 + hoist 规则（`fjs-runtime/src/vue/renderer.ts`），渲染复用 specs/136 的 app 宿主（Dart 零改动）。差异（后退不拦 vs 拦）已在 specs/136 登记 |
| II 边界即契约 | 否 | 游离根用已有 Create / Insert / Remove op；不动 `ops.ts`/`ui_ops.dart`、natives、事件表 |
| III 同步单线程零序列化 | 否 | 纯 JS 记账 |
| IV 外观照 WeUI | 否 | 外观就是 vant 组件本身，同组件式写法 |
| V 静默失效是 bug | 是 | 补丁锚点缺失沿用 `vant()` 的 warn；`createApp` shim 保持指名抛错（Q1）；探针页改成真实调用并自证结果 |
| VI 注释记录权衡 | 是 | 游离根为什么不用 `createRoot`（会挂到隐式根被 base 页画出）、为什么不直接 mount 进 app 宿主根（Vue 在容器上记 `_vnode`，多 app 互相覆盖；空 wrapper 会被返回守卫当成可见元素）；`pageRootOf` 回退最后一页的陷阱 |
| VII JS 能包就不要下 Dart | 是 | 全部在 JS：挂载点是 JS 记账，渲染复用已有 app 宿主，不下 Dart |
| VIII 变更落到文档 | 是 | `docs/vant-adaptation.md`、`docs/vue3.md`、`docs/third-party-components.md`（命令式从"不可用"改"可用 + 机制"）、`docs/overlay-host.md`（游离根一条） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | `createDetachedRoot()` / `releaseDetachedRoot(root)`；`detachedRoots` 集合；`hostForLevel` 先判"祖先是游离根 → app 宿主"（在 `pageRootOf` 回退之前）；`setConnectedResolver` 把 app 宿主根算作已连接（body 语义） |
| JS runtime | `packages/fjs-runtime/src/vue/index.ts` | 导出上面两个函数 |
| JS runtime | `packages/fjs-runtime/src/vue/vue-shim.ts` | `createApp` 抛错文案指向新的挂载方式（仍抛错，Q1） |
| JS 测试 | `packages/fjs-runtime/test/vue_overlay_level.test.ts` | 游离根 mount 第二个 app：Teleport 进 app 根、fixed 元素 hoist 进 app 根、不落入页面宿主；release 后记账清空 + Remove |
| demo 构建 | `demo/vite/vant.ts` | `MOUNT_COMPONENT` 两个补丁：import 改从 `fjs/vue` 取 `createApp` + 游离根函数；挂载/卸载改用游离根 |
| demo 页面 | `demo/src/pages/vant-feedback.vue` | 探针改为真实调用：showToast / showConfirmDialog / showNotify / showImagePreview，说明文字更新 |
| Web 适配层 | — | 不涉及 |
| C++ 引擎 / Dart 宿主 | — | 不涉及（Dart 不渲染无父节点；app 宿主已在 specs/136） |
| 文档 | `docs/vant-adaptation.md`、`docs/vue3.md`、`docs/third-party-components.md`、`docs/overlay-host.md` | 见 VIII |

## 3. 方案

**游离根**：`createDetachedRoot()` 用 element 层 `create('view')` 建一个真实节点，
**不插入任何父节点**（Dart 侧是孤儿节点，不在 `rootChildren` 里，不渲染），
JS 侧照 `flutterRoot` 登记 `childrenOf/parentOf`，另记 `detachedRoots`。Vue 的第二个
app mount 进去，里面的：

- `Teleport to="body"`（Toast / Dialog / ImagePreview 默认）→ `querySelector('body')`
  → app 宿主根（specs/136，已有）；
- `position: fixed` 且不 teleport 的（Notify）→ `hostForLevel` 发现祖先是游离根 →
  hoist 进 app 宿主根。

`releaseDetachedRoot(root)`：vant `unmount()` 里 `app.unmount()` 之后调用，走
`forgetSubtree` + `remove(root)`。

**vant 补丁**（`vant/es/utils/mount-component.mjs`）：

```js
import { reactive } from "vue";
import { createApp, createDetachedRoot, releaseDetachedRoot } from "fjs/vue";
…
  const root = createDetachedRoot();
  return {
    instance: app.mount(root),
    unmount() { app.unmount(); releaseDetachedRoot(root); }
  };
```

`fjs/vue` 在 `SHARED_BARE_BUILTIN` 里，vant 模块可直接导入。

**被否掉的备选**：

- *直接 mount 进 app 宿主根*：Vue 把 `_vnode` 挂在容器上，Toast 与 Dialog 两个 app
  挂同一容器会互相 patch 掉；且挂载容器里残留的占位会让 specs/136 的返回守卫一直生效。
- *用 `flutterRoot()` / `createRoot` 当容器*：会插到隐式根（parent 0）下，Dart 的
  base 页（navKey 回退 0）会把它当页面内容画出来；还会进 `pageRoots`，被
  `pageRootOf` 当成"页面"。
- *让 dom-env 的 `document.createElement` 返回游离根*：垫片在 demo 侧，不该知道
  runtime 的节点模型；而且 `createApp` 仍被 shim 拦着，一样要改 import。
- *shim 的 `createApp` 改成真的*（Q1 b）：用户选了保持抛错。
- *转发 `FjsToastHost`*：只有纯文本，见 spec §2。

## 4. 风险

- `pageRootOf` 找不到页面时**回退到最后一个页面根**：游离根下元素若先走到这条，会被
  hoist 进当前页面宿主（被新页面盖住、随页面销毁），表现是"弹出来但跨页就没了"——
  必须在 `hostForLevel` 里先判游离根，单测锁住。
- 样式在元素 insert 前解析时 `parentOf` 还没有：沿父链找不到游离根 → 走回退。需要
  确认 Vue mount 顺序下样式解析发生在 insert 之后（flush 时），单测覆盖 Notify 形状。
- vant Toast 单例常驻 app 宿主（`v-show` 隐藏）：返回守卫靠"可见子元素"判定，
  已在 specs/136 处理；Dart 回归测试不需要改。
- `isConnected` 语义变化（app 宿主算已连接）：检查 runtime 里 connected 的使用点无回归（全量单测）。
- 补丁锚点：vant 升级后缺锚 → warn + 回到抛错，不会坏 bundle。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime test
pnpm test && pnpm run typecheck && pnpm --filter demo run typecheck
cd packages/flutter_fjs && flutter test
# dev server 需重启才吃到 runtime 改动（fjs dev 不监听 fjs-runtime/src）
cd demo && pnpm run dev:pages   # 看无 "[vant] app patch did not apply" 告警
# Android 模拟器：vant-feedback 页逐个点 showToast / showConfirmDialog /
# showNotify / showImagePreview，截图；Dialog 开着按物理返回被拦
# Web：pnpm --filter demo run dev:web，同页四个调用行为不变
```

## 6. 实现中发现（plan 未预料，已处理）

1. **teleport 到 body 的 fixed 元素又被搬回页面宿主**（specs/136 遗留）：
   `Teleport to="body"` 的内容逻辑父是 app 宿主根，但 fixed 元素解析样式后走
   `hoistIfNeeded → hostForLevel → pageRootOf`，app 宿主根不是页面，触发"最后一页"
   回退，元素被挪进当前页的页面宿主——`teleport="body"` 的 Popup、命令式 Toast/Dialog
   都中招。改为 `belongsToNoPage`：沿**逻辑**父链（有 `hoistedFrom` 用它）碰到
   app 宿主根或游离根 → app 宿主。
2. **Vue 移动已 hoist 元素的 insert 路径**写死 `pageRootOf(parent)`，app 级元素会被
   挪回页面宿主；改走 `hostForLevel(child)`。
3. **Fragment 根的第二个 app 卸载漏删 hoist 出去的元素**：Vue 删 Fragment 按容器的
   物理子节点逐个删，hoist 出去的 Notify 不在其中。`releaseDetachedRoot` 先按
   `hoistedUnder` 清掉它们（同 `nodeOps.remove`）。
4. **`font-size: 0` 让 loading Toast 画成红色错误块**（Dart 既有缺陷）：vant
   `.van-loading { font-size: 0 }`，`StrutStyle` 断言 fontSize > 0。`fjsTextStyle`
   统一出口把 ≤0 夹到 0.001（不可见），`test/font_size_zero_test.dart` 锁住。
5. **嵌套 touch 节点抬手时 `touches` 为空**（Dart 既有缺陷）：`_activeTouches` 全局
   共享，第一个处理 up 的节点就把手指删了，外层节点补发的最后一个 touchmove 带
   `touches: []`，vant `touches[0].clientX` 抛错，ImagePreview 滑动卡在两张之间。
   改为按节点引用计数，最后一个拥有者松手才移出；`touch_event_test.dart` 新增嵌套用例。
6. **文字 Toast 铺满整行**（不修，登记差异）：vant `.van-toast--text { width: fit-content }`，
   fjs CSS 不支持 `fit-content`，定位盒按 `left:0; right:0` 撑开。属于 CSS 布局能力，
   超出本 spec，登记到 `docs/vant-adaptation.md` 已知差异，另开 spec 处理。

