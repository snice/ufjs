# Plan: App 端点击输入框外失焦并收起键盘

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter 改 `fjs_view.dart`、`node/overlay_host_adapter.dart`，新增 `widgets/blank_tap_blur.dart`、`render/pointer_claim.dart`，`render/touch.dart` 打标记；Web 与小程序是原生输入框，本来就点外面失焦，不改。"点带事件的按钮不失焦"这条差异登记到 `docs/web.md` |
| II 边界即契约 | 否 | 三张表都不动：判定全在 Dart 侧，读的是已有的 `onTap`/`onClick`/`onLongPress`/`onTouch*` props |
| III 同步单线程零序列化 | 否 | 纯 Dart 手势处理，无 JS 往返 |
| IV 外观照 WeUI | 否 | 无外观变化 |
| V 静默失效是 bug | 是 | widget 测试覆盖四种情形；跑 `flutter test` 前确认 native 已编，不接受 `No tests ran` |
| VI 注释记录权衡 | 是 | blank_tap_blur.dart 顶部注释：为什么不用 Flutter 默认、为什么靠竞技场、为什么只在根部、两个根；pointer_claim.dart 写 touch 节点这个漏洞 |
| VII JS 能包就不要下 Dart | 是，必须下 Dart | 焦点、键盘、命中测试都是平台控件与 Flutter 手势层的事，JS 侧看不到"点在空白处"（空白处没有节点派发事件） |
| VIII 变更落到文档 | 是 | `docs/ui-api.md` 输入框焦点一节；`docs/web.md` 已知差异 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / JS runtime / Web / C++ | — | 不动 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/blank_tap_blur.dart`（新） | `FjsBlankTapBlur`：`Listener` 记指针 + `GestureDetector(onTap: primaryFocus.unfocus)` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_view.dart` | 页面内容包 `FjsBlankTapBlur`（opaque） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/node/overlay_host_adapter.dart` | fixed 弹层的 overlay 内容包 `FjsBlankTapBlur(opaque: false)` |
| Dart 宿主 | `packages/flutter_fjs/lib/src/render/pointer_claim.dart`（新）+ `render/touch.dart` | 监听 `onTouch*` 的节点按下时标记指针，根部 tap 见到标记就不失焦 |
| 测试 | `packages/flutter_fjs/test/input_tap_outside_test.dart`（新） | 5 条 widget 测试 |
| 文档 | `docs/ui-api.md`、`docs/web.md` | 见 VIII |

## 3. 方案

**页面根部一个 tap 识别器，让手势竞技场判定"空白"。**（实现中途按用户建议改成此方案）
- 带 `@tap` 的节点、button / switch / checkbox 等控件、另一个输入框都有更深的
  tap 识别器；竞技场 sweep 时最先加入者（最深）胜出，根部 tap 不触发。
- 拖动超过 slop 时 tap 识别器自行退出、滚动容器接走指针 → 滚动不失焦。
- 只挂在根部：挂在每个 view 上会让子 view 的空 tap 抢走祖先的 `@tap`。
- 漏洞：只挂 touch 监听的节点（vant 清除图标的 `touchstart`）不在竞技场里
  认领 tap。`touch.dart` 按下时写 `pointer_claim` 标记，根部 tap 见到就跳过。
- fixed 弹层经 `OverlayPortal` 挂到根 Overlay，不在页面命中路径上，另包一层；
  那层始终显示且铺满屏，所以用 `deferToChild`，没点中弹层内容时不拦截。
- 点另一个输入框：B 的识别器胜出并 `requestFocus`，与 Flutter 原生换焦路径相同，键盘不闪。

被否掉的备选：
- **沿用 Flutter 默认**：mobile touch 不失焦（spec §1）。
- **`TextField.onTapOutside/onTapUpOutside` + 自算位移 + 所有事件入口打标记**：
  已实现过一版，要在 gesture.dart 维护"自带点击控件"名单、自己算 slop，
  与竞技场已有的判断重复；改为根部识别器后删除。
- **按下即失焦**：拖动也会收键盘。

## 4. 风险

- 根部 tap 识别器加入每一次手势竞技场；它最浅，只在无人认领时胜出，
  不影响 `@tap` / 长按 / 滚动（全量 flutter test 491 条通过）。
- toast 与 modal action sheet 不在两个根之下；其中没有输入框，不影响。

## 5. 验证路径

```bash
cd packages/flutter_fjs/native && cmake --build build-native -j
cd packages/flutter_fjs && flutter test test/input_control_test.dart
cd packages/flutter_fjs && flutter test
pnpm run typecheck && pnpm test
# iOS 模拟器：demo 的输入页 + vant 页，按 spec §6.3/6.4 操作
```
