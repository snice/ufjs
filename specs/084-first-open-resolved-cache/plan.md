# Plan: 首开剩余——FjsStyleEntry 解析驻留 + compute miss 再瘦

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不涉及（行为不变） | App 管线内部：Dart 派生对象驻留 + JS compute miss 少分配。最终样式与外观逐位不变；web 走浏览器原生 CSS / 布局，没有镜像树也没有这份引擎 |
| II 边界即契约 | 不涉及 | 三张表零改动。`DEFINE_STYLE` 仍换整个 `FjsStyleEntry`，驻留随对象一起死 |
| III 同步单线程零序列化 | 不涉及 | 全是同步路径上的对象共享，无新异步、无新桥 |
| IV 外观照 WeUI | 不涉及 | 不改任何默认样式数值 |
| V 静默失效是 bug | **涉及（核心风险）** | 驻留脏读（换了 styleId 仍用旧 EdgeInsets / BoxDecoration）会画错却不抛。防线：驻留只挂在 `FjsStyleEntry` 实例上，`DEFINE_STYLE` 今天就是换对象；`:active`/`:hover` 的 overlay 缓存在 (baseId, overlayId) 键上，不写进 base。专项测试覆盖「换 id 后读到新值」「按下态不污染 base」 |
| VI 注释记录权衡 | 涉及 | `FjsStyleEntry` 上写清为什么 view 能按 entry 共享、为什么 `keepsBox` 不能跟 view 走、overlay 键的失效条件；JS 侧写清为什么现在才合并 inherit+merged（076 当时 merge <1 ms 是因为 custom 拷贝 30 ms 盖住了它） |
| VII JS 能包就不要下 Dart | **涉及，必须落 Dart** | 驻留的是 Flutter 的 `EdgeInsets` / `BoxDecoration` / `BorderRadius`，web 没有对应物，JS 组件层包不出来。JS 那一刀仍留在 `fjs-runtime` 的 `compute()`，不下 Dart |
| VIII 变更落到文档 | 涉及 | `docs/vant-mount-perf.md` 补本轮 A/B；`docs/performance.md` 热点清单（Dart 派生 / compute miss 分配）更新。`css-compat.md` 支持矩阵不动 |

无破例。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/mirror_tree.dart` | `FjsStyleEntry` 增加 interned view / overlay 槽（`Object?`，与 `MirrorNode.view` 同层：本文件不 import `style.dart`）。注释兑现「parsed Flutter values live on the entry」 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/style.dart` | `FjsStyle.of` 走 entry.view；派生值（padding / margin / boxBorders / radius / 背景等 decorateNode 热路径）lazy 记在这份共享 view 上。`keepsBox` 移出共享实例（见 §3.1）。`stateOf` 未按下时返回 base view，按下时走 overlay 缓存 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/decoration.dart` | `keepsBox` 改为 `decorateNode` / `transitionNode` 的参数（renderer 已经知道这个节点是否 track press/hover），不再读 `FjsStyle.keepsBox` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/renderer.dart` | 把 `tracksPress \|\| tracksHover` 传给装饰层；`stateOf` 未按下走共享 view |
| Dart 宿主（测试） | `packages/flutter_fjs/test/resolved_style_test.dart` | spec §6.3：共享 styleId 的派生对象 identical；`DEFINE_STYLE` 换 id 后不是旧对象；active overlay 不写穿 base |
| Dart 宿主（bench） | `packages/flutter_fjs/test/render_bench_test.dart` | 不改口径；跑一遍确认不回退 |
| JS runtime | `packages/fjs-runtime/src/css/style.ts` | compute miss：① `INHERITABLE` 迭代改成冻结数组（Set 的 `for-of` 在 QuickJS 上每次分配迭代器）；② `inherited` 与 `merged` 合成一个对象；③ 四层 spread 改赋值循环 |
| JS runtime（测试） | `packages/fjs-runtime/test/css-compute-diet.test.ts` | 补 inherit 合并后「无自带声明的子元素仍继承 color/fontSize」；既有 custom 共享用例不改 |
| 文档 | `docs/vant-mount-perf.md`、`docs/performance.md` | 落 A/B 数字与热点状态 |

CLI / web 适配层 / C++：**零改动**。

