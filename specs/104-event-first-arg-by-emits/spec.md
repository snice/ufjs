# Spec: 事件首参按「web 组件是否 emit 该事件」判定——修 103 的 `@click.stop` 回归

- **ID**: 104-event-first-arg-by-emits
- **状态**: ready
- **日期**: 2026-09-24
- **来源**: 近 3 天代码 review。specs/103 之后，Flutter 端 `<view @click.stop>`、
  `<button @click.prevent>` 直接抛 `TypeError: Cannot read properties of
  undefined (reading 'stopPropagation')`，handler 不执行；web 端同一模板正常。

## 1. 要解决什么

### 现象（renderer 单测复现，无需设备）

```ts
h('view',   { onClick: withModifiers(fn, ['stop']) })  // Flutter: TypeError，fn 未调用
h('button', { onClick: withModifiers(fn, ['stop']) })  // Flutter: TypeError，fn 未调用
h('div',    { onClick: withModifiers(fn, ['stop']) })  // Flutter: 正常
```

`@click.stop` / `.prevent` / `.self` / 按键修饰符，以及任何读
`e.target` / `e.clientX` 的 `@click` handler，只要绑在 fjs 标签上，
在 Flutter 端都会坏。这类写法在 103 之前能正常工作（当时所有事件都交事件对象）。

### 根因

specs/103 按**标签**判定首参形状：fjs 标签 → 裸载荷，非 fjs 标签 → 事件对象
（`packages/fjs-runtime/src/vue/renderer.ts` 的 `payloadEventTags`）。

但 web 端（参照物）实际是按**事件**区分的：fjs 标签在 web 上是 Vue 组件，
- 组件 `emits` 里声明的事件（`tap`、`longPress`、`load`、`error`、`input`、
  `change`、`scroll`……）交组件 emit 的**裸载荷**；
- 没声明的事件（`click`，以及 `touch*` 等）作为 fallthrough attr 经
  `hostAttrs(attrs)` 落到根 DOM 元素上，handler 拿到的是**原生 DOM 事件**。

例：`web/components/gestures.ts` 的 `container()`（`view` / `safe-area` /
`swiper-item`）与 `FjsButton` 都只 `emits: ['tap', 'longPress']`，所以 web 上
`<view @click>` 拿到 `MouseEvent`，`<view @tap>` 拿到无参。

Flutter 端 `HTML_EVENT_ALIASES` 把 `onClick` 映射到原生 `onTap`，两者共用
事件号 1——所以**区分依据只能是作者写下的 prop 名**，不能是原生事件号，
也不能只是标签。

## 2. 不做什么（Non-goals）

- **不改 native 边界**：`ops.ts` / `natives` / `EventType` 三张表零变更。
- **不改 web 端**：web 是参照物，组件的 `emits` 与透传行为一行不动。
- **不回退 103 已修好的部分**：`<image @load>` 仍是裸 JSON 串，
  `<input @input>` 仍是文本，`<div @click>` 仍是事件对象，demo 的 vant
  补丁（`demo/vite/vant.ts` 的 Field / Stepper）保持原样。
- **不修 `@tap.stop`**：web 上 `emit('tap')` 无参，`withModifiers` 两端一样抛错，
  属于「两端一致但不可用」，登记为已知限制，不在本 spec 修。
- **不处理 fjs 与 HTML 标签重名的根问题**（`input` / `button` / `textarea` /
  `form`，第三方库需打补丁），那是更大的命名空间设计，另开 spec。
- 不改 `asDomEvent` 的对象形状（`detail` 为载荷而非 click 次数等既有差异照旧）。

## 3. 用户可见的行为

页面代码不改，两端行为一致：

