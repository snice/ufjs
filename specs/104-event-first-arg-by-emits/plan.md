# Plan: 事件首参按「web 组件是否 emit 该事件」判定

对应 spec：`./spec.md`（方案 A，用户 2026-09-24 拍板）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | web 是参照物、不改（`fjs-runtime/src/web/components/*.ts` 零改动）；只改 Flutter 路径的 Vue renderer（`fjs-runtime/src/vue/renderer.ts`），让它按 web 组件的 `emits` 交首参。漂移单测把两端锁在一起。本次不涉及 Dart（`packages/flutter_fjs/lib/src/` 零改动）：首参形状是 JS 渲染层的事，native 一直交字符串。 |
| II 边界即契约 | 否 | `ops.ts`/`ui_ops.dart`、`native-global.d.ts`/`natives.cpp`、`element.ts EventType`/`fjs.h` 三张表都不动。新增的 `event-emits.ts` 是 JS 内部表，不跨边界。 |
| III 同步单线程零序列化 | 否 | 只是 patchProp 时查一次 Set，不引入桥。 |
| IV 外观照 WeUI | 否 | 无外观变化。 |
| V 静默失效是 bug | 是 | 本 spec 修的就是一条静默两端偏差。防复发：漂移单测——web 组件 `emits` 与表不一致即失败，不再靠人记。 |
| VI 注释记录权衡 | 是 | `event-emits.ts` 顶部写清：为何按事件名而非标签判定（`onClick`/`onTap` 共用事件号 1）、为何大小写不敏感匹配（`onScrollToUpper` 等 Flutter 侧额外拼写）、为何 web 组件不从表导入（方案 A 取舍）。renderer 里 `payloadEventTags` 的注释改写。 |
| VII JS 能包就不要下 Dart | 是 | 完全在 JS 层完成，不下 Dart。 |
| VIII 变更落到文档 | 是 | `docs/ui-api.md` 的「首参形状（specs/103）」改为按事件判定的总则；`docs/roadmap.md` 登记 104。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动（`webIsNativeTag` 的标签判定照旧） |
| JS runtime | `packages/fjs-runtime/src/event-emits.ts`（新增） | `WEB_EMITS: Record<tag, readonly string[]>` 常量表 + `emitsFor(tag)`：返回该标签在 web 上 emit 的事件名小写 Set（无条目→空 Set） |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | `payloadEventTags: WeakSet` → `payloadEvents: WeakMap<HostNode, ReadonlySet<string>>`（仅 fjs 标签有条目）；`patchProp` 里用「作者写的 prop 名去掉 `on` 与修饰符后的小写」查表决定 `rawPayload`，其余逻辑（`once`、`textValues` 同步、`asDomEvent`）不变 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/*.ts` | **不动**（参照物） |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | — | 不动 |
| 测试 | `packages/fjs-runtime/test/event-emits.test.ts`（新增） | 漂移测试：遍历 `web/components/index.ts` 的 `fjsComponents`，每个组件的 `emits` 与 `WEB_EMITS[tag] ?? []` 相等；表里每个 key 都在 `fjsComponents` 里 |
| 测试 | `packages/fjs-runtime/test/flutter-event-payload.test.ts` | 追加：`view`/`button`/`image` 上 `withModifiers(fn,['stop'])` 的 `onClick` 调到 fn 不抛错；`view` `onClick` 首参含 `target`/`clientX`；`view` `onTap` 首参为 null；`onLongPress`（大小写）、`onScrollToUpper`（Flutter 额外拼写）走裸载荷 |
| 文档 | `docs/ui-api.md`、`docs/roadmap.md` | 见 VIII |

表内容（从 web 组件实测导出，2026-09-24）：`view`/`text`/`button`/`swiper-item`/`safe-area`/`label`/`sticky-section` = tap, longPress；`image` +load, error；`inner-canvas` +resize；`canvas` resize；`input` input, submit, textChanged, focus, blur, linechange；`textarea` input, textChanged, confirm, focus, blur, linechange；`scroll-view` tap, longPress, scroll, scrolltoupper, scrolltolower；`list-view` scroll, tap, longPress；`swiper` pageChanged, change；`switch`/`checkbox`/`radio`/`radio-group`/`checkbox-group`/`slider`/`picker-view` change, valueChanged；`form` submit, reset；`picker` change, cancel, columnchange；`modal` modalClosed；`page-container` 7 个过渡事件 + clickoverlay；`refresh` refresh；`sticky-header` tap, longPress, stickontopchange。无 emits：`divider`、`progress`、`picker-view-column`、`rich-text`，以及 web 没有组件的 `stack`。

## 3. 方案

**匹配规则**：handler 键 = `parseEventName` 去掉修饰符后的 prop 名（`onClick` / `onLongPress`），去掉 `on` 前缀后**小写**，与该标签 web emits 的小写集合比。
- 命中 → 裸载荷（同 103）；未命中或非 fjs 标签 → `asDomEvent` 事件对象；touch 系对象载荷两条路都原样直传（`asDomEvent` 本身就放行对象）。
- 用作者的 prop 名而不是 `aliasEvent` 后的原生名：`onClick` 与 `onTap` 都变成 `onTap`（事件号 1），别名之后就分不开了。
- 小写匹配：Vue 对 `emit('scrolltoupper')` 只认 `onScrolltoupper`，但 Flutter 的 `EventType` 还收 `onScrollToUpper`/`onLineChange` 这类拼写，103 下它们是裸载荷；小写比较让它们保持原样，不引入新的行为变化。代价是区分不出只差大小写的两个事件名——现有 emits 里没有这种情况，漂移测试会原样比对 web 列表。

**被否掉的备选**：
- B：web 组件 `emits` 改为从表导入。单一事实源，但要改十几个 web 组件文件，而 web 是本次的参照物——参照物跟着改，回归风险反而落到 web 上。用户选 A。
- C：只硬编码 `onClick`（及 `onDblclick` 等）总交事件对象。改动最小，但以后组件增减 emit 时会再次静默偏离（违反 V）。
- D：回到 103 之前「全部交事件对象」。会让 103 修好的 `JSON.parse(payload)` 页面再次全挂。
- E：在 `asDomEvent` 对象上补 `stopPropagation` 之外、让裸载荷也「可 stop」（比如把字符串包成 String 对象）。会破坏 `typeof payload === 'string'` 判定（`components/list-view.ts`），否。

## 4. 风险

- **vant 在 fjs 标签上绑 `onClick` 的地方**：103 之后它们拿裸载荷，104 之后拿事件对象——回到 103 之前（已在设备验收过的）形状，属于修复方向；`demo/vite/vant.ts` 的 Field/Stepper 补丁针对的是 `onInput`（在 input emits 里，仍是裸载荷），不受影响。
- **内部组件**：`components/picker.ts` 在 `view` 上绑 `onTap`（在 emits 里，裸载荷不变）；`components/form.ts` 直接 `setProps` 走 element API，不经 patchProp，不受影响。
- **`stack`** 仍在 `tags.json` 但 `docs/ui-api.md:910` 说已删除、web 无组件：本 spec 把它当「无 emits」处理（事件对象），与 web 的自定义元素表现一致；清理 tags.json 另开 spec。
- **无法在本环境真机验证**：没有 Flutter SDK，设备观测（spec 验收 5）记为待验。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime exec vitest run test/event-emits.test.ts test/flutter-event-payload.test.ts
pnpm test
pnpm run typecheck
pnpm --filter demo run typecheck
pnpm --filter hello-fjs run typecheck
# 设备（有 Flutter 时）：pnpm --filter hello-fjs run run:android，点带 @click 的页面 + 图片页
```
