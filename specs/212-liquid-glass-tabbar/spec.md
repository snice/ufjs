# Spec: tabbar liquid glass 风格（@ufjs/liquidglass 模块 + 风格切换）

- **ID**: 212-liquid-glass-tabbar
- **状态**: done
- **日期**: 2026-10-08

> 与 specs/210-global-tabbar 的关系：210 未勾项（T024 深色目测、T070–T073
> safe-area scale）与本需求无关，本 spec 不接续它们；但依赖它的产物——全局
> tabBar 挂载机制（`createFjsApp({ tabBar })`）与 hello-fjs 的 `TabBar.vue`。

## 1. 要解决什么

1. hello-fjs 的 tabbar 只有一种外观：半透明纯色胶囊（210）。Web 端有
   `backdrop-filter` 毛玻璃，**App 端没有任何模糊**（`docs/css-compat.md`
   登记 `filter` / `backdrop-filter` ❌），所以两端观感差距明显，更谈不上
   iOS 26 的 Liquid Glass（折射、高光边、按下果冻形变）。
2. 想换 tabbar 风格只能直接改 `TabBar.vue`，没有"风格"这个概念，也没有
   运行时切换；未来再加风格会继续堆在同一个文件里。
3. 玻璃效果需要原生渲染能力（Flutter 着色器 / BackdropFilter），不是
   页面里一个组件能表达的，需要一个可复用、可 `npm i` 的模块承载。

## 2. 不做什么（Non-goals）

- 不改 `createFjsApp({ tabBar })` 的契约、不动 210 的挂载/可见性逻辑。
- 不新增内置标签、不动 tags.json / op 协议 / natives / 事件表（宪法 II）；
  玻璃面通过**模块 widget** 注册（`ComponentRegistry`），与 iconmind 同路径。
- 不做完整的 Liquid Glass 组件库（switch / slider / 菜单 / toast 等）。本期
  只交付**玻璃面**原语 + tabbar 用到的部分；其余组件留给后续 spec。
- 不做 mp 端玻璃：小程序维持原生 tabBar（210 已定，选项忽略），本模块不声明
  `mp` 组件，并在 `docs/miniprogram.md` 登记。
- 不做"跟随系统自动切换风格"；风格是应用显式选择。

## 3. 用户可见的行为

### 3.1 新模块 `@ufjs/liquidglass`（`packages/fjs-liquidglass`）

结构照 `fjs-iconmind`：`index.ts` + `components/` + `flutter/` + `fjs`
清单（`widgets` 声明 + `flutter.register`）。对外提供：

**a. 玻璃层 widget 标签 `<glass-surface>`**（叶子元素：只画一块玻璃，不排版子节点；
用法是 `position:absolute` 铺满容器、内容作为它的兄弟节点画在上面——实现期发现
ComponentRegistry builder 拿不到 CSS flex 方向，做成容器会丢掉 `flex-direction: row`）

```vue
<view class="capsule">  <!-- flex-direction: row; border-radius: 26px -->
  <glass-surface class="glass" :radius="26" :blur="20" :refraction="0.6" />
  <!-- .glass { position:absolute; left:0; top:0; right:0; bottom:0 } -->
  <view class="item">…</view>  <!-- 内容是兄弟节点，画在玻璃之上 -->
</view>
```

| prop | 类型 | 含义 |
|---|---|---|
| `radius` | number | 圆角（px），缺省 0 |
| `blur` | number | 背景模糊半径（px），缺省 20 |
| `tint` | string | 玻璃底色（rgba/hex），缺省随明暗给半透明白/黑 |
| `refraction` | number 0–1 | 边缘折射强度；0 = 纯毛玻璃（降级形态） |
| `dark` | boolean | 明暗外观；缺省跟随主题 |
| `pressed` | boolean | 按下态（果冻形变/加亮），由页面驱动 |

**b. 风格化 tabbar 组件 `GlassTabBar`**（全局注册，不用 import）

props 与 210 注入的一致（`tabs` / `active`），外加 `items`（图标 + 文案 +
path），内部用 `<glass-surface>` 做胶囊底，选中项下方滑动的"玻璃滑块"
（indicator）跟随 `active` 动画。切 tab 仍用 `router.replace`。

**c. 风格注册表（"风格可切换，将来可扩展"）**

```ts
import { tabBarStyles, registerTabBarStyle } from '@ufjs/liquidglass';
// 内置：'liquid-glass'；hello-fjs 自带 'classic'（现有 TabBar.vue 外观）
registerTabBarStyle('my-style', MyTabBar);   // 未来风格同一入口
```

约定：一个风格 = 一个满足 210 `TabBar` props 契约的 Vue 组件。注册表只做
`name → Component` 与默认值，不引入新的运行时机制。

### 3.2 hello-fjs 接入与切换

- `TabBar.vue` 改为风格分发器：按当前风格渲染 `classic`（现有外观，原样保留）
  或 `liquid-glass`；`main.ts` 的 `tabBar: { component: TabBar }` 不变。
- 风格存在 `useTheme` 同级的应用状态里（`theme.ts` 旁），**持久化**到本地
  存储，重启保持。
- 切换入口：「关于」页（或设置区）加一个风格选择（分段控件 `classic` /
  `liquid glass`），切换**即时生效**、不重启、不重建页面树。
- 默认风格：见 §7 待澄清。

### 3.3 视觉目标（liquid-glass 风格）

