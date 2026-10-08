# Spec: 全局组件（createFjsApp `globalComponents`）+ hello-fjs 悬浮球演示

- **ID**: 211-global-components
- **状态**: done
- **日期**: 2026-10-08

## 1. 要解决什么

框架的页面模型是"一个路由页 = 一个独立 Vue app"（`app/web.ts`、
`router/flutter.ts`），应用级的常驻 UI（悬浮球、客服入口、全局播放条、
调试面板）今天只有两条路，都不好用：

1. 写进 shell → 每页各挂一份，状态不跨页，push 后随页面一起滑走；
2. 用 `position: fixed` → App 端被 hoist 进**页面级** overlay 宿主
   （docs/overlay-host.md），跟着页面走，且全屏 fixed 层按"形状"可能被判成
   模态、拦截返回。

specs/210 给 tabBar 开了一条"全局唯一实例、挂在页面树之外"的口子，但它是
专用的（底部停靠、仅 tab 页）。缺一个通用的：**注册一个 Vue SFC，全应用只
挂一份，按路由决定显不显示**。

## 2. 不做什么（Non-goals）

- **不做 mp 端**：小程序没有页面树之外的挂载点（同 specs/210）；mp 构建下
  `globalComponents` 忽略并在文档登记，hello-fjs 演示组件被
  `fjs.mp.excludeComponents` 剔除。
- **不新增标签 / op / natives**：全局组件是应用层 Vue 组件，框架只给挂载
  机制（宪法 VII：JS 侧能包就不下 Dart；Dart 只学一条"全局层"布局规则）。
- **不做 vapor 路径**（`enableVapor`）：显式 `console.warn` 后忽略（同
  tabBar，宪法 V）。
- **不做全局组件的转场动画 / z 序配置**：层序固定（见 §4）。
- **不做 `position: fixed` 语义改动**：overlay 宿主不动。
- 不做 pointer-events 子树 `auto` 重开（css-compat 已登记不支持）；穿透靠
  结构保证（见 §3/§4），不靠 CSS。

## 3. 用户可见的行为

### 3.1 配置

```ts
// main.ts
createFjsApp({
  routes, shell: Shell, tabBar: { component: TabBar },
  globalComponents: [
    // 简写：组件本身，所有 route 显示
    Toolbox,
    // 完整：include / exclude 为路由 path 匹配（字符串精确 / 前缀通配 `/a/*` / 正则）
    { component: FloatingBall, include: ['/', '/components/*'], exclude: ['/game/*'] },
  ],
});
```

```ts
type RoutePattern = string | RegExp;      // 'path' 精确；'/a/*' 前缀；RegExp 测 path
interface GlobalComponentOptions {
  component: Component;
  /** 缺省 = 所有 route。给了就只在命中的 route 显示 */
  include?: RoutePattern[];
  /** 优先于 include */
  exclude?: RoutePattern[];
}
createFjsApp({ globalComponents?: (Component | GlobalComponentOptions)[] })
```

- 每个全局组件**全应用一份实例**（跨路由切换不重建，内部状态——悬浮球
  位置、菜单展开——保留）。不命中路由时**隐藏而不卸载**（`display:none`），
  再回到命中路由时状态仍在。
- 组件内可 `useRouter()` / `useRoute()`（同 tabBar：注入同一对）。
- 全局层**不遮挡事件**：全局组件占位之外的所有区域，触摸 / 滚动 / 点击照常
  落到下面的页面；只有全局组件自身可命中的元素（悬浮球、展开后的扇形项）
  响应事件。展开扇形菜单若要"点空白收起"，由组件自己在展开期间铺一层
  可命中的遮罩（此时遮挡是组件有意为之，不是框架层）。

### 3.2 hello-fjs 演示（`FloatingBall.vue`）

- 默认出现在右侧中部的悬浮球（所有页面，含 push 的二级页；游戏页
  `meta` 排除，演示 exclude）。
- **拖拽**：手指拖动跟手；松手后**停靠**到最近的左/右边缘（带吸附动画，
  y 夹在安全区内），停靠后半隐藏（贴边露出一半）。
- **点击**展开**扇形菜单**：菜单项（3–5 个，iconmind 图标）沿圆弧从球
  位置绽开；球靠左边向右展开、靠右边向左展开、靠上下边自动调整圆弧
  起止角避免出屏；再点球 / 点任一项收起。菜单项点击做真实动作
  （回首页、切换深色主题、返回顶部/上一页等，用现有 API）。
- 拖拽与点击不冲突：位移超阈值判拖拽，否则判点击。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 挂载 | 每个全局组件一个独立 Vue app，根为 `fjs-global-host` 保留根（`__global` prop，`setProps` 既有通道，同 `__tabBar`） | 第二批 Vue app，挂进 `#app` 内 `fjs-global-host` 容器 |
| 层序 | 在 **Navigator 之上**（FjsApp 层，同 app overlay 宿主位置）——push 二级页不盖住它；低于页面模态弹层 **（Q1 已定：盖住二级页）** | `#app > fjs-global-host` absolute 全屏，z-index 高于 page entry（含 `data-covers-bar` 的 3）、低于模态 1000 之上？见 §7 |
| 事件穿透 | 全局层容器本身**不参与命中**：Dart 侧用 `IgnorePointer`/自定义命中规则，仅子节点命中；非组件区域的触摸落到 Navigator | 容器 `pointer-events: none`，组件**根节点**（框架注入的 wrapper，`pointer-events: auto`）重开——web 的 CSS 本来就支持子树重开 |
| 定位 | 组件自己用 `position: absolute/fixed` 相对全局层（= 全屏）定位；全局层尺寸 = 整个 App 区域 | 同左（absolute 相对 `#app`） |
| 路由匹配 | 同一份 `matchGlobal(route.path, include, exclude)`（`app/global-components.ts`，纯函数，两端共用），surface 用 display 切换 | 同左 |
| 事件载荷 | 字符串（无新事件） | 同左 |
| mp | 忽略 + 文档登记 | — |

