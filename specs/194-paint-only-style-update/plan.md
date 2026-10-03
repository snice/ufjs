# Plan: 「只改绘制」的样式更新快路径

对应 spec：`./spec.md`（含 §结论：测量数据）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 不触发 | 不新增能力；Flutter 渲染器内部的更新路径，页面语义与画面不变。web 由浏览器决定重绘范围，本就只重绘变了的节点。等价性用对拍守住（逐节点矩形 + 逐像素） |
| II 边界即契约 | 不涉及 | 不动 op 协议 / natives 表 / 事件类型。`SET_STYLE` 已带完整新样式，Dart 侧自己比较新旧 entry |
| III 同步单线程零序列化 | 满足 | 全在 UI isolate 的 `flushDirty` 里同步完成；不引入线程或序列化 |
| IV 外观照 WeUI | 不涉及 | 不改任何默认外观 |
| V 静默失效是 bug | 要守 | 快路径**只在能证明等价时**才走；任何拿不准（键集合不同、有 transition / animation、按下态、border 可见、背景图……）一律回退整链重建，并按原因计数（`FjsPaintOnlyStats.fallbacks`），测试断言各回退原因真的触发。不允许「近似换色」 |
| VI 注释记录权衡 | 要做 | `paint_only.dart` 文件头写：为什么放在 `flushDirty` 而不是 build 里；为什么父节点也不标脏；为什么文字要走不触发 layout 的换色入口；为什么 widget 对象与 RenderObject 暂时不一致是安全的 |
| VII JS 能包就不要下 Dart | 例外且已论证 | 瓶颈是 Dart 侧重建 widget 链（嵌套 build ≈ 80–100 ms / 107 ms，spec §结论），JS 侧已是 0.03 ms，JS 包不了 |
| VIII 变更落到文档 | 要做 | `docs/architecture.md`（重建粒度一节补「只改绘制」）、`docs/performance.md`（主题切换数据与方法）、`docs/roadmap.md` |

没有破例条款。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime / Web / C++ | — | 不动 |
| 镜像树 | `packages/flutter_fjs/lib/src/mirror_tree.dart` | ① `MirrorNode` 加 `paintHook`（节点视图挂载时注册的「就地换色」回调）与 `pressed`（按下态标记）；② `FjsStyleEntry` 加 `paintOnlyTo` 记忆（新旧 entry 对 → 分类结果，主题切换里同一对反复出现，一次计算）；③ `applyFrame` 的 `SET_STYLE`：算出新旧 entry 的差集，若全是绘制键且无回退条件，把 id 记入 `_paintOnly` 而**不**调 `_touch`（不标节点、不标父节点）；④ `flushDirty` 开头先处理 `_paintOnly`：已在 `_dirty` 里的跳过（别的 op 已要求整链重建），其余调 `paintHook`，失败（返回 false / 无钩子）则 `_touch(id)` 回到原路径 |
| 就地换色（新） | `lib/src/render/paint_only.dart` | 分类（`classifyPaintOnly(old, new, oldActive, newActive, node)`，键白名单、回退原因枚举）；`applyPaintOnly(node)`：沿节点自己的包装链找 `RenderDecoratedBox`（背景）与 `RenderFjsParagraph`（文字），装饰用 `copyWith(color:)`，文字换 span；`FjsPaintOnlyStats`；开关 `fjsPaintOnlyEnabled`（`--dart-define=FJS_PAINT_ONLY=off` 初始化）与 dev 宿主函数 `fjs.dev.paintOnly`（release 不注册，仿 specs/193） |
| 段落 | `lib/src/render/paragraph.dart` | `RenderFjsParagraph.recolorPaintOnly(InlineSpan span)`：用新 span 在**同一 min / max 宽度键**上换共享 painter，确认尺寸不变后只 `markNeedsPaint`（现有 `text` setter 对任何 span 变化都 `markNeedsLayout`，那是 specs/191 修「只改颜色时共享 painter 不换」引入的，会让祖先链重排）；尺寸变了返回 false |
| 文字环境 | `lib/src/widgets/text.dart` | `FjsTextEnvData.peek(context)`：读环境但**不登记依赖**（快路径跑在 build 之外，`dependOn…` 会断言） |
| 渲染入口 | `lib/src/render/renderer.dart` | `_FjsNodeViewState` 在 `initState` / `didUpdateWidget` 注册 `node.paintHook`、`dispose` 注销；`_PressedNode` 带 `node` 参数，`_setPressed` 同步 `node.pressed`（按下期间一律回退，因为此时画的是按下态样式） |
| 示例 | `examples/hello-js/src/theme-bench.ts` | 脚本手柄 `__themeBench.setPaintOnly('on'\|'off')`（`invokeHost('fjs.dev.paintOnly', …)`），模拟器免重编 A/B |
| 测试（新） | `test/paint_only_test.dart` | 分类单测、回退各一例、对拍（见 §5）、节点 build 计数 |
| 基准 | `test/theme_switch_bench_test.dart`（已有，测量用） | 加 off / on 两臂对照 |
| 文档 | `docs/architecture.md`、`docs/performance.md`、`docs/roadmap.md` | 见宪法 VIII |

