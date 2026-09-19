# Tasks: vant 兼容剩余差异收尾

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（第二步 overlay 开工前先定，第一步不涉及）

- [x] T001 定 overlay 第二步的 op 契约：op 号分配、载荷形状、JS/Dart 两侧
      命名，写成对照表存进本 spec 目录（`contract.md`）——动 `ops.ts` /
      `ui_ops.dart` 之前先有这张表
      （结论：预留标签 `fjs-overlay-host`，零 op 变更）

## 实现：CSS 引擎基础（后面几条都依赖）

- [x] T010 `packages/fjs-runtime/src/css/parser.ts`：`parseSelector` 支持
      subject 上的 `::before` / `::after`；不支持的形式（祖先位伪元素、
      `content: attr()` 预留的报文）warnOnce。补 parse 单测（css.test.ts）
- [x] T011 `packages/fjs-runtime/src/css/style.ts`：伪规则按
      （元素，before/after）归并并暴露查询接口；类切换增删伪规则要触发
      重算。补单测
- [x] T012 `packages/fjs-runtime/src/css/style.ts`：`display:
      inline-block/inline` 映射 `flex + row + wrap`；`position: fixed`
      打 hoist 标记。补单测（含「不覆盖显式 flex-direction」）

## 实现：弹层第一步（JS hoist）

- [x] T013 `packages/fjs-runtime/src/vue/renderer.ts`：惰性创建 overlay
      host（页面根下、内容之后的兄弟盒，`position: absolute; inset: 0`）
- [x] T014 `packages/fjs-runtime/src/vue/renderer.ts`：`nodeOps.insert/
      remove` 对 hoist 元素做「逻辑父 → overlay host」的对称翻译；补回归
      （`v-model:show` 反复开关、keep-alive 切页再切回）

## 实现：伪元素合成

- [x] T015 `packages/fjs-runtime/src/vue/renderer.ts`：引擎 restyle 回调里
      按 T011 的接口合成/增删/更新伪子节点（first/last 位、`content`
      文本走 text 子节点、Vue anchor 撞伪节点时回退追加）。补「伪节点 +
      v-if 兄弟共存」测试

## 实现：行内流与 % 圆角

- [x] T016 `packages/flutter_fjs/lib/src/render/flex.dart`：`_flexChild`
      的 cross 拉伸跳过 `display: inline-block` 子项（收缩盒）。补
      pseudo_layout_test
- [x] T017 `packages/flutter_fjs/lib/src/render/style_parse.dart` +
      `style.dart`：逐角 border-radius 解析（px + 分率，1~4 值展开，
      `a / b` 椭圆形式 warnOnce 丢弃）。补单测
- [x] T018 `packages/flutter_fjs/lib/src/render/decoration.dart`：带分率角
      进 LayoutBuilder，按盒尺寸解 `Radius.elliptical`。补 widget 测试
      （50% 方盒 → 圆形）

## 实现：溢出红条（先诊断后修）

- [x] T019 用 DevTools / debugDumpRenderTree 定位 checkbox/radio 行 ~5px
      溢出的 RenderFlex 与根因，结论记进本目录（`notes.md`）
      （未再复现；根因未直接证实，推断见 notes.md）
- [x] T020 修根因并验证该盒 `overflow: hidden` 裁剪生效；补回归测试
      （绝对子项不再参与行内布局；回归 vant_layout_test.dart）

## 两端对齐

- [x] T021 web 侧零改动确认：五条差异在 web 天然不成立，对拍记录写进
      `notes.md`（宪法 I 登记义务）
- [x] T022 demo 三个 vant 页 iOS ↔ web 逐屏对拍：弹层遮罩/贴底/点遮罩、
      Stepper 横排 + v-model 两端各点一次、Radio 圆点、Cell 发丝线、
      Checkbox 对勾、debug 无溢出红条
      （对拍表与验证期 12 条引擎修复见 notes.md）
- [x] T023 hello-fjs 画廊页跑一遍（`pnpm --filter hello-fjs run
      build:pages` + 真机/浏览器），确认 inline-block 映射无意外横排
      （2026-09-19：build:pages 全过；浏览器过检 flex 布局/表单/textarea 页，
      无意外横排。画廊不用 inline-block，映射仅显式声明生效）

## 扩展对比测试（用户新增要求，2026-09-19）

- [x] T033 新增 demo 页 vant-more（NoticeBar/Collapse/Card/Progress/Circle/
      Steps/CountDown/Skeleton/Empty/TextEllipsis）与 vant-nav（NavBar(fixed)/
      Tabs/Sidebar/Swipe/Popup+Picker/NumberKeyboard/Tabbar(fixed)），注册
      24 个新组件（plugins/vant.ts + vant-components.d.ts，现 44 个）
- [x] T034 web ↔ iOS 模拟器逐屏对比 + 交互实测（Tabs 切换、展开收起、
      Picker 确认、键盘触屏输入），差异 D1–D12 记入 notes.md「第二轮记录」
- [x] T035 修复 overlay host 单例跨页失效（renderer.ts，回归测试已验证
      带修绿/不带修红）；native vm.cpp 微任务 job 抛错改上报后继续排空；
      `tool/build-apple.sh` 重建预编译产物（overlay 第二步首次真正上设备）
- [ ] T036（遗留→下个 spec 首项）含关闭态弹层的页面在第二步 overlay 引擎上
      整页空白（D1）与 NavBar(fixed) top:0 失效（D3）；vant-feedback 弹层
      滚动验收被其阻塞，待修复后在设备上补测

## 第二步：Dart 置顶 overlay（依赖 T001 契约表与第一步落地）

- [x] T024 `packages/fjs-runtime/src/ui/ops.ts` +
      `packages/flutter_fjs/lib/src/ui_ops.dart`：按 T001 对照表成对新增
      overlay 挂载 op
      （按 contract.md 零 op 变更，无需改 ops.ts / ui_ops.dart）
- [x] T025 Dart 宿主（`fjs run` 的 host main.dart 生成段 +
      `FjsApp`/引擎层）：顶层 overlay 容器，弹层不随页面滚动
      （overlay_host_adapter.dart：OverlayPortal 渲染到根 Overlay）
- [x] T026 `renderer.ts`：hoist 切换到 overlay 通道；验收「弹层打开时滚动
      页面，遮罩与弹层不动」
      （结构上不随滚动；demo 页不足一屏，未在设备上实际滚动验证）

## 文档

- [x] T027 `docs/css-compat.md`：伪元素 ❌→✅（限装饰型）、
      `border-radius` % ❌→✅、`position: fixed` 行为登记、行内流等效
      范围与行为变化说明
- [x] T028 `docs/ui-api.md`：overlay 宿主条目（若第二步走新标签/op）

## 验收

- [x] T029 `pnpm run typecheck` 全 workspace
- [x] T030 `pnpm test`
- [x] T031 `cd packages/flutter_fjs && flutter test`
- [x] T032 spec.md 第 6 节逐条核对（弹层两步形态、Stepper、圆点、发丝线、
      对勾、红条消失）
      （2026-09-19：验收 1 测试全绿（typecheck/vitest 811/flutter 364/fjs-test）；
      验收 2/4 以 T022 记录为准——注意那是旧引擎结论，新引擎上需连 T036 重跑；
      验收 3 弹层滚动实测被 D1 阻塞；验收 5 已完成）
