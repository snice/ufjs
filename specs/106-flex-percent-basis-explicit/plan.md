# Plan: flex 主轴百分比参照改为显式标记

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 修的就是 Flutter 偏离 web 的一处；web（`fjs-runtime/src/web/`）是参照，不改。Flutter 侧改 `lib/src/render/decoration.dart` 与 `lib/src/render/flex.dart`。 |
| II 边界即契约 | 否 | 三张表不动。 |
| III 同步单线程零序列化 | 否 | — |
| IV 外观照 WeUI | 否 | — |
| V 静默失效是 bug | 是 | 101 没有测试让这条两端偏差静默存在；本次为两个方向都补测试。 |
| VI 注释记录权衡 | 是 | 标记类与 `buildFlex` 处写清：为何不能从约束形状推断（`OverflowBox` 与 `min-height` 产生同一形状）、为何用 style 身份匹配。 |
| VII JS 能包就不要下 Dart | 不适用 | 纯布局修复，本来就在 Dart 渲染层。 |
| VIII 变更落到文档 | 是 | `docs/roadmap.md` 登记；`docs/css-compat.md` 的百分比行为本来就写的是 CSS 语义，无需改。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/decoration.dart` | 新增 `FjsUncappedHeightScope`（InheritedWidget，携带打标节点的 `FjsStyle`）；`sizedBox` 里解封高度的 `OverflowBox` 把内容包进这个标记 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/flex.dart` | `mainAxisMax`：纵向仅当「max 无穷、min > 0、且最近的标记属于本节点的 style」才用 min；横向恢复为 `maxWidth` |
| 测试 | `packages/flutter_fjs/test/percent_in_flex_test.dart` | 三条用例（见 spec §6.1） |
| 文档 | `docs/roadmap.md` | 登记 106 |

## 3. 方案

标记由产生这种约束的那一层显式给出：装饰层在它解封高度时，把内容包进
`FjsUncappedHeightScope(style: style)`；`buildFlex` 的 LayoutBuilder 里取最近的
该标记，**只有 `identical(scope.style, style)`** 时才认——标记描述的是「这个
节点的内容被解封了」，更深的子节点的 flex 不该继承。解封的 `content` 就是本节点
`buildBox(style, …)` 的结果，所以第一个遇到标记的 flex 正是本节点的。

style 是驻留（interned）对象，理论上子节点可能与父节点共享同一 style 实例；但那样
的子节点同样满足 overflow hidden + 高度过渡 + 固定高度，会在自己的装饰层打一个
更近的标记，不会误用父节点的。

参照值仍取 `constraints.minHeight`（与 101 相同，已经是 padding 扣除后的内容高度），
所以飞行盒的效果与 101 完全一致，只是不再作用于 `min-height`。

**被否掉的备选**：
- 让 `OverflowBox` 传 `minHeight: 0` 并把盒高作为数值放进标记：要在装饰层重新计算
  padding / box-sizing 后的内容高度，与 101 的实测结果可能不一致，风险更大。
- 自定义 `BoxConstraints` 子类携带参照：中间的 `Padding` 等会用 `deflate` 生成普通
  `BoxConstraints`，标记在途中丢失。
- 保留推断、只排除 `min-height`：需要在 flex 里反查祖先 style，仍然是推断。

## 4. 风险

- 本环境无 Flutter SDK，Dart 改动和测试都未运行；需用户本机 `flutter test` 与真机看飞行盒。
- 若飞行盒内容与 `buildFlex` 之间还夹着另一个节点的 flex（例如内容是 `positioned`
  包装后的 Stack），标记仍然只认本节点 style，行为与 101 相同或回到 auto——
  真机验收项 4 会暴露。

## 5. 验证路径

```bash
cd packages/flutter_fjs
flutter test test/percent_in_flex_test.dart    # 需用户本机
flutter test                                    # 需用户本机
# 真机：hello-fjs 共享元素示例