胶囊悬浮在内容之上，内容从下方透出并被**模糊 + 折射**；顶部/边缘有细高光
描边；选中项有一块更亮的玻璃滑块，切换时弹簧滑动；按下时滑块轻微放大
（果冻感）。深色/浅色两套参数。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 玻璃面 | Dart widget：`BackdropFilter(blur)` + 描边高光 + 可选折射着色器（`refraction>0` 且平台支持时），降级为纯毛玻璃 | Vue 替身（`widgets.glass-surface.web`）：`backdrop-filter: blur() saturate()` + 高光描边；折射用 SVG `feDisplacementMap`（参考 gentpan/liquidglass，Chromium 有折射，Safari/Firefox 降级为毛玻璃） |
| 事件载荷 | `<glass-surface>` 是不响应事件的叶子层，不新增事件 | 同左 |
| 风格切换 | 纯 JS 状态；组件替换，bar 根不重挂 | 同左 |
| 已知差异 | 折射依赖着色器/Impeller；不支持时（如旧设备、web canvaskit 外）降级；与 web 的折射实现不同源，**取同一组参数**（blur/tint/radius），折射只保证"有无"，不保证像素一致 | Safari/Firefox 无折射 |

宪法 VII 自查：玻璃面需要 BackdropFilter/着色器，属"需要 Flutter 渲染能力"，
下 Dart 成立；tabbar 本身（状态、滑块动画、风格分发）全部在 JS 侧。
宪法 IV：classic 风格保持 WeUI 取值不动；liquid glass 是 iOS 26 风格化扩展，
不属于"内置组件默认外观"，不套 WeUI 数值。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及——走模块 widget（`ComponentRegistry`）+ 既有 prop/children
      通道，无新 op / native / 事件。需新增的仅：模块清单（`widgets`、
      `flutter`）、`docs/modules.md` 与 `docs/css-compat.md` 的差异登记。

## 6. 验收标准

1. `pnpm run typecheck` 全 workspace 通过（含新包）。
2. `pnpm test` 通过；新增 vitest：风格注册表（注册/取默认/未知名回退并
   warnOnce）、`GlassTabBar` 的 active→滑块位置计算。
3. `cd packages/fjs-liquidglass/flutter && flutter test`：widget 测试——
   `glass-surface` 渲染子节点、`blur`/`radius`/`dark` 变化重绘、
   `refraction=0` 不创建着色器路径。（先编 native，防止 `No tests ran`
   被误当通过。）
4. `fjs modules`（在 hello-fjs）列出 `@ufjs/liquidglass`，autolink 生效，
   `pnpm --filter hello-fjs run typecheck` 通过且 `<glass-surface>` 有类型提示。
5. `fjs dev --web`（hello-fjs）：关于页切换风格，tabbar 即时换为玻璃胶囊，
   滑块随 tab 滑动，深浅色各截一张图。
6. `fjs run ios`（模拟器）：同上；App 端有可见模糊（对比 classic 的纯色），
   切换风格不闪烁、不丢当前 tab。持久化：Web 刷新后保持；App 重启回默认
   （已知差异，通用 storage 模块另立 spec）。
7. `pnpm --filter hello-fjs run build:mp`：产物无本模块残留、不报错
   （mp 忽略）；`docs/miniprogram.md` 已登记。
8. 唯一新增依赖是 `liquid_glass_widgets`，仅限模块 Flutter 包；plan 写明理由，
   `flutter_fjs` 核心 pubspec 无改动。
9. 文档：`docs/modules.md`（范例补一条）、`docs/css-compat.md`（玻璃差异）、
   `docs/routing.md` tabbar 章节（风格化）、`packages/fjs-liquidglass/README.md`。

## 7. 待澄清

已拍板（2026-10-08，用户）：

- Flutter 折射走 **依赖 pub 包 `liquid_glass_widgets`**（着色器现成）。这是
  对"不新增依赖"规则的明示例外，理由：折射着色器自写成本高。代价需在 plan
  里落实：
  - 依赖只加在 `fjs-liquidglass/flutter/pubspec.yaml`，不进 flutter_fjs 核心；
  - 该包要求 Flutter ≥ 3.41 / `LiquidGlassWidgets.initialize()` 预热 /
    `wrap()` 包 App 根——plan 必须查清 `register(engine)` 里能否完成预热、
    `wrap` 如何接入 fjs 宿主（不改用户 main.dart 为佳）、与宿主现有 Flutter
    版本是否兼容；不可行则回到用户重新拍板，不自行降级。
  - §4 中"自写 BackdropFilter"一行相应改为：以 `liquid_glass_widgets` 的玻璃层
    承载，`refraction=0` 仍须能降级为纯毛玻璃。
- 默认风格：**liquid-glass**（classic 保留为可切换项）。
- 切换入口：**「关于」页分段控件**。
- 命名：`@ufjs/liquidglass`（`packages/fjs-liquidglass`）+ `<glass-surface>`。

plan 阶段调研已关（见 plan.md §0）：

- [x] `liquid_glass_widgets`（Flutter ≥3.41）与 hello-fjs 当前 Flutter 3.41.10
      兼容；`wrap()` 非必需，不侵入宿主。

plan 阶段新发现、待用户确认：

- [x] **持久化**（用户已同意，2026-10-08）：仓库无键值存储原语，App 端做不到"重启保持风格"。拟定 Web 用
      `localStorage`、App 本期内存态（重启回默认），验收 #6 相应放宽；通用
      storage 模块另立 spec。
