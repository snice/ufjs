# Spec: vant 兼容剩余差异收尾（弹层、行内流、伪元素、% 圆角）

- **ID**: 069-vant-compat-gaps
- **状态**: ready
- **日期**: 2026-09-18
- **来源**: specs/068 的两端自动对比（web 浏览器 ↔ iOS 模拟器 `fjs run ios`）
  在修复 flex 初始方向、em 单位、绝对 calc 之后仍然成立的差异清单
  （见 068 spec「验证后的剩余差异」一节）。

## 1. 要解决什么

vant 是真实组件库的探针；下面每条现象都已在 demo 三个页面上实际观察到，
不是推测。目标：页面源码一行不改，这些组件在 App 端达到「可用」——
结构、位置、交互与 web 端一致；装饰性细节允许有登记过的差异。

1. **弹层不贴底、无遮罩、无交互关闭**。`van-popup`/`van-action-sheet`/
   `van-dialog` 在 web 端是 `position: fixed` 全屏遮罩 + 底部/居中弹层 +
   点遮罩关闭；App 端目前原地内联渲染——弹层内容出现在页面文档流中间，
   没有遮罩，按钮照常可以点，`v-model:show` 之外的关闭手段全部失效。
2. **行内流布局缺失，Stepper 竖排**。vant 的 `.van-stepper` 是
   `display: inline-block`，横排靠子元素的行内排布实现；fjs 没有行内流，
   减号 / 数字输入框 / 加号竖着摞。同类的还有「若干 inline 图标横排」的
   常见写法。
3. **`border-radius: 50% / 100%` 呈方角**。`parseBorderRadius` 只认绝对
   长度，百分比被丢弃：van-radio 选中图标（web 是圆圈）、van-switch 圆点
   在 App 端都是方块。
4. **伪元素缺失**：Cell 之间的发丝线（`.van-cell::after`）、Checkbox 选中
   的对勾（`.van-checkbox__icon--checked .van-icon::after` 旋转边框）、
   Divider 的线段全部来自 `::before` / `::after`，App 端一律没有。
5. **Checkbox/Radio 行 debug 溢出红条**（内容比行盒高约 5px；vant 用
   `overflow: hidden` 掩盖，App 端该场景下裁剪未生效，红条只在 debug
   构建可见）。根因未诊断，plan 阶段先用 widget 检查定位。

## 2. 不做什么（Non-goals）

- **iconfont 字形**（Grid/Cell 箭头/Rate 星星）：需要字体加载与渲染管线，
  与本 spec 的布局/CSS 缺口无关，单独立项。App 端继续显示空缺，页面已有
  文案说明。
- **真 Teleport 语义**：不做 DOM 层面的 teleport API，只要求弹层的
  视觉与交互等效（全屏遮罩、置顶、不被页面滚动带走）。
- **CSS Positioned 布局的完整实现**：只为弹层场景修到可用，不做通用
  `position: fixed` 布局。
- **(伪元素) 完整 CSS 规范**：只覆盖 `content: ''` 型装饰伪元素
  （空白内容 + 盒样式），不做 `content: attr()/counter()` 等内容型伪元素。

## 3. 用户可见的行为

页面代码就是 vant 的标准写法，不需要任何平台分支：

```vue
<van-popup v-model:show="show" position="bottom" round>
  <text>底部弹层内容</van-button>
</van-popup>
<van-stepper v-model="value" />
<van-radio-group v-model="radio" direction="horizontal">
  <van-radio name="1">选项一</van-radio>
</van-radio-group>
```

改完之后 App 端（弹层按已定的两步走交付）：

1. 点「Popup」→ 页面整体压暗（遮罩 rgba(0,0,0,.7)），弹层贴屏幕底部、
   全宽、圆角朝上；点遮罩或「关闭」按钮，遮罩与弹层一起消失。
   - 第一步（JS 挂载点）：页面不滚动时达到上述效果；页面滚动时弹层
     会随内容带走，属于登记过的过渡形态。
   - 第二步（Dart 置顶 overlay 宿主）：弹层不随页面滚动，始终真全屏。
2. Stepper 的减号 / 数字 / 加号横排一行，28px 见方的按钮。
3. Radio 选中态是蓝色圆点（圆圈），Switch 圆点是圆形。
4. Cell 之间出现 0.5px 发丝线；选中的 Checkbox 出现白色对勾；Divider
   出现线—文字—线。
5. debug 构建下 Checkbox/Radio 行不再有溢出红条。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 弹层位置/遮罩 | 置顶覆盖层（脱离页面滚动流），遮罩与关闭行为同 web | `position: fixed` + overlay，真 DOM |
| 伪元素 | 引擎合成为装饰盒，样式取自同一条 CSS 管道 | 浏览器原生 |
| `border-radius: %` | 横向 % 依宽、纵向 % 依高，布局期解析 | 浏览器原生 |
| 行内流 | `inline-block` 的收缩适配 + 横排等效，不支持任意行内混排（换行、基线对齐） | 浏览器原生行内格式化上下文 |
| 已知差异 | iconfont 字形空缺（另立项）；伪元素不支持内容型 `content`；弹层动画时序可能与 web 有出入（Flutter 侧驱动） | — |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 预计都不涉及：伪元素 / % 圆角 / 行内流走既有样式管道；
      弹层置顶优先用 JS 侧换挂载点（宪法 VII），若 plan 阶段证明必须
      Dart 侧 Overlay，再回来改这份 spec 的这一节。

## 6. 验收标准

1. `pnpm --filter demo run typecheck`、`pnpm test`、`flutter test` 全绿；
   新能力各带回归测试（CSS 引擎: css.test.ts；Dart: 对应 widget 测试）。
2. demo 三个 vant 页在 web（`pnpm --filter demo run dev:web`）与
   iOS 模拟器（`pnpm --filter demo run run:ios`）逐屏截图对比：
   本 spec 第 1 节的五条现象全部消失。
3. Popup 打开后遮罩可见、弹层贴底；点遮罩关闭（`v-model:show` 回 false）；
   第二步完成后，弹层打开状态下滚动页面，弹层与遮罩位置不动。
4. Stepper 能点加/减改变数值，`v-model` 回显同步（两端各点一次）。
5. `docs/css-compat.md` 差异表更新：伪元素 ❌→✅（限装饰型）、
   `border-radius` 百分比 ❌→✅、行内流登记等效范围。

## 7. 待澄清

无（已拍板，2026-09-18）：

- **范围**：五条全做。
- **弹层形态**：先 JS 后 Dart 分两步。第一步 JS 侧把弹层重新挂到页面根，
  贴底/遮罩/点遮罩关闭可用，弹层随页面滚动属于登记过的过渡形态；
  第二步 Dart 侧提供置顶 overlay 宿主，弹层不随滚动、真全屏。