## 3. 方案

### 3.1 选层（spec §6.1，数据已出）

三个候选里选 **①：跳过 build，直接改已挂载的 RenderObject**，理由全部来自测量：

- 一次切换 107 ms，嵌套 build 80–100 ms；重建后需要 layout 的 RenderObject 只有 2 个、需要 paint 的 12728 个——更新在语义上就是重画。
- ② 把颜色挪成 `ValueListenable`（widget 链不变、叶子监听）要改 `decorateNode` / 文字构造等核心，且每个带颜色的叶子多一个 builder 层，**稳态成本增加**；① 对 widget 链零侵入，稳态成本为零。
- ③ 缓存 widget 链、只替换装饰对象，仍然要走 Flutter 对每个 element 的 update，省不掉大头。

### 3.2 判定放在 `SET_STYLE` 解码，且不标父节点

- 现状 `_touch` 把父节点一起标脏，是因为父节点的 build 要读孩子的 `display` / `position` / `flexGrow`（`docs/architecture.md`「重建粒度」）。「只改绘制键」的孩子不改这些，父节点没必要重建。判定在解码里做是因为那里同时有新旧 entry 和这一帧里别的 op（`_dirty` 已含该 id 就不走快路径）。
- 分类规则（**全部满足才是 paint-only**）：
  1. 新旧 entry 都非空，键集合相同；
  2. 差集里的键 ⊆ `{backgroundColor, color, borderColor}`，其余键值逐个 `==`（非标量值保守视为不等）；
  3. 两份 `activeStyle` 同样满足 1–2（它们随主题一起换），或都为空；`hoverStyle` 任一非空 → 回退；
  4. 无 `transition` / `animation*` 键、`FjsStyle.transitions == null`；
  5. 无 `backgroundImage` / `background`（渐变与背景图和纯色并存时 `decoration.color` 的语义不同）；
  6. 新旧样式都没有**可见边框**（`boxBorders` 为 null 或 `isNone`）——否则 `color` / `borderColor` 会改边框颜色，那要换 `Border`，v1 不做；
  7. 节点是 `view`（不是 `htmlBlock`，且没有非空的裸文本）或「无子节点、无 `richSpans` 的 `text`」；
  8. 同一帧里这个节点没有别的 op 把它放进 `_dirty`（`flushDirty` 里再判一次）。
- 运行期条件（`flushDirty` 调钩子时判）：节点已挂载且 RenderObject 已 attach；`node.pressed == false`；找得到该节点自己的 `RenderDecoratedBox`（背景）/ `RenderFjsParagraph`（文字）。

### 3.3 就地换色

- **背景**：从 `node.element.findRenderObject()` 起沿**单孩子链**下探（Padding / ConstrainedBox / ShrinkCross 标记 / `FjsBox`），遇到第一个 `RenderDecoratedBox` 就是该节点的装饰；遇到多孩子（`RenderFlex`，孩子是别的节点）或别的节点的外层 RO 即停。`decoration` 必须是 `BoxDecoration`；`copyWith(color: 新背景色)`，赋值触发 `markNeedsPaint`。背景色在新旧间出现 / 消失：找得到 `RenderDecoratedBox` 就照改（`keepsBox` 的节点装饰本来就在），找不到回退。
- **文字**：用 `fjsPlainTextSpec(env, node.text, newStyle)` 得到新 span（与 `_FjsText.build` 同源，specs/193 已有），`RenderFjsParagraph.recolorPaintOnly(span)`；该节点的 `backgroundColor` 走背景路径。
- **widget 对象与 RenderObject 暂时不一致是安全的**：元素持有的是旧 widget，RenderObject 已是新颜色。之后任何一次重建都从 `node.style`（已是新值）造新 widget，`updateRenderObject` 把 RO 设成它——与快路径写入的值相同。不会出现「相同 widget 实例被跳过更新」，因为每次 build 都新造 widget（缓存的是 `_FjsNodeView`，不是它里面的 widget）。
- `:active`：`node.activeStyle` 在解码时已更新，下一次按下重建读到新的按下态样式；`pressed` 为真期间回退。

