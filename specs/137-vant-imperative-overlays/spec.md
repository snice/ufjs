# Spec: vant 命令式弹层（showToast / showConfirmDialog / showNotify / showImagePreview）App 端可用

- **ID**: 137-vant-imperative-overlays
- **状态**: done
- **日期**: 2026-09-25
- **来源**: specs/136 完成后的追问——app 级 overlay 宿主已经有了，命令式 API 缺的只是"挂载点"

## 1. 要解决什么

vant 的命令式 API 在 App 端是**静默空操作**，demo `vant-feedback` 页的探针把这件事
自证了出来：

- `showToast('…')` 返回 `{}`，屏幕上什么都没有；
- `showConfirmDialog({...})` 返回 `Promise.resolve(undefined)`，没弹窗、没人点按钮就"结束"了。

原因有两层，都在 vant 源码里：

1. `showToast` / `showDialog` / `showNotify` / `showImagePreview` 开头都是
   `if (!inBrowser) return …`（`inBrowser = typeof window !== "undefined"`），
   App 端没有 `window`，直接早退。
2. 过了第 1 层也挂不上：`utils/mount-component.mjs` 是
   `createApp(Root)` + `document.createElement("div")` + `document.body.appendChild(root)`。
   App 端没有 `document`；`vue` shim 里的 `createApp` 故意指名抛错
   （`vue-shim.ts`："there is no DOM to mount a second app root into"）。

现状被登记为已知差异（`docs/vant-adaptation.md`、`docs/vue3.md`、
`docs/third-party-components.md` D 类），页面只能改组件式写法。但 vant 业务代码里
命令式调用非常普遍（尤其 `showToast` / `showLoadingToast` / `showConfirmDialog`），
迁移成本高。

specs/136 之后，渲染侧的前提已经具备：这几个 API 默认 `teleport: "body"`，
`querySelector('body')` 现在指向 **app 级 overlay 宿主**（画在所有页面之上，
与 web 上挂在 `<body>` 同义）。缺的只是"第二个 Vue 根挂在哪"。

## 2. 不做什么（Non-goals）

- **不**给 runtime 装 `window` / `document` 全局（`vite/vant.ts` 顶部注释的原则：
  让库适配 runtime，不让 runtime 假装浏览器）。
- **不**把 vant Toast 转发给 `FjsToastHost`（`__fjs.toast`）：那条路只有纯文本，
  loading / success 图标、`forbidClick`、位置、Dialog 全部丢失。
- 不改 op 协议 / natives 表 / 事件类型。
- 不适配 vant 以外组件库的命令式 API（runtime 能力是通用的，但补丁只写 vant）。
- 不做小程序端（vant 不在小程序编译的支持面内）。
- 不改 specs/136 的返回拦截规则本身（见待澄清 Q2 的取舍）。

## 3. 用户可见的行为

页面代码**一行不改**，两端都生效：

```ts
import { showToast, showLoadingToast, closeToast, showConfirmDialog, showNotify, showImagePreview } from 'vant';

showToast('保存成功');
showLoadingToast({ message: '加载中…', forbidClick: true });
closeToast();

const ok = await showConfirmDialog({ title: '确认', message: '删除这条记录？' })
  .then(() => true, () => false);

showNotify({ type: 'success', message: '通知内容' });
showImagePreview(['https://…/a.png', 'https://…/b.png']);
```

App 端表现：

- 弹层画在 **app 级宿主**（所有页面之上、`toast()` 之下），外观就是 vant 组件本身
  （同组件式写法的样式与动画）。
- `showConfirmDialog` 的 Promise 由按钮 resolve / reject（不再是 `undefined`）。
- vant 的单例 / 队列语义不变（`allowMultipleToast`、`closeToast(true)` 等）。
- 弹层可见期间系统返回被拦（specs/136 规则）；关闭后 vant 用 `v-show` 隐藏实例，
  不再拦返回。
- 页面跳转不带走它们（同 web：挂在 body 上的实例不随路由卸载）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | vant 补丁去掉 `inBrowser` 早退；`mountComponent` 挂进 runtime 提供的**游离根**；内容经 Teleport/hoist 进 app 级宿主 | vant 原样（真 `document.body`），补丁只作用于 App 构建 |
| 层级 | app 宿主：盖住所有页面 | `<body>` 下，vant 自己的 z-index |
| 跨页 | 实例不随页面卸载 | 同 |
| 系统返回 | 可见期间拦截（specs/136） | 浏览器后退不拦（已登记的差异，specs/136） |
| 事件载荷 | 不涉及（vant 内部回调） | — |

### runtime 侧要补的通用能力（框架层，不含 vant 假设）

1. **游离根**：`fjs/vue` 导出一对函数，语义等同 `document.createElement('div')`
   （不挂到任何页面）和它的释放：创建一个真实节点但不插入任何父节点，Vue 可以把第二个
   app mount 进去；释放时清掉 JS 记账并发 Remove。
2. **无页面的 fixed 元素进 app 宿主**：hoist 现在靠 `pageRootOf(el)` 找页面宿主，
   找不到就不 hoist（元素留在游离根里，看不见）。改为：找不到页面 → 进 app 宿主。
   Toast/Dialog/ImagePreview 走 Teleport 不依赖这条；Notify 默认不 teleport，靠它。
3. `vue` shim 的 `createApp` 保持指名抛错（Q1），vant 补丁改从 `fjs/vue` 导入。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（游离根用已有的 Create / Remove op；Dart 侧不渲染无父节点）

## 6. 验收标准

1. `pnpm --filter @ufjs/runtime test` 通过，新增单测覆盖：
   - 游离根上 mount 第二个 app，`Teleport to="body"` 内容进 app 宿主根；
   - 游离根下的 `position: fixed` 元素 hoist 进 app 宿主；
   - 释放游离根后 JS 记账清空、发出 Remove。
2. `cd packages/flutter_fjs && flutter test` 通过（回归，不期望 Dart 改动）。
3. `pnpm test`、`pnpm run typecheck`、`pnpm --filter demo run typecheck` 通过。
4. `vite/vant.ts` 补丁全部命中：`fjs dev` 构建不出现 "anchor missing" 告警。
5. demo `vant-feedback` 页在 Android 模拟器（`fjs run android`）上：
   - showToast：屏幕中部出现 vant Toast，约 2s 后消失；探针显示 ✅；
   - showConfirmDialog：弹出 vant Dialog，点"确认"探针显示"已确认"、点"取消"显示"已取消"；
   - showNotify：顶部出现通知条；
   - showImagePreview：全屏图片预览，可左右滑、点击关闭；
   - Dialog 打开时物理返回被拦，关闭后物理返回正常离开页面。
6. 同一页 `fjs dev --web`（浏览器）上四个调用表现与改动前一致。
7. 文档：`docs/vant-adaptation.md`、`docs/vue3.md`、`docs/third-party-components.md`
   里"命令式 App 端不可用"的条目改为可用并说明机制；`docs/overlay-host.md` 补
   "游离根 / 无页面 fixed 元素"一条。

## 7. 待澄清

- [x] **Q1 `vue` shim 的 `createApp`** → **保持指名抛错**；vant 补丁把
  `mount-component.mjs` 的 `createApp` 改从 `fjs/vue` 导入。能力在 `fjs/vue` 里是
  通用的，打通哪个库由该库的适配补丁显式决定，其他库的命令式 API 仍明确报错。
- [x] **Q2 Toast 拦返回** → **拦**，沿用 specs/136"app 宿主有可见元素即拦系统返回"，
  不为非遮罩元素开例外。
