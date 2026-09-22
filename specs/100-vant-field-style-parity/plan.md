# Plan: vant Field 样式对齐——label 默认样式与 ::placeholder

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | label 默认值两处同删（base-css + HTML 兼容表）；`::placeholder` web 已原生支持，Flutter 由引擎补齐，最终读数对拍 |
| II 边界即契约 | 否 | 不新增 op / natives / 事件；`placeholderStyle` 复用已有 setProps 通道 |
| III 同步单线程零序列化 | 否 | 纯样式计算，无新跨线程数据 |
| IV 外观照 WeUI | 否 | 参照物是 vant（demo 页面就是 vant 复刻），不是 WeUI 组件 |
| V 静默失效是 bug | 是 | 旧实现把 `::placeholder` 静默丢弃、label 默认层静默盖过库 CSS；修复后规则要么生效、要么按现有 `warnOnce` 告警 |
| VI 注释记录权衡 | 是 | 兼容表/base-css 删默认值处、parser 伪元素种类处都写"为什么"（向 UA 收敛、避免挡住继承） |
| VII JS 能包就不要下 Dart | 是 | `::placeholder` 全部在 JS 引擎 + 已有的 `input.dart` `_hintStyle` 消费端完成，Dart 侧零改动 |
| VIII 变更落到文档 | 是 | `docs/css-compat.md`、`docs/web.md` 同步改 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · CSS 解析 | `packages/fjs-runtime/src/css/support.ts` | `SUPPORTED_PSEUDO_ELEMENTS` 加 `placeholder` |
| JS runtime · CSS 解析 | `packages/fjs-runtime/src/css/parser.ts` | `Selector` / `CssRule` 的 `pseudo` 联合类型加 `'placeholder'`；`parseSelector` 识别 `::placeholder`；规则拆分循环的 kind 列表加 `'placeholder'` |
| JS runtime · CSS 计算 | `packages/fjs-runtime/src/css/style.ts` | `PseudoStyles` 加 `placeholder`；匹配时收集 `placeholderDecls`；参与 `pseudoChanged` 比较；**不**生成装饰盒 |
| JS runtime · Vue renderer | `packages/fjs-runtime/src/vue/renderer.ts` | `styleEngine` 回调里，`pseudo.placeholder` 落成宿主元素的 `placeholderStyle` prop（四键序列化），清空时删 prop；HTML 兼容表 `label` 项去掉 `style`（margin/color/fontSize） |
| Web 适配层 | `packages/fjs-runtime/src/web/base-css.ts` | `label` 规则删 `margin` / `font-size` / `color`，保留容器与指针行为 |
| Dart 宿主 | — | 不改：`input.dart` `_hintStyle` 已解析 `placeholderStyle` 四键 |
| 小程序 | `packages/fjs/src/mp/css.ts` | 只核对：Skyline 过滤器对 `::placeholder` 的处置仍是丢弃（不漏进 wxss） |
| 文档 | `docs/css-compat.md`、`docs/web.md` | 伪元素支持表、label 默认值段落、placeholder 默认色段落 |
| 测试 | `packages/fjs-runtime/test/css-support.test.ts` 等 | 旧断言翻转 + 新增解析/计算/prop 序列化用例 |

## 3. 方案

**label 默认值：直接删，不做条件化。**
`label` 的 `margin: 4 / color: #666666 / font-size: 14` 是 fjs 把 `<label>` 收编为
自有标签时，为了"只写文字的老页面外观不变"留下的（css-compat §6）。但它以
"元素自身声明"的形态落在**每个** `<label>` 上：浏览器 UA 对 label 恰恰是
margin 0 / 继承颜色字号，所以库（vant）按标准 CSS 写的
`.van-field__label { color: … }` 只能作用在外层 div，内层 label 自己的
`#666666` 永远赢过继承——这就是两端 label 颜色错、且被 margin 顶低 4px 的原因。
仓库内所有 fjs 自有页面（hello-fjs form/radio）都显式写了 `margin: 0` 和
`color`，不依赖默认值；删掉后向浏览器语义收敛，两端也天然一致。
备选（给默认值加"库渲染的 label 不生效"的判定）被否：镜像树里没有可靠依据
区分"页面写的 `<label>`"和"vant 写的 `<label>`"，特判就是把 bug 挪个位置。

**`::placeholder`：进 CSS 引擎，走已有的 placeholderStyle 通道。**
parser 把它作为第三种伪元素解析（与 `before`/`after` 同一套拆分/特指度/桶），
style.ts 在同一个 `PseudoStyles` 里算出它的样式（从宿主继承 var()/em，和
before/after 同一条层叠），renderer 不给它造装饰盒，而是把四键序列化成
`placeholderStyle` prop——这个 prop 是 `placeholder-style` 属性的既有契约，
`input.dart` 的 `_hintStyle` 已经在解析。web 端原生 CSS 本来就生效，不走引擎。
备选（Flutter 端把 hint 色硬编码成 vant 灰、或让 input 组件读 computed color）被否：
前者只对 vant 一个值生效，后者拿的是元素前景色不是 placeholder 色，都会在下
一个库/下一条规则上再次静默偏差。

## 4. 风险

- **规则拆分**：`.a, .a::placeholder { … }` 这类混选必须仍拆成两条规则，
  漏拆会让普通选择器也带上 placeholder 声明（或反之），表现为整行文字变色——
  用单测钉住。
- **装饰盒误生成**：`placeholder` 进入 `PseudoStyles` 后，before/after 的盒子
  生成与清理路径要显式跳过它，否则可能凭空多子节点（结构变化比样式更难查）。
- **prop 抖动**：样式重算时 `placeholderStyle` 从有到无要删 prop，不能留旧值。
- **label 默认值删除的隐性依赖**：仓库外的用户页面可能真在吃这 4px/#666——
  属于有意的破坏性修正，文档里写明（css-compat 段落更新）。
- **Flutter 输入行盒**：label margin 修掉后，若输入框文字仍因行盒度量
  （20 vs 24）偏移 ≤2px，按实测决定是否追加行高对齐；不在本 spec 里先验断言。

## 5. 验证路径

```bash
pnpm run typecheck && pnpm test

# web 参照（5174 起着时直接看）
pnpm --filter demo run dev:web
# 浏览器 393px viewport 打开 /vant-form，量 cell 高 / label 与占位中心 / 两色

# iOS 端
cd demo && pnpm run run:ios     # 已有 fjs run ios 会话可复用
# 模拟器进 vant-form，agent-device 截图 + AX rect 量同三组数，与 web 对拍
```