已知难点（plan 阶段重点验证）：

1. Flutter 侧 `pointer-events` 子树重开不支持，所以"整层不挡、局部挡"必须在
   Dart 结构上做：全局层 widget 的 hitTest 只对**子节点自身命中成功**才返回
   true（`RenderBox.hitTest` 自定义，空白区返回 false 让事件下穿），而不是
   靠 CSS。需实机验证拖拽手势在该结构下能拿到 move/up。
2. 悬浮球拖拽跟手要求 touch move 事件在 JS 侧可用（已有 `touchmove`？
   plan 阶段核对 `docs/ui-api.md` 事件表与 `element.ts` EventType）；
   若没有，退一步用 `pan`/`drag` 现有事件，**不新增事件类型**。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及——预期无协议变更。唯一 Dart 改动：`fjs_app.dart`/`fjs_view.dart`
  对 `__global` 根的布局 + 命中规则（同 `__tabBar` / `__appOverlay` 的做法）。
  若 §4 难点 2 证明现有事件不够，回到本节并升级为契约变更。

## 6. 验收标准

1. `pnpm run typecheck` 全 workspace 通过。
2. `pnpm test` 通过；新增 runtime vitest：
   - `matchGlobal`：缺省全显、include 精确/前缀/正则、exclude 优先、组合；
   - web：全局组件单例（跨路由不重建，计数器状态保留）、未命中隐藏不卸载、
     `fjs-global-host` 容器 `pointer-events:none` 而组件根 `auto`；
   - 不传 `globalComponents` 时零挂载（demo 回归）。
3. `cd packages/flutter_fjs && flutter test` 通过；新增 widget 测试：
   全局层空白区点击落到页面（页面按钮 onTap 触发）、点全局组件自身元素
   由其响应、push 二级页后全局层仍在其上、display:none 不占命中。
   （先编 native，避免 `No tests ran`。）
4. `pnpm --filter hello-fjs run dev:web`（`fjs dev --web`）：悬浮球出现在
   除排除页外所有页；拖拽跟手、松手停靠边缘；点击展开扇形、再点收起；
   球之外区域点击/滚动照常作用于页面；切路由后球位置/展开态不丢。
5. `fjs run ios`（模拟器）：同第 4 条；另验 push 二级页球仍在、返回手势
   不被全局层拦截、深色模式正常。
6. 不传 `globalComponents` 的应用（demo）行为与改前一致。
7. `pnpm --filter hello-fjs run build:mp` 产物无全局组件残留、不报错。

## 7. 待澄清

已拍板（2026-10-08）：

- Q1 层序：**盖住 push 的二级页**，Navigator 之上（A）。
- Q2 与页面模态：**在模态之下**（遮罩盖住球）。
- Q3 页内覆写：**仅 include/exclude**，不加 `<route>` meta 开关（§3.1 对应
  描述已作废）。
- Q4 匹配对象：**`route.path`**（精确 / `/a/*` 前缀 / RegExp）。

**遗留风险（plan 阶段必须先验证，不能自行绕过）**：Q1 与 Q2 在 Flutter 上
结构性冲突——页面模态（vant Popup/Dialog）画在 Navigator 的 Overlay 里、
紧贴本页路由 entry；Navigator 之上的全局层天然压在它们**之上**。要同时满足
"盖住二级页"和"低于模态"，得让全局层随"当前页是否有模态"让位（复用
`isModalMask` 的模态判定，在有模态时全局层降级为不可见/不可命中），或把全局
层插进 Overlay 的特定层序。若 plan 阶段确认代价过高，回退方案：全局层在
模态之上（两端一致），请用户再确认。web 与 App 必须同一结论（宪法 I）。