```vue
<!-- 1. 修饰符在 fjs 标签上可用（当前 Flutter 抛错） -->
<view @click.stop="open">…</view>
<button @click.prevent="save">保存</button>

<!-- 2. @click 拿到事件对象，与 web 的 MouseEvent 同样可读 target / clientX -->
<view @click="(e) => log(e.clientX, e.target)" />

<!-- 3. emit 事件保持裸载荷（103 的修复不回退） -->
<view @tap="onTap" />                                  <!-- 无参 -->
<image @load="(p) => size = JSON.parse(p)" />          <!-- 字符串 -->
<input @input="(v) => text = v" />                     <!-- 字符串 -->
<switch @change="(v) => on = v" />                     <!-- 载荷 -->
```

## 4. 两端约定（宪法 I）

**总则**：首参形状由「raw 标签 + 作者写下的事件名」决定，以 web 组件的
`emits` 为唯一依据。

| 情形 | Web（参照，现状） | Flutter（修复后） |
|---|---|---|
| fjs 标签 + 事件在该组件 web `emits` 中（`@tap` / `@load` / `@input` / `@change` / `@scroll`…） | 组件 emit 的裸载荷 | 裸载荷（同 103） |
| fjs 标签 + 事件**不在** `emits` 中（`@click` 等 fallthrough） | 根元素的原生 DOM 事件 | `asDomEvent` 事件对象（**本 spec 修正**） |
| 非 fjs 标签（vant 的 `div` 等） | 原生 DOM 事件 | `asDomEvent` 事件对象（同 103） |
| touch 系（载荷本来就是对象） | 对象 | 对象原样直传（不变） |

- 事件载荷跨边界仍是字符串（宪法 II v1 ABI）。
- **已知差异（沿用）**：Flutter 事件对象的 `detail` 是载荷，web `MouseEvent.detail`
  是点击次数；`target` 是 fjs element 而非 DOM 节点。
- **已知限制**：`@tap.stop` 两端都不可用（见 Non-goals）。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

会新增一张 **JS 侧内部表**：每个 fjs 标签在 web 上 emit 哪些事件（Flutter
renderer 读它），并用单测把它与 web 组件实际的 `emits` 锁在一起，防止漂移。
表的具体形式见待澄清。

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过，其中：
   - 新增 renderer 单测：`view` / `button` / `image` 上
     `onClick: withModifiers(fn, ['stop'])` 派发 tap 后 `fn` 被调用一次、不抛错；
     `view` 上 `onClick` 首参含 `target` / `clientX` / `stopPropagation`；
   - `view` 上 `onTap` 首参为 `undefined`/`null`（无参，与 web `emit('tap')` 一致）；
   - specs/103 的 `test/flutter-event-payload.test.ts` 原样通过
     （`image @load` 裸串、`div @click` 事件对象、`.once` 单次）；
   - 漂移测试：对 `web/components/index.ts` 的 `fjsComponents` 每个组件，
     其 `emits` 与 Flutter 使用的表逐标签相等；任何一边增删事件而不同步即失败。
3. `pnpm --filter demo run typecheck` 与 `pnpm --filter hello-fjs run typecheck` 通过。
4. `docs/ui-api.md` 的「首参形状（specs/103）」一段按本 spec 的总则改写，
   `docs/roadmap.md` 登记（宪法 VIII）。
5. 设备观测（有模拟器时执行；本环境无 Flutter，记录为待验）：hello-fjs 任一
   含 `<view @click>` 的页面点击正常；图片页 mode 面板与 load/error 面板正常
   （103 不回退）。

## 7. 待澄清

- [x] **「web emits 表」放在哪、怎么保持同步？** → 用户选 **A**（2026-09-24）。
  - A（推荐）：新增 `packages/fjs-runtime/src/event-emits.ts`，导出
    `tag → 事件名[]` 的常量表，Flutter renderer 读它；web 组件**不改**，
    由漂移单测保证两者一致。改动面最小，也不碰 web。
  - B：web 组件的 `emits` 改为从同一张表导入（单一事实源、无需漂移测试），
    但要改十几个 web 组件文件。
  - C：只把 `onClick`（及 `onDblclick` 等 DOM 专有拼写）硬编码为「总交事件对象」，
    不建表。最省事，但以后组件新增/删减 emit 时会再次静默漂移。