`flex.dart` 里每个孩子多次 `FjsStyle.of(n)` **不必改调用点**：`of` 改成返回共享实例之后，三次查找是三次指针，不再是三个 FjsStyle。

## 3. 方案

两刀独立，先 Dart（first-paint 验收）再 JS（flush attributed）。任何一刀单独可回滚。

### 3.1 Dart：一份 interned style → 一份 `FjsStyle` view

现状：

- 协议已经按对象身份 intern：N 个节点同一份 map，镜像树上是同一个 `FjsStyleEntry`。
- widget 层每次 build 每个节点 `FjsStyle.of` **new 一个包装**，getter 再从 map 派生 `EdgeInsets` / `FjsBoxBorders` / …。值解析有 `style_parse.dart` 的按值缓存，但**派生对象按节点分配**。
- 更糟的是 vant 大量节点 `tracksPress`：renderer 走 `FjsStyle.stateOf`，未按下也 `{...base}` 或至少 new 一个带 `keepsBox=true` 的实例。`FjsStyleEntry` 上那句「cache parsed Flutter values on it」是空头注释。

做法：

```dart
class FjsStyleEntry {
  FjsStyleEntry(this.id, this.map);
  final int id;
  final Map<String, Object?> map;
  /// Shared FjsStyle view. Object? so this file stays free of painting.
  Object? resolvedView;
  /// Pressed/hovered overlay FjsStyle views, keyed by packed hover/active ids.
  Map<int, Object>? overlays;
}
```

Layering: `mirror_tree.dart` is the op decoder. Putting a typed `FjsStyle?` here
would import `render/style.dart` and pull painting into every frame apply.
`MirrorNode.view` already uses this opaque-slot pattern.

- **`FjsStyle.of(node)`**：有 `node.style` → `entry.view ??= FjsStyle._interned(entry)`（`style = entry.map`，`props` 空；interned 路径样式是完整 computed，不再回落 top-level props）。无 interned 的遗留帧仍走今天的 `FjsStyle(props)`。
- **派生值 lazy 记在这份 view 上**（`padding` / `paddingLengths` / `margin*` / `boxBorders` / `borderRadius` / `borderRadiusParts` / `backgroundColor` / `overflowHidden` / `opacity` / `transform` 等 decorateNode 热路径）。`null` 是合法答案，用 `bool _paddingResolved` 或 sentinel 区分「还没算」和「算出来是 null」。
- **`keepsBox` 不能跟 view 走**：它是 per-node 的 widget 形状约束（`:active` 背景来去不能给手势层换父亲，vant collapse 箭头栽过）。从 `FjsStyle` 挪到 `decorateNode` / `transitionNode` 的参数，由 renderer 传入 `tracksPress \|\| tracksHover`。共享 view 上不再有这个可变字段。
- **`stateOf`**：
  - 未按下且未悬停 → 返回 base `entry.view`（不再 new、不再 spread）。
  - 按下 / 悬停 → CSS 引擎的 active/hover map 是「inherit+defaults+**只含伪类声明**+inline」，必须叠在 base 上才是完整 computed（今天 `{...base, ...active}`）。按 `(baseEntry.id, overlayEntry.id)` 缓存一份 merged `FjsStyle` 在 `base.overlays[overlayId]`。merged 的 `style` 仍是一次 spread 的结果，但这份对象按样式对驻留，不是按节点、按帧。
- **失效**：`DEFINE_STYLE` 写 `_styles[id] = FjsStyleEntry(...)` 换掉对象，旧 view / overlays 随旧 entry 一起不可达。不另做手动 clear。

`FjsStyle.stateOf` 里 `keepsBox = true` 的现有赋值删掉，改调用点传参。这是本刀唯一会碰到「widget 形状」的地方，测试用现有 `active_style_test` / `hover_style_test` 以及 collapse 相关用例兜。

### 3.2 JS：compute miss 少分配

076 把 custom 拷贝和 `resolveVars` 无 `var()` 快路径砍掉之后，vant-form 首开 flush 还剩 **37.4 ms / 286 miss**。076 plan 当时否掉「合并 inherit spread」，理由是 merge <1 ms、被 30 ms 的 custom 盖住。custom 走了之后这刀才轮到。

