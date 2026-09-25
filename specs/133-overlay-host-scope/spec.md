# Spec: overlay 宿主专题——跟随页面转场、模态拦截返回、使用范围收口

- **ID**: 133-overlay-host-scope
- **状态**: done
- **日期**: 2026-09-25

## 1. 要解决什么

App 端所有 `position: fixed` 元素都被 renderer 挪进页面的 `fjs-overlay-host`
（`fjs-runtime/src/vue/renderer.ts` 的 hoist），Dart 侧
`overlay_host_adapter.dart` 用 `OverlayPortal` 把整棵子树搬进 Navigator 的 Overlay
（紧贴本页 entry 之上）——**脱离了路由的转场包装**。宿主本身没有"返回"语义，
现在看到的返回行为全是副作用：

1. **iOS 弹框时侧滑返回失效，Android 物理返回照样返回**。iOS 失效不是设计出来的：
   vant 的全屏遮罩（`.van-overlay`：fixed、0/0、100%×100%）在 Overlay 上挡住了
   路由的边缘手势。Android 物理返回走 `Navigator.maybePop`，不经命中测试，页面照样
   pop（复现：demo `vant-feedback` 打开 Popup → 物理返回）。两端表现不一致，而且没有
   任何代码对"弹框开着时按返回"负责。
2. **返回转场时 fixed 层留在屏幕上**。demo `vant-float` 下滚让 Sticky 吸顶
   （vant Sticky 吸顶就是切成 `position: fixed`），再返回：页面滑走，
   「基础用法 / 吸顶距离 / 指定容器」三个按钮仍钉在屏幕上方，盖在上一页上（见会话截图），
   直到页面 dispose 才消失。同理推测：从该页 push 新页面，吸顶按钮会盖在新页面上
   （待实测）。
3. **谁在用 overlay 宿主没有账**。当前进宿主的全部来源（按 `position: fixed` 一刀切，
   另加 `<Teleport to="body">`）：

   | 来源 | 性质 |
   |------|------|
   | vant Overlay（遮罩）/ Popup / Dialog / ActionSheet / ShareSheet / Picker·Calendar 弹层 | 模态弹层 |
   | vant Toast / Notify（无遮罩）、Popover（Teleport to body） | 非模态浮层 |
   | vant Sticky 吸顶态、NavBar `fixed`、Tabbar `fixed`（demo `vant-nav`） | 页面级固定元素 |
   | hello-fjs `HeroFly`、`shared-element` 飞行盒与 ✕ | 页面级转场/动画盒 |

   三类东西共用一个"脱离路由转场、盖在页面之上"的宿主，只有第一类真的需要
   "盖住一切"；后两类本该属于页面，却也跑到了路由之外。没有文档说明宿主给谁用、
   页面级 fixed 在 App 上会有什么后果，业务代码（以及它引入的第三方组件）无从判断。

## 2. 不做什么（Non-goals）

- 不改 `position: fixed` → overlay 宿主这条 hoist 通道本身（不新增标签、不改 op 协议）。
- 不做 CSS 的 static position、层叠上下文等 specs/129 已登记的差异。
- 不接管 vant 的 `close-on-popstate` 等组件自己的 history 逻辑（App 上没有 history）。
- 不改 `modal` / `page-container` 这两个原生标签的返回语义（它们本来就是路由级，
  各自已有 PopScope / 返回手势处理）。
- 不改小程序端（wx 原生 fixed 与页面栈自己处理）。

## 3. 用户可见的行为

页面代码不变：

```vue
<!-- vant-feedback：模态弹层 -->
<van-popup v-model:show="show" position="bottom">…</van-popup>

<!-- vant-float：页面级固定元素 -->
<van-sticky :offset-top="pageTop"><van-button>基础用法</van-button></van-sticky>
```

改完之后（App 端）：

1. **fixed 层属于它的页面**：页面 push / pop 转场时，该页 overlay 宿主里的内容跟页面
   一起动（或随页面一起离场），不在别的页面上残留；页面被新页面盖住时，它的 fixed 层
   也被盖住。
2. **模态弹层开着时，返回先对付弹层**：宿主里存在模态遮罩时，iOS 侧滑、Android
   物理 / 预测式返回、Flutter 宿主导航栏的 BackButton（`maybePop`）**行为一致**，一律**拦截**：返回无效，必须先关弹层（§7-1）。
