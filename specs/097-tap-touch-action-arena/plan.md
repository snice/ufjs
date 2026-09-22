# Plan: touch-action: none 不得吞掉同节点的 @tap

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | 修的就是 Flutter 端 tap 不派发的两端分歧；web 不改（本来正确） |
| II 边界即契约 | 不涉及 | 三张表零改动 |
| III 同步单线程零序列化 | 不涉及 | 纯手势竞技场时序 |
| IV 外观照 WeUI | 不涉及 | 无默认外观变化 |
| V 静默失效是 bug | 涉及 | 复现测试 `tap_touch_action_test.dart` 把行为钉死 |
| VI 注释记录权衡 | 涉及 | 改 `addAllowedPointer` 时更新注释，说明为什么 down 时不 eager-accept |
| VII JS 能包就不要下 Dart | 不涉及 | 修复必须在 Dart 手势层，JS 侧没有对应物 |
| VIII 文档 | 不涉及 | spec 029 文档表本来就写的是「移动约 8px 抢下指针」——修完代码与文档一致 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/touch.dart` | 删掉 `_TouchActionRecognizer.addAllowedPointer` 里 `touch-action: none` 的 down 时 `resolvePointer(accepted)`；抢指针交给既有的 move 时 `_claims()`（none: >8px） |
| 测试 | `packages/flutter_fjs/test/tap_touch_action_test.dart` | 新增：control + touch-action 两个用例（已写好，先红） |
| JS runtime / Web / C++ / 文档 | — | 不改 |

## 2.1 eager-accept 当初想保什么、为什么不保 tap

`addAllowedPointer` 的注释说 eager-accept 是为了「父级滚动容器不得在同一轮
竞技场里抢走快速的第一段 move」。这个保护**不需要 down 时就赢**：

- 竞技场在 down 结束时 close，之后谁先 `resolve(accepted)` 谁赢；
- move 事件经 pointerRouter 按注册顺序分发，而注册发生在 hit-test 派发中、
  **深度优先**——`FjsTouchNode` 比外层滚动容器深，先注册、先收到 move；
- `none` 的 `_claims()` 阈值 8px 又早于滚动容器的 18px。
  所以即便一段 -80px 的快速 move，也是 touch recognizer 先 accept、滚动容器
  被 reject（`touch_event_test` 的 fast-first-move 用例会守住这条）。

而 down 时 eager-accept 会在**手指抬起前**就把 arena 裁决完，外层（其实同节点）
的 `TapGestureRecognizer` 收到 reject——这就是 @tap 消失的全部原因。
类注释本来就写着 "Only movement makes it claim"，实现与注释对不上。

## 3. 方案

**选定**：删掉 `addAllowedPointer` 里的 `if (action == TouchAction.none)` eager
分支，`none` 与 pan-x/pan-y 走同一套「move 过阈值才 claim」路径；up 时
`resolvePointer(rejected)` 自裁（既有代码）不变。

**被否掉的备选**：
- *保留 eager-accept，把 tap 检测器挪进 touch 层内部*：竞技场只有一个赢家，
  谁内谁外都一样被 reject，挪位置不解决。
- *保留 eager-accept，Dart 侧在 up 无位移时手动补发 tap*：绕开竞技场语义
  自己造一套 tap 判定（位移阈值、多指、pointer id），重复 `TapGestureRecognizer`
  已有的逻辑，且 `lastTapPosition` 几何也得自己维护——复杂且易与 web 漂移。
- *让 canvas 组件在 App 端不透传 touch-action*：改变用户可见的 CSS 语义
  （同一份样式两端不同源），违宪法 I。

## 4. 风险

- **回归面**：`touch-action: none` 抢指针的速度。若删掉 eager 后
  fast-first-move 用例失败，说明存在「滚动容器先注册」的路径，需要改为
  「down 时只对滚动方向 claim」之类的折中——以测试结果为准。
- **van Slider / vant 弹层**等既有 `touch-action` 使用方：它们只挂 touch
  事件不挂 @tap，理论零影响；全量 `flutter test` 覆盖。

## 5. 验证路径

```bash
cd packages/flutter_fjs && flutter test          # 全量，含新增两用例与既有 touch 用例
pnpm --filter hello-fjs run typecheck            # 页面零改动，确认
# 手工：fjs dev + fjs run android，鹈鹕骑行页点画布切速
```
