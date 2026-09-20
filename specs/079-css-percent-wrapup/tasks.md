# Tasks: 079-css-percent-wrapup

对应 spec:`./spec.md`。按顺序做,做完一条勾一条。

## 实现

- [x] T001 `render/style.dart`:gapLength / rowGapLength / columnGapLength
  getter(parseLengthValue + 简写回退,照 widthLength 模式)
- [x] T002 `render/flex.dart`:两个 LayoutBuilder 内解析 gap(Wrap 的
  spacing/runSpacing 与 Flex 的 entries);主轴 gap 参照 mainAxisMax、
  交叉 gap 参照 crossAxisMax;删除顶部死变量 gap/crossGap
- [x] T003 `render/decoration.dart`:_fractionRadius 拆成确定盒版与
  _fractionRadiusIn(已知尺寸版);相对尺寸盒在尺寸 LayoutBuilder 内
  解析(layoutRadius 门);painter 组合回退方形 + fjsWarnOnce;
  decorated 判定纳入 radiusPainted(% 圆角盒子走装饰路径)

## JS 侧

- [x] T010 `css/style.ts` resolveEm 顶部:裸 % fontSize 按父计算字号改写成
  px(与 em 同一条父链,根按 INITIAL_FONT_PX 16px)

## 测试

- [x] T020 `gap_percent_test.dart` 4 条(row % / wrap % / 绝对回归 /
  相对尺寸 % 圆角)
- [x] T021 `css.test.ts` font-size: % describe 4 条

## 文档

- [x] T030 css-compat.md 单位节与 gap/radius/font-size 条目
- [x] T031 docs/roadmap.md 打勾(收尾时统一)
- [x] T032 hello-fjs 示例页「百分比间距与圆角」(spec 完成后与对拍一起)

## 验收

- [x] T040 `flutter test` 全过(464 过 3 跳 + 新增 4 条)
- [x] T041 `pnpm run typecheck` + `pnpm test`
- [x] T042 web 与模拟器对拍(收尾统一)(web 侧已对拍;App 侧行为由 widget 用例覆盖,真机对拍挂账 roadmap)
