# Plan: vant 页首开挂载提速

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（`<defer>`） | 元素层 / 标脏 / 卸载三项只在 Flutter 路径（`ui/element.ts`、`ui/ops.ts`、`vue/renderer.ts`、`css/style.ts`），web 走 DOM 适配层不经过它们，无对侧。`<defer>`：Flutter 用 `components/defer.ts`（在 `app/flutter.ts` 注册），Web 用 `web/components/defer.ts`（进 `web/components/index.ts` 的 `fjsComponents`），同一个工厂、同样的 props、同样的时机（各自 router 的 `onPageSettled`）。小程序：`mp/wxml.ts` 把 `defer` 编译成透明 `<block>`（skyline 按需构建，不存在这笔账），在 `docs/miniprogram.md` 登记差异 |
| II 边界即契约 | 否 | op 协议不改：常量 props 预编码只是缓存同一段 JSON 字节，帧逐字节不变；ASCII 直写产生的字节与 `utf8Encode` 完全相同。natives 表、事件类型不动 |
| III 同步单线程零序列化 | 是 | 不引入异步桥。`<defer>` 的补挂由现有 `onPageSettled`（Dart 转场结束 → 事件）驱动，本身不新增任何跨边界调用 |
| IV 外观照 WeUI | 否 | 不改任何默认样式；`<defer>` 占位无外观（只有可选高度） |
| V 静默失效是 bug | 是 | `<defer>` 在页面转场前卸载时不补挂且不报错（已卸载是合法状态）；`placeholder-height` 非法值 `warnOnce` 后按 0 处理；小程序端 `placeholder-height` 被丢弃这一点写进差异表 |
| VI 注释记录权衡 | 是 | 原型化 Element、ASCII 直写、子树标脏 epoch、按节点记事件类型四处都写「为什么」+ 实测单价 |
| VII JS 能包就不要下 Dart | 是 | `<defer>` 纯 JS 组件，按 VII 的包法：`fjs-runtime/src/components/` + `component-tags.json`（→ `FLUTTER_COMPONENT_TAGS`）。全部改动不下 Dart |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`（`<defer>` 标签行）、`docs/miniprogram.md`（映射表一行 + 差异）、`docs/vant-mount-perf.md`（实测表）、`docs/performance.md`（元素层单价一节）、`docs/roadmap.md`（如有对应条目则勾选） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/mp/wxml.ts` | `defer` → `<block>`，丢弃 `placeholder-height` |
| CLI / 构建 | （无代码）`packages/fjs-runtime/src/component-tags.json` 被 `@ufjs/cli` dist 内联 | 改完 `pnpm --filter @ufjs/cli run build`（AGENTS.md §4.6） |
| JS runtime · op 编码 | `packages/fjs-runtime/src/ui/ops.ts` | `OpWriter`：标签字节缓存（`create`）；私有 `str()` 对 ASCII 直写帧缓冲、非 ASCII 回落 `utf8Encode`；`setText` / `setProps` 走 `str()`；新增 `setPropsJson(id, json)` 供预编码常量用 |
| JS runtime · element | `packages/fjs-runtime/src/ui/element.ts` | `makeElement` 改为 `Object.create(ELEMENT_PROTO)`，方法 / `style` / offset getter 全在原型上（`Element` 接口的 `id`/`tag` 类型保持 readonly，内部赋值用一次类型断言）；`setProps` 去掉 `Object.entries`（`for...in`）；新增 `setConstProps(el, props)`：按 props 对象身份缓存 JSON 串（WeakMap），只接受模块级常量；按节点记已注册事件类型（`Map<number, number[]>`），`forgetHandlers` 只删这些 |
| JS runtime · Vue renderer | `packages/fjs-runtime/src/vue/renderer.ts` | 锚点 `{style: ANCHOR_STYLE}`、`{htmlBlock: true}`、`{multiline: true}` 提成冻结常量走 `setConstProps` |
| JS runtime · CSS | `packages/fjs-runtime/src/css/style.ts` | `ElementState` 加 `subtreeEpoch`；`markDirty(id, true)` 遇到本 epoch 已整棵标过的子树根就不再下探；进入子树时给根打戳 |
| JS runtime · 组件 | `packages/fjs-runtime/src/components/defer.ts`（新） | `createDefer(onSettled, placeholderTag)` 工厂 + Flutter 实例 `FjsDefer`；ready 前渲染占位，ready 后渲染 `slots.default()`（Fragment，不留包裹层） |
| JS runtime · app | `packages/fjs-runtime/src/app/flutter.ts` | `app.component('defer', FjsDefer)` |
| JS runtime · tags | `packages/fjs-runtime/src/component-tags.json` | 加 `"defer"` |
| Web 适配层 | `packages/fjs-runtime/src/web/components/defer.ts`（新）、`web/components/index.ts` | 用同一工厂 + `router/web` 的 `onPageSettled` + `div` 占位；登记进 `fjsComponents` |
| 类型 | `packages/fjs-runtime/src/vue-global.d.ts`（若内置组件在此声明） | 加 `defer` 的 props 类型（plan 实现时 Grep 确认位置） |
| demo | `demo/src/pages/vant-{form,more,nav,basic}.vue` | 首屏以下分组包进 `<defer>` |
| demo · 基准 | `demo/bench/mount.ts`（新）、`demo/package.json` | 离线挂载基准 + `bench:mount` 脚本 |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | — | 不动 |
| 测试 | `packages/fjs-runtime/test/`（新增 `element-proto.test.ts`、`ops-ascii.test.ts`、`defer.test.ts`，在 `css-*.test.ts` 旁补标脏用例）、`packages/fjs/test/mp-compiler.test.ts` | 见 §5 |
| 文档 | `docs/ui-api.md`、`docs/miniprogram.md`、`docs/vant-mount-perf.md`、`docs/performance.md` | 见 VIII |

