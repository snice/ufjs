# Spec: 装饰盒瘦身——外边距与背景合成一个渲染对象，去掉 DecoratedBox 的环境依赖

- **ID**: 191-box-fusion
- **状态**: done
- **日期**: 2026-10-03

## 1. 要解决什么

specs/190 后 4050 屏挂载帧 ~67–77ms。一个带背景和外边距的 view（格子 `.cell`）：

```
Padding(margin) → DecoratedBox(背景) → FjsFlex
```

- 外边距与背景各占一个 Element + RenderObject；2000 格 = 4000 + 4000。
- `DecoratedBox.createRenderObject` 调 `createLocalImageConfiguration(context)`，每个装饰节点
  注册 4 个 Inherited 依赖（DefaultAssetBundle、MediaQuery 像素比、Localizations、
  Directionality）——2000 格 8000 次注册，卸载时再反注册。只有背景**图片**用得到这份配置。

## 2. 不做什么（Non-goals）

- 不把装饰合进 RenderFjsFlex（侵入布局管线；本轮先量盒子这一层的收益）。
- 不动过渡动画路径（margin / decoration 带 transition 时保持原有 Tween 包装）。
- 不改布局语义与绘制顺序。

## 3. 用户可见的行为

画面不变。新增内部 widget `FjsBox`（render/box.dart）：

- 替代装饰管线里的背景 `DecoratedBox`：装饰不含图片时不读环境、零依赖；含图片
  （或非 BoxDecoration）时回退 `DecoratedBox`。
- 外边距紧贴背景盒时（中间没有约束 / 裁剪 / 过渡）合成一个渲染对象：布局同
  `RenderPadding`，背景画在扣除外边距的内框，命中测试与 `DecoratedBox` 一致。

## 4. 两端约定（宪法 I）

纯 Dart 渲染侧内部实现，web 不适用。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `flutter test` 全部通过；`node_widget_count_test` 格子 Element / RenderObject 下降。
2. `mount_bench_test` mount / unmount 下降。
3. 真机（iPhone profile，克隆模式）挂载帧、show 上屏较 specs/190 下降；改 1 格不回退；画面一致。

## 7. 待澄清

- 无。
