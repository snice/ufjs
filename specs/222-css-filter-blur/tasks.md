# Tasks: 222-css-filter-blur

## 契约层
- [x] T001 确认契约零变更（`filter` 已能过桥；设备上确认到达 Dart）

## 实现
- [x] T010 `style_parse.dart`：`FjsFilter` / `parseFilter`
- [x] T011 `style.dart`：`filter` getter
- [x] T012 `decoration.dart`：`filterNode`（ImageFiltered，decal，非 blur 函数告警一次）
- [x] T013 `renderer.dart`：包在 `transitionNode` 内侧
- [x] T014 `support.ts` / `lint.ts`：`filter` 降为 warn（非 blur），`backdrop-filter` 保持 drop

## 两端对齐
- [x] T020 Web：浏览器原生；示例在 web 上量到 `filter: blur(1.24px) → 2.90px` 随拖动变化、结束归零
- [x] T021 iOS 模拟器：设备日志里 `filterNode` 收到逐帧变化的半径；连拍帧里 Today 页被高斯模糊

## 测试
- [x] T030 `filter_blur_test.dart`（6 个）：blur 有 ImageFiltered 且 sigma 对、裸数字、blur(0)/none/缺省无包装、布局不变、其他函数告警一次、blur 与其他函数并存
- [x] T031 `lint.test.ts`：blur 不报、其他函数 warn、backdrop-filter 仍 drop（并修正两处原先断言 `filter` 被 drop 的用例）
- [x] T032 `css-support.test.ts` 结构性断言通过

## 文档
- [x] T040 `css-compat.md`（filter 行改 ⚠️、不插值、与 backdrop-filter 的区别）、`ui-api.md`、`miniprogram.md`

## 验收
- [x] T050 `pnpm run typecheck`、`pnpm test`（runtime 1026、cli 514）、`flutter test`（805 通过、9 跳过为既有）
- [x] T051 spec §6 逐条核对
- [ ] T052 真机 profile 大半径整页模糊的耗时（模拟器不可信）；spec 状态保持 in-progress 直到做完

## 实现期发现

1. Web 上 `filter` 本来就是原生 CSS，缺的只是 App 端渲染和 lint/文档口径（`filter` 被登记成「不支持」）。
2. 示例里最初用 `<glass-surface>` 做背景模糊是错的方向（用户纠正）：它画的是背后，而这里要糊的是「Today 页面自己」；两者在 css-compat 里已并列写明区别。
3. `flutter test` 要求 `debugPrint` 在测试体返回之前就还原，放 `addTearDown` 会触发「foundation debug variable was changed」断言——测试里用 `try/finally`。
4. 设备上验证用了「后台连拍 + `touch_path` 保持」：`simctl screenshot` 在拖动中途抓帧，才拍到模糊那一帧。
