# Spec: overlay 第二步真机验收收尾（静态节点挂载崩溃、NavBar 偏移、弹层滚动实测）

- **ID**: 070-overlay-step2-acceptance
- **状态**: done
- **日期**: 2026-09-19
- **来源**: specs/069 第二轮记录。`tool/build-apple.sh` 重建预编译产物后，
  overlay 第二步（fb9c07c）首次真正上到 iOS 设备，暴露出「含关闭态弹层的
  页面整页静默空白」（D1）；同时 NavBar(fixed) 的 `top: 0` 未落到 overlay
  顶部（D3），与 069 验收第 3 条（弹层打开时滚动页面）被 D1 阻塞。

## 1. 要解决什么

1. **D1：含关闭态弹层的页面整页空白，无任何用户可见报错。**
   根因已定位（带日志复现）：fjs 的 app 构建按 Vue 默认 `hoistStatic: true`
   编译 SFC，产出 `createStaticVNode`；而 fjs 的自定义 renderer（nodeOps）
   **没有实现 `insertStaticContent`**——Vue 的 `mountStaticNode` 调它时抛
   `TypeError: not a function`，页面挂载中途死亡。vant-feedback（探测区块
   静态子树大）、tabs+field 组合页均因此空白；本地 Node 复现不出来是因为
   测试走运行时模板编译（无静态提升）。
2. **D3：NavBar(fixed) 的 `top: 0` 未落到 overlay 顶部。**
   重建引擎后，hoisted Tabbar（bottom）正确贴底，hoisted NavBar 却与
   Tabbar 叠在屏幕底。`positionedChild` / `_AbsLayoutDelegate` 的 place()
   逻辑读起来正确（top=0 应返回 0），需要用 widget 测试定位实际样式记录
   与解析结果，再修根因。
3. **069 验收第 3 条被阻塞**：vant-feedback 加了垫底内容后页面可滚动，
   但 D1 使其无法打开——修复后才能实测「弹层打开时滚动页面，遮罩与弹层
   不动」。

## 2. 不做什么（Non-goals）

- **D2（vant Tabs 无 window 守卫抛 ReferenceError）**：第三方库内部问题，
  fjs 不给全局塞 window 假象（会翻转 vant 的 inBrowser 行为，影响面大）。
  vm.cpp 修复后该异常已按 console.error 上报且不再中断排空；下划线位置
  停在左侧作为登记过的差异记入 docs。
- **D4–D12（Sidebar/Swipe 溢出红条、NumberKeyboard 键排一行、Picker 列区、
  Card 行内流、Progress 填充、Empty 槽位、CSS keyframes）**：各自独立，
  不与本 spec 的 overlay 验收纠缠，后续按优先级另立。
- 真机 Teleport 语义、完整 sticky 定位等既定 Non-goals 沿袭 069。

## 3. 用户可见的行为

页面代码不变（vant 标准写法）。修复后：

```vue
<!-- vant-feedback.vue：静态子树 + 关闭态弹层共存，页面正常渲染 -->
<text class="page-note">命令式 Toast/Dialog 依赖 DOM，预期报错并显示在页面上。</text>
<van-popup v-model:show="showPopup" position="bottom" round>…</van-popup>

<!-- vant-nav.vue：NavBar(fixed) 钉在屏幕顶（safe-area 之下的 overlay 顶） -->
<van-nav-bar fixed title="固定顶栏" left-text="返回" right-text="按钮" left-arrow />
```

- App 端打开任一含静态子树 + 弹层的页面：内容完整渲染，debug 控制台无
  `TypeError: not a function at mountStaticNode`。
- 若未来手写 render 函数使用了 `createStaticVNode`：要么正常渲染
  （insertStaticContent 兜底实现），要么得到**指名道姓的报错**，不再是
  `not a function`（宪法 V：静默失效是 bug）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 静态 vnode | 构建期不产出（app 构建 hoistStatic:false）；renderer 兜底实现 `insertStaticContent` | 浏览器原生（vue runtime-dom 自带实现） |
| fixed 元素在 overlay 的锚定 | top:0 → overlay Stack 顶；bottom:0 → 底；由 positionedChild 统一解析 | `position: fixed` 相对 viewport |
| 已知差异 | NavBar(fixed) 挂根 Overlay 不经 safe-area 包裹，顶进状态栏区域（宿主安全区策略另立）；Tabs 下划线因 D2 停在最左 | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 预计都不涉及：hoistStatic 是编译选项；insertStaticContent 是 renderer
      options 内部实现；D3 若定位到 style 解析层，也只是解析行为修正。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`、`cd packages/flutter_fjs && flutter test`
   全绿；D1/D3 各带回归测试（构建产物断言 / widget 测试）。
2. iOS 模拟器（重建引擎后的构建）上逐屏对比 069 的五个 vant 页 +
   vant-more/vant-nav：全部正常渲染，无整页空白；console 无
   `mountStaticNode` / `not a function` 报错。
3. vant-feedback：打开 Popup → 滚动页面 → 遮罩与弹层钉在屏幕上不动；
   点遮罩关闭（069 验收第 3 条，本 spec 核心闭环）。
4. NavBar(fixed) 在 vant-nav 页显示于屏幕顶部（Tabbar 贴底不变）。
5. tabs+field 同页（临时二分页或恢复 van-search 后的 vant-nav）正常渲染，
   D1 不再复现；`docs/css-compat.md` 登记静态 vnode / Tabs 下划线差异。

## 7. 待澄清

无（已拍板 2026-09-19：范围 = D1 + D3 + 验收 3 + 新引擎上重对拍）。
