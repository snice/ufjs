# Spec: App 端点击输入框外失焦并收起键盘

- **ID**: 124-input-tap-outside-blur
- **状态**: done
- **日期**: 2026-09-24

## 1. 要解决什么

App 端（Flutter）`<input>` / `<textarea>` 获得焦点、键盘弹出后，点页面其他
地方，输入框**仍保持焦点、键盘不收**，只能靠键盘自带的收起键或页面主动
`blur()`。浏览器（含移动端 Safari / Chrome）与小程序里，点输入框以外的
区域会失焦（触发 `@blur`）并收起键盘。页面同一份源码两端表现不一致。

**为什么不能"让 app 默认处理"**：Flutter 的 `TextField` 有 tap-outside 机制
（`TapRegion` → `EditableTextTapOutsideIntent`），但默认实现
`_EditableTextTapOutsideAction` 在 Android / iOS / ohos 上对 **touch** 指针
刻意不失焦（只有 `kIsWeb` 或鼠标/手写笔才 `unfocus`），这是在模仿原生
App 的习惯。所以必须自己做：在页面根部（`FjsView` 与 fixed 弹层宿主）挂一个 tap 识别器，
由手势竞技场判定"空白处"（见 plan §3）。

## 2. 不做什么（Non-goals）

- 不做"拖动/滚动列表时收起键盘"（iOS 原生的 `keyboardDismissBehavior.onDrag`）；
  浏览器滚动不失焦，这里也不失焦。
- 不改 web 端、小程序端：它们用的是真 DOM / 原生输入框，行为已经正确。
- 不改 op 协议、事件类型表；不新增 prop（不做"点外面不失焦"的开关，
  除非待澄清里决定要）。
- 不处理页面内非 `input` 的可聚焦控件（fjs 目前没有别的键盘焦点控件）。

## 3. 用户可见的行为

页面代码零变化：

```vue
<input v-model="name" placeholder="姓名" @blur="onBlur" />
<textarea v-model="remark" />
<van-field v-model="phone" clearable label="手机号" />
```

App 端：

1. 输入框聚焦、键盘弹出后，**点**页面上**没有 tap / touch 事件处理**的区域
   （实际上就是页面空白、静态文字、无事件的 view）→ 输入框失焦，`@blur`
   触发一次（载荷为当前文本），键盘收起。
   点到**带事件处理的节点**（按钮、带 `@tap`/`@click`/`@touchstart` 的 view、
   vant 清除图标、cell）→ 事件照常触发，**输入框保持焦点**：事件被页面接走，
   失焦与否由页面自己决定（需要时调 `blur()`）。
2. 手指按下后**拖动**（滚动页面、滑动 swiper）再抬起 → 不失焦，键盘保持。
   判据：tap 识别器本身的 slop，超过即不算"点"。
3. 从输入框 A 直接点输入框 B → 焦点转到 B，键盘**不收起再弹出**（不闪），
   A 收到 `@blur`、B 收到 `@focus`，各一次。
4. 点输入框自身（移动光标、选择文字）→ 不失焦。
5. 点 vant Field 的清除图标 → 清空，保持焦点、键盘不收（属于第 1 条的
   "带事件处理的节点"；与 web 上 vant `touchstart` 里 `preventDefault()` 的效果一致）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 本 spec：页面根部的 tap 识别器只在没有更深节点接走这次点击（竞技场）、且没按在 touch 监听节点上时 `unfocus()` | 浏览器原生：点非聚焦区域 blur |
| 事件载荷 | `@blur` 载荷为当前文本（已有，`_onFocusChange` 一次转换一条） | 同 |
| 已知差异 | ① Flutter 以"抬起"判定，浏览器在 `mousedown`/`touchend` 判定，对页面不可观察。② 点带事件但没 `preventDefault` 的普通按钮：浏览器会失焦，App 保持焦点。这是有意的：App 里点按钮不收键盘更符合原生习惯，页面要收可以自己 `blur()`。登记到 `docs/web.md` 已知差异 | — |

小程序：原生 `input` 组件，行为一致，不需要改。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `cd packages/flutter_fjs && flutter test` 通过（先编 native，确认不是
   `No tests ran`），新增 widget 测试覆盖：
   - 聚焦后 tap 无事件区域 → `hasFocus == false`，`blur` 派发一次；
   - 聚焦后 tap 带 tap 事件的节点 → 仍聚焦，tap 事件照常派发；
   - 聚焦后在输入框外拖动超过 slop → 仍聚焦；
   - A 聚焦后 tap B → B 聚焦，A `blur` 一次、B `focus` 一次。
2. `pnpm run typecheck`、`pnpm test` 通过。
3. iOS 模拟器跑 `demo`（或 hello-fjs 的表单页）：
   - 聚焦输入框 → 点空白处，键盘收起；
   - 聚焦后上下滚动页面，键盘保持；
   - 两个输入框之间来回点，键盘不闪。
4. vant 页：聚焦 Field 后点页面空白处，键盘收起；点清除图标，清空且键盘保持。
5. `fjs dev --web` 同页面同样操作，表现与第 3、4 条一致（回归确认，不改代码）。
6. `docs/ui-api.md` 输入框「焦点」一节补一句"点外面失焦"的两端约定（宪法 VIII）。

## 7. 待澄清

- [x] ~~Q1：vant 清除图标点后是否保持焦点~~ → 保持。规则定为"只有点在无
      tap/touch 事件处理的区域才失焦"（用户 2026-09-24 拍板），清除图标带
      `touchstart`，自然保持焦点，不需要让 `preventDefault` 生效。
