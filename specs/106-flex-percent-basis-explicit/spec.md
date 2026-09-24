# Spec: flex 主轴百分比参照改为显式标记，不再从约束形状推断

- **ID**: 106-flex-percent-basis-explicit
- **状态**: done（Dart 测试与真机项待用户本机验证）
- **日期**: 2026-09-24
- **来源**: 近 3 天代码 review 第三条（13b4543，spec 101 的飞行盒修复）。

## 1. 要解决什么

13b4543 为修共享元素「飞行盒」顶裁，在 `packages/flutter_fjs/lib/src/render/flex.dart`
的 `buildFlex` 里加了一条推断：主轴 max 为无穷、min > 0 时，把 min 当成
`height: 100%` 子节点的百分比参照。

这个约束形状并不只来自飞行盒：

- 飞行盒：`overflow: hidden` + 声明了 `height` 过渡 + 固定高度时，
  `decoration.dart` 用 `OverflowBox(maxHeight: ∞)` 解封内容高度，而 `OverflowBox`
  不指定 min 时沿用父约束的 min，于是内容拿到 `[盒高, ∞]`。这是 101 要修的。
- **CSS `min-height`**：`style.dart` 的 `constraints` 把它变成
  `ConstrainedBox(minHeight: X, maxHeight: ∞)`，放在滚动容器里时 flex 同样拿到
  `[X, ∞]`。按 CSS，`height: auto; min-height: X` 的盒子**不是**百分比高度的
  确定参照，子节点的 `height: 100%` 应按 auto 处理（web 端就是这样）；101 之后
  Flutter 端会把它解析成 X——两端不一致（宪法 I）。
- 横向同理：101 对 `minWidth` 也做了同样推断，而飞行盒只解封高度，
  横向这条只会命中 CSS `min-width`。

101 的提交没有附带测试，这条误伤没有被发现。

## 2. 不做什么（Non-goals）

- 不改飞行盒的修复效果：共享元素飞行盒里的 `height: 100%` 子节点仍按盒高解析。
- 不改 `OverflowBox` 解封本身（vant collapse 收缩时内容不被压扁的承重逻辑）。
- 不改 web 端、不改 JS runtime、不动 op 协议。
- 不处理 flex-wrap 分支（它本来就只看 max，没有这条推断）。

## 3. 用户可见的行为

```vue
<!-- 1. min-height 不再误当百分比参照（与 web 一致） -->
<scroll-view scroll-y>
  <view style="min-height: 200px">
    <view style="height: 100%; background: red" />   <!-- 改前 Flutter 200px，改后 auto（0），web 为 auto -->
  </view>
</scroll-view>

<!-- 2. 飞行盒照旧：overflow hidden + 高度过渡 + 固定高度的盒子 -->
<view style="height: 150px; overflow: hidden; transition: height .3s">
  <image style="height: 100%" mode="aspectFill" />  <!-- 仍按 150px 解析 -->
</view>
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `min-height` 盒子里的 `height: 100%` | 改后按 auto（与 web 一致） | auto（CSS 规范） |
| overflow hidden + 高度过渡 + 固定高度盒子里的 `height: 100%` | 按盒高（不变） | 按盒高 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议
- [ ] natives 表
- [ ] 事件类型
- [x] 都不涉及

## 6. 验收标准

本环境没有 Flutter SDK，Dart 测试只能写好由用户本机运行。

1. `packages/flutter_fjs/test/percent_in_flex_test.dart` 新增用例：
   - 滚动容器里 `min-height: 200` 的盒子，其 `height: 100%` 子节点高度为 0（auto）；
   - 横向滚动容器里 `min-width: 200` 的行盒，其 `width: 100%` 子节点宽度为 0；
   - `height: 150; overflow: hidden; transition: height` 的盒子，其 `height: 100%`
     子节点高度为 150（101 的飞行盒场景，首次补上测试）。
2. `cd packages/flutter_fjs && flutter test test/percent_in_flex_test.dart` 全绿
   ——**需用户本机执行**；并在回退 flex.dart 改动时，第一、二条用例失败。
3. `flutter test` 全量不回退（需用户本机执行）。
4. 真机：hello-fjs 共享元素示例的飞行盒裁切与缩略图一致（101 的观测项，需用户执行）。
5. `docs/roadmap.md` 登记。

## 7. 待澄清

无。

## 8. 验收记录（2026-09-24）

1. 三条用例已写入 `packages/flutter_fjs/test/percent_in_flex_test.dart`。
2–4. **未执行**：本环境无 Flutter SDK。Dart 改动只经人工复读（一处注释错位已修正），
   未编译。请本机运行：
   `cd packages/flutter_fjs && flutter test test/percent_in_flex_test.dart && flutter test`，
   并在回退 `lib/src/render/flex.dart` 后确认前两条用例失败；再看 hello-fjs 共享元素飞行盒。
5. `docs/roadmap.md` 已登记；`docs/css-compat.md` 补充了 `min-height` 不作参照与飞行盒例外的说明。