3. **页面代码主动调 `router.back()` 不拦截**：那是业务自己的决定，同 web。
4. **非模态 fixed 不影响返回**：Sticky 吸顶、fixed NavBar/Tabbar、Toast、Popover
   开着时，返回照常。
5. **模态判定**：宿主里有一个"覆盖整个视口"的 fixed 元素（四边为 0，或 0/0 起点且
   100%×100%，可见）即视为模态——vant `.van-overlay` 正是这个形状。判定规则写进文档，
   业务自己写遮罩照此即可获得同样的返回语义。（判定方式见 §7 第 2 条）
6. **有专题文档**：新增 `docs/overlay-host.md`，写清谁会进宿主、三类用法各自的
   App 端行为、返回语义、模态判定、已知差异与"页面级 fixed 该怎么写"；
   `ui-api.md` / `css-compat.md` 的相关条目改为指向它。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| fixed 层与转场 | 随所在页面的路由转场移动/离场，不跨页残留 | 原生 CSS fixed 在页面 DOM 内，路由切换本就随页面走 |
| 模态时返回 | 拦截，三种返回入口一致 | 不拦截：浏览器后退直接离开（已知差异，§7-3） |
| 事件载荷 | 不新增事件 | — |
| 已知差异 | 模态判定基于解析后的样式形状 | 后退不拦截 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（模态判定在 JS 样式回调里做，结果经已有的 `setProps` 写到宿主节点的 `modal` 属性；Dart 只读它）

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过；`cd packages/flutter_fjs && flutter test`
   通过且**不是** `No tests ran`。
2. Dart widget 测试（`overlay_host_test.dart` 扩充）：
   - 两个路由，底下那页的宿主里有 fixed 子节点；push 新路由后该节点不再命中/不可见；
   - pop 转场进行中，宿主内容与页面同一变换（或已随页面离场），转场结束后不在树里；
   - 宿主内有全屏遮罩时，`Navigator.maybePop()` 不 pop（拦截）；只有非全屏 fixed
     时正常 pop。
3. runtime 测试：模态判定——`.van-overlay` 形状判为模态；Toast / Sticky 吸顶 /
   fixed NavBar 形状判为非模态；遮罩 `display:none`（vant 关闭后）不算。
4. Android 真机或模拟器，demo `vant-feedback`：打开 Popup / ActionSheet / Dialog →
   物理返回，页面不返回、弹层仍在；关掉后物理返回正常回上一页。
5. iOS 模拟器，同一页：打开 Popup → 左边缘侧滑，表现与第 4 条一致。
6. iOS 模拟器 demo `vant-float`：下滚至 Sticky 吸顶 → 返回，转场中吸顶按钮随页面
   滑走，上一页上无残留；再次进入页面、吸顶、打开一个 Popover，行为同 specs/129。
7. hello-fjs `shared-element` / HeroFly、demo `vant-nav`（fixed NavBar/Tabbar）行为
   不回退。
8. Web：`vant-feedback`、`vant-float` 行为不回退。
9. 文档：新增 `docs/overlay-host.md` 并挂进 `docs/README.md` 与 AGENTS.md §6 文档地图；
   `ui-api.md`（`fjs-overlay-host` 行）、`css-compat.md`（`position: fixed` 行）改为
   摘要 + 链接。

## 7. 待澄清

已决（2026-09-25，用户确认）：

- [x] **1. 模态开着时按返回 → 拦截**：返回无效，必须先关弹层。iOS 侧滑、Android 物理 /
  预测式返回、`Navigator.maybePop` 一致。不关闭弹层、不新增事件。
- [x] **2. 模态判定 → 按全屏遮罩形状自动判**（§3-5），不要求显式标记。
- [x] **3. Web → 登记为已知差异**：浏览器后退直接离开页面，写进 `docs/overlay-host.md`
  与 `docs/web.md` 的差异表。
- [x] **4. 页面级 fixed → 位置不变，跟随转场**：只修成随页面转场、被新页面盖住、不跨页残留。
  （实现中核实：宿主实际画在 FjsApp Navigator 的 Overlay、紧贴本页 entry 之上，不是根 Overlay；见 plan §3.5）
