# Spec: vant 页首开挂载提速（元素层削分配 + 首屏优先分片挂载）

- **ID**: 118-vant-mount-speedup
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

demo 的 vant 页（specs/068–073）在 086 之后，模拟器上 `[nav] mounted` 仍是
vant-basic 40 / vant-more 62 / vant-nav 55 / **vant-form 91–98 ms**，push 转场第
一拍仍会顿。目标是 vant-form 首开降到 **~35 ms（模拟器）量级**。

`docs/vant-mount-perf.md`「086 之后还剩什么」一节的离线拆账（fjsrun + PrimJS，
容器 CPU ≈ 模拟器 2× 慢）给出剩下的钱：

| vant-form（346 元素） | 首开 | 重开 |
|---|---:|---:|
| 合计 | 200–237 ms | 106 ms |
| CSS 重算 + 标脏 | 84–96 ms | 35 ms |
| Vue 本身（空渲染器） | ~37 ms | ~34 ms |
| fjs renderer + element API + op 编码 | ~80 ms | ~37 ms |

以及三个具体现象：

1. **element 层每节点分配过多**：`makeElement`（`ui/element.ts`）每个节点新建
   9 个方法闭包 + 2 次 `defineProperty`；`OpWriter.create` 每次重编码标签名
   （`utf8Encode("view")` 2.3 µs）；`setProps` / `setText` 每次先编码成临时
   `Uint8Array` 再拷进帧缓冲；每个 v-if 锚点把同一份 `ANCHOR_STYLE`
   重新 `JSON.stringify`。单价：`create()` 12.1 µs、`setProps` 一个布尔 14.3 µs、
   锚点 19.6 µs。原型（未提交）已验证前三项把 `create()` 压到 2.7 µs、挂载期
   renderer ops −33%。
2. **标脏重复走**：Vue 自底向上挂载，每次 `insert` 子树根都
   `styleEngine.recomputeSubtree`，同一个新节点被祖先链上每一次插入重走一遍
   （vant-form 标脏 ~6 ms）。
3. **卸载一个 vant-form 要 ~27 ms**（`nodeOps.remove` 一次调用），返回上一页
   那一拍的来源。

即使 1–3 全部到位，每节点单价仍约 150 µs（模拟器），346 个节点一次挂完到不了
目标——**必须让首帧少挂节点**：首屏先出，屏外内容转场结束后再挂。

## 2. 不做什么（Non-goals）

- **不做 IFR / 构建期首帧快照**（节点 id 对齐的水合协议，另立 spec）。
- **不升级 Vue 3.6、不接 Vapor**：已实测热态零收益，Vapor 无自定义渲染器入口
  （见 vant-mount-perf.md）。
- **不做样式匹配缓存落盘**（冷态 CSS 多出的那段），见待澄清 Q3。
- 不改 CSS 引擎的匹配 / 级联语义；match miss 数（vant-form 275）是回归哨，
  不许变。
- 不改 vant 源码，不按页面拆 vant 样式注册。
- 不动 Dart 侧 widget build / layout（086 已把同步 layout 移出 navMount）。

## 3. 用户可见的行为

**element 层、标脏、卸载三项对页面代码零可见变化**：同样的模板、同样的 op 帧
语义、同样的 `el.style` / `el.offsetWidth` / `addEventListener` / `focus()` 等
DOM 形状接口（`Element` 上现有成员一个不少，只是从实例挪到原型）。

**首屏优先**：新增一个内置组件 `<defer>`，包住屏外内容：

```vue
<template>
  <view class="page">
    <van-cell-group title="基础">…首屏可见的部分，照常同步挂载…</van-cell-group>
    <defer>
      <van-cell-group title="更多">…屏外内容，页面转场结束后才挂载…</van-cell-group>
    </defer>
  </view>
</template>
```

- 首次渲染时 `<defer>` 只挂一个空占位，`onPageSettled`（两端已有，见
  `router/flutter.ts` / `router/settled.ts`）触发后再挂 slot 内容。
- 页面不在转场中（已在屏上、或没有转场）时，下一个微任务就挂——行为退化为
  「稍晚一拍的同步挂载」，不会永久不显示。