## 3. 方案

### 3.1 元素层削分配（ops.ts / element.ts / renderer.ts）

原型已验证（`create()` 12.1 → 2.7 µs，挂载期 renderer ops −33%）。在原型基础上：

- **Element 原型化**：`Object.create(ELEMENT_PROTO)` + 两个自有字段。TEXT 控件
  的 `value` 仍由 `installTextControlValue` 装在实例上（覆盖原型没有的成员，
  不冲突）；renderer `track()` 给实例挂的 `contains` 也挪到原型——它本来就是
  共享函数 `hostContains`，但 element.ts 不能 import renderer，所以改为
  renderer 在模块加载时 `Object.defineProperty(ELEMENT_PROTO…)` 不可行（跨层）
  → 保留 `track()` 里的实例赋值（一次属性写入，量级可忽略）。
- **ASCII 直写**：`str(s, wide)` 先扫一遍，全 ASCII 就按 `charCodeAt` 写进缓冲；
  任一字符 ≥ 0x80 回落 `utf8Encode`。比「总是编码」少一次分配 + 一次拷贝。
- **常量 props**：`setConstProps` 以 props 对象身份为键缓存 `JSON.stringify` 结果；
  写帧时 `setPropsJson` 直接 `str()`。devtools `recordProps` 照调。
- **按节点记事件类型**：`setProps` / `addDomListener` 注册时把 type 推进
  `nodeEventTypes.get(id)`；`forgetHandlers` 只遍历这个列表。
  没有注册过任何事件的节点（大多数）零字符串拼接。

**否掉的备选**：
- *事件注册表改嵌套 `Map<id, Map<type, fn>>`*：更彻底，但要改 dispatch 热路径和
  canvas 的 `nodeHandler`，收益和按节点记类型相同（卸载只差删除那一步），改动面更大。
- *给布尔标记开二进制 op*：动 op 协议（宪法 II 两端同改 + Dart 测试），而预编码
  已把重复序列化去掉，剩下的只有一次 `str()` 写入，不值得。
- *改 `EventType` 让 onTap/onClick 合并减少类型数*：只把 33 降一点，治标。

### 3.2 新子树标脏去重（style.ts）

Vue 自底向上挂载：`insert(C→P)` 走 C 的子树，`insert(P→GP)` 又走 P（含 C）……
同一节点被访问「深度」次。`markDirty(id, true)` 进入每个节点时若
`state.subtreeEpoch === dirtyEpoch` 就跳过它的孩子（本 epoch 已整棵入队），否则
打戳后继续。

正确性：同一 epoch 内（未 flush 之前）整棵已在 `dirtyList`；之后往这棵子树里插入
的新孩子会自己触发 `recomputeSubtree(child)`，不依赖祖先重走。flush 会 `dirtyEpoch++`，
戳自动失效。没有 state 的节点（锚点、未跟踪文本）无戳可打，照常下探。

**否掉的备选**：
- *挂载期间完全不标、mount 结束统一标整页*：要知道「挂载何时结束」，Vue 没有
  这个钩子给渲染器；且 vant 在 mount 中途读 rect 会触发 flush，那时样式必须已就绪。
- *超过半棵树就全标*：performance.md 已记录试过并回退（会把 park 住的页面拖进来）。

### 3.3 卸载

主因即 3.1 的 `forgetHandlers`（33 种类型 × 2 字符串键 × 每节点）。改完后若离线
基准卸载仍 > 10 ms，再看 `forgetSubtree` 里 `onceFired` 的前缀扫描（只在有 `.once`
时才走）与 `styleEngine.forget` 的 `releaseChain`。

### 3.4 `<defer>`