### 3.4 被否掉的备选

| 备选 | 否掉原因 |
|------|---------|
| ② `ValueListenable` 颜色 | 改核心装饰 / 文字构造，稳态每个带色叶子多一层 builder；收益与 ① 相当但侵入大 |
| ③ 缓存 widget 链、只换装饰 | 仍要走 Flutter 对每个 element 的 update，省不掉大头 |
| 在 JS 侧标记「paint-only」再发新 op | 要动 op 协议（宪法 II 三张表），而 Dart 侧本来就能比较新旧样式 |
| 让 `RenderFjsParagraph.text` setter 自己判断「只改色」 | 它对所有调用方生效，包括需要重排的场景；显式的 `recolorPaintOnly` 只在快路径里用，语义清楚 |
| 把 `opacity` 也放进绘制键 | 值在 1 与非 1 之间变会改变 widget 链形状（`Opacity` / `transitionNode`），不是「只改绘制」，spec 已定首版不放 |
| 快路径放进 `_FjsNodeViewState.build` 里（build 内改 RO） | 在 build 阶段改兄弟 RO 不安全，且节点视图的 setState 已经让 Flutter 付了调度成本；放在 `flushDirty`（帧外、build 之前）最干净 |

## 4. 风险

- **静默错色**：找错 `RenderDecoratedBox`（下探进了别的节点）会把颜色画到别人身上。对策：沿单孩子链下探、遇到别的节点的外层 RO 即停；对拍测试覆盖带 / 不带 margin、定宽高、padding 的链形状；每个对拍 fixture 两路径逐像素比。
- **文字换色后尺寸变**：色不影响度量，但 span 的其他部分若与旧 span 有别（例如共享缓存键不同）会导致 painter 尺寸不同。对策：`recolorPaintOnly` 校验尺寸，不等返回 false 回退。
- **按下态竞争**：按下期间主题切换。对策：`pressed` 为真回退，按下结束后下一次 `setState` 本来就会读最新样式。
- **与 specs/193 的交互**：flat 子树内的节点没有视图 / 钩子 → 回退 `_touch` → 走 flat 的转发，不受影响；对拍里加一例「主题切换穿过 flat 子树」。
- **回退率高导致没收益**：用 `FjsPaintOnlyStats` 在 hello-js 主题屏上读 applied / fallbacks，确认 3000+ 节点基本都走快路径。
- **模拟器上语义树常开**：快路径与语义无关，无需特殊处理；但自绘（193）在那里会回退，对照时 193 用 `force`，194 用默认。

## 5. 验证路径

```bash
cd packages/flutter_fjs
# 阶段零数据（已有）
flutter test --dart-define=FJS_BENCH=true test/theme_switch_bench_test.dart
# 正确性
flutter test test/paint_only_test.dart
# 主线不退化
flutter test
flutter test --dart-define=FJS_BENCH=true test/render_bench_test.dart test/mount_bench_test.dart
pnpm run typecheck && pnpm test

# 模拟器（iPhone 17 Pro，端口 38901；scroll-view 与 list-view 两种容器各量）
cd examples/hello-js && npx fjs run ios --device 76B1D996-6521-4370-9A11-2A14234A6567 --port 38901
npx fjs eval --port 38901 "__helloTab(1)"
npx fjs eval --port 38901 "__themeBench.setPaintOnly('off')"   # 对照
npx fjs eval --port 38901 "__themeBench.setPaintOnly('on')"
```

### 对拍的做法

同一棵 `MirrorTree`、同一串「只改颜色」的 `SET_STYLE`，分别在 `fjsPaintOnlyEnabled = false` / `true` 下渲染并逐步应用，每一步比较**所有节点的矩形与整张图的像素字节**（沿用 `test/support/parity.dart`）。fixture：纯色背景；带圆角；带 margin / 定宽高 / padding 的不同链形状；文字颜色（含同一文本多节点共享 painter）；带 `:active` 样式的节点；多次连续切换与切回；同一帧里既改色又改布局键（必须回退）；有 transition、有可见边框、背景图、按下中、view 带裸文本、htmlBlock（各一例回退）；穿过 flat 子树。