- 可选 `placeholder-height`给占位一个高度，避免屏外内容补上时滚动
  条跳动；不给就是 0 高。
- demo 的 vant-form / vant-more / vant-nav / vant-basic 用 `<defer>` 包住首屏以下
  的分组，作为这个能力的回归样板。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| element 层 / 标脏 / 卸载 | 内部提速，行为不变 | 不涉及（web 走 DOM 适配层，不经 `ui/element.ts`） |
| `<defer>` 行为 | 占位 → `onPageSettled` 后挂 slot | 同左（web 的 `onPageSettled` 由 `router/settled.ts` 驱动） |
| 事件载荷 | 无新事件 | 无新事件 |
| 小程序 | `<defer>` 编译成直接渲染 slot（skyline 本身按需构建，没有这笔账） | |
| 已知差异 | 无（两端都是转场后补挂） | |

`<defer>` 是纯 JS 组件（宪法 VII）：放 `fjs-runtime/src/components/`，进
`component-tags.json` / `FLUTTER_COMPONENT_TAGS`，不下 Dart。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——**默认不改**。常量 props 预编码
      走「缓存 JSON 字节」而不是新 op；若 plan 阶段实测需要给布尔标记开二进制
      op，再回到这里勾选并两端同改。
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及（按默认方案）

文档（宪法 VIII）：`docs/ui-api.md` 登记 `<defer>`；`docs/miniprogram.md` 映射表
加一行；`docs/vant-mount-perf.md` 追加本 spec 的实测表；`component-tags.json`
改动后要重新 `pnpm --filter @ufjs/cli run build`（AGENTS.md §4.6）。

## 6. 验收标准

1. `pnpm run typecheck` 通过；`pnpm test` 通过（含新增用例：`Element` 原型上
   成员齐全且 `this` 绑定正确、ASCII / 非 ASCII / 代理对字符串编码结果与
   `utf8Encode` 逐字节一致、锚点预编码帧与原帧逐字节一致、`<defer>` 在
   settled 前只出占位 / settled 后出内容 / 页面转场前卸载不挂内容）。
2. **离线挂载基准入库**：`demo/bench/mount.ts` + `pnpm --filter demo run bench:mount`
   （构建后用 `fjsrun` 跑），输出每页冷/热的合计、CSS、标脏、match miss、
   renderer ops 分账。
3. 同机 A/B（本 spec 前后各跑 3 轮交替，取 min），**不含 `<defer>`**：
   - vant-form 挂载期 renderer ops（CSS 之外的元素层）≥ −40%；
   - 标脏 markMs ≥ −50%；
   - 卸载 vant-form ≤ 10 ms（现 ~27 ms）；
   - 五页 match miss 数与改前逐页相等（275 / 276 / 185 …，语义哨）。
4. 同一基准**含 `<defer>`**（只量同步挂载那一段）：vant-form 首开合计相对改前
   ≤ 40%（容器口径；对应模拟器 ~35 ms）。
5. 模拟器复核（需要 Flutter 的机器，本容器跑不了）：`fjs run ios`，按
   vant-mount-perf.md 附录流程，vant-form `[nav] mounted` 落在 ~35 ms 量级；
   转场结束后屏外分组出现，滚到底内容完整。
6. `pnpm --filter demo run build:release` 与 `build:pages` 成功；
   `fjs dev --web` 下 vant-form 同样先首屏、后补齐。
7. `examples/bench` 的 `style-mount-1000-rows` / 切主题用例无回退（±5%）。

## 7. 待澄清

已于 2026-09-24 由用户拍板：

- [x] **Q1 API 形状**：内置标签 `<defer>`（进 `component-tags.json`，小程序编译成
      直接渲染 slot）；占位高度属性 `placeholder-height`。
- [x] **Q2 补挂时机**：`onPageSettled`（转场结束后）。不提供「下一帧」开关。
- [x] **Q3 冷态 CSS**：不纳入，另立 spec。
- [x] **Q4 验收口径**：离线基准为主验收；模拟器 `[nav] mounted`（验收 5）由用户
      在有 Flutter 的机器上复核。