三处，都不改匹配与级联结果：

1. **`INHERITABLE` 迭代**：现在是 `Set`，`for (const k of INHERITABLE)` 每次 miss 一个迭代器。改成冻结数组（`color` / `fontSize` / … 十个键，顺序固定），`has` 若还要用再留 Set，热路径只扫数组。
2. **`inherited` 与 `merged` 合成一个对象**：先按数组把父级可继承键写进 `merged`，再把 `defaults` / `matched.decls` / `inline` 用 `for-in` 盖上去。少一次空对象 + 一次四层 spread 的临时对象。text-decoration / text-overflow 的特例仍写在 inherit 段，位置不变。
3. **active / hover / 伪元素**：已经是 `matched.activeDecls ? … : undefined`，保持。不要为了「少一次 spread」去复用 `merged` 再改——那会写穿元素自己的 computed。

命中路径（`byParent.get`）一行不动。`Object.keys(style)` 仍在 miss 末尾做一次，结果挂在 MatchResult 上给 `sameStyle` 用；再省要动 keys 的维护方式，ROI 低于上面三处，本轮不做。

### 被否掉的备选

- **改 op 协议，DEFINE_STYLE 改二进制**：能削 applyFrame 7.5 ms，但动契约、要升 `uiOpsVersion`、fjsrun 解码器三处同步。spec 明确 Non-goal。
- **`scroll-view` 变 sliver**：001 已登记语义风险；vant-form 也不是「一屏十几行」的长列表，懒构建对首屏帮助有限。
- **style-slots（002）**：治主题切换的 `recompute` 次数，治不了首开 miss。
- **共享 `BoxDecoration` widget / 跨节点复用 Padding widget**：Flutter `Widget.==` 是身份，子不同就不能交同一实例；只共享**值对象**（EdgeInsets、Decoration、BorderRadius），包装层仍每节点一个。
- **`Object.create(parentComputed)` 做继承**：查表变 O(深)，且 `for-in` 会沿链枚举，076 已否，这里同样否。
- **动 QuickJS GC 阈值**：产品已否（001 待澄清、本 spec Non-goal）。

## 4. 风险

- **驻留脏读**：换 style 仍画旧 padding/颜色。防线 = 驻留只活在 entry 实例上 + `resolved_style_test` 换 id 断言 identical 为 false 且数值为新值。
- **按下态写穿 base**：overlay 必须是独立 `FjsStyle`，base.view 的 lazy 字段不能在 merge 时被改。测试：读过 base.padding 再按下，base.padding 仍是未按的值。
- **`keepsBox` 挪参数漏传**：某个 track-press 节点装饰层来去导致子树 remount，手势/transition 丢。防线 = 现有 `active_style_test` / `hover_style_test` / collapse 用例；renderer 只在原来走 `stateOf` 的那条分支传 `true`。
- **inherit 合并改 cascade**：子元素不该继承的键被留下、该继承的丢了。防线 = 既有 `css.test.ts` 继承用例原样过 + diet 测试补一条 color/fontSize。
- **first-paint ≤ 30 ms 是 debug 模拟器目标**：598 个节点的 widget 构建/布局/绘制仍在。驻留削的是派生分配，不是 ListenableBuilder 个数。若同口径 min-of-3 仍 > 30，数字落账、不放宽语义、不靠关 GC 凑数；是否继续压包装层另立项。

## 5. 验证路径

```bash
# 1. 单测 + 类型
pnpm test
pnpm run typecheck
cd packages/flutter_fjs && flutter test

# 2. Dart bench 不回退（对照组是绕过，不是清空）
cd packages/flutter_fjs
flutter test --dart-define=FJS_BENCH=true test/render_bench_test.dart

# 3. 小规则集 JS 不回退
cd examples/bench && pnpm run build
../../packages/flutter_fjs/native/build-native/fjsrun --pump 8000 dist/app/bundle.js

# 4. 模拟器同口径（docs/vant-mount-perf.md 附录打点，量完撤）
#    iPhone 17、fjs run ios、chunk 预热后首开 vant-form ×3 取 min
#    first-paint 目标 ≤ 30 ms；CSS attributed ≤ 15 ms；match miss = 275
```
