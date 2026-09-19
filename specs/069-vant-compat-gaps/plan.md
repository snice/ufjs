# Plan: vant 兼容剩余差异收尾（弹层、行内流、伪元素、% 圆角）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（登记型） | Web 端用真 CSS，五条差异本来就只在 App 端成立——所以 **web 适配层（`src/web/`）零改动**，改动全部落在共享 CSS 引擎 / vue renderer / Dart 渲染层，页面源码两端同一份。做不到的部分（行内混排的完整语义、弹层动画时序）在 `docs/css-compat.md` 差异表登记 |
| II 边界即契约 | 第一步不涉及；第二步涉及 | 弹层第二步（Dart 置顶 overlay）若以「新标签 + 新 op」实现，`ops.ts` 与 `ui_ops.dart` 同一提交内成对修改；在 tasks 拆步时先写协议对照表再动手 |
| III 同步单线程零序列化 | 否 | hoist/合成都是 JS 侧同步对象操作；不新增跨等待 |
| IV 外观照 WeUI | 否 | 全部样式值来自 vant 自身样式表，不引入新默认值 |
| V 静默失效是 bug | 是 | `position: fixed` 的 hoist、`inline-block` 的映射、伪元素支持都要 `warnOnce` 通道可观测（首次生效打一条 info 级说明，不支持的形式打 warn）；css-compat.md 同步更新 |
| VI 注释记录权衡 | 是 | fixed→overlay-host、inline-block→row-wrap 两处映射各留「为什么不是别的做法」注释；否掉的备选记录在本文件第 3 节 |
| VII JS 能包就不要下 Dart | 是 | 弹层第一步、伪元素、行内流全在 JS/runtime 层；唯一新增 Dart 触点是 % 圆角（布局期才有盒尺寸，JS 无从折算——这是「需要 Flutter 的布局能力」的判据）与第二步 overlay 宿主（置顶渲染是宿主能力） |
| VIII 变更落到文档 | 是 | `docs/css-compat.md`：伪元素 ❌→✅（装饰型）、`border-radius` % ❌→✅、`position: fixed` 行为登记、行内流等效范围；`docs/ui-api.md` 若 overlay 走新标签则补条目 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | 无 | — |
| JS runtime（CSS 引擎） | `packages/fjs-runtime/src/css/parser.ts` | `parseSelector` 接受 `::before` / `::after`（ subject compound 上携带伪元素标记）；`position: fixed` 的值映射入口 |
| JS runtime（CSS 引擎） | `packages/fjs-runtime/src/css/style.ts` | 伪元素规则按 (元素, before/after) 归并输出；`display: inline-block/inline` 映射为 `flex + row + wrap`（+ shrink 标记）；fixed→hoist 的标记位 |
| JS runtime（vue renderer） | `packages/fjs-runtime/src/vue/renderer.ts` | `flutterRoot()` 时不建、首次 hoist 时惰性建 overlay host（页面根下、内容之后的兄弟盒）；`nodeOps.insert/remove` 对 `position: fixed` 元素做「逻辑父 → overlay host」的对称翻译；引擎 restyle 回调里按伪规则增删/更新合成的伪子节点 |
| JS runtime（vue shim） | `packages/fjs-runtime/src/vue/vue-shim.ts` | 无改动兜底确认：Teleport 走 runtime-core 原生（vant 未传 teleport prop 时不渲染）；不在此层做 hoist |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/style_parse.dart` | 新增逐角 `border-radius` 解析（px + 百分比分数，拒绝 `a / b` 椭圆形式并 warnOnce） |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/style.dart` | `borderRadiusParts` 之类的读取口；`borderRadius` 保持既有绝对值路径 |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/decoration.dart` | 带百分比角时进 LayoutBuilder，按盒尺寸解出 `Radius.elliptical(宽×分率, 高×分率)` |
| Dart 渲染 | `packages/flutter_fjs/lib/src/render/flex.dart` | `_flexChild` 的 cross 拉伸判定跳过 `display: inline-block` 的子项（收缩盒不自拉伸——一行级触点，配套 `FjsStyle.display` 已有） |
| Dart 宿主（第二步） | `packages/fjs/src/commands/run.ts`（宿主 main.dart 生成段）+ `packages/flutter_fjs/lib/src/`（FjsApp/引擎层） | 置顶 overlay 宿主：JS 可请求把子树挂进顶层 overlay；涉及契约则成对改 `ops.ts` + `ui_ops.dart` |
| 文档 | `docs/css-compat.md`、`docs/ui-api.md` | 差异表与能力登记（见宪法 I/VIII） |
| 测试 | `packages/fjs-runtime/test/css.test.ts`、`packages/flutter_fjs/test/pseudo_layout_test.dart`（或新增）、demo 页 | 每个能力一条回归；demo 用vant 三页做两端对拍 |

## 3. 方案

### 3.1 弹层第一步（JS：fixed → overlay host）

选定的做法：**在 `renderer.ts` 的 `nodeOps.insert/remove` 做「逻辑父 → overlay host」的对称翻译**。overlay host 是页面根的一个兄弟盒（`position: absolute; inset: 0;`），在第一次 hoist 发生时惰性创建。CSS 引擎把 `position: fixed` 保留原值并打 hoist 标记；`nodeOps.insert` 见标记即改插 overlay host（记录逻辑父），`nodeOps.remove` 把逻辑父翻译回 overlay host 再走常规删除。遮罩（`.van-overlay`，`position: fixed; inset: 0`）与弹层同为 hoist 对象，后插入者在上，符合 vant 的 DOM 顺序遮罩在前弹层在后。

被否掉的备选：

- **CSS 纯映射 fixed→absolute**：fjs 的 absolute 以父盒为包含块（`flex.dart:361` 只看子样式），弹层会落在 `.block` 的底部而不是视口底部——位置错误。
- **demo 给 vant 传 `teleport` prop**：runtime-core 的 Teleport 目标归一化走 `document.querySelector`（App 无 DOM）；且改页面/插件代码违背「页面源码不改」。
- **Dart 侧直接认 fixed**：置顶渲染本来就是宿主能力，但那是第二步；第一步要的是不动宿主就可用。

### 3.2 弹层第二步（Dart：置顶 overlay 宿主）

方向：宿主（`FjsApp`/引擎层）提供一个顶层 overlay 容器，JS 侧通过显式请求把子树挂进去（挂进 overlay 的元素不再随页面滚动、真全屏）。是否新增标签/op 在 tasks 拆步时按契约 II 定（成对改 `ops.ts` + `ui_ops.dart`），第一步的 hoist 翻译点（nodeOps）是第二步的天然切换点——把「翻译到页面内 host」换成「翻译到 overlay 通道」。

被否掉：跳过第一步直接 Dart overlay（用户已拍板分两步；第一步独立可用，也让第二步的契约设计有真实用例可对照）。

### 3.3 行内流（JS 映射 + 一行 Dart 触点）

`display: inline-block` / `inline` 在 CSS 引擎映射为 `flex + row + wrap`，vant stepper 的减号/输入/加号即横排；配套 Dart `_flexChild` 的 cross 拉伸跳过 inline-block 子项（收缩盒语义）。`display: inline` 仅映射不声明支持完整行内混排（css-compat 登记）。

被否掉：**Dart 实现完整行内格式化上下文**（基线对齐、行盒、文本绕排）——工作量数倍且 web 端天然已有，组件库场景 row-wrap 等效即可；**伪 inline（只改 shrink 不横排）**——stepper 的痛点就是竖排，不解决横排等于没做。

### 3.4 % 圆角（Dart 布局期解析）

`style_parse.dart` 新增 `parseBorderRadiusParts`：4 角各存 (px, 分率)，1~4 值 shorthand 展开，`a / b` 椭圆形式不支持（整条置 null）。落地时实现比原计划更克制：**不进 LayoutBuilder**，而是在 decoration.dart 读尺寸的地方解析——当盒的 width/height 是确定值（绝对 px）时直接解 `Radius.elliptical`，覆盖 vant 的全部实际用例（van-radio 圆点 / van-switch 圆钮都自带确定尺寸）；内容自适应盒的百分比圆角保持方角并在 css-compat.md 登记。原计划的 LayoutBuilder 方案要把整个 decorated-box 构建推迟到布局期，改动面大而收益仅覆盖这最后一个角落情况，不值得。

被否掉：**JS 侧按元素自身 width/height 折算 %**——CSS 的 % 圆角依布局后的盒尺寸，JS 无布局信息；**LayoutBuilder 全量推迟**（本条落地时否掉，理由如上）。

### 3.5 伪元素（JS 合成真实子节点）

`parseSelector` 接受 subject 上的 `::before` / `::after`（现有实现遇伪元素 warn + 丢整条）。引擎把伪规则按 (元素 id, before/after) 归并，restyle 回调里由 renderer 层合成**真实的 mirror 子节点**（first / last 位插入，tag=view，`content` 文本走 text 子节点），样式 = 伪规则 decls 的内联应用。合成后的一切（布局、绘制、命中、absolute 发丝线、旋转对勾）复用既有管道，零 Dart 改动。

被否掉：**Dart decoration 直接画伪元素盒**——伪元素样式走完整级联（继承、var、类切换增删），在 CSS 引擎之外重实现一遍级联违反单一来源；JS 合成让级联只算一次。**内容型伪元素**（`content: attr()/counter()`）按 spec 保持范围外。

### 3.6 溢出红条（先诊断后修）

plan 阶段不预设根因。实现时第一步用 Flutter DevTools / 临时 `debugDumpRenderTree` 定位是哪个 RenderFlex 溢出 5px（候选：`.van-checkbox__icon` 的 `line-height: 1em` 经 em 折算后的文本行盒、label 的 `line-height: var(--van-checkbox-size)` 链路）；确认后修引擎侧，并验证 `overflow: hidden` 在该盒上裁剪生效（Dart 已有 `overflowHidden` → ClipRRect 管道）。

### 3.7 验证期追加的两个引擎修复（2026-09-18 晚，iOS 实测发现）

1. **私有区字形跳过**：伪元素合成让 iconfont 的 `content: '\e728'` 以字面
   文本渲染——既在 20px 图标盒里溢出红条，又把 Rate 星星变成 `\e72 72` 乱
   码。`pseudoContent` 现在解析 CSS 转义序列为码点，并检测「全部码点落在私
   有区」→ 保留装饰盒但跳过 text 子节点（css-compat.md 已登记 iconfont 缺
   口，这里只保证降级形态可接受）。
2. **纯绝对 calc 折叠**：van-switch 圆钮的位移是
   `translate(calc(var(--w) - var(--node) - 4px))`，em 折算后 calc 内全是绝
   对项，但 Dart 的 transform 解析不吃 calc。引擎在 em 折算后把纯绝对 calc
   折叠成单值 px（带 % 的表达式保持原样交给 Dart 的 FjsLength 解析器）。

## 4. 风险

- **nodeOps 翻译不对称**：`insert` 把 fixed 元素搬进 overlay host 后，`remove`/`move` 必须同样翻译，否则 mirror 树与 Vue 树静默错位（表现：节点删不掉/重复）。回归必须覆盖 `v-model:show` 反复开关、页面切走再切回（keep-alive）。
- **伪子节点与 Vue 的锚点插入相互动**：Vue 带 anchor 的 insert 用 `childrenOf` 索引定位，伪节点占着 first/last 位可能挤错位。伪节点要参与索引但被标记为引擎所有，Vue 的 diff 永远不会提到它们——实现时以 anchor 匹配失败回退「追加到末尾」兜底，并补一条「伪节点 + v-if 兄弟」的测试。
- **inline-block 映射改变既有页面行为**：以前 inline-block 无效表现为「块级堆叠」，现在变横排——对齐了 web，但对老页面是可见变化。css-compat.md 登记行为变化，`pnpm test` + hello-fjs 画廊页过一遍。
- **溢出根因未定位**：可能牵出 em 折算与行高的边界（上一轮刚改过的路径），改法要带两侧行为对照，避免再引入 web 端不可见的回归。
- **两端对拍覆盖面**：每条修复都要在 web 与 iOS 各操作一遍（spec 验收 2~4），防止「只在一端测过」。

## 5. 验证路径

```bash
# 基线
pnpm test && pnpm run typecheck
cd packages/flutter_fjs && flutter test

# 逐条能力的单元/组件回归
npx vitest run test/css.test.ts            # 伪元素、inline-block 映射、fixed 标记
flutter test test/pseudo_layout_test.dart  # % 圆角、收缩盒

# 两端对拍（demo 三个 vant 页）
pnpm --filter demo run typecheck
pnpm --filter demo run run:ios             # 终端 A：iOS 模拟器 + fjs dev
pnpm --filter demo run dev:web             # 终端 B：web 对照
#   Popup/ActionSheet/Dialog：遮罩、贴底、点遮罩关闭、滚动不动（第二步）
#   Stepper 横排 + v-model；Radio 圆点；Cell 发丝线；Checkbox 对勾
#   （idb ui tap/swipe 驱动，两端逐屏截图对照）

# 回归兜底
pnpm --filter hello-fjs run build:pages    # 画廊页确认 inline-block 映射无意外
```