```ts
// components/defer.ts
export function createDefer(onSettled: (cb: () => void) => void, placeholderTag: string) {
  return defineComponent({
    name: 'FjsDefer',
    props: { placeholderHeight: { type: [Number, String], default: 0 } },
    setup(props, { slots }) {
      const ready = ref(false);
      let alive = true;
      onBeforeUnmount(() => { alive = false; });
      onSettled(() => { if (alive) ready.value = true; });
      return () => ready.value
        ? slots.default?.()
        : h(placeholderTag, { style: { height: px(props.placeholderHeight) } });
    },
  });
}
```

- ready 后渲染 slot 本身（Fragment），不留包裹元素：`.page > .van-cell-group`
  这类选择器、flex 布局前后一致。
- `onSettled` 在 setup 里调用，两端各自的实现都要求这点（Flutter 用 `inject(PAGE_KEY)`，
  web 用 `useRoute()`）；两端都保证至少异步一次、至多一次、已卸载不回调。
- Flutter 侧注册在 `app/flutter.ts`（和 `list-view`、`form` 同处）；页面级
  `createApp` 之外（手写 `createApp` 的离线基准）不自动注册——基准自己
  `app.component('defer', …)`。

**否掉的备选**：
- *用 `list-view` 包整页*：`list-view` 只做 Dart 侧的 widget 懒构建，JS 侧照样全量
  挂载，打不到这笔账；而且要求页面改成数据驱动。
- *Vue `<Suspense>` + 异步组件*：runtime-core 的 Suspense 在自定义渲染器下可用，但
  「等转场结束」不是 Promise 语义自带的，要包一层；且每个被推迟块要拆成独立组件文件，
  页面改动更大。
- *自动推迟（按 viewport 高度估算首屏）*：挂载前没有布局信息；估错会导致首屏空白，
  且是隐式行为（宪法 V）。

### 3.5 离线基准入库

`demo/bench/mount.ts`：从本会话临时脚本整理而来，输出每页冷/热
合计、CSS、标脏、match miss、「余数」（合计 − CSS − 标脏）、空渲染器 Vue 时间
（→ 元素层 ≈ 余数 − 空渲染器）、卸载耗时；同时跑一遍「含 `<defer>`（页面尚未 settle）」
即页面实际首帧那一段。`demo/package.json` 加
`"bench:mount": "fjs build bench/mount.ts --out dist/bench && ../packages/flutter_fjs/native/build-native/fjsrun --pump 50 dist/bench/app/bundle.js"`。

基准挂载时页面不在转场中 → `onPageSettled` 会在下一个微任务触发。为量「首帧」那一段，
计时窗口只包 `app.mount()` 的同步部分（微任务之前），这正是 navMount 里用户等的那一段。

## 4. 风险

- **Element 原型化**：任何对元素做 `Object.keys` / 展开 / `hasOwnProperty('style')`
  的代码会看到不同的结果。实现前 Grep `\.\.\.el\b`、`Object.keys(el`、`hasOwnProperty`
  于 `fjs-runtime/src` 与 `demo`、`examples`；vant 的 `useRect` 走
  `getBoundingClientRect`（原型方法，行为不变）。
- **ASCII 直写**：必须与 `utf8Encode` 字节一致——测试覆盖 ASCII / 2 字节 / 3 字节 /
  代理对 / 孤立代理（`drawableText` 之后的字符串）。
- **标脏去重**：若某路径在同 epoch 内先整棵标了子树、又**不经 insert** 挂上新孩子，
  会漏标。所有挂孩子的路径都经 `nodeOps.insert` → `recomputeSubtree(child)`；
  `ensureOverlayHost`/pseudo box 走 element 层 `insert`，不进样式引擎，不受影响。
  回归哨：五页 match miss 数不变 + `css*.test.ts` 全绿 + 新增「移动已挂子树后样式正确」用例。
- **`<defer>` 的 web 端**：web 的 `onPageSettled` 依赖 `useRoute()`；在页面组件树外
  用会退化到当前路由，行为可接受（与 canvas 相同）。
- **`component-tags.json` 内联**：忘记重建 `@ufjs/cli` 会让 `fjs dev` 把 `defer` 当元素，
  页面空白（specs/065 的坑）。验证路径里强制重建。
- 离线基准数字是容器 / fjsrun 口径，模拟器复核由用户做（spec Q4）。

## 5. 验证路径

```bash
cd /home/user/ufjs
pnpm run typecheck
pnpm test
pnpm --filter @ufjs/cli run build            # component-tags.json 被内联
pnpm --filter demo run typecheck
pnpm --filter demo run build:release
pnpm --filter demo run build:pages
pnpm --filter demo run build:web
# 离线基准：改前（git stash）/ 改后交替 3 轮
(cd packages/flutter_fjs/native && cmake --build build-native -j)
pnpm --filter demo run bench:mount
# examples/bench 无回退
cd examples/bench && pnpm run build && ../../packages/flutter_fjs/native/build-native/fjsrun --pump 8000 dist/app/bundle.js
```

模拟器（用户复核）：`cd demo && pnpm exec fjs run ios`，按 vant-mount-perf.md 附录读
`[nav] mounted`。
