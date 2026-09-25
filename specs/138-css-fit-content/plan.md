# Plan: `width: fit-content`（App 端）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Web：浏览器原生 `fit-content`，零改动（`web/css-compat.ts` 不需改写，`-webkit-` 前缀由 parser 统一剥离）。Flutter：`render/style.dart` 认关键字 + `render/flex.dart` 两条布局路径。行为差异（row 子项、min/max-content）登记 css-compat |
| II 边界即契约 | 否 | `width` 仍是字符串值，op 协议 / natives / 事件表不动 |
| III 同步单线程零序列化 | 否 | 纯 Dart 布局 |
| IV 外观照 WeUI | 否 | 布局能力，不改默认外观 |
| V 静默失效是 bug | 是 | 现状就是静默失效。改后：`min-content` / `max-content`（任一尺寸属性）、`fit-content` 用在 `min-width`/`max-width`/row flex 子项的 `width` 上 → Dart `fjsWarnOnce`；`fjs lint` 静态报告同一组 |
| VI 注释记录权衡 | 是 | 定位盒为什么是"松约束 + FjsShrinkCross"而不是量 intrinsic width；在流内为什么复用 inline-block 的收缩路径 |
| VII JS 能包就不要下 Dart | 是（必须下 Dart） | 这是布局算法本身（shrink-to-fit 需要子树的内容宽），JS 侧拿不到布局结果；Flutter 布局能力正是判据里"需要 Flutter 的渲染/布局能力"的情形 |
| VIII 变更落到文档 | 是 | `docs/css-compat.md`（盒模型表 + §6 差异）、`docs/vant-adaptation.md`（删 specs/137 登记的 Toast 宽度差异）、`docs/roadmap.md` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI（lint） | `packages/fjs/src/commands/lint.ts` | 报告不支持的尺寸关键字（同一组规则） |
| JS runtime（支持表） | `packages/fjs-runtime/src/css/support.ts` | `UNSUPPORTED_SIZE_KEYWORDS = {min-content, max-content}` + fit-content 只在 `width` 上有效的说明 |
| JS 测试 | `packages/fjs-runtime/test/css-support.test.ts` | 值级集合断言 |
| Dart 样式 | `packages/flutter_fjs/lib/src/render/style.dart` | `bool get widthFitContent`（`fit-content` / `-webkit-fit-content`）；尺寸属性上的 `min-content`/`max-content`/非 width 的 `fit-content` → `fjsWarnOnce` |
| Dart 布局（定位盒） | `packages/flutter_fjs/lib/src/render/flex.dart` `positionedChild` / `_AbsGeometry` / `_AbsLayoutDelegate` | `fitX`：两侧 inset 都在、无显式宽 → 约束 `0..(box - l - r)`，子盒套 `FjsShrinkCross`；位置沿用 auto margin 居中分支（`auto && trail != null`），否则贴 left；`needsLayoutSize` 纳入 fitX |
| Dart 布局（在流内） | `packages/flutter_fjs/lib/src/render/flex.dart` `_flexChild` | column 父（cross = 宽）：`widthFitContent` 并入 `shrinkBox`（Align 放松 + FjsShrinkCross，`margin: 0 auto` 走已有 crossAuto 居中）；row 父：`fjsWarnOnce` 按 auto |
| Dart 测试 | `packages/flutter_fjs/test/fit_content_test.dart`（新） | spec §6.1 的四个 widget 用例 |
| demo | `demo/src/pages/vant-feedback.vue` | 加"居中 Popup（短内容）"对拍按钮 |
| Web 适配层 | — | 不涉及 |
| C++ 引擎 | — | 不涉及 |
| 文档 | `docs/css-compat.md`、`docs/vant-adaptation.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

**定位盒**：CSS 10.3.7，`left`+`right` 已定、`width` 为 fit-content 时宽度 =
min(max(min-content, available), max-content)，再用 auto margin 分剩余空间。在 Flutter
里等价于：给子盒松约束（上限 = 可用宽），让它按内容自己定宽（文字到可用宽才折行，
正好是 min(max-content, available)），然后按已有规则摆放。

- `_AbsLayoutDelegate.getConstraintsForChild`：`g.fitX && _l != null && _r != null && _w == null`
  → `minWidth: 0, maxWidth: box - l - r`；
- `getPositionForChild` 不用改：`place()` 的 `auto && trail != null` 分支本来就按
  子盒实际宽度居中；
- 子盒外套 `FjsShrinkCross`：fjs 的 view 是 stretch 的 flex column，松约束下 Flutter 的
  stretch 会把它撑到上限；marker 让 `FjsShrinkStretchFlex` 走"先量最宽子项再 stretch"的两遍布局
  （nowrap 定位盒已经这么用）；
- `min-width` / `max-width` 在子盒自身的约束盒里生效（已有），与 shrink 结果自然 clamp。

**在流内（column）**：fit-content 在块流里就是 shrink-to-fit，与 `display: inline-block`
在 column 里的待遇相同（`shrinkBox`：Align 放松父的紧 cross 约束 + FjsShrinkCross）。
`margin: 0 auto` 走同一路径的 `crossAuto` 居中。

**被否掉的备选**：

- *量 intrinsic width（`getMaxIntrinsicWidth`）再给紧约束*：fjs 的节点树里有
  LayoutBuilder（百分比、flex 包装），intrinsic 查询穿不过 LayoutBuilder（Flutter 直接断言）；
  松约束 + 两遍 flex 是现成、已被 nowrap/inline-block 验证过的路径。
- *JS 引擎把 `fit-content` 改写成 `align-self: flex-start`*：只覆盖在流内一半，定位盒
  没有对应物；而且 align-self 会丢掉 `margin: 0 auto` 居中。
- *只在 JS 侧 warnOnce*：值在 JS 里不知道父是 row 还是 column，row 子项的判定只能在
  Dart 布局处做。

## 4. 风险

- 松约束下子盒若含 `width: 100%` 的孩子：百分比参照变成"可用宽"，内容会撑满上限——
  与 CSS 一致（fit-content 盒里的 % 子项按包含块解析的循环依赖，浏览器也是撑到上限），
  但要在测试里确认不崩。
- Toast 文字节点：text 在松约束下按内容宽，超过上限折行——验证 `max-width: 70%` 用例。
- 已有定位盒行为回归：只有 `widthFitContent` 为真才进新分支，其他路径不变；
  全量 `flutter test` 兜底。
- vant `.van-popup--center` 的 `transform: translateY(-50%)` 与本改动无关，已支持。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter test test/fit_content_test.dart && flutter test
pnpm --filter @ufjs/runtime test && pnpm --filter @ufjs/cli test
pnpm test && pnpm run typecheck && pnpm --filter demo run typecheck
# 设备：重启 dev server（runtime 未改可免）→ flutter run 热重启（只发给自己的进程）
#   vant-feedback：showToast 窄条居中；居中 Popup 收缩
# web：vite 5199 同页 375 宽截图对拍
```

## 6. 实现中发现（plan 未预料，已处理）

1. **loading Toast 内容偏右**（用户对拍发现，既有缺陷）：vant `.van-toast` 是
   `box-sizing: content-box; width: 88px; min-height: 88px; padding: 16px`，web 为 120×120。
   decoration 已按 content-box 把盒子算成 120，但定位槽位 `_atLeastEdges` 对 content-box
   原样返回 88——盒子被压进 88 的槽、居中也按 88 算；`min-height` 同样按 border-box 生效，
   高只有 ~98。修：`FjsStyle.contentBoxExtra`（绝对 padding + 边框），`_atLeastEdges` 与
   `_constraints`（min/max 四值）在 content-box 下都加上它。

